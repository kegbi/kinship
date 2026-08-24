import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";
import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { execFileSync } from "node:child_process";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const apiOrigin = origin;
const composeArgs = [
  "compose",
  "--file",
  "compose.yaml",
  "--file",
  "compose.test.yaml",
] as const;

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseSql(statement: string): void {
  execFileSync(
    "docker",
    [
      ...composeArgs,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      process.env.POSTGRES_USER ?? "kinship_e2e",
      "-d",
      process.env.POSTGRES_DB ?? "kinship_e2e",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ],
    { cwd: process.cwd(), env: process.env, stdio: "pipe" },
  );
}

function databaseValue(statement: string): string {
  return execFileSync(
    "docker",
    [
      ...composeArgs,
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      process.env.POSTGRES_USER ?? "kinship_e2e",
      "-d",
      process.env.POSTGRES_DB ?? "kinship_e2e",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ],
    { cwd: process.cwd(), encoding: "utf8", env: process.env },
  ).trim();
}

async function mailToken(
  request: APIRequestContext,
  email: string,
  path: "/auth/reset-password" | "/auth/verify-email",
  exclude?: string,
): Promise<string> {
  let token: string | undefined;
  await expect.poll(async () => {
    const response = await request.get(
      `${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    );
    const body = await response.json() as { messages?: Array<{ ID: string }> };
    for (const message of body.messages ?? []) {
      const detail = await request.get(
        `${mailOrigin}/api/v1/message/${message.ID}`,
      );
      const content = await detail.json() as { Text?: string };
      const link = content.Text?.match(/https?:\/\/\S+\?token=\S+/)?.[0];
      if (!link) continue;
      const url = new URL(link);
      if (url.pathname === path) {
        const candidate = url.searchParams.get("token") ?? undefined;
        if (candidate && candidate !== exclude) token = candidate;
      }
      if (token) break;
    }
    return token;
  }).toBeTruthy();
  return token!;
}

async function createVerifiedUser(
  request: APIRequestContext,
  email: string,
  workspaceName = "Analytical circle",
): Promise<void> {
  const registered = await request.post(`${apiOrigin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Ada",
      lastName: "Lovelace",
      password: "correct horse battery staple",
      workspaceName,
    },
  });
  expect(registered.status()).toBe(202);
  const token = await mailToken(request, email, "/auth/verify-email");
  const verified = await request.post(
    `${apiOrigin}/api/v1/email-verifications`,
    { data: { token } },
  );
  expect(verified.status()).toBe(200);
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

async function keyboardSignOut(page: Page): Promise<void> {
  const skipLink = page.getByRole("link", { name: "Skip to main content" });
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Kinship Today" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Today", exact: true }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "People", exact: true }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Tasks", exact: true }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Quick capture" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Add person" })).toBeFocused();
  await page.keyboard.press("Tab");
  const menuToggle = page.getByRole("button", { name: "Open member menu" });
  await expect(menuToggle).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Settings" })).toBeFocused();
  await page.keyboard.press("Tab");
  const signOutButton = page.getByRole("button", { name: "Sign out" });
  await expect(signOutButton).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/auth\/sign-in$/);
}

test(
  "[AUTH-003] signs in, rotates, signs out, and rejects protected or cross-workspace access",
  {
    annotation: { type: "flow", description: "AUTH-003" },
  },
  async ({ page, request, context, browserName }) => {
    const email = `auth-003-session-${browserName}-${Date.now()}@example.test`;
    await createVerifiedUser(request, email);
    const forged = await request.post(`${apiOrigin}/api/v1/sessions`, {
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
      (await context.cookies()).find((item) => item.name === "kinship_session"),
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
    await expect(page.locator("#shell-status")).toBeEmpty();
    await expectAccessible(page);
    const firstCookie = (await context.cookies()).find((item) =>
      item.name === "kinship_session"
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
      item.name === "kinship_session"
    )?.value;
    expect(secondToken).toBeTruthy();
    expect(secondToken).not.toBe(firstToken);
    const stale = await request.get(`${apiOrigin}/api/v1/session`, {
      headers: { cookie: `kinship_session=${firstToken}` },
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
    const selected = await request.post(`${apiOrigin}/api/v1/sessions`, {
      headers: { origin },
      data: {
        email,
        password: "correct horse battery staple",
        workspaceId: secondWorkspaceId,
      },
    });
    expect(selected.status()).toBe(200);
    expect((await selected.json()).workspace.id).toBe(secondWorkspaceId);
    const crossed = await request.post(`${apiOrigin}/api/v1/sessions`, {
      headers: { origin },
      data: {
        email,
        password: "correct horse battery staple",
        workspaceId: foreignWorkspaceId,
      },
    });
    expect(crossed.status()).toBe(403);
    expect(crossed.headers()["set-cookie"] ?? "").not.toContain(
      "kinship_session=",
    );

    await page.goto("/app");
    await keyboardSignOut(page);
    expect(
      (await context.cookies()).find((item) => item.name === "kinship_session"),
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
    await expectAccessible(page);
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

    const replay = await request.post(`${apiOrigin}/api/v1/mfa-challenges`, {
      headers: { cookie: `kinship_mfa=${challenge}`, origin },
      data: { factor: totp(secret) },
    });
    expect(replay.status()).toBe(410);

    await keyboardSignOut(page);
    await keyboardSignIn(page, email);
    await expect(page).toHaveURL(/\/auth\/mfa$/);
    await keyboardMfaFactor(page, recoveryCode);
    await expect(page).toHaveURL(/\/app$/);
    await keyboardSignOut(page);
    await keyboardSignIn(page, email);
    await expect(page).toHaveURL(/\/auth\/mfa$/);
    await keyboardMfaFactor(page, recoveryCode);
    await expect(page.getByRole("status")).toContainText("not valid");
  },
);

test("[AUTH-003] recovers safely and rejects expired reset links", {
  annotation: { type: "flow", description: "AUTH-003" },
}, async ({ page, request, browserName }) => {
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
  const token = await mailToken(request, email, "/auth/reset-password");
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
    `${apiOrigin}/api/v1/password-reset-requests`,
    { headers: { origin }, data: { email } },
  );
  expect(requestedAgain.status()).toBe(202);
  const expired = await mailToken(
    request,
    email,
    "/auth/reset-password",
    token,
  );
  databaseSql(`
    update crm.password_reset_requests set expires_at = now() - interval '1 minute'
      where email = ${sqlLiteral(email)} and used_at is null;
  `);
  await page.goto(`/auth/reset-password?token=${encodeURIComponent(expired)}`);
  await keyboardReset(page, "expired correct horse battery staple");
  await expect(page.getByRole("status")).toContainText("invalid or expired");
  await expectAccessible(page);
});
