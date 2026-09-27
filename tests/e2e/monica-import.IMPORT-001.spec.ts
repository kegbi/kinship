import { expect, test } from "@playwright/test";
import { registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { submitSignIn } from "./support/sign-in.ts";

const source = {
  format: "monica-json",
  version: 1,
  tables: {
    contacts: [{
      id: 42,
      uuid: "00000000-0000-4000-8000-000000000042",
      first_name: "Ada",
      last_name: "Lovelace",
      avatar_file_name: "avatars/ada.png",
    }],
    users: [{
      id: 7,
      email: "legacy-import@example.test",
      password: "legacy-hash",
      two_factor_secret: "legacy-totp",
    }],
  },
  attachments: [{ path: "avatars/ada.png", byteSize: 123, present: false }],
};

test("[IMPORT-001] imports Monica data safely and idempotently", {
  annotation: [{ type: "flow", description: "IMPORT-001" }, {
    type: "leaf",
    description: "APP-009A",
  }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(15_000);
  const email = `import-${browserName}-${Date.now()}@example.test`;
  await registerVerified(request, {
    email,
    firstName: "Import",
    lastName: "Admin",
    workspaceName: "Import circle",
  }, bareToken);
  await submitSignIn(page, email);

  const advertisedPayload = await page.request.post(
    `${origin}/api/v1/imports/dry-runs`,
    {
      data: {
        source: {
          format: "monica-json",
          version: 1,
          tables: { contacts: [], ignored: "x".repeat(1_100_000) },
        },
      },
      headers: { origin },
    },
  );
  expect(advertisedPayload.status()).toBe(201);

  const uploadAndCommit = async (expected: string) => {
    await page.goto("/app/settings/import/new");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.import-new",
    );
    await page.getByLabel("Monica JSON export").setInputFiles({
      name: "monica.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(source)),
    });
    await expect(page.getByText("Monica JSON version 1 detected."))
      .toBeVisible();
    await page.getByRole("button", { name: "Validate dry run" }).click();
    await expect(page.getByText("Dry run complete.")).toBeVisible();
    await expect(page.locator("[data-import-contacts]")).toHaveText("1");
    await expect(page.locator("[data-import-missing]")).toHaveText("1");
    await expect(page.locator("[data-import-credentials]")).toHaveText("1");
    await page.getByLabel("I confirm this validated import").check();
    await page.getByRole("button", { name: "Commit import" }).click();
    await expect(page.getByText(expected)).toBeVisible();
  };
  await uploadAndCommit("1 created, 0 reused");
  await uploadAndCommit("0 created, 1 reused");

  const reportLink = page.getByRole("link", { name: "Open import report" });
  const reportPath = await reportLink.getAttribute("href");
  if (process.env.E2E_DEV_SHELL === "1" && reportPath) {
    await page.route(`**${reportPath}`, async (route) =>
      route.fulfill({
        response: await request.get(`${origin}/internal/import-report-shell`),
      }));
  }
  await reportLink.click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "settings.import-report",
  );
  await expect(page.getByText("Import report is current.")).toBeVisible();
  await expect(page.getByText("Completed", { exact: true })).toBeVisible();
  expect((await page.request.post(`${origin}/api/v1/sessions`, {
    data: {
      email: "legacy-import@example.test",
      password: "legacy-hash",
    },
    headers: { origin },
  })).status()).toBe(401);
  await expectAccessible(page);
});
