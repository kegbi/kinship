import { expect, test } from "@playwright/test";
import { createPerson, registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { submitSignIn } from "./support/sign-in.ts";

test(
  "[FILES-001] attaches, retrieves, quarantines, and removes person files",
  {
    annotation: [
      { type: "flow", description: "FILES-001" },
      { type: "leaf", description: "APP-007A" },
    ],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const email = `files-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "File",
      lastName: "Keeper",
      workspaceName: "File circle",
    }, bareToken);
    await submitSignIn(page, email);

    const personId = await createPerson(page.request, {
      givenName: "Ada",
      familyName: "Lovelace",
    });
    if (process.env.E2E_DEV_SHELL === "1") {
      await page.route(`**/app/people/${personId}*`, async (route) => {
        const shell = await request.get(
          `${origin}/internal/person-profile-shell`,
        );
        await route.fulfill({ response: shell });
      });
    }
    await page.goto(`/app/people/${personId}?section=documents`);
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "people.profile",
    );
    await expect(page.getByRole("heading", { name: "Ada Lovelace" }))
      .toBeVisible();
    const documents = page.locator('[data-person-files="document"]');
    await expect(documents.getByText("No documents saved.")).toBeVisible();
    await documents.getByRole("button", { name: "Attach document" }).click();
    await documents.getByLabel("Title").fill("Care plan");
    await documents.getByLabel("File").setInputFiles({
      buffer: Buffer.from("%PDF-1.7 person care plan"),
      mimeType: "application/pdf",
      name: "care-plan.pdf",
    });
    await documents.getByRole("button", { name: "Upload" }).click();
    const documentRow = documents.locator("li", { hasText: "Care plan" });
    await expect(documentRow).toContainText("Available");
    const downloadPromise = page.waitForResponse((response) =>
      response.url().includes(`/api/v1/people/${personId}/files/`) &&
      response.url().endsWith("/content")
    );
    await documentRow.getByRole("link", { name: "Download" }).click();
    expect((await downloadPromise).status()).toBe(200);

    const photos = page.locator('[data-person-files="photo"]');
    await photos.getByRole("button", { name: "Attach photo" }).click();
    await photos.getByLabel("Title").fill("Suspicious portrait");
    await photos.getByLabel("File").setInputFiles({
      buffer: Buffer.from("not-a-jpeg"),
      mimeType: "image/jpeg",
      name: "portrait.jpg",
    });
    await photos.getByRole("button", { name: "Upload" }).click();
    await expect(photos.locator("li", { hasText: "Suspicious portrait" }))
      .toContainText("Quarantined");
    await expect(
      photos.locator("li", { hasText: "Suspicious portrait" }).getByRole(
        "link",
        { name: "Download" },
      ),
    ).toHaveCount(0);

    await documentRow.getByRole("button", { name: "Remove" }).click();
    await expect(documents.getByText("File removed.")).toBeVisible();
    await expect(documentRow).toHaveCount(0);
    await expectAccessible(page);
  },
);
