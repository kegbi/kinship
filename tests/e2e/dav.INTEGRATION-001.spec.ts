import { expect, test } from "./support/test.ts";
import { registerVerified } from "./support/api.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

test("[INTEGRATION-001] configures, retries, resumes, and disables DAV", {
  annotation: [
    { type: "flow", description: "INTEGRATION-001" },
    { type: "leaf", description: "APP-010B" },
  ],
}, async ({ page, request }) => {
  test.setTimeout(180_000);
  const email = `dav-${Date.now()}@example.test`;
  await registerVerified(request, {
    email,
    firstName: "DAV",
    lastName: "Owner",
    workspaceName: "DAV circle",
  }, bareToken);
  await signInAcceptingCompliance(page, email);

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
  await expectAccessible(page);
});
