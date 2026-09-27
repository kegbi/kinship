import { expect, test } from "@playwright/test";
import { registerVerified } from "./support/api.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

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
    await registerVerified(request, {
      email,
      firstName: "API",
      lastName: "Owner",
      workspaceName: "API circle",
    }, bareToken);

    await signInAcceptingCompliance(page, email);
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
    await expectAccessible(page);

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
