/**
 * Editing a gift's or a debt's values, and deleting a gift (MCP-D3).
 *
 * Each write is read at a revision: the client sends the `updatedAt` it last
 * saw, the record is locked, and a revision that moved since answers `stale`
 * before anything is written. An edit follows one convention: a field left
 * out keeps its value, `null` clears an optional one, and at least one field
 * is named. Status is not a value here; it keeps its own transition graph.
 *
 * A gift's attachment is the files module's link row, so an edit that moves
 * or clears it asks that module to detach and attach, and a refusal between
 * the gift's write and the link's unwinds the whole transaction. Deleting a
 * gift removes its links by the schema's cascade and leaves the files.
 */

import {
  type DebtChange,
  debtMatchesCreate,
  type DebtRecord,
  debtValuesLocked,
  type GiftChange,
  giftMatchesCreate,
  type GiftRecord,
  mergeDebtChange,
  mergeGiftChange,
} from "../domain/gift_rules.ts";
import { instant } from "../../../shared-kernel/validation.ts";
import type { GiftActor } from "../ports/context.ts";
import {
  active,
  AttachmentFailure,
  type GiftManagementDependencies,
  type GiftMutationFailure,
  mutationFailure,
  represent,
  staleRevision,
} from "./gift_context.ts";

/** The revision an edit or a delete must name. */
export interface RequiredRevision {
  readonly expectedUpdatedAt: string;
}

export function createGiftEdits(dependencies: GiftManagementDependencies) {
  return {
    changeGift: async (
      actor: GiftActor,
      personId: string,
      id: string,
      input: GiftChange & RequiredRevision,
    ): Promise<
      | {
        readonly gift: GiftRecord;
        readonly status: "saved" | "unchanged";
      }
      | GiftMutationFailure
    > => {
      const { expectedUpdatedAt, ...change } = input;
      if (instant(expectedUpdatedAt) === undefined) {
        return { status: "validation-error" };
      }
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
          if (staleRevision(found.gift.updatedAt, { expectedUpdatedAt })) {
            return { status: "stale" as const };
          }
          const current = await represent(
            dependencies,
            actor,
            found.gift,
            transaction,
          );
          const merged = mergeGiftChange(current, change);
          if (!merged) return { status: "validation-error" as const };
          const { status: _status, ...values } = merged.values;
          if (
            values.currencyCode !== undefined &&
            values.currencyCode !== current.currencyCode &&
            !await dependencies.currencies.isSupported({
              code: values.currencyCode,
              transaction,
            })
          ) return { status: "validation-error" as const };
          const attachment = merged.attachmentFileId?.toLowerCase();
          const attachmentChanged = attachment !== current.attachmentFileId;
          if (attachmentChanged && attachment) {
            const valid = await dependencies.attachments.validateForGift({
              ...actor,
              fileId: attachment,
              transaction,
            });
            if (valid.status !== "ready") return valid;
          }
          if (giftMatchesCreate(current, merged.values, attachment)) {
            return { gift: current, status: "unchanged" as const };
          }
          const saved = await dependencies.repository.saveGiftValues({
            ...actor,
            ...values,
            checkRecipient:
              values.recipientPersonId !== current.recipientPersonId,
            id,
            occurredAt,
            personId,
            transaction,
          });
          if (saved.status !== "saved") return saved;
          if (attachmentChanged) {
            if (current.attachmentFileId) {
              const detached = await dependencies.attachments.detachFromGift({
                ...actor,
                giftId: id,
                transaction,
              });
              if (detached.status !== "detached") {
                throw new AttachmentFailure(detached.status);
              }
            }
            if (attachment) {
              const attached = await dependencies.attachments.attachToGift({
                ...actor,
                fileId: attachment,
                giftId: id,
                transaction,
              });
              if (attached.status !== "attached") {
                throw new AttachmentFailure(attached.status);
              }
            }
          }
          const gift = await represent(
            dependencies,
            actor,
            saved.gift,
            transaction,
          );
          if (gift.attachmentFileId !== attachment) {
            throw new AttachmentFailure("not-found");
          }
          await dependencies.audit.record({
            action: "changed",
            actor,
            occurredAt,
            record: gift,
            recordType: "gift",
            transaction,
          });
          return { gift, status: "saved" as const };
        }, { workspaceId: actor.workspaceId });
      } catch (error) {
        return mutationFailure(error);
      }
    },

    deleteGift: async (
      actor: GiftActor,
      personId: string,
      id: string,
      revision: RequiredRevision,
    ): Promise<
      | { readonly giftId: string; readonly status: "deleted" }
      | GiftMutationFailure
    > => {
      if (instant(revision.expectedUpdatedAt) === undefined) {
        return { status: "validation-error" };
      }
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
          const deleted = await dependencies.repository.deleteGift({
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
            record: deleted.gift,
            recordType: "gift",
            transaction,
          });
          return { giftId: id, status: "deleted" as const };
        }, { workspaceId: actor.workspaceId });
      } catch (error) {
        return mutationFailure(error);
      }
    },

    changeDebt: async (
      actor: GiftActor,
      personId: string,
      id: string,
      input: DebtChange & RequiredRevision,
    ): Promise<
      | {
        readonly debt: DebtRecord;
        readonly status: "saved" | "unchanged";
      }
      | GiftMutationFailure
    > => {
      const { expectedUpdatedAt, ...change } = input;
      if (instant(expectedUpdatedAt) === undefined) {
        return { status: "validation-error" };
      }
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
          if (staleRevision(found.debt.updatedAt, { expectedUpdatedAt })) {
            return { status: "stale" as const };
          }
          const next = mergeDebtChange(found.debt, change);
          if (!next) return { status: "validation-error" as const };
          if (
            next.currencyCode !== found.debt.currencyCode &&
            !await dependencies.currencies.isSupported({
              code: next.currencyCode,
              transaction,
            })
          ) return { status: "validation-error" as const };
          if (debtMatchesCreate(found.debt, next)) {
            return { debt: found.debt, status: "unchanged" as const };
          }
          const history = await dependencies.repository.listSettlements({
            ...actor,
            debtId: id,
            limit: 1,
            personId,
            transaction,
          });
          if (
            debtValuesLocked(
              found.debt,
              next,
              history.status !== "ready" || history.settlements.length > 0,
            )
          ) return { status: "debt-values-locked" as const };
          const { status: _status, ...values } = next;
          const saved = await dependencies.repository.saveDebtValues({
            ...actor,
            ...values,
            id,
            occurredAt,
            personId,
            transaction,
          });
          if (saved.status !== "saved") return saved;
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
