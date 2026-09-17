/**
 * The gifts facade.
 *
 * A person's gifts and debts are read one way and written four, and the two
 * halves share only the context they both establish first. They are assembled
 * here so a composition root still builds a single object with `createGift`,
 * `createDebt`, `changeGiftStatus`, `changeDebtStatus`, and `list` on it, and
 * so the split between `gift_listing.ts` and `gift_writes.ts` stays an
 * internal matter rather than something every caller has to know about.
 */

import { createGiftListing } from "./gift_listing.ts";
import { createGiftWrites } from "./gift_writes.ts";
import type { GiftManagementDependencies } from "./gift_context.ts";

export function createGiftManagement(dependencies: GiftManagementDependencies) {
  const listing = createGiftListing(dependencies);
  const writes = createGiftWrites(dependencies);
  return {
    createGift: writes.createGift,
    createDebt: writes.createDebt,
    changeGiftStatus: writes.changeGiftStatus,
    changeDebtStatus: writes.changeDebtStatus,
    list: listing.list,
  };
}

export type GiftManagement = ReturnType<typeof createGiftManagement>;
