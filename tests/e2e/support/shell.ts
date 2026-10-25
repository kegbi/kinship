import { expect, type Page } from "@playwright/test";

/* Page object for the protected application shell's header. */

/** Opens the member menu with a click unless it is already open. */
export async function openMemberPopover(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Open member menu" });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/**
 * Tabs from the top of the page through every header destination to the
 * member menu toggle, asserting the focus order on the way.
 */
export async function keyboardReachMemberMenuToggle(page: Page): Promise<void> {
  // Quick capture stays disabled, and out of the Tab order, until its handlers
  // are wired after the session and preferences load (REL-039).
  await expect(page.getByRole("button", { name: "Quick capture" }))
    .toBeEnabled();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Kinship Today" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Today", exact: true }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "People", exact: true }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Tasks", exact: true }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Journal", exact: true }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Find a person" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Quick capture" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Add person" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: /^Theme: / })).toBeFocused();
  await page.keyboard.press("Tab");
  const menuToggle = page.getByRole("button", { name: "Open member menu" });
  await expect(menuToggle).toBeFocused();
}

/** Reaches the member menu toggle by keyboard and opens it with Enter. */
export async function keyboardOpenMemberMenu(page: Page): Promise<void> {
  await keyboardReachMemberMenuToggle(page);
  const menuToggle = page.getByRole("button", { name: "Open member menu" });
  await page.keyboard.press("Enter");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
}
