import { expect, test } from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

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
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Storage",
        lastName: "Admin",
        password,
        workspaceName: "Storage circle",
      },
    })).status()).toBe(202);
    let token = "";
    await expect.poll(async () => {
      const messages = (await (await request.get(
        `${mailOrigin}/api/v1/search?query=${
          encodeURIComponent(`to:${email}`)
        }`,
      )).json() as { messages?: Array<{ ID: string }> }).messages ?? [];
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
    expect((await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token },
    })).status()).toBe(200);
    await page.goto("/auth/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);

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
