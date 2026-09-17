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
 */

import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import {
  canTransitionDebt,
  canTransitionGift,
  type CreateDebtInput,
  type CreateGiftInput,
  type DebtRecord,
  type DebtStatus,
  type GiftRecord,
  type GiftStatus,
  normalizeDebt,
  normalizeGift,
} from "../domain/gift_rules.ts";
import type { GiftActor } from "../ports/context.ts";
import {
  active,
  AttachmentFailure,
  type GiftManagementDependencies,
  type GiftMutationFailure,
  mutationFailure,
  represent,
} from "./gift_context.ts";

export function createGiftWrites(dependencies: GiftManagementDependencies) {
  return {
    createGift: async (
      actor: GiftActor,
      personId: string,
      input: CreateGiftInput,
    ): Promise<
      | { readonly gift: GiftRecord; readonly status: "created" }
      | GiftMutationFailure
    > => {
      const values = normalizeGift(input);
      if (!values) return { status: "validation-error" };
      const occurredAt = dependencies.clock.now();
      try {
        return await dependencies.transaction.run(async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
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
            id: dependencies.ids.next(),
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
        });
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
      if (!values) return { status: "validation-error" };
      const occurredAt = dependencies.clock.now();
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
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
            id: dependencies.ids.next(),
            occurredAt,
            personId,
            ...(values.status === "settled" ? { settledAt: occurredAt } : {}),
            transaction,
          });
          if (created.status !== "created") return created;
          await dependencies.audit.record({
            action: "created",
            actor,
            occurredAt,
            record: created.debt,
            recordType: "debt",
            transaction,
          });
          return created;
        },
      );
    },

    changeGiftStatus: async (
      actor: GiftActor,
      personId: string,
      id: string,
      status: GiftStatus,
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
        });
      } catch (error) {
        return mutationFailure(error);
      }
    },

    changeDebtStatus: async (
      actor: GiftActor,
      personId: string,
      id: string,
      status: DebtStatus,
    ) => {
      const occurredAt = dependencies.clock.now();
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
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
          await dependencies.audit.record({
            action: "changed",
            actor,
            occurredAt,
            record: saved.debt,
            recordType: "debt",
            transaction,
          });
          return saved;
        },
      );
    },
  };
}
