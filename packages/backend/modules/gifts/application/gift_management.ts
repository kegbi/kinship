/**
 * The gifts facade.
 *
 * A person's gifts and debts are read one way and written several, and the
 * halves share only the context they all establish first. They are assembled
 * here so a composition root still builds a single object with `createGift`,
 * `createDebt`, the status changes, the recurring debt rules, and `list` on it, and
 * so the split between `gift_listing.ts` and `gift_writes.ts` stays an
 * internal matter rather than something every caller has to know about.
 */

import { createGiftListing } from "./gift_listing.ts";
import { createDebtSettlementReads } from "./debt_settlements.ts";
import { createGiftWrites } from "./gift_writes.ts";
import { createRecurringDebtWrites } from "./recurring_debts.ts";
import type { GiftManagementDependencies } from "./gift_context.ts";

export function createGiftManagement(dependencies: GiftManagementDependencies) {
  const listing = createGiftListing(dependencies);
  const writes = createGiftWrites(dependencies);
  const recurring = createRecurringDebtWrites(dependencies);
  return {
    listDebtSettlements: createDebtSettlementReads(dependencies),
    createGift: writes.createGift,
    createDebt: writes.createDebt,
    changeGiftStatus: writes.changeGiftStatus,
    changeDebtStatus: writes.changeDebtStatus,
    deleteDebt: writes.deleteDebt,
    createRecurringDebt: recurring.createRecurringDebt,
    changeRecurringDebt: recurring.changeRecurringDebt,
    deleteRecurringDebt: recurring.deleteRecurringDebt,
    list: listing.list,
  };
}

export type GiftManagement = ReturnType<typeof createGiftManagement>;
