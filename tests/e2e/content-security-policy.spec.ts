/// <reference lib="dom" />
import { captureScreenshot } from "./support/screenshot.ts";
import { expect, test } from "./support/test.ts";

/*
 * AUD-G3 positive control for the policy-violation collector every spec runs
 * under (`support/test.ts`): the gateway's CSP allows no inline style, so an
 * injected `<style>` element and a `style` attribute in markup are refused and
 * reported, while a CSSOM write, which React and Base UI positioning use, is
 * not.
 */
test("the policy-violation collector reports injected inline styles", async ({ page, policyViolations }) => {
  await page.goto("/");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "public.home",
  );
  expect(await policyViolations.take()).toEqual([]);

  // What Playwright itself adds to take a screenshot is not the product's.
  await captureScreenshot(page);
  expect(await policyViolations.take()).toEqual([]);

  await page.evaluate(() => {
    const element = document.createElement("style");
    element.textContent = "main { outline: 3px solid red; }";
    document.head.append(element);
    document.body.insertAdjacentHTML(
      "beforeend",
      '<p data-injected style="outline: 3px solid red">Injected</p>',
    );
    document.body.style.setProperty("outline", "1px solid transparent");
  });

  const violations = await policyViolations.take();
  expect(violations.map(({ directive }) => directive).sort()).toEqual([
    "style-src-attr",
    "style-src-elem",
  ]);
  for (const violation of violations) {
    expect(violation.blocked).toBe("inline");
    expect(new URL(violation.document).pathname).toBe("/");
  }
  await expect(page.locator("main")).not.toHaveCSS(
    "outline-color",
    "rgb(255, 0, 0)",
  );
  await expect(page.locator("[data-injected]")).not.toHaveCSS(
    "outline-color",
    "rgb(255, 0, 0)",
  );
  await expect(page.locator("body")).toHaveCSS(
    "outline-style",
    "solid",
  );
});
