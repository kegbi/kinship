/**
 * Recording a gift or a debt, and moving one to its next status.
 *
 * All four writes run the same errand: establish the actor under lock, ask the
 * workspace whether the currency is one it supports, let the repository do the
 * work, and audit it. What may be written and where a status may move are
 * decided by `domain/gift_rules.ts` before any of that starts, so the order of
 * the steps is all that is left here.
 *
 * A gift is the awkward one, because its attachment lives in another module: a
 * create has to validate the file first and attach it afterwards, and a
 * boundary that refuses in between has to unwind the whole transaction rather
 * than commit a gift whose file never arrived.
 *
 * A create may carry a retry key (MCP-D3). It derives the record's id, a lock
 * on that id serializes retries of one request, and a retry finds the record
 * the first attempt wrote: the same proposal returns it, a different one is a
 * conflict, and a record since deleted is never written again. A status
 * change may carry the revision it was read at, and a stale one changes
 * nothing.
 */

import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import {
  type SettlementDetails,
  settlementDetails,
} from "../domain/debt_settlements.ts";
import { recordSettlement } from "./debt_settlements.ts";
import {
  canTransitionDebt,
  canTransitionGift,
  type CreateDebtInput,
  type CreateGiftInput,
  DEBT_ID_NAMESPACE,
  debtMatchesCreate,
  type DebtRecord,
  type DebtStatus,
  type DebtValues,
  GIFT_ID_NAMESPACE,
  giftMatchesCreate,
  type GiftRecord,
  type GiftStatus,
  type GiftValues,
  normalizeDebt,
  normalizeGift,
} from "../domain/gift_rules.ts";
import type { GiftActor, GiftTransaction } from "../ports/context.ts";
import {
  active,
  AttachmentFailure,
  type GiftManagementDependencies,
  type GiftMutationFailure,
  mutationFailure,
  recordId,
  represent,
  requestKey,
  type Revision,
  staleRevision,
  unreplayable,
} from "./gift_context.ts";

/** What a retried gift create answers, or nothing on its first attempt. */
async function replayedGift(
  dependencies: GiftManagementDependencies,
  actor: GiftActor,
  personId: string,
  id: string,
  values: GiftValues,
  attachmentFileId: string | undefined,
  transaction: GiftTransaction,
): Promise<
  | { readonly gift: GiftRecord; readonly status: "created" }
  | GiftMutationFailure
  | undefined
> {
  const found = await dependencies.repository.findGift({
    ...actor,
    id,
    personId,
    transaction,
  });
  if (found.status === "found") {
    const gift = await represent(dependencies, actor, found.gift, transaction);
    return giftMatchesCreate(gift, values, attachmentFileId?.toLowerCase())
      ? { gift, status: "created" }
      : { status: "idempotency-conflict" };
  }
  if (found.status === "archived-write-rejected") return found;
  return await unreplayable(
    dependencies,
    actor,
    "gift",
    id,
    () => dependencies.repository.giftExists({ ...actor, id, transaction }),
    transaction,
  );
}

/**
 * What a retried debt create answers, or nothing on its first attempt. A debt
 * created settled is the same proposal only if its first settlement, the one
 * the create wrote under the debt's own id, carries the same details.
 */
async function replayedDebt(
  dependencies: GiftManagementDependencies,
  actor: GiftActor,
  personId: string,
  id: string,
  values: DebtValues,
  details: SettlementDetails,
  transaction: GiftTransaction,
): Promise<
  | { readonly debt: DebtRecord; readonly status: "created" }
  | GiftMutationFailure
  | undefined
> {
  const found = await dependencies.repository.findDebt({
    ...actor,
    id,
    personId,
    transaction,
  });
  if (found.status === "found") {
    if (!debtMatchesCreate(found.debt, values)) {
      return { status: "idempotency-conflict" };
    }
    if (values.status === "settled") {
      const settlement = await dependencies.repository.findSettlement({
        ...actor,
        debtId: id,
        id,
        transaction,
      });
      if (
        settlement?.reason !== details.settlementReason ||
        settlement?.photoFileId !==
          details.settlementPhotoFileId?.toLowerCase()
      ) return { status: "idempotency-conflict" };
    }
    return { debt: found.debt, status: "created" };
  }
  if (found.status === "archived-write-rejected") return found;
  return await unreplayable(
    dependencies,
    actor,
    "debt",
    id,
    () => dependencies.repository.debtExists({ ...actor, id, transaction }),
    transaction,
  );
}

export function createGiftWrites(dependencies: GiftManagementDependencies) {
  return {
    deleteDebt: async (actor: GiftActor, personId: string, id: string) => {
      const occurredAt = dependencies.clock.now();
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const deleted = await dependencies.repository.deleteDebt({
            ...actor,
            id,
            personId,
            transaction,
          });
          if (deleted.status !== "deleted") return deleted;
          await dependencies.audit.record({
            action: "deleted",
            actor,
            occurredAt,
            record: deleted.debt,
            recordType: "debt",
            transaction,
          });
          return { debtId: deleted.debt.id, status: "deleted" as const };
        },
        { workspaceId: actor.workspaceId },
      );
    },
    createGift: async (
      actor: GiftActor,
      personId: string,
      input: CreateGiftInput,
    ): Promise<
      | { readonly gift: GiftRecord; readonly status: "created" }
      | GiftMutationFailure
    > => {
      const values = normalizeGift(input);
      const requestId = requestKey(input.requestId);
      if (!values || requestId === false) return { status: "validation-error" };
      const occurredAt = dependencies.clock.now();
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const id = await recordId(
            dependencies,
            GIFT_ID_NAMESPACE,
            actor,
            requestId,
          );
          if (requestId) {
            await dependencies.repository.lockRequest({ id, transaction });
            const replay = await replayedGift(
              dependencies,
              actor,
              personId,
              id,
              values,
              input.attachmentFileId,
              transaction,
            );
            if (replay) return replay;
          }
          if (input.attachmentFileId) {
            const valid = await dependencies.attachments.validateForGift({
              ...actor,
              fileId: input.attachmentFileId,
              transaction,
            });
            if (valid.status !== "ready") return valid;
          }
          if (
            values.currencyCode &&
            !await dependencies.currencies.isSupported({
              code: values.currencyCode,
              transaction,
            })
          ) return { status: "validation-error" as const };
          const created = await dependencies.repository.createGift({
            ...actor,
            ...values,
            id,
            occurredAt,
            personId,
            transaction,
          });
          if (created.status !== "created") return created;
          let representedGift = created.gift;
          if (input.attachmentFileId) {
            const attached = await dependencies.attachments.attachToGift({
              ...actor,
              fileId: input.attachmentFileId,
              giftId: created.gift.id,
              transaction,
            });
            if (attached.status !== "attached") {
              throw new AttachmentFailure(attached.status);
            }
            representedGift = await represent(
              dependencies,
              actor,
              created.gift,
              transaction,
            );
            if (!representedGift.attachmentFileId) {
              throw new AttachmentFailure("not-found");
            }
          }
          await dependencies.audit.record({
            action: "created",
            actor,
            occurredAt,
            record: representedGift,
            recordType: "gift",
            transaction,
          });
          return { gift: representedGift, status: "created" as const };
        }, { workspaceId: actor.workspaceId });
      } catch (error) {
        return mutationFailure(error);
      }
    },

    createDebt: async (
      actor: GiftActor,
      personId: string,
      input: CreateDebtInput,
    ): Promise<
      | { readonly debt: DebtRecord; readonly status: "created" }
      | GiftMutationFailure
    > => {
      const values = normalizeDebt(input);
      const requestId = requestKey(input.requestId);
      if (!values || requestId === false) return { status: "validation-error" };
      const details = settlementDetails(input);
      if (
        !details ||
        (values.status !== "settled" && Object.keys(details).length > 0)
      ) return { status: "validation-error" };
      const occurredAt = dependencies.clock.now();
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const id = await recordId(
            dependencies,
            DEBT_ID_NAMESPACE,
            actor,
            requestId,
          );
          if (requestId) {
            await dependencies.repository.lockRequest({ id, transaction });
            const replay = await replayedDebt(
              dependencies,
              actor,
              personId,
              id,
              values,
              details,
              transaction,
            );
            if (replay) return replay;
          }
          if (
            !await dependencies.currencies.isSupported({
              code: values.currencyCode,
              transaction,
            })
          ) return { status: "validation-error" as const };
          const created = await dependencies.repository.createDebt({
            ...actor,
            ...values,
            id,
            occurredAt,
            personId,
            ...(values.status === "settled" ? { settledAt: occurredAt } : {}),
            transaction,
          });
          if (created.status !== "created") return created;
          if (values.status === "settled") {
            // A retried create finds this first settlement by the debt's id.
            await recordSettlement(
              dependencies,
              actor,
              personId,
              created.debt.id,
              occurredAt,
              details,
              transaction,
              requestId ? created.debt.id : undefined,
            );
          }
          await dependencies.audit.record({
            action: "created",
            actor,
            occurredAt,
            record: created.debt,
            recordType: "debt",
            transaction,
          });
          return created;
        }, { workspaceId: actor.workspaceId });
      } catch (error) {
        return mutationFailure(error);
      }
    },

    changeGiftStatus: async (
      actor: GiftActor,
      personId: string,
      id: string,
      status: GiftStatus,
      revision: Revision = {},
    ) => {
      const occurredAt = dependencies.clock.now();
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const found = await dependencies.repository.findGift({
            ...actor,
            id,
            personId,
            transaction,
          });
          if (found.status !== "found") return found;
          if (staleRevision(found.gift.updatedAt, revision)) {
            return { status: "stale" as const };
          }
          if (found.gift.status === status) {
            return { gift: found.gift, status: "unchanged" as const };
          }
          if (!canTransitionGift(found.gift.status, status)) {
            return { status: "invalid-transition" as const };
          }
          const saved = await dependencies.repository.saveGift({
            ...actor,
            id,
            occurredAt,
            personId,
            status,
            transaction,
          });
          if (saved.status !== "saved") return saved;
          const representedGift = await represent(
            dependencies,
            actor,
            saved.gift,
            transaction,
          );
          await dependencies.audit.record({
            action: "changed",
            actor,
            occurredAt,
            record: representedGift,
            recordType: "gift",
            transaction,
          });
          return { gift: representedGift, status: "saved" as const };
        }, { workspaceId: actor.workspaceId });
      } catch (error) {
        return mutationFailure(error);
      }
    },

    changeDebtStatus: async (
      actor: GiftActor,
      personId: string,
      id: string,
      status: DebtStatus,
      input: SettlementDetails = {},
      revision: Revision = {},
    ) => {
      const details = settlementDetails(input);
      if (
        !details || (status !== "settled" && Object.keys(details).length > 0)
      ) return { status: "validation-error" as const };
      const occurredAt = dependencies.clock.now();
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const found = await dependencies.repository.findDebt({
            ...actor,
            id,
            personId,
            transaction,
          });
          if (found.status !== "found") return found;
          // Checked before anything is written, so a stale settle appends no
          // settlement history.
          if (staleRevision(found.debt.updatedAt, revision)) {
            return { status: "stale" as const };
          }
          if (found.debt.status === status) {
            return { debt: found.debt, status: "unchanged" as const };
          }
          if (!canTransitionDebt(found.debt.status, status)) {
            return { status: "invalid-transition" as const };
          }
          const saved = await dependencies.repository.saveDebt({
            ...actor,
            id,
            occurredAt,
            personId,
            ...(status === "settled" ? { settledAt: occurredAt } : {}),
            status,
            transaction,
          });
          if (saved.status !== "saved") return saved;
          if (status === "settled") {
            await recordSettlement(
              dependencies,
              actor,
              personId,
              id,
              occurredAt,
              details,
              transaction,
            );
          }
          await dependencies.audit.record({
            action: "changed",
            actor,
            occurredAt,
            record: saved.debt,
            recordType: "debt",
            transaction,
          });
          return saved;
        }, { workspaceId: actor.workspaceId });
      } catch (error) {
        return mutationFailure(error);
      }
    },
  };
}
