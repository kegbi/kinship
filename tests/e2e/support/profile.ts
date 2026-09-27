import { expect, type Page } from "@playwright/test";

/* Page object for the canonical person workspace, `/app/people/:personId`. */

/** Opens the person menu with a click unless it is already open. */
export async function openPersonMenu(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Open person menu" });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}
