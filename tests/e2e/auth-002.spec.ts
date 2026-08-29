import {
  type APIRequestContext,
  type BrowserContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";
import { execFileSync } from "node:child_process";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";
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
  execFileSync("docker", [
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
  ], { cwd: process.cwd(), env: process.env, stdio: "pipe" });
}

async function mailText(
  request: APIRequestContext,
  email: string,
  pattern: RegExp,
): Promise<string> {
  let text: string | undefined;
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
      if (content.Text && pattern.test(content.Text)) text = content.Text;
    }
    return text;
  }).toBeTruthy();
  return text!;
}

async function registerVerified(
  request: APIRequestContext,
  email: string,
  workspaceName: string,
): Promise<void> {
  const registered = await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Test",
      lastName: "Invitee",
      password,
      workspaceName,
    },
  });
  expect(registered.status()).toBe(202);
  const text = await mailText(request, email, /auth\/verify-email/);
  const token = new URL(text.match(/https?:\/\/\S+\?token=\S+/)![0])
    .searchParams.get("token");
  expect(token).toBeTruthy();
  expect(
    (await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token },
    })).status(),
  ).toBe(200);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function invitationLink(
  request: APIRequestContext,
  email: string,
): Promise<string> {
  const text = await mailText(request, email, /\/invite\//);
  const match = text.match(/https?:\/\/\S+\/invite\/\S+/);
  expect(match).not.toBeNull();
  return match![0];
}

async function replacementInvitationLink(
  request: APIRequestContext,
  email: string,
  previous: string,
): Promise<string> {
  let replacement: string | undefined;
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
      const candidate = content.Text?.match(/https?:\/\/\S+\/invite\/\S+/)?.[0];
      if (candidate && candidate !== previous) replacement = candidate;
    }
    return replacement;
  }).toBeTruthy();
  return replacement!;
}

async function expectAccessible(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () =>
    (await (window as typeof window & {
      axe: { run(): Promise<{ violations: unknown[] }> };
    }).axe.run()).violations
  );
  expect(violations).toEqual([]);
}

async function cookieHeader(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((candidate) =>
    candidate.name === "kinship_session"
  );
  expect(cookie?.httpOnly).toBe(true);
  expect(cookie?.secure).toBe(true);
  return `kinship_session=${cookie!.value}`;
}

test(
  "[AUTH-002] owner invites and intended authenticated user atomically joins once",
  { annotation: { type: "flow", description: "AUTH-002" } },
  async ({ browser, browserName, context, page, request }) => {
    test.setTimeout(180_000);
    const suffix = `${browserName}-${Date.now()}`;
    const ownerEmail = `owner-${suffix}@example.test`;
    const inviteeEmail = `invitee-${suffix}@example.test`;
    const adminEmail = `admin-${suffix}@example.test`;
    const raceEmail = `race-${suffix}@example.test`;
    const foreignEmail = `foreign-${suffix}@example.test`;
    await registerVerified(request, ownerEmail, `Owner ${suffix}`);
    await registerVerified(request, adminEmail, `Admin ${suffix}`);
    await registerVerified(request, raceEmail, `Race ${suffix}`);
    await registerVerified(request, foreignEmail, `Foreign ${suffix}`);
    await signIn(page, ownerEmail);
    await page.goto("/app/settings/members");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.members",
    );
    await expect(page.getByRole("heading", { level: 1, name: "Members" }))
      .toBeVisible();
    await expect(page.getByText(ownerEmail)).toBeVisible();
    await expect(page.getByText("No pending invitations.")).toBeVisible();
    await expectAccessible(page);

    const email = page.getByLabel("Email address");
    await email.click();
    await email.fill(inviteeEmail);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Role")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Send invitation" }))
      .toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("status").filter({ hasText: "Invitation sent" }),
    ).toBeVisible();
    await expect(page.getByText(inviteeEmail)).toBeVisible();
    const link = await invitationLink(request, inviteeEmail);

    await page.goto(link);
    await page.getByRole("button", { name: "Accept invitation" }).click();
    await expect(page.getByRole("heading", { name: "Invitation unavailable" }))
      .toBeVisible();
    await expect(page.getByText(/different email address/i)).toBeVisible();

    const inviteeContext = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      const inviteePage = await inviteeContext.newPage();
      const invitationResponse = await inviteePage.goto(link);
      expect(invitationResponse?.headers()["cache-control"]).toBe(
        "private, no-store",
      );
      expect(invitationResponse?.headers()["referrer-policy"]).toBe(
        "no-referrer",
      );
      const rawToken = decodeURIComponent(
        new URL(link).pathname.split("/").at(-1)!,
      );
      await expect(inviteePage).toHaveURL(/\/invite\/continue$/);
      expect(await inviteePage.locator("html").innerHTML()).not.toContain(
        rawToken,
      );
      const signUpLink = inviteePage.getByRole("link", {
        name: "Create an account, then return to this link",
      });
      await expect(signUpLink).toHaveAttribute("href", "/auth/sign-up");
      await expectAccessible(inviteePage);
      expect(await inviteePage.evaluate(() => Object.keys(localStorage)))
        .toEqual([]);
      await signUpLink.click();
      await expect(inviteePage).toHaveURL(/\/auth\/sign-up$/);
      expect(await inviteePage.locator("html").innerHTML()).not.toContain(
        rawToken,
      );
      await expect(inviteePage.getByLabel("Workspace name")).toHaveCount(0);
      await inviteePage.getByLabel("First name").fill("New");
      await inviteePage.getByLabel(/Last name/).fill("Invitee");
      await inviteePage.getByLabel("Email address").fill(inviteeEmail);
      await inviteePage.getByLabel("Password").fill(password);
      await inviteePage.getByRole("button", {
        name: "Create account and join",
      }).click();
      await expect(inviteePage.getByText(/check your email/i)).toBeVisible();
      const verificationText = await mailText(
        request,
        inviteeEmail,
        /auth\/verify-email/,
      );
      const verificationLink = verificationText.match(
        /https?:\/\/\S+\?token=\S+/,
      )?.[0];
      expect(verificationLink).toBeTruthy();
      await inviteePage.goto(verificationLink!);
      await expect(inviteePage).toHaveURL(/\/invite\/continue$/);
      await expect(
        inviteePage.getByRole("heading", {
          name: new RegExp(`Join Owner ${browserName}`),
        }),
      ).toBeVisible();

      await page.goto("/app/settings/members");
      await expect(page.getByRole("heading", { level: 1, name: "Members" }))
        .toBeVisible();
      const replacementResponse = page.waitForResponse((response) =>
        response.url().endsWith("/api/v1/workspace-invitations") &&
        response.request().method() === "POST"
      );
      await page.getByLabel("Email address").fill(inviteeEmail);
      await page.getByRole("button", { name: "Send invitation" }).click();
      expect((await replacementResponse).status()).toBe(201);
      const replacementLink = await replacementInvitationLink(
        request,
        inviteeEmail,
        link,
      );
      expect(replacementLink).not.toBe(link);
      const originalInspection = await request.post(
        `${origin}/api/v1/workspace-invitations/inspect`,
        { headers: { origin }, data: { token: rawToken } },
      );
      expect(originalInspection.status()).toBe(410);

      await inviteeContext.clearCookies();
      await inviteePage.goto(replacementLink);
      await inviteePage.getByRole("link", {
        name: "Sign in as the invited person",
      }).click();
      await expect(inviteePage).toHaveURL(/\/auth\/sign-in$/);
      await inviteePage.getByLabel("Email address").fill(inviteeEmail);
      await inviteePage.getByLabel("Password").fill(password);
      await inviteePage.getByRole("button", { name: "Sign in" }).click();
      await expect(inviteePage).toHaveURL(/\/invite\/continue$/);
      await expect(
        inviteePage.getByRole("heading", {
          name: new RegExp(`Join Owner ${browserName}`),
        }),
      ).toBeVisible();
      await inviteePage.getByRole("button", { name: "Accept invitation" })
        .click();
      await expect(
        inviteePage.getByRole("heading", {
          name: new RegExp(`Welcome to Owner ${browserName}`),
        }),
      ).toBeVisible();
      await expect(inviteePage.getByText(/cannot be used again/i))
        .toBeVisible();
      const ownerWorkspaceId = databaseWorkspaceId(ownerEmail);
      expect(
        await inviteePage.evaluate(() =>
          sessionStorage.getItem("kinship.active-workspace")
        ),
      ).toBe(ownerWorkspaceId);
      await inviteePage.getByRole("link", { name: "Open workspace" }).click();
      await expect(inviteePage).toHaveURL(/\/app$/);
      await expect(inviteePage.locator("body")).toHaveAttribute(
        "data-page-id",
        "app.today",
      );
      await expect(inviteePage.locator("[data-workspace-name]").first())
        .toContainText(`Owner ${suffix}`);
      await inviteePage.goto("/app/settings");
      await expect(inviteePage.getByRole("heading", { name: "Settings" }))
        .toBeVisible();
      await expect(inviteePage.getByRole("heading", { name: "Members" }))
        .toHaveCount(0);
      await inviteePage.goto("/app/settings/members");
      await expect(
        inviteePage.getByRole("heading", {
          name: "You don’t have access to Members",
        }),
      ).toBeVisible();
      await expect(inviteePage.getByText("Invite a member")).toHaveCount(0);
      await expect(inviteePage.getByText("Pending invitations")).toHaveCount(
        0,
      );
      await inviteePage.goto(replacementLink);
      await expect(inviteePage.getByText(/already been used/i)).toBeVisible();

      const memberDenial = await inviteeContext.request.post(
        `${origin}/api/v1/workspace-invitations`,
        {
          headers: { origin, "X-Workspace-Id": ownerWorkspaceId },
          data: { email: `denied-${suffix}@example.test`, role: "member" },
        },
      );
      expect(memberDenial.status()).toBe(403);
      const alreadyMember = await context.request.post(
        `${origin}/api/v1/workspace-invitations`,
        {
          headers: { origin, "X-Workspace-Id": ownerWorkspaceId },
          data: { email: inviteeEmail, role: "member" },
        },
      );
      expect(alreadyMember.status()).toBe(409);

      await page.goto("/app/settings/members");
      await page.getByLabel("Email address").fill(adminEmail);
      await page.getByLabel("Role").selectOption("admin");
      await page.getByRole("button", { name: "Send invitation" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Invitation sent" }),
      ).toBeVisible();
      const adminLink = await invitationLink(request, adminEmail);
      const adminContext = await browser.newContext({
        baseURL: origin,
        ignoreHTTPSErrors: true,
      });
      try {
        const adminPage = await adminContext.newPage();
        await signIn(adminPage, adminEmail);
        const adminWorkspaceId = await adminPage.evaluate(async () =>
          (await (await fetch("/api/v1/session")).json()).workspace.id as string
        );
        await adminPage.evaluate((workspaceId) => {
          sessionStorage.setItem("kinship.active-workspace", workspaceId);
        }, adminWorkspaceId);
        await adminPage.goto(adminLink);
        await adminPage.getByRole("button", { name: "Accept invitation" })
          .click();
        await expect(
          adminPage.getByRole("heading", {
            name: new RegExp(`Welcome to Owner ${browserName}`),
          }),
        ).toBeVisible();
        expect(
          await adminPage.evaluate(() =>
            sessionStorage.getItem("kinship.active-workspace")
          ),
        ).toBe(ownerWorkspaceId);
        await adminPage.getByRole("link", { name: "Open workspace" }).click();
        await expect(adminPage).toHaveURL(/\/app$/);
        await expect(adminPage.locator("[data-workspace-name]").first())
          .toContainText(`Owner ${suffix}`);
        databaseSql(
          `update crm.workspace_members set role = 'member', updated_at = now() where workspace_id = ${
            sqlLiteral(adminWorkspaceId)
          }::uuid and user_id = (select id from crm.users where email = ${
            sqlLiteral(adminEmail)
          });`,
        );
        await adminPage.goto("/app/settings/members");
        await expect(adminPage.getByText(ownerEmail)).toBeVisible();
        const memberMenuToggle = adminPage.getByRole("button", {
          name: "Open member menu",
        });
        await memberMenuToggle.click();
        await expect(memberMenuToggle).toHaveAttribute("aria-expanded", "true");
        await adminPage.getByLabel("Active workspace").selectOption(
          adminWorkspaceId,
        );
        await expect(
          adminPage.getByRole("heading", {
            name: "You don’t have access to Members",
          }),
        ).toBeVisible();
        await expect(adminPage.getByText(ownerEmail)).toHaveCount(0);
        await expect(adminPage.getByText("Invite a member")).toHaveCount(0);
      } finally {
        await adminContext.close();
      }

      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/app/settings/members");
      const send = page.getByRole("button", { name: "Send invitation" });
      const box = await send.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(44);
      expect(box?.height).toBeGreaterThanOrEqual(44);
      await expectAccessible(page);
      await page.setViewportSize({ width: 1280, height: 900 });

      await page.getByLabel("Email address").fill(raceEmail);
      await page.getByRole("button", { name: "Send invitation" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Invitation sent" }),
      ).toBeVisible();
      const raceLink = await invitationLink(request, raceEmail);
      const raceToken = decodeURIComponent(
        new URL(raceLink).pathname.split("/").at(-1)!,
      );
      const raceContext = await browser.newContext({
        baseURL: origin,
        ignoreHTTPSErrors: true,
      });
      try {
        const racePage = await raceContext.newPage();
        await signIn(racePage, raceEmail);
        const cookie = await cookieHeader(raceContext);
        const outcomes = await Promise.all(
          [1, 2].map(() =>
            request.post(`${origin}/api/v1/workspace-invitations/accept`, {
              headers: { cookie, origin },
              data: { token: raceToken },
            })
          ),
        );
        expect(outcomes.map((response) => response.status()).sort()).toEqual([
          200,
          410,
        ]);
      } finally {
        await raceContext.close();
      }

      const foreignWorkspaceId = databaseWorkspaceId(foreignEmail);
      const crossedList = await context.request.get(
        `${origin}/api/v1/workspace-members`,
        {
          headers: {
            cookie: await cookieHeader(context),
            "X-Workspace-Id": foreignWorkspaceId,
          },
        },
      );
      expect(crossedList.status()).toBe(401);

      for (const terminal of ["expired", "revoked"] as const) {
        const terminalEmail = `${terminal}-${suffix}@example.test`;
        await page.getByLabel("Email address").fill(terminalEmail);
        await page.getByRole("button", { name: "Send invitation" }).click();
        await expect(
          page.getByRole("status").filter({ hasText: "Invitation sent" }),
        ).toBeVisible();
        const terminalLink = await invitationLink(request, terminalEmail);
        databaseSql(
          terminal === "expired"
            ? `update crm.workspace_invitations set expires_at = now() - interval '1 second' where email = ${
              sqlLiteral(terminalEmail)
            };`
            : `update crm.workspace_invitations set status = 'revoked' where email = ${
              sqlLiteral(terminalEmail)
            };`,
        );
        const terminalContext = await browser.newContext({
          baseURL: origin,
          ignoreHTTPSErrors: true,
        });
        try {
          const terminalPage = await terminalContext.newPage();
          await terminalPage.goto(terminalLink);
          await expect(terminalPage.getByText(new RegExp(terminal)))
            .toBeVisible();
        } finally {
          await terminalContext.close();
        }
      }
    } finally {
      await inviteeContext.close();
    }
  },
);

function databaseWorkspaceId(email: string): string {
  return execFileSync("docker", [
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
    "-c",
    `select w.id from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
      sqlLiteral(email)
    } limit 1;`,
  ], { cwd: process.cwd(), env: process.env, encoding: "utf8" }).trim();
}
