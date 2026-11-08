import type { APIRequestContext, Page } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { settleNavigation } from "./support/navigation.ts";
import { registerVerified } from "./support/api.ts";
import { databaseSql, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin, sessionCookieName } from "./support/env.ts";
import { mailToken, pathLinkToken } from "./support/mail.ts";
import {
  expectAccessible,
  recordPolicyViolations,
} from "./support/page-checks.ts";
import { keyboardOpenMemberMenu } from "./support/shell.ts";

async function pathMailToken(
  request: APIRequestContext,
  email: string,
  path: "/auth/reset-password" | "/auth/verify-email",
  exclude?: string,
): Promise<string> {
  return await mailToken(request, email, pathLinkToken(path, exclude), {
    stopOnToken: true,
  });
}

async function createVerifiedUser(
  request: APIRequestContext,
  email: string,
  workspaceName = "Analytical circle",
): Promise<void> {
  await registerVerified(
    request,
    { email, firstName: "Ada", lastName: "Lovelace", workspaceName },
    pathLinkToken("/auth/verify-email"),
    { stopOnToken: true },
  );
}

function decodeBase32(value: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let buffer = 0;
  const output: number[] = [];
  for (const character of value) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      output.push((buffer >>> bits) & 0xff);
    }
  }
  return Buffer.from(output);
}

function totp(secret: string): string {
  let counter = Math.floor(Date.now() / 30_000);
  const message = Buffer.alloc(8);
  for (let index = 7; index >= 0; index -= 1) {
    message[index] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const signature = createHmac("sha1", decodeBase32(secret)).update(message)
    .digest();
  const offset = signature.at(-1)! & 0x0f;
  const binary = (signature[offset]! & 0x7f) << 24 |
    signature[offset + 1]! << 16 |
    signature[offset + 2]! << 8 |
    signature[offset + 3]!;
  return String(binary % 1_000_000).padStart(6, "0");
}

function encryptedMfaSecret(secret: string, userId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.alloc(32), iv);
  cipher.setAAD(
    Buffer.from(`kinship.user-mfa-totp.v1.test.${userId}`),
  );
  const encrypted = Buffer.concat([
    cipher.update(secret, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  return `v1.test.${iv.toString("base64url")}.${
    encrypted.toString("base64url")
  }`;
}

function recoveryHash(code: string): string {
  return createHash("sha256").update(code).digest("base64url");
}

async function keyboardSignIn(
  page: Page,
  email: string,
  password = "correct horse battery staple",
): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Kinship home" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Password")).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeFocused();
  await page.keyboard.press("Enter");
}

async function keyboardMfaFactor(page: Page, factor: string): Promise<void> {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Authenticator or recovery code"))
    .toBeFocused();
  await page.keyboard.type(factor);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Continue securely" }))
    .toBeFocused();
  await page.keyboard.press("Enter");
}

async function keyboardReset(page: Page, password: string): Promise<void> {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("New password")).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Reset password" }))
    .toBeFocused();
  await page.keyboard.press("Enter");
}

async function keyboardFinishSignOut(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Profile" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Settings" })).toBeFocused();
  await page.keyboard.press("Tab");
  const signOutButton = page.getByRole("button", { name: "Sign out" });
  await expect(signOutButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
  await settleNavigation(page);
}

async function keyboardSignOutWithMultipleWorkspaces(
  page: Page,
): Promise<void> {
  await expect(page.getByLabel("Active workspace").locator("option"))
    .toHaveCount(2);
  await keyboardOpenMemberMenu(page);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Active workspace")).toBeFocused();
  await keyboardFinishSignOut(page);
}

async function keyboardSignOutWithSingleWorkspace(page: Page): Promise<void> {
  await keyboardOpenMemberMenu(page);
  await expect(page.getByLabel("Active workspace")).toBeHidden();
  await keyboardFinishSignOut(page);
}

// Catalog: docs/product/user-flows.yaml#AUTH-003 (existing auth-003 testRefs).
test(
  "[AUTH-003] APR-005 keeps authenticated pages usable with storage disabled",
  {
    annotation: { type: "flow", description: "AUTH-003" },
  },
  async ({ page, request, context, browserName }) => {
    const email = `apr-005-storage-${browserName}-${Date.now()}@example.test`;
    await createVerifiedUser(request, email, "Storage circle");
    const otherWorkspaceId = randomUUID();
    databaseSql(`
    insert into crm.workspaces (id, name, status, created_by_user_id)
    select '${otherWorkspaceId}'::uuid, 'Other storage circle', 'active', id
      from crm.users where email = ${sqlLiteral(email)};
    insert into crm.workspace_members (workspace_id, user_id, role, status, joined_at)
    select '${otherWorkspaceId}'::uuid, id, 'member', 'active', now()
      from crm.users where email = ${sqlLiteral(email)};
  `);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => {
      Object.defineProperty(window, "sessionStorage", {
        configurable: true,
        get() {
          throw new DOMException("Storage disabled", "SecurityError");
        },
      });
    });

    await keyboardSignIn(page, email);
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator("#protected-shell")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Welcome back.",
    );
    await page.getByRole("link", { name: "People", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/people$/);
    await expect(page.locator("#protected-shell")).toBeVisible();
    await expect(page.locator("#people-directory-empty")).toBeVisible();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "No people yet",
        exact: true,
      }),
    )
      .toBeVisible();
    // FEQ-11: the tag filter reads its options once the reader reaches it.
    await page.getByRole("combobox", { name: "Tag", exact: true }).focus();
    await expect(page.locator("#people-tag-options-status")).toHaveText(
      "0 tag options shown.",
    );

    const profileSession = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v1/session" &&
      response.status() === 200
    );
    await page.goto("/app/settings/profile");
    await profileSession;
    const firstName = page.getByLabel("First name", { exact: true });
    await expect(firstName).toBeEnabled();
    await firstName.fill("Retained storage draft");
    await page.getByRole("button", { name: "Member menu" }).click();
    const switcher = page.getByLabel("Active workspace");
    await expect(switcher.locator("option")).toHaveCount(2);
    const currentWorkspaceId = await switcher.inputValue();
    expect(currentWorkspaceId).not.toBe(otherWorkspaceId);
    page.once("dialog", (dialog) => dialog.accept());
    await switcher.selectOption(otherWorkspaceId);
    await expect(page.locator("#app-toasts")).toContainText(
      "Browser storage is unavailable",
    );
    await expect(switcher).toHaveValue(currentWorkspaceId);
    await expect(switcher).toBeEnabled();
    await expect(firstName).toHaveValue("Retained storage draft");
    await expect(page.locator("#profile-form")).toHaveAttribute(
      "data-dirty",
      "true",
    );
    await expect(page).toHaveURL(/\/app\/settings\/profile$/);
    await page.getByRole("button", { name: "Member menu" }).click();
    await page.getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator("#profile-form")).toHaveAttribute(
      "data-dirty",
      "false",
    );
    await page.getByRole("button", { name: "Member menu" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    expect(
      (await context.cookies()).find((cookie) =>
        cookie.name === sessionCookieName
      ),
    ).toBeUndefined();
    await settleNavigation(page);
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Sign in to Kinship",
    );
    expect(errors).toEqual([]);
  },
);

test(
  "[AUTH-003] signs in, rotates, signs out, and rejects protected or cross-workspace access",
  {
    annotation: { type: "flow", description: "AUTH-003" },
  },
  async ({ page, request, context, browserName }) => {
    const email = `auth-003-session-${browserName}-${Date.now()}@example.test`;
    await createVerifiedUser(request, email);
    const forged = await request.post(`${origin}/api/v1/sessions`, {
      headers: { origin: "https://attacker.invalid" },
      data: {
        email,
        password: "correct horse battery staple",
      },
    });
    expect(forged.status()).toBe(403);
    expect((await forged.json()).code).toBe("origin_invalid");
    expect(forged.headers()["set-cookie"] ?? "").toBe("");
    await keyboardSignIn(page, email, "wrong password");
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await expect(page.getByRole("status")).toContainText("incorrect");
    expect(
      (await context.cookies()).find((item) => item.name === sessionCookieName),
    ).toBeUndefined();

    const sessionResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v1/sessions" &&
      response.request().method() === "POST"
    );
    await keyboardSignIn(page, email);
    const sessionResponse = await sessionResponsePromise;
    expect((await sessionResponse.allHeaders())["set-cookie"]).toContain(
      "SameSite=Strict",
    );
    expect((await sessionResponse.allHeaders())["set-cookie"]).toContain(
      "Secure",
    );
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "app.today",
    );
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Welcome back.",
    );
    await expect(page.locator("#app-toasts > li")).toHaveCount(0);
    await expectAccessible(page, { networkIdle: true });
    const firstCookie = (await context.cookies()).find((item) =>
      item.name === sessionCookieName
    );
    expect(firstCookie?.httpOnly).toBe(true);
    expect(firstCookie?.secure).toBe(true);
    expect(firstCookie?.path).toBe("/");
    const firstToken = firstCookie?.value;
    expect(firstToken).toBeTruthy();

    const challengeResponsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === "/api/v1/sessions" &&
      response.request().method() === "POST"
    );
    await keyboardSignIn(page, email);
    const challengeResponse = await challengeResponsePromise;
    expect((await challengeResponse.allHeaders())["set-cookie"]).toContain(
      "SameSite=Strict",
    );
    await expect(page).toHaveURL(/\/app$/);
    const secondToken = (await context.cookies()).find((item) =>
      item.name === sessionCookieName
    )?.value;
    expect(secondToken).toBeTruthy();
    expect(secondToken).not.toBe(firstToken);
    const stale = await request.get(`${origin}/api/v1/session`, {
      headers: { cookie: `${sessionCookieName}=${firstToken}` },
    });
    expect(stale.status()).toBe(401);

    const secondWorkspaceId = randomUUID();
    const secondMemberId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    databaseSql(`
    insert into crm.workspaces (id, name, status, created_by_user_id)
    select '${secondWorkspaceId}'::uuid, 'Second browser circle', 'active', id
      from crm.users where email = ${sqlLiteral(email)};
    insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at)
    select '${secondMemberId}'::uuid, '${secondWorkspaceId}'::uuid, id, 'member', 'active', now()
      from crm.users where email = ${sqlLiteral(email)};
    insert into crm.workspaces (id, name, status, created_by_user_id)
    select '${foreignWorkspaceId}'::uuid, 'Unowned browser circle', 'active', id
      from crm.users where email = ${sqlLiteral(email)};
  `);
    const selected = await request.post(`${origin}/api/v1/sessions`, {
      headers: { origin },
      data: {
        email,
        password: "correct horse battery staple",
        workspaceId: secondWorkspaceId,
      },
    });
    expect(selected.status()).toBe(200);
    expect((await selected.json()).workspace.id).toBe(secondWorkspaceId);
    const crossed = await request.post(`${origin}/api/v1/sessions`, {
      headers: { origin },
      data: {
        email,
        password: "correct horse battery staple",
        workspaceId: foreignWorkspaceId,
      },
    });
    expect(crossed.status()).toBe(403);
    expect(crossed.headers()["set-cookie"] ?? "").not.toContain(
      `${sessionCookieName}=`,
    );

    await page.goto("/app");
    await keyboardSignOutWithMultipleWorkspaces(page);
    expect(
      (await context.cookies()).find((item) => item.name === sessionCookieName),
    ).toBeUndefined();
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Sign in to Kinship",
    );
    await expect(page.getByRole("link", { name: "Go to sign-in" }))
      .toBeVisible();
  },
);

test(
  "[AUTH-003] completes TOTP and one-use recovery challenges without replay",
  {
    annotation: { type: "flow", description: "AUTH-003" },
  },
  async ({ page, request, context, browserName }) => {
    const email = `auth-003-mfa-${browserName}-${Date.now()}@example.test`;
    await createVerifiedUser(request, email, "MFA circle");
    const secret = "JBSWY3DPEHPK3PXP";
    const recoveryCode = `recovery-${browserName}-${Date.now()}`;
    const userId = databaseValue(
      `select id::text from crm.users where email = ${sqlLiteral(email)}`,
    );
    databaseSql(`
    insert into crm.user_mfa_totp (user_id, encrypted_secret, confirmed_at)
    select id, ${sqlLiteral(encryptedMfaSecret(secret, userId))}, now()
      from crm.users where email = ${sqlLiteral(email)};
    insert into crm.user_recovery_codes (user_id, code_hash)
    select id, ${sqlLiteral(recoveryHash(recoveryCode))}
      from crm.users where email = ${sqlLiteral(email)};
  `);

    await keyboardSignIn(page, email);
    await expect(page).toHaveURL(/\/auth\/mfa$/);
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "auth.mfa",
    );
    await expectAccessible(page, { networkIdle: true });
    const challengeCookie = (await context.cookies()).find((item) =>
      item.name === "kinship_mfa"
    );
    expect(challengeCookie?.httpOnly).toBe(true);
    expect(challengeCookie?.path).toBe("/api/v1/mfa-challenges");
    const challenge = challengeCookie?.value;
    expect(challenge).toBeTruthy();

    await page.route("**/api/v1/mfa-challenges", (route) => route.abort());
    await keyboardMfaFactor(page, "000000");
    await expect(page.getByRole("status")).toContainText(
      "temporarily unavailable",
    );
    await expect(page.getByRole("status")).toBeFocused();
    await expect(page.getByRole("button", { name: "Continue securely" }))
      .toBeEnabled();
    await page.unroute("**/api/v1/mfa-challenges");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByLabel("Authenticator or recovery code"))
      .toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type("000000");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toContainText("not valid");
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByLabel("Authenticator or recovery code"))
      .toBeFocused();
    await page.keyboard.press("ControlOrMeta+A");
    await page.keyboard.type(totp(secret));
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app$/);
    expect(
      (await context.cookies()).find((item) => item.name === "kinship_mfa"),
    ).toBeUndefined();

    const replay = await request.post(`${origin}/api/v1/mfa-challenges`, {
      headers: { cookie: `kinship_mfa=${challenge}`, origin },
      data: { factor: totp(secret) },
    });
    expect(replay.status()).toBe(410);

    await keyboardSignOutWithSingleWorkspace(page);
    await keyboardSignIn(page, email);
    await expect(page).toHaveURL(/\/auth\/mfa$/);
    await keyboardMfaFactor(page, recoveryCode);
    await expect(page).toHaveURL(/\/app$/);
    await keyboardSignOutWithSingleWorkspace(page);
    await keyboardSignIn(page, email);
    await expect(page).toHaveURL(/\/auth\/mfa$/);
    await keyboardMfaFactor(page, recoveryCode);
    await expect(page.getByRole("status")).toContainText("not valid");
  },
);

test("[AUTH-003] recovers safely and rejects expired reset links", {
  annotation: { type: "flow", description: "AUTH-003" },
}, async ({ page, request, browserName }) => {
  const policyViolations = recordPolicyViolations(page);
  const email = `auth-003-reset-${browserName}-${Date.now()}@example.test`;
  await createVerifiedUser(request, email, "Recovery circle");
  await page.goto("/auth/forgot-password");
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "auth.recover",
  );
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Email address")).toBeFocused();
  await page.keyboard.type(email);
  await page.keyboard.press("Tab");
  await page.route(
    "**/api/v1/password-reset-requests",
    (route) => route.abort(),
  );
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText(
    "could not submit",
  );
  await expect(page.getByRole("button", { name: "Send recovery link" }))
    .toBeEnabled();
  await page.unroute("**/api/v1/password-reset-requests");
  await page.getByRole("button", { name: "Send recovery link" }).click();
  await expect(page.getByRole("status")).toContainText(
    "cannot confirm delivery",
  );
  await expect(page.getByRole("button", { name: "Send recovery link" }))
    .toBeEnabled();
  const token = await pathMailToken(request, email, "/auth/reset-password");
  await page.goto(`/auth/reset-password?token=${encodeURIComponent(token)}`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "auth.reset",
  );
  await page.route("**/api/v1/password-resets", (route) => route.abort());
  await keyboardReset(page, "new correct horse battery staple");
  await expect(page.getByRole("status")).toContainText(
    "temporarily unavailable",
  );
  await expect(page.getByRole("button", { name: "Reset password" }))
    .toBeEnabled();
  await page.unroute("**/api/v1/password-resets");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page).toHaveURL(/\/auth\/sign-in$/);

  const requestedAgain = await request.post(
    `${origin}/api/v1/password-reset-requests`,
    { headers: { origin }, data: { email } },
  );
  expect(requestedAgain.status()).toBe(202);
  const expired = await pathMailToken(
    request,
    email,
    "/auth/reset-password",
    token,
  );
  databaseSql(`
    update crm.password_reset_requests set expires_at = now() - interval '1 minute'
      where email = ${sqlLiteral(email)} and used_at is null;
  `);
  await settleNavigation(page);
  await page.goto(`/auth/reset-password?token=${encodeURIComponent(expired)}`);
  await keyboardReset(page, "expired correct horse battery staple");
  await expect(page.getByRole("status")).toContainText("invalid or expired");
  await expectAccessible(page, { networkIdle: true });
  expect(policyViolations).toEqual([]);
});

test(
  "[AUTH-003] FER-13 a sign-in made before the page's script runs never reaches a native POST",
  {
    annotation: { type: "flow", description: "AUTH-003" },
  },
  async ({ page }) => {
    // Hold every module the page loads, so the form is drawn but not yet wired:
    // the window a reader on a slow connection meets. A native submission there
    // would be a POST to the static page, which the gateway answers 405.
    let release!: () => void;
    const held = new Promise<void>((resolve) => release = resolve);
    await page.route("**/_astro/**/*.js", async (route) => {
      await held;
      await route.continue();
    });
    const nativePosts: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && !request.url().includes("/api/")) {
        nativePosts.push(request.url());
      }
    });

    await page.goto("/auth/sign-in", { waitUntil: "commit" });
    const submit = page.getByRole("button", { name: "Sign in" });
    await expect(submit).toBeVisible();
    await expect(submit).toBeDisabled();
    await page.getByLabel("Email address").fill("early@example.test");
    await page.getByLabel("Password").fill("correct horse battery staple");
    await page.getByLabel("Password").press("Enter");
    await expect(page).toHaveURL(/\/auth\/sign-in$/);

    release();
    await expect(submit).toBeEnabled();
    expect(nativePosts).toEqual([]);
    await expect(page.getByLabel("Email address")).toHaveValue(
      "early@example.test",
    );
  },
);
