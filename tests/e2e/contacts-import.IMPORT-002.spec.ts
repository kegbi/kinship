import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { deletePerson, registerVerified } from "./support/api.ts";
import { databaseValue, sqlLiteral } from "./support/database.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { submitSignIn } from "./support/sign-in.ts";

const fixture = (name: string) =>
  readFileSync(resolve(process.cwd(), "tests/e2e/fixtures", name));

async function openNewImport(page: Page, source: "CSV" | "vCard") {
  await page.goto("/app/settings/import/new");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "settings.import-new",
  );
  await page.getByLabel(source, { exact: true }).check();
}

async function commit(page: Page, expected: string) {
  await page.getByLabel("I confirm this validated import").check();
  await page.getByRole("button", { name: "Commit import" }).click();
  await expect(page.getByText(expected)).toBeVisible();
}

test("[IMPORT-002] imports contacts from vCard and CSV without duplicates", {
  annotation: [{ type: "flow", description: "IMPORT-002" }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const email = `contacts-${browserName}-${Date.now()}@example.test`;
  await registerVerified(request, {
    email,
    firstName: "Contacts",
    lastName: "Admin",
    workspaceName: "Contacts circle",
  }, bareToken);
  await submitSignIn(page, email);
  const workspaceId = databaseValue(
    `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
      sqlLiteral(email)
    }`,
  );
  // The Email type is made as a member makes it, with its kind set.
  await page.goto("/app/settings/personalization?section=contact-method-types");
  await expect(
    page.getByRole("heading", { name: "Contact method types", exact: true }),
  ).toBeVisible();
  const create = page.locator("#personalization-create");
  await create.getByLabel("New option name").fill("Email");
  await create.getByLabel("New option kind").selectOption("email");
  await create.getByRole("button", { name: "Create option" }).click();
  await expect(page.locator("#personalization-status")).toHaveText(
    "Option created.",
  );
  await expect(page.getByLabel("Kind for Email")).toHaveValue("email");
  const people = () =>
    databaseValue(
      `select count(*)::text from crm.people where workspace_id = '${workspaceId}'::uuid`,
    );

  const importVCard = async (expected: string, diagnostic?: string) => {
    await openNewImport(page, "vCard");
    await page.getByLabel("vCard file").setInputFiles({
      buffer: fixture("contacts.vcf"),
      mimeType: "text/vcard",
      name: "contacts.vcf",
    });
    await expect(page.getByText("vCard file detected.")).toBeVisible();
    await page.getByRole("button", { name: "Validate dry run" }).click();
    await expect(page.getByText("Dry run complete.")).toBeVisible();
    await expect(page.locator("[data-import-contacts]")).toHaveText("2");
    await expect(page.locator("[data-import-diagnostics]")).toContainText(
      "PHOTO (1). Photos are not imported.",
    );
    await expect(page.locator("[data-import-diagnostics]")).toContainText(
      "1 phone number will be skipped",
    );
    if (diagnostic) {
      await expect(page.locator("[data-import-diagnostics]")).toContainText(
        diagnostic,
      );
    }
    await commit(page, expected);
  };
  await importVCard("2 created, 0 reused");
  await expectAccessible(page);
  await importVCard("0 created, 2 reused");
  expect(people()).toBe("2");

  // A person the member deleted stays deleted on the next import and is
  // reported as skipped (REL-065).
  await deletePerson(
    page.request,
    databaseValue(
      `select id::text from crm.people where workspace_id = '${workspaceId}'::uuid and given_name = 'Charles'`,
    ),
  );
  await importVCard(
    "0 created, 1 reused, 1 skipped because it was deleted",
    "1 contact was imported before and its person was deleted since; it will be skipped and stay deleted.",
  );
  expect(people()).toBe("2");

  const stageCsv = async () => {
    await openNewImport(page, "CSV");
    await page.getByLabel("CSV file").setInputFiles({
      buffer: fixture("contacts.csv"),
      mimeType: "text/csv",
      name: "contacts.csv",
    });
    await expect(page.getByText("CSV file detected.")).toBeVisible();
    await page.getByRole("button", { name: "Validate dry run" }).click();
    await expect(page.getByRole("heading", { name: "Map columns" }))
      .toBeVisible();
  };
  const applyMapping = async () => {
    await expect(page.getByLabel("E-mail")).toHaveValue("email");
    await expect(page.getByLabel("Shoe size")).toHaveValue("ignore");
    await page.getByLabel("Birthday").selectOption("birthday");
    await page.getByRole("button", { name: "Apply mapping" }).click();
    await expect(page.getByText("Dry run complete.")).toBeVisible();
    await expect(page.locator("[data-import-contacts]")).toHaveText("2");
    await expect(page.locator("[data-import-diagnostics]")).toContainText(
      "1 row with no name, email, or phone will be skipped.",
    );
    await expect(page.locator("[data-import-diagnostics]")).toContainText(
      "1 duplicate row in this file will be imported once.",
    );
  };
  await stageCsv();
  await expect(page.getByRole("cell", { name: "grace@example.com" }).first())
    .toBeVisible();
  await expectAccessible(page);
  await applyMapping();
  await commit(page, "2 created, 0 reused");
  expect(people()).toBe("4");

  // A CSV import left at its mapping step resumes from the import history.
  await stageCsv();
  await page.goto("/app/settings/import");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "settings.import",
  );
  const pending = page.getByRole("link", { name: "4 rows · CSV" });
  await expect(pending).toBeVisible();
  await expect(page.locator("[data-import-history]")).toContainText(
    "Awaiting column mapping",
  );
  await pending.click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "settings.import-new",
  );
  await expect(page.getByRole("heading", { name: "Map columns" }))
    .toBeVisible();
  await applyMapping();
  await expect(page.locator("[data-import-diagnostics]")).toContainText(
    "2 contacts were imported before and will be reused.",
  );
  await commit(page, "0 created, 2 reused");
  expect(people()).toBe("4");
});
