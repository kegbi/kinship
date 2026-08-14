import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";

const apiOrigin = process.env.TEST_API_ORIGIN ?? "http://127.0.0.1:18000";
const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";

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

async function expectAccessible(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle");
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () => {
    const scanner = (window as typeof window & {
      axe: { run(): Promise<{ violations: unknown[] }> };
    }).axe;
    return (await scanner.run()).violations;
  });
  expect(violations).toEqual([]);
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
  await expectAccessible(page);

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
  await expect(page.getByRole("status")).toContainText(
    "Analytical circle is ready",
  );
  await expect(page.getByRole("status")).toContainText("verified owner");
  await expectAccessible(page);

  await page.goto(`/auth/verify-email?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole("status")).toContainText("already used");
});

test("[AUTH-001] shows safe duplicate and invalid verification states", {
  annotation: { type: "flow", description: "AUTH-001" },
}, async ({ page, request, browserName }) => {
  const email = `auth-001-duplicate-${browserName}-${Date.now()}@example.test`;
  const input = {
    email,
    firstName: "Grace",
    lastName: "Hopper",
    password: "a very long test password",
    workspaceName: "Compiler friends",
  };
  const first = await request.post(`${apiOrigin}/api/v1/registrations`, {
    data: input,
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
  await expect(page.getByRole("status")).toContainText(
    "already uses that email",
  );

  await page.goto(
    "/auth/verify-email?token=this-token-is-long-enough-but-invalid-000000000",
  );
  await expect(page.getByRole("status")).toContainText("invalid");
});

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
  const response = await request.post(`${apiOrigin}/api/v1/registrations`, {
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
  await expect(page.getByRole("status")).toContainText(`${payload} is ready`);
  await expect(page.locator("#entry-status img, #entry-status script"))
    .toHaveCount(0);
  expect(await page.evaluate(() => "__kinshipXss" in window)).toBe(false);
});
