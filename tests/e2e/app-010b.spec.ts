import { type APIRequestContext, expect, test } from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

async function verificationToken(request: APIRequestContext, email: string) {
  let token = "";
  await expect.poll(async () => {
    const messages = (await (await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    )).json() as { messages?: Array<{ ID: string }> }).messages ?? [];
    for (const message of messages) {
      token = ((await (await request.get(
        `${mailOrigin}/api/v1/message/${message.ID}`,
      )).json() as { Text?: string }).Text ?? "")
        .match(/token=([^\s]+)/)?.[1] ?? token;
    }
    return token;
  }).toBeTruthy();
  return token;
}

test("[INTEGRATION-001] configures, retries, resumes, and disables DAV", {
  annotation: [
    { type: "flow", description: "INTEGRATION-001" },
    { type: "leaf", description: "APP-010B" },
  ],
}, async ({ page, request }) => {
  test.setTimeout(180_000);
  const email = `dav-${Date.now()}@example.test`;
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "DAV",
      lastName: "Owner",
      password,
      workspaceName: "DAV circle",
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

  const subscriptionId = "00000000-0000-4000-8000-000000000010";
  let subscription: Record<string, unknown> | undefined;
  let syncs = 0;
  await page.route("**/api/v1/settings/integrations/dav**", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/dav")) {
      const input = request.postDataJSON() as {
        name: string;
        password: string;
        remoteUrl: string;
        username?: string;
      };
      expect(input.password).toBe("remote-secret");
      subscription = {
        id: subscriptionId,
        isActive: true,
        lastOutcome: "never",
        name: input.name,
        remoteUrl: input.remoteUrl,
        ...(input.username ? { username: input.username } : {}),
      };
      return route.fulfill({
        json: { status: "configured", subscription },
        status: 201,
      });
    }
    if (request.method() === "POST" && url.pathname.endsWith("/sync")) {
      syncs += 1;
      subscription = syncs === 1
        ? {
          ...subscription,
          lastError: "dav_sync_failed",
          lastOutcome: "partial",
        }
        : {
          ...subscription,
          lastError: undefined,
          lastOutcome: "success",
          lastSyncedAt: "2026-08-24T12:00:00.000Z",
        };
      return route.fulfill({
        json: {
          processed: syncs,
          status: syncs === 1 ? "partial" : "success",
          subscription,
        },
      });
    }
    if (request.method() === "DELETE") {
      subscription = { ...subscription, isActive: false };
      return route.fulfill({ json: { status: "disabled", subscription } });
    }
    return route.fulfill({
      json: {
        status: "ready",
        subscriptions: subscription ? [subscription] : [],
      },
    });
  });

  await page.goto("/app/settings/integrations");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "settings.integrations",
  );
  await page.getByLabel("Connection name").fill("Personal DAV");
  await page.getByLabel("DAV collection URL").fill(
    "https://dav.example.test/collection/",
  );
  await page.getByLabel("Username").fill("ada");
  await page.getByLabel("Secret").fill("remote-secret");
  await page.getByRole("button", { name: "Add connection" }).click();
  const connection = page.locator("[data-integration-list] li", {
    hasText: "Personal DAV",
  });
  await expect(connection).toBeVisible();
  await expect(page.locator("body")).not.toContainText("remote-secret");
  await connection.getByRole("button", { name: "Sync now" }).click();
  await expect(connection).toContainText("Partially synchronized");
  await connection.getByRole("button", { name: "Retry" }).click();
  await expect(connection).toContainText("Synchronized");
  await page.reload();
  await expect(connection).toContainText("Synchronized");
  await connection.getByRole("button", { name: "Disable" }).click();
  await expect(connection).toContainText("Disabled");
  await page.addScriptTag({ content: axe.source });
  expect(
    await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    ),
  ).toEqual([]);
});
