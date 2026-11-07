import type { Page } from "@playwright/test";

/**
 * Waits until the React island `name` has hydrated: its root carries
 * `data-island="<name>"` and, once the first render has committed and every
 * handler is attached, `data-island-ready` (ADR 0006). Interacting only after
 * this closes REL-039's click-before-wired class of failure.
 */
export async function waitForIsland(page: Page, name: string): Promise<void> {
  await page.locator(`[data-island="${name}"][data-island-ready]`).waitFor({
    state: "attached",
  });
}

/**
 * Mounts the header's people palette the way a member's first intent does,
 * by focusing its static search field, and waits for it: the palette loads
 * only on intent (FER-01). The field is drawn once the shell is visible.
 */
export async function activateGlobalSearch(page: Page): Promise<void> {
  const field = page.locator("#global-people-search-input");
  await field.waitFor({ state: "visible" });
  await field.focus();
  await waitForIsland(page, "global-people-search");
}
