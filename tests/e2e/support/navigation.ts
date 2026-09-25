import type { Page } from "@playwright/test";

/**
 * Waits for the `load` event of the page's current document. `toHaveURL`
 * passes as soon as an app-driven navigation commits, while that document is
 * still loading; a spec's own `goto` or `reload` issued then interrupts the
 * load, which Linux WebKit reports as "WebKit encountered an internal error"
 * (REL-042). Call this after an app-driven navigation and before the spec
 * navigates on its own.
 */
export async function settleNavigation(page: Page): Promise<void> {
  await page.waitForLoadState("load");
}
