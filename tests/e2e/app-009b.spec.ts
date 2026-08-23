import { expect, test } from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

test("[EXPORT-001] exports portable workspace data and a person vCard", {
  annotation: [{ type: "flow", description: "EXPORT-001" }, {
    type: "leaf",
    description: "APP-009B",
  }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const email = `export-${browserName}-${Date.now()}@example.test`;
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Export",
      lastName: "Admin",
      password,
      workspaceName: "Export circle",
    },
  })).status()).toBe(202);
  let token = "";
  await expect.poll(async () => {
    const messages = (await (await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
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
  expect(
    (await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token },
    })).status(),
  ).toBe(200);
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/app(?:$|\/compliance)/);
  if (new URL(page.url()).pathname === "/app/compliance") {
    await page.getByLabel("I have reviewed and accept this exact version.")
      .check();
    await page.getByRole("button", { name: "Accept and continue" }).click();
  }
  const created = await page.request.post(`${origin}/api/v1/people`, {
    data: { familyName: "Lovelace", givenName: "Ada", isPartial: false },
    headers: { origin },
  });
  expect(created.status()).toBe(201);
  const personId =
    (await created.json() as { person: { id: string } }).person.id;

  await page.goto("/app/settings/export");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "settings.export",
  );
  await expect(page.getByText("No exports yet.")).toBeVisible();
  await page.getByRole("button", { name: "Create export" }).click();
  await expect(page.getByText("Export completed for 1 person.")).toBeVisible();
  await expect(page.locator("[data-export-history]")).toContainText(
    "Completed",
  );
  await page.getByRole("button", { name: "Prepare download" }).click();
  const downloadLink = page.getByRole("link", { name: "Download export" });
  await expect(downloadLink).toBeVisible();
  const href = await downloadLink.getAttribute("href");
  expect(href).toContain("token=");
  const artifact = await page.request.get(`${origin}${href}`);
  expect(artifact.status()).toBe(200);
  expect(artifact.headers()["content-disposition"]).toContain("attachment;");
  const portable = await artifact.json() as {
    format: string;
    tables: { contacts: Array<{ first_name: string }> };
    version: number;
  };
  expect(portable).toMatchObject({ format: "monica-json", version: 1 });
  expect(portable.tables.contacts).toEqual([
    expect.objectContaining({ first_name: "Ada" }),
  ]);
  expect(JSON.stringify(portable)).not.toMatch(/password|secret|storage_key/i);
  await page.addScriptTag({ content: axe.source });
  expect(
    await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    ),
  ).toEqual([]);

  if (process.env.E2E_DEV_SHELL === "1") {
    await page.route(
      `**/app/people/${personId}*`,
      async (route) =>
        route.fulfill({
          response: await request.get(
            `${origin}/internal/person-profile-shell`,
          ),
        }),
    );
  }
  await page.goto(`/app/people/${personId}`);
  const vcardLink = page.getByRole("link", { name: "Export vCard" });
  await expect(vcardLink).toHaveAttribute(
    "href",
    new RegExp(`/api/v1/people/${personId}/vcard\\?workspaceId=`),
  );
  const vcardHref = await vcardLink.getAttribute("href");
  const vcard = await page.request.get(`${origin}${vcardHref}`);
  expect(vcard.status()).toBe(200);
  expect(await vcard.text()).toContain("FN:Ada Lovelace");
});
