import { expect, test } from "./support/test.ts";
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
      gender_id: 999,
      last_name: "Lovelace",
      avatar_file_name: "avatars/ada.png",
    }],
    debts: [{
      id: 1,
      contact_id: 42,
      amount: "12.34",
      currency_id: null,
      in_debt: "yes",
      status: "open",
      reason: "Train ticket",
    }, {
      id: 2,
      contact_id: 42,
      amount: "4.5",
      currency_id: 999,
      in_debt: "no",
      status: "open",
      reason: "Lunch",
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
      "# Synthetic export\nSET FOREIGN_KEY_CHECKS=0;\nINSERT IGNORE INTO contacts (id,uuid,first_name,last_name,avatar_file_name,description,job,company,gender_id) VALUES (42,'00000000-0000-4000-8000-000000000042','Ada','Lovelace','avatars/ada.png','SQL contact','Engineer','Example Co',999); INSERT INTO debts(id,contact_id,amount,currency_id,in_debt,status,reason) VALUES (1,42,56000,NULL,'yes','open','Train ticket'),(2,42,56000.25,999,'no','open','Lunch'); INSERT INTO contact_field_types (id,name,type,protocol) VALUES (1,'Chat handle','custom','chat'),(2,'Mapped handle','custom','chat'),(3,'Skipped handle','custom','chat'); INSERT INTO contact_fields (contact_id,contact_field_type_id,data) VALUES (42,1,'synthetic-chat'),(42,2,'synthetic-mapped'),(42,3,'synthetic-skipped'); INSERT INTO notes (id,contact_id,body) VALUES (1,42,'SQL note'); INSERT INTO contacts (id,uuid,first_name,last_name) VALUES (43,'00000000-0000-4000-8000-000000000043','Grace','Hopper'); INSERT INTO relationship_types (id,name,name_reverse_relationship) VALUES (1,'friend','friend'); INSERT INTO relationships (id,contact_is,of_contact,relationship_type_id) VALUES (1,42,43,1); INSERT INTO activities (id,summary,happened_at) VALUES (1,'Imported park walk','2020-01-02 12:00:00'); INSERT INTO activity_contact (activity_id,contact_id) VALUES (1,42),(1,43); INSERT INTO reminders (id,contact_id,title,initial_date,frequency_type,frequency_number,inactive) VALUES (1,42,'Imported annual reminder','2020-01-02','year',1,0); INSERT INTO tags (id,name,name_slug) VALUES (1,'Imported friend','imported-friend'); INSERT INTO contact_tag (contact_id,tag_id) VALUES (42,1);  INSERT INTO users (id,password,google2fa_secret) VALUES (7,'legacy-hash','legacy-totp'); SET FOREIGN_KEY_CHECKS=1;",
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
    await page.setViewportSize({ width: 390, height: 844 });
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

    let existingTypeId: string | undefined;
    if (upload.name === "monica.sql") {
      const saved = await page.request.post(
        `${origin}/api/v1/settings/personalization/contact-method-types`,
        {
          data: { name: "Existing handle", contactKind: "custom" },
          headers: { origin },
        },
      );
      expect(saved.status()).toBe(200);
      existingTypeId = (await saved.json()).entry.id;
    }
    const uploadAndCommit = async (expected: string, firstImport: boolean) => {
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
      await expect(page.locator("[data-import-contacts]")).toHaveText(
        upload.name === "monica.sql" ? "2" : "1",
      );
      await expect(page.locator("[data-import-missing]")).toHaveText("1");
      await expect(page.locator("[data-import-credentials]")).toHaveText("1");
      if (upload.name === "monica.sql") {
        const create = page.getByLabel("Chat handle (1 methods)");
        if (firstImport) {
          await expect(create).toBeVisible();
          await page.getByLabel("I confirm this validated import").check();
          await expect(page.getByRole("button", { name: "Commit import" }))
            .toBeDisabled();
          const types = await page.request.get(
            `${origin}/api/v1/settings/personalization/contact-method-types`,
          );
          expect(JSON.stringify(await types.json())).not.toContain(
            '"Chat handle"',
          );
          await create.selectOption("create");
        } else await expect(create).toHaveCount(0);
        await page.getByLabel("Mapped handle (1 methods)").selectOption(
          existingTypeId!,
        );
        await page.getByLabel("Skipped handle (1 methods)").selectOption(
          "skip",
        );
      }
      const timezone = page.getByRole("combobox", { name: "Your timezone" });
      await timezone.fill("Paris");
      const option = page.getByRole("option", {
        name: "Europe/Paris",
        exact: true,
      });
      await expect(option).toBeVisible();
      const box = await option.boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
      await timezone.press("ArrowDown");
      await timezone.press("Enter");
      await expect(timezone).toHaveValue("Europe/Paris");
      if (firstImport) {
        await page.getByLabel("I confirm this validated import").check();
        await expect(page.getByRole("button", { name: "Commit import" }))
          .toBeDisabled();
        await page.getByLabel("Currency for all debts").selectOption("RUB");
        await page.getByRole("button", { name: "Apply currency to all debts" })
          .click();
        await expect(page.locator("output").first()).toHaveText(
          upload.name === "monica.sql" ? "56000 RUB" : "12.34 RUB",
        );
        await page.getByLabel("Ada Lovelace — debt 2").selectOption("JPY");
        await expect(page.locator("output").last()).toHaveText(
          upload.name === "monica.sql" ? "56000.25 JPY" : "4.5 JPY",
        );
        await page.getByLabel("Ada Lovelace — gender").selectOption(
          "unspecified",
        );
      } else {
        await expect(page.getByLabel("Currency for all debts")).toHaveCount(0);
        await expect(page.getByLabel("Ada Lovelace — gender")).toHaveCount(0);
      }
      await page.getByLabel("I confirm this validated import").check();
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const commitRoute = "**/api/v1/imports/*/commit";
      await page.route(commitRoute, async (route) => {
        await pending;
        await route.continue();
      });
      await page.getByRole("button", { name: "Commit import" }).click();
      try {
        await expect(page.getByRole("dialog", { name: "Importing your data" }))
          .toBeVisible();
        await expect(
          page.getByRole("progressbar", { name: "Import in progress" }),
        ).toBeVisible();
      } finally {
        release();
      }
      await expect(page.locator("[data-import-state]")).toContainText(expected);
      await expect(page.getByRole("dialog")).toHaveCount(0);
      const toast = page.locator("#app-toasts > li[data-tone=success]");
      await expect(toast).toContainText(expected);
      await toast.getByRole("button", { name: "Dismiss notification" }).click();
      await expect(toast).toHaveCount(0);
      await page.unroute(commitRoute);
    };
    await uploadAndCommit(
      upload.name === "monica.sql"
        ? "2 created, 0 reused"
        : "1 created, 0 reused",
      true,
    );
    await uploadAndCommit(
      upload.name === "monica.sql"
        ? "0 created, 2 reused"
        : "0 created, 1 reused",
      false,
    );

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
    if (upload.name === "monica.sql") {
      const directory = await page.request.get(`${origin}/api/v1/people`);
      expect(directory.status()).toBe(200);
      const listed = await directory.json() as {
        people: { id: string; displayName?: string; givenName?: string }[];
      };
      expect(listed.people).toHaveLength(2);
      const ada = listed.people.find((person) =>
        JSON.stringify(person).includes("Ada")
      )!;
      const gifts = await page.request.get(
        `${origin}/api/v1/people/${ada.id}/gifts`,
      );
      expect(gifts.status()).toBe(200);
      const importedDebts = (await gifts.json()).debts;
      expect(importedDebts).toEqual(expect.arrayContaining([
        expect.objectContaining({ amount: "56000.0000", currencyCode: "RUB" }),
        expect.objectContaining({ amount: "56000.2500", currencyCode: "JPY" }),
      ]));
      const relationships = await page.request.get(
        `${origin}/api/v1/people/${ada.id}/relationships`,
      );
      expect(relationships.status()).toBe(200);
      expect(JSON.stringify(await relationships.json())).toContain("Grace");
      const activities = await page.request.get(
        `${origin}/api/v1/people/${ada.id}/activity-report`,
      );
      expect(activities.status()).toBe(200);
      expect(JSON.stringify(await activities.json())).toContain(
        "Imported park walk",
      );
      const reminders = await page.request.get(
        `${origin}/api/v1/people/${ada.id}/reminders`,
      );
      expect(reminders.status()).toBe(200);
      expect(JSON.stringify(await reminders.json())).toContain(
        "Imported annual reminder",
      );
    }
  });
}
