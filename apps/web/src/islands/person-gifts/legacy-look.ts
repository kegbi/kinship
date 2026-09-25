/**
 * Keeping the vanilla look while the vanilla stylesheet still owns it.
 *
 * The gifts and debts cards sit among sections the person stylesheet draws,
 * and that stylesheet (unlayered) wins every property it sets on the shadcn
 * components the cards render. The ones it never sets would leak through:
 * fixed heights, a tighter line height, flex layout on a textarea that grows
 * with its content, transitions, a press offset, and a focus halo beside the
 * existing focus outline. These utilities cancel exactly those, so the cards
 * look as they did before the island, measured property by property against
 * the vanilla cards. GAP-033 retires the stylesheet, and these go with it.
 */

export const LEGACY_BUTTON =
  "h-auto gap-0 transition-none focus-visible:ring-0 active:not-aria-[haspopup]:translate-y-0";

export const LEGACY_BADGE =
  "h-auto gap-0 border-0 overflow-visible leading-[normal] transition-none";

export const LEGACY_INPUT = "h-auto transition-none focus-visible:ring-0";

export const LEGACY_TEXTAREA =
  "block field-sizing-fixed transition-none focus-visible:ring-0";
