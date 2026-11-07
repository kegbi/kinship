import { expect, test } from "./support/test.ts";
import { registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { submitSignIn } from "./support/sign-in.ts";

test(
  "[FILES-001] workspace admins review safe storage diagnostics and file metadata",
  {
    annotation: [
      { type: "flow", description: "FILES-001" },
      { type: "leaf", description: "APP-007C" },
    ],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const email = `storage-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Storage",
      lastName: "Admin",
      workspaceName: "Storage circle",
    }, bareToken);
    await submitSignIn(page, email);

    const created = await page.request.post(`${origin}/api/v1/people`, {
      data: { givenName: "Ada", familyName: "Lovelace", isPartial: false },
      headers: { origin },
    });
    const personId = (await created.json() as { person: { id: string } })
      .person.id;
    expect((await page.request.post(
      `${origin}/api/v1/people/${personId}/files`,
      {
        data: Buffer.from("%PDF-1.7 storage settings"),
        headers: {
          "Content-Type": "application/pdf",
          origin,
          "X-File-Kind": "document",
          "X-File-Name": "care-plan.pdf",
          "X-File-Title": "Care plan",
        },
      },
    )).status()).toBe(201);

    await page.goto("/app/settings/storage");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.storage",
    );
    await expect(page.getByRole("heading", { name: "Storage", exact: true }))
      .toBeVisible();
    await expect(page.locator("[data-storage-total-files]")).toHaveText("1");
    await expect(page.locator("[data-storage-available]")).toHaveText("1");
    await expect(page.locator("[data-storage-health]")).toHaveText(
      "Available",
    );
    await page.getByLabel("File ID, filename, title, or person").fill("Ada");
    await page.getByRole("button", { name: "Search" }).click();
    const result = page.locator("[data-storage-results] li");
    await expect(result).toContainText("Care plan");
    await expect(result).toContainText("Ada Lovelace");
    await expect(page.locator("main")).not.toContainText("storageKey");
    await expectAccessible(page);
  },
);
