/**
 * Mounting Quick capture into the application layout (GAP-031).
 *
 * `ApplicationLayout.astro` reserves `[data-quick-capture-root]` on every
 * protected page. The shell imports this on the first click on an opener
 * (FER-01), so a page nobody captures from never loads it, and the island
 * opens from that opener. The dialog renders through a portal; the root holds
 * only the island's readiness marker. Mounting again while it is mounted
 * keeps the one owner, and whatever it has in flight, rather than starting a
 * second.
 */

import { mountIsland } from "../../islands/core/index.ts";
import { QuickCapture } from "./quick-capture.tsx";
import { profilePersonId } from "./shared.ts";

export const QUICK_CAPTURE_ISLAND = "quick-capture";

/**
 * Mounts Quick capture, opening it from `opener` once it is ready, and
 * answers the function that unmounts it.
 */
export function mountQuickCapture(opener?: HTMLButtonElement): () => void {
  const root = document.querySelector<HTMLElement>("[data-quick-capture-root]");
  if (!root || root.dataset.island) return () => undefined;
  return mountIsland(
    root,
    QUICK_CAPTURE_ISLAND,
    <QuickCapture initialOpener={opener} preferredId={profilePersonId()} />,
  );
}
