/**
 * One person's gifts and debts.
 *
 * The read is lock-free and asks for everything the page needs at once: the
 * rows, the attachment links the files module owns, and the currencies the
 * workspace supports, so a page costs a fixed handful of queries. Joining the
 * links onto the gifts is a rule, and it lives in `domain/gift_rules.ts`.
 */

import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import { hydrateGifts } from "../domain/gift_rules.ts";
import type { GiftActor } from "../ports/context.ts";
import { active, type GiftManagementDependencies } from "./gift_context.ts";

export function createGiftListing(dependencies: GiftManagementDependencies) {
  return {
    list: async (actor: GiftActor, personId: string) => {
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, false)) {
            return { status: "forbidden" as const };
          }
          const records = await dependencies.repository.list({
            ...actor,
            personId,
            transaction,
          });
          if (records.status !== "ready") return records;
          const [attachments, supportedCurrencyCodes] = await Promise.all([
            dependencies.attachments.listForGifts({
              ...actor,
              giftIds: records.gifts.map((gift) => gift.id),
              transaction,
            }),
            dependencies.currencies.listSupported({ transaction }),
          ]);
          if (attachments.status !== "ready") return attachments;
          return {
            debts: records.debts,
            gifts: hydrateGifts(records.gifts, attachments.links),
            status: "ready" as const,
            supportedCurrencyCodes,
          };
        },
      );
    },
  };
}
