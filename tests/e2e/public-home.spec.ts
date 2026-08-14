import { expect, test } from "@playwright/test";

test("public home reports live API readiness and degrades safely", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(/Kinship/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Relationships deserve a place",
  );
  const readiness = page.getByRole("status");
  await expect(readiness).toContainText("API ready");
  await expect(readiness).toHaveAttribute("data-state", "ready");

  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" }))
    .toBeFocused();

  await page.route("**/api/v1/health", (route) => route.abort());
  await page.reload();
  await expect(readiness).toContainText("API temporarily unavailable");
  await expect(readiness).toHaveAttribute("data-state", "unavailable");
  await expect(page.getByRole("main")).toBeVisible();
});
