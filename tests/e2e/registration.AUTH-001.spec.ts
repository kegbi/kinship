import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { mailOrigin, origin } from "./support/env.ts";
import { expectAccessible } from "./support/page-checks.ts";

async function verificationToken(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  let messageId: string | undefined;
  await expect.poll(async () => {
    const response = await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const body = await response.json() as { messages?: Array<{ ID: string }> };
    messageId = body.messages?.[0]?.ID;
    return messageId;
  }).toBeTruthy();
  const response = await request.get(
    `${mailOrigin}/api/v1/message/${messageId}`,
  );
  const message = await response.json() as { Text: string };
  const link = message.Text.match(
    /https?:\/\/\S+\/auth\/verify-email\?token=\S+/,
  )?.[0];
  if (!link) {
    throw new Error("Verification email did not contain its browser link.");
  }
  const token = new URL(link).searchParams.get("token");
  if (!token) throw new Error("Verification email did not contain a token.");
  return token;
}

test("[AUTH-001] creates and verifies the first workspace", {
  annotation: { type: "flow", description: "AUTH-001" },
}, async ({ page, request, browserName }) => {
  const email = `auth-001-${browserName}-${Date.now()}@example.test`;
  await page.goto("/auth/sign-up");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "auth.sign-up",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Create your private circle.",
  );
  await expectAccessible(page, { networkIdle: true });

  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await expect(skipLink).toHaveAttribute("tabindex", "0");
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("main")).toBeVisible();

  await page.goto("/auth/sign-up");
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Kinship home" })).toBeFocused();

  for (
    const [control, value] of [
      [page.getByLabel("First name"), "Ada"],
      [page.getByLabel(/Last name/), "Lovelace"],
      [page.getByLabel("Email address"), email],
      [page.getByLabel("Workspace name"), "Analytical circle"],
      [page.getByLabel("Password"), "correct horse battery staple"],
    ] as const
  ) {
    await page.keyboard.press("Tab");
    await expect(control).toBeFocused();
    await page.keyboard.type(value);
  }
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Create workspace" }))
    .toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Check your email");

  const token = await verificationToken(request, email);
  await page.goto(`/auth/verify-email?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "app.today",
  );
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Welcome, Ada.",
  );
  await expect(page.locator("#app-toasts > li")).toHaveCount(0);
  await expectAccessible(page, { networkIdle: true });

  await page.goto(`/auth/verify-email?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole("status")).toContainText("already used");
});

test(
  "[AUTH-001] answers an existing address like a new one and shows invalid verification",
  {
    annotation: { type: "flow", description: "AUTH-001" },
  },
  async ({ page, request, browserName }) => {
    const email =
      `auth-001-duplicate-${browserName}-${Date.now()}@example.test`;
    const input = {
      email,
      firstName: "Grace",
      lastName: "Hopper",
      password: "a very long test password",
      workspaceName: "Compiler friends",
    };
    const first = await request.post(`${origin}/api/v1/registrations`, {
      data: input,
      headers: { origin },
    });
    expect(first.status()).toBe(202);

    await page.goto("/auth/sign-up");
    await expect(page.getByRole("link", { name: "Skip to main content" }))
      .toHaveAttribute("tabindex", "0");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" }))
      .toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    for (
      const [control, value] of [
        [page.getByLabel("First name"), input.firstName],
        [page.getByLabel(/Last name/), input.lastName],
        [page.getByLabel("Email address"), input.email.toUpperCase()],
        [page.getByLabel("Workspace name"), input.workspaceName],
        [page.getByLabel("Password"), input.password],
      ] as const
    ) {
      await expect(control).toBeFocused();
      await page.keyboard.type(value);
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
    // SECA-02: the page cannot tell an existing address from a new one.
    await expect(page.getByRole("status")).toContainText("Check your email");
    await expect(page.getByRole("status")).not.toContainText(/already/i);

    await page.goto(
      "/auth/verify-email?token=this-token-is-long-enough-but-invalid-000000000",
    );
    await expect(page.getByRole("status")).toContainText("invalid");
  },
);

test("[AUTH-001] sign-up stays usable at a mobile viewport", {
  annotation: { type: "flow", description: "AUTH-001" },
}, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/auth/sign-up");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create workspace" }))
    .toBeVisible();
  await expect.poll(() =>
    page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
  ).toBe(true);
});

test(
  "[AUTH-001] retries a delayed verification email without resubmitting registration",
  {
    annotation: { type: "flow", description: "AUTH-001" },
  },
  async ({ page }) => {
    let registrations = 0;
    let retries = 0;
    await page.route("**/api/v1/registrations", async (route) => {
      registrations += 1;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "https://kinship.test/problems/verification_delivery_failed",
          title: "Verification email delayed",
          status: 503,
          detail: "Workspace created; email delayed.",
          code: "verification_delivery_failed",
        }),
      });
    });
    await page.route(
      "**/api/v1/email-verification-deliveries",
      async (route) => {
        retries += 1;
        await route.fulfill({
          status: 202,
          contentType: "application/json",
          body: JSON.stringify({ status: "accepted" }),
        });
      },
    );
    await page.goto("/auth/sign-up");
    await expect(page.getByRole("link", { name: "Skip to main content" }))
      .toHaveAttribute("tabindex", "0");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to main content" }))
      .toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    for (
      const value of [
        "Ada",
        "Lovelace",
        "DELAYED@EXAMPLE.TEST",
        "Delayed circle",
        "correct horse battery staple",
      ]
    ) {
      await page.keyboard.type(value);
      await page.keyboard.press("Tab");
    }
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText(
      "workspace was created",
    );
    await expect(page.getByRole("button", { name: "Create workspace" }))
      .toBeHidden();
    const retry = page.getByRole("button", {
      name: "Retry verification email",
    });
    await page.keyboard.press("Tab");
    await expect(retry).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText(
      "request was accepted",
    );
    expect(registrations).toBe(1);
    expect(retries).toBe(1);
  },
);

test("[AUTH-001] renders malicious owner and workspace names as text", {
  annotation: { type: "flow", description: "AUTH-001" },
}, async ({ page, request, browserName }) => {
  const email = `auth-001-xss-${browserName}-${Date.now()}@example.test`;
  const payload = '<img src=x onerror="window.__kinshipXss=1">';
  // Registered from the page's own browser, which keeps the verifier cookie
  // that the verification below presents.
  const response = await page.request.post(`${origin}/api/v1/registrations`, {
    headers: { origin },
    data: {
      email,
      firstName: payload,
      lastName: "",
      password: "a very long test password",
      workspaceName: payload,
    },
  });
  expect(response.status()).toBe(202);
  const token = await verificationToken(request, email);
  await page.goto(`/auth/verify-email?token=${encodeURIComponent(token)}`);
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(payload);
  await expect(page.locator("#app-toasts > li")).toHaveCount(0);
  await expect(page.locator("#entry-status img, #entry-status script"))
    .toHaveCount(0);
  expect(await page.evaluate(() => "__kinshipXss" in window)).toBe(false);
});

test(
  "[AUTH-001] verifying in another browser asks for a password before sign-in",
  {
    annotation: { type: "flow", description: "AUTH-001" },
  },
  async ({ browser, page, request, browserName }) => {
    const email =
      `auth-001-other-browser-${browserName}-${Date.now()}@example.test`;
    const registrationPassword = "correct horse battery staple";
    const chosenPassword = "a different passphrase chosen later";
    // Browser A registers, and keeps the verifier cookie to itself.
    await page.goto("/auth/sign-up");
    await page.getByLabel("First name").fill("Ada");
    await page.getByLabel(/Last name/).fill("Lovelace");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Workspace name").fill("Two browser circle");
    await page.getByLabel("Password").fill(registrationPassword);
    await page.getByRole("button", { name: "Create workspace" }).click();
    await expect(page.getByRole("status")).toContainText("Check your email");
    const token = await verificationToken(request, email);

    // Browser B opens the mailed link without that cookie (SECA-01).
    const other = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      const otherPage = await other.newPage();
      // The page navigates as soon as it reads the answer, so the answer is
      // captured on its way through rather than read back afterwards.
      let verified: { status: number; body: { status?: string } } | undefined;
      await otherPage.route("**/api/v1/email-verifications", async (route) => {
        const response = await route.fetch();
        verified = {
          body: await response.json() as { status?: string },
          status: response.status(),
        };
        await route.fulfill({ response });
      });
      // The reset page opens with the token, then reads it and removes it
      // from the address; a static page (ADR 0007) can do that before a URL
      // poll looks, so the navigation itself is awaited.
      const openedWithToken = otherPage.waitForEvent("framenavigated", {
        predicate: (frame) =>
          frame === otherPage.mainFrame() &&
          /\/auth\/reset-password\?token=/.test(frame.url()),
      });
      await otherPage.goto(
        `/auth/verify-email?token=${encodeURIComponent(token)}`,
      );
      await openedWithToken;
      await expect(otherPage).toHaveURL(/\/auth\/reset-password$/);
      expect(verified).toEqual({
        body: expect.objectContaining({ status: "password-required" }),
        status: 200,
      });
      await expect(otherPage.locator("body")).toHaveAttribute(
        "data-page-id",
        "auth.reset",
      );
      await expect(otherPage.getByRole("heading", { level: 1 })).toHaveText(
        "Choose a new passphrase.",
      );
      await otherPage.getByLabel("New password").fill(chosenPassword);
      await otherPage.getByRole("button", { name: "Reset password" }).click();
      await expect(otherPage).toHaveURL(/\/auth\/sign-in$/);

      // The registration's password was discarded at verification.
      await otherPage.getByLabel("Email address").fill(email);
      await otherPage.getByLabel("Password").fill(registrationPassword);
      await otherPage.getByRole("button", { name: "Sign in" }).click();
      await expect(otherPage.getByRole("status")).toContainText(
        "email address or password is incorrect",
      );

      await otherPage.getByLabel("Password").fill(chosenPassword);
      await otherPage.getByRole("button", { name: "Sign in" }).click();
      await otherPage.waitForURL(/\/app(?:$|\/compliance)/);
    } finally {
      await other.close();
    }
  },
);
