import { type APIRequestContext, expect, test } from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

async function verificationToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
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
  return token;
}

test(
  "[API-001] creates, uses, hides, and revokes a scoped personal API token",
  {
    annotation: [
      { type: "flow", description: "API-001" },
      { type: "leaf", description: "APP-010A" },
    ],
  },
  async ({ page, request }) => {
    test.setTimeout(180_000);
    const email = `api-${Date.now()}@example.test`;
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "API",
        lastName: "Owner",
        password,
        workspaceName: "API circle",
      },
    })).status()).toBe(202);
    expect((await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token: await verificationToken(request, email) },
    })).status()).toBe(200);

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
    const session = await (await page.request.get(`${origin}/api/v1/session`))
      .json() as { workspace: { id: string } };
    expect((await page.request.post(`${origin}/api/v1/people`, {
      data: { givenName: "Ada", isPartial: false },
      headers: { origin, "X-Workspace-Id": session.workspace.id },
    })).status()).toBe(201);

    await page.goto("/app/settings/api");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.api-access",
    );
    await page.getByLabel("Token name").fill("Desktop read");
    await page.getByLabel("Read people").check();
    await page.getByRole("button", { name: "Create token" }).click();
    const secretInput = page.getByLabel("New API token secret");
    await expect(secretInput).toBeVisible();
    const secret = await secretInput.inputValue();
    expect(secret).toMatch(/^kin_pat_[0-9a-f-]+\.[A-Za-z0-9_-]+$/);
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText(value: string) {
            (globalThis as typeof globalThis & {
              __app010aCopiedText?: string;
            }).__app010aCopiedText = value;
            return Promise.resolve();
          },
        },
      });
    });
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await expect(page.locator("[data-api-state]")).toContainText("copied");
    expect(
      await page.evaluate(() =>
        (globalThis as typeof globalThis & {
          __app010aCopiedText?: string;
        }).__app010aCopiedText
      ),
    ).toBe(secret);
    await expect(page.locator("[data-api-list]")).toContainText("Desktop read");
    await expect(page.locator("[data-api-list]")).toContainText("No expiry");
    await expect(page.locator("[data-api-list]")).not.toContainText(secret);

    const programmatic = await page.request.get(`${origin}/api/v1/people`, {
      headers: {
        authorization: `Bearer ${secret}`,
        "X-Workspace-Id": session.workspace.id,
      },
    });
    expect(programmatic.status()).toBe(200);
    expect(await programmatic.text()).toContain("Ada");

    await page.goto("/app/settings");
    await page.goto("/app/settings/api");
    await expect(secretInput).not.toBeVisible();
    await expect(page.locator("body")).not.toContainText(secret);
    await page.addScriptTag({ content: axe.source });
    expect(
      await page.evaluate(async () =>
        (await (globalThis as typeof globalThis & {
          axe: { run(): Promise<{ violations: unknown[] }> };
        }).axe.run()).violations
      ),
    ).toEqual([]);

    await page.locator("[data-api-list] li", { hasText: "Desktop read" })
      .getByRole("button", { name: "Revoke" }).click();
    await expect(
      page.locator("[data-api-list] li", { hasText: "Desktop read" }),
    ).toContainText("Revoked");
    expect((await page.request.get(`${origin}/api/v1/people`, {
      headers: {
        authorization: `Bearer ${secret}`,
        "X-Workspace-Id": session.workspace.id,
      },
    })).status()).toBe(401);
  },
);
