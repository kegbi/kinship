import { expect, type Page } from "@playwright/test";
import { settlePersonWorkspace } from "./navigation.ts";

/* Page object for the people directory and its create page. */

/**
 * Saves a new person through `/app/people/new` and returns the path of the
 * person workspace it opens. The workspace may still be loading.
 */
export async function saveNewPerson(
  page: Page,
  givenName: string,
  familyName: string,
): Promise<string> {
  await page.goto("/app/people/new");
  await page.getByLabel("Given name").fill(givenName);
  await page.getByLabel("Family name").fill(familyName);
  await page.getByRole("button", { name: "Save person", exact: true })
    .click();
  await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
  return new URL(page.url()).pathname;
}

/**
 * Saves a new person through the UI and waits until its workspace has
 * settled (REL-046), then returns the workspace path.
 */
export async function createPersonThroughUi(
  page: Page,
  givenName: string,
  familyName: string,
): Promise<string> {
  await saveNewPerson(page, givenName, familyName);
  await settlePersonWorkspace(page);
  return new URL(page.url()).pathname;
}
