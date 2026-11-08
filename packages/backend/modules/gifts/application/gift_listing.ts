/**
 * One person's gifts and debts, one page of each.
 *
 * The read is lock-free and asks for everything the page needs at once: the
 * rows, the attachment links the files module owns, the currencies the
 * workspace supports, the currency a new debt or gift starts from (the
 * member's preference, else the workspace default, else US dollars), and the
 * person's recurring debt rules, so a page costs a fixed handful of queries.
 * The rules are few by rule, so every answer carries all of them. Joining the
 * links onto the gifts is a rule, and it lives in `domain/gift_rules.ts`.
 *
 * The two collections page independently. A caller continuing gifts sends only
 * the gift cursor and is still served the first page of debts, which is what
 * lets the two profile cards extend without refetching each other. A cursor
 * that does not decode for this workspace, this person, and this collection is
 * a rejected query rather than an empty page.
 */

import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import { decodeGiftCursor, encodeGiftCursor } from "../domain/cursors.ts";
import { hydrateGifts } from "../domain/gift_rules.ts";
import { defaultCurrency } from "../domain/recurring_debts.ts";
import type { GiftActor } from "../ports/context.ts";
import { active, type GiftManagementDependencies } from "./gift_context.ts";

/** The largest page this listing serves, as the contract publishes it. */
export const GIFT_PAGE_LIMIT_MAXIMUM = 50;
/** The page it serves when the caller names no size. */
export const GIFT_PAGE_LIMIT_DEFAULT = 20;

/** Where a caller asked the two collections to resume, and how many rows. */
export interface ListGiftsInput {
  readonly debtCursor?: string;
  readonly giftCursor?: string;
  readonly limit?: number;
}

/** The page size this listing accepts, clamped to what it will serve. */
export function giftPageLimit(limit: number | undefined): number {
  return Math.max(
    1,
    Math.min(
      GIFT_PAGE_LIMIT_MAXIMUM,
      Math.trunc(limit ?? GIFT_PAGE_LIMIT_DEFAULT),
    ),
  );
}

export function createGiftListing(dependencies: GiftManagementDependencies) {
  return {
    list: async (
      actor: GiftActor,
      personId: string,
      input: ListGiftsInput = {},
    ) => {
      const giftAfter = input.giftCursor
        ? decodeGiftCursor(
          "gift",
          input.giftCursor,
          actor.workspaceId,
          personId,
        )
        : undefined;
      const debtAfter = input.debtCursor
        ? decodeGiftCursor(
          "debt",
          input.debtCursor,
          actor.workspaceId,
          personId,
        )
        : undefined;
      if (
        (input.giftCursor && !giftAfter) || (input.debtCursor && !debtAfter)
      ) return { status: "validation-error" as const };
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, false)) {
            return { status: "forbidden" as const };
          }
          const records = await dependencies.repository.list({
            ...actor,
            ...(debtAfter ? { debtAfter } : {}),
            ...(giftAfter ? { giftAfter } : {}),
            limit: giftPageLimit(input.limit),
            personId,
            transaction,
          });
          if (records.status !== "ready") return records;
          const [
            attachments,
            supportedCurrencyCodes,
            preferredCurrency,
            recurringDebts,
          ] = await Promise.all([
            dependencies.attachments.listForGifts({
              ...actor,
              giftIds: records.gifts.map((gift) => gift.id),
              transaction,
            }),
            dependencies.currencies.listSupported({ transaction }),
            dependencies.currencies.preferredFor({
              memberId: actor.memberId,
              transaction,
              workspaceId: actor.workspaceId,
            }),
            dependencies.recurringDebts.listForPerson({
              ...actor,
              personId,
              transaction,
            }),
          ]);
          if (attachments.status !== "ready") return attachments;
          return {
            debts: records.debts,
            defaultCurrencyCode: defaultCurrency(preferredCurrency),
            gifts: hydrateGifts(records.gifts, attachments.links),
            ...(records.nextDebt
              ? {
                nextDebtCursor: encodeGiftCursor(
                  "debt",
                  records.nextDebt,
                  actor.workspaceId,
                  personId,
                ),
              }
              : {}),
            ...(records.nextGift
              ? {
                nextGiftCursor: encodeGiftCursor(
                  "gift",
                  records.nextGift,
                  actor.workspaceId,
                  personId,
                ),
              }
              : {}),
            recurringDebts,
            status: "ready" as const,
            supportedCurrencyCodes,
          };
        },
        { workspaceId: actor.workspaceId },
      );
    },
  };
}
