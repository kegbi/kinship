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

const uploads = [
  {
    name: "monica.json",
    mimeType: "application/json",
    text: JSON.stringify(source),
    detected: "Monica JSON version 1 detected.",
  },
  {
    name: "monica.sql",
    mimeType: "application/sql",
    text:
      "# Synthetic export\nSET FOREIGN_KEY_CHECKS=0;\nINSERT IGNORE INTO contacts (id,uuid,first_name,last_name,avatar_file_name,description,job,company) VALUES (42,'00000000-0000-4000-8000-000000000042','Ada','Lovelace','avatars/ada.png','SQL contact','Engineer','Example Co'); INSERT INTO notes (id,contact_id,body) VALUES (1,42,'SQL note'); INSERT INTO users (id,password,google2fa_secret) VALUES (7,'legacy-hash','legacy-totp'); SET FOREIGN_KEY_CHECKS=1;",
    detected: "Monica SQL export detected. Validate to review supported data.",
  },
];
for (const upload of uploads) {
  test(`[IMPORT-001] imports ${upload.name} safely and idempotently`, {
    annotation: [{ type: "flow", description: "IMPORT-001" }, {
      type: "leaf",
      description: "APP-009A",
    }],
  }, async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const email =
      `import-${upload.name}-${browserName}-${Date.now()}@example.test`;
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
      await page.getByLabel("Monica JSON or SQL export").setInputFiles({
        name: upload.name,
        mimeType: upload.mimeType,
        buffer: Buffer.from(upload.text),
      });
      await expect(page.getByText(upload.detected))
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
}
