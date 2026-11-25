import type { Page, PageScreenshotOptions } from "@playwright/test";

/** The pages being captured whose one Playwright style is still to come. */
const expecting = new Set<Page>();

/**
 * Whether a refused inline style element of `page` is the one Playwright adds
 * while `captureScreenshot` runs. It answers yes once for each screenshot, so
 * a style the product ships at that moment is still reported.
 */
export function takePlaywrightStyle(page: Page): boolean {
  return expecting.delete(page);
}

/**
 * Takes a screenshot under the policy guard every spec runs under (`test.ts`).
 * Before one, Playwright adds an empty `<style>` element to a WebKit page's
 * document to bring its animations up to date, and no option turns that off.
 * The page's Content-Security-Policy refuses it, so the guard leaves out that
 * one refusal.
 */
export async function captureScreenshot(
  page: Page,
  options: PageScreenshotOptions = {},
): Promise<Buffer> {
  if (page.context().browser()?.browserType().name() === "webkit") {
    expecting.add(page);
  }
  try {
    const screenshot = await page.screenshot(options);
    // A round trip to the page delivers a refusal it has already queued.
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 0)));
    return screenshot;
  } finally {
    expecting.delete(page);
  }
}
