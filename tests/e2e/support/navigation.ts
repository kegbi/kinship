import { expect, type Page } from "@playwright/test";

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

/**
 * Waits until the person workspace the page shows has nothing left in flight:
 * its first sections have answered and its view is recorded, which the
 * workspace marks with `data-workspace-settled`. The workspace keeps loading
 * section code and reading after `load`, so a spec that navigates away then
 * cancels those requests, after which Linux WebKit left the next page's API
 * requests unanswered (REL-046). Call this before leaving a person workspace
 * the spec only created and does not otherwise wait on.
 */
export async function settlePersonWorkspace(page: Page): Promise<void> {
  await settleNavigation(page);
  await expect(page.locator("#person-profile-ready")).toHaveAttribute(
    "data-workspace-settled",
    "",
  );
}
