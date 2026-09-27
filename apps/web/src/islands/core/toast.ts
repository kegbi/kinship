/**
 * The bridge from an island to the application's toast region.
 *
 * `ApplicationLayout.astro` renders one `#app-toasts` list, and
 * `features/shell/toasts/toasts.ts` owns its stacking, auto-dismissal, and focus
 * rules. An island announces through that same owner rather than rendering a
 * second region, so the shell and islands share one stack.
 */

import {
  showToast,
  type ToastTone,
} from "../../features/shell/toasts/toasts.ts";

export type { ToastTone };

/** Shows `message` in `#app-toasts`; a page without the region ignores it. */
export function toast(message: string, tone: ToastTone = "info"): void {
  showToast({ message, tone });
}
