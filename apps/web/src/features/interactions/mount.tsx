/**
 * Mounting Quick capture into the application layout (GAP-031).
 *
 * `ApplicationLayout.astro` reserves `[data-quick-capture-root]` on every
 * protected page and loads this with the people palette, so the two islands
 * share one React runtime and the shell's vanilla modules start without
 * waiting for it. The dialog renders through a portal; the root holds only
 * the island's readiness marker. Mounting again while it is mounted keeps the
 * one owner, and whatever it has in flight, rather than starting a second.
 */

import { mountIsland } from "../../islands/core/index.ts";
import { QuickCapture } from "./quick-capture.tsx";
import { profilePersonId } from "./shared.ts";

export const QUICK_CAPTURE_ISLAND = "quick-capture";

/** Mounts Quick capture and answers the function that unmounts it. */
export function mountQuickCapture(): () => void {
  const root = document.querySelector<HTMLElement>("[data-quick-capture-root]");
  if (!root || root.dataset.island) return () => undefined;
  return mountIsland(
    root,
    QUICK_CAPTURE_ISLAND,
    <QuickCapture preferredId={profilePersonId()} />,
  );
}
