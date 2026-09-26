import { expect, test } from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

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
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "File",
        lastName: "Keeper",
        password,
        workspaceName: "File circle",
      },
    })).status()).toBe(202);
    let token = "";
    await expect.poll(async () => {
      const search = await request.get(
        `${mailOrigin}/api/v1/search?query=${
          encodeURIComponent(`to:${email}`)
        }`,
      );
      const messages =
        (await search.json() as { messages?: Array<{ ID: string }> })
          .messages ?? [];
      for (const message of messages) {
        const detail = await request.get(
          `${mailOrigin}/api/v1/message/${message.ID}`,
        );
        token = ((await detail.json() as { Text?: string }).Text ?? "").match(
          /token=([^\s]+)/,
        )?.[1] ?? token;
      }
      return token;
    }).toBeTruthy();
    expect(
      (await request.post(`${origin}/api/v1/email-verifications`, {
        data: { token },
      })).status(),
    ).toBe(200);
    await page.goto("/auth/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

    const created = await page.request.post(`${origin}/api/v1/people`, {
      data: { givenName: "Ada", familyName: "Lovelace", isPartial: false },
      headers: { origin },
    });
    expect(created.status()).toBe(201);
    const personId =
      (await created.json() as { person: { id: string } }).person.id;
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
    await page.evaluate(axe.source);
    expect(
      await page.evaluate(async () =>
        (await (globalThis as typeof globalThis & {
          axe: { run(): Promise<{ violations: unknown[] }> };
        }).axe.run()).violations
      ),
    ).toEqual([]);
  },
);
