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

function withExecRetry<T>(operation: () => T): T {
  for (let attempt = 1;; attempt += 1) {
    try {
      return operation();
    } catch (error) {
      if (attempt === 3) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
}

function sqlLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function databaseSql(statement: string): void {
  withExecRetry(() =>
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
    ], { cwd: process.cwd(), env: process.env, stdio: "pipe" })
  );
}

function databaseValue(statement: string): string {
  return withExecRetry(() =>
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
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      statement,
    ], { cwd: process.cwd(), encoding: "utf8", env: process.env })
  ).trim();
}

async function verificationToken(
  request: APIRequestContext,
  email: string,
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
      if (link && new URL(link).pathname === "/auth/verify-email") {
        token = new URL(link).searchParams.get("token") ?? undefined;
      }
    }
    return token;
  }).toBeTruthy();
  return token!;
}

async function registerVerified(
  request: APIRequestContext,
  email: string,
  workspaceName: string,
): Promise<void> {
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Test",
      lastName: "Member",
      password,
      workspaceName,
    },
  })).status()).toBe(202);
  expect((await request.post(`${origin}/api/v1/email-verifications`, {
    data: { token: await verificationToken(request, email) },
  })).status()).toBe(200);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function openMemberPopover(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Open member menu" });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function sessionCookie(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((item) =>
    item.name === "kinship_session"
  );
  expect(cookie).toBeTruthy();
  return `kinship_session=${cookie!.value}`;
}

async function expectAccessible(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  const violations = await page.evaluate(async () =>
    (await (globalThis as typeof globalThis & {
      axe: { run(): Promise<{ violations: unknown[] }> };
    }).axe.run()).violations
  );
  expect(violations).toEqual([]);
}

test(
  "[AUTH-004] APR-008 saved name and sort preferences follow the active membership",
  {
    annotation: [
      { type: "flow", description: "AUTH-004" },
    ],
  },
  async ({ page, request, browserName }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(15_000);
    const suffix = `${browserName}-${Date.now()}`;
    const email = `names-${suffix}@example.test`;
    const otherEmail = `names-other-${suffix}@example.test`;
    await registerVerified(request, email, `Names ${suffix}`);
    await registerVerified(request, otherEmail, `Other names ${suffix}`);
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(email)
      }`,
    );
    const otherWorkspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(otherEmail)
      }`,
    );
    const userId = databaseValue(
      `select id::text from crm.users where email = ${sqlLiteral(email)}`,
    );
    databaseSql(
      `with inserted as (insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at) values (gen_random_uuid(), ${
        sqlLiteral(otherWorkspaceId)
      }::uuid, ${
        sqlLiteral(userId)
      }::uuid, 'member', 'active', now(), now(), now()) returning id) insert into crm.member_preferences (member_id) select id from inserted`,
    );
    await signIn(page, email);
    const createPerson = async (
      targetWorkspaceId: string,
      identity: {
        givenName: string;
        familyName?: string;
        nickname?: string;
        isPartial?: boolean;
      },
    ) => {
      const created = await page.request.post(`${origin}/api/v1/people`, {
        headers: { "X-Workspace-Id": targetWorkspaceId, Origin: origin },
        data: { ...identity, isPartial: identity.isPartial ?? false },
      });
      expect(created.status()).toBe(201);
      return (await created.json() as { person: { id: string } }).person.id;
    };
    const adaId = await createPerson(workspaceId, {
      givenName: "Ada",
      familyName: "Zulu",
    });
    await createPerson(workspaceId, { givenName: "Zoe", familyName: "Alpha" });
    const partialId = await createPerson(workspaceId, {
      givenName: "",
      nickname: "Sunny",
      isPartial: true,
    });
    await createPerson(otherWorkspaceId, {
      givenName: "Ada",
      familyName: "Zulu",
    });
    await createPerson(otherWorkspaceId, {
      givenName: "Zoe",
      familyName: "Alpha",
    });

    await page.goto("/app/settings/preferences");
    await page.getByLabel("Name display").selectOption("family_given_nickname");
    await page.locator('[name="contactSortOrder"]').selectOption(
      "family_name_asc",
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Preferences saved" }),
    ).toBeVisible();
    await page.goto("/app/people");
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "family-name",
    );
    const labels = page.locator("#people-directory-list h2");
    await expect(labels).toHaveCount(3);
    const familyLabels = await labels.allTextContents();
    expect(familyLabels.indexOf("Alpha Zoe")).toBeLessThan(
      familyLabels.indexOf("Zulu Ada"),
    );
    expect(familyLabels).toContain("Sunny");
    await page.goto("/app/people?sort=given-name");
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "given-name",
    );
    await expect(labels).toHaveCount(3);
    const explicitLabels = await labels.allTextContents();
    expect(explicitLabels.indexOf("Zulu Ada")).toBeLessThan(
      explicitLabels.indexOf("Alpha Zoe"),
    );
    await page.reload();
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "given-name",
    );

    const recordedView = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/people/${adaId}/view`) &&
      response.request().method() === "POST" && response.status() === 200
    );
    await page.goto(`/app/people/${adaId}`);
    await expect(page.locator("#person-profile-name")).toHaveText("Zulu Ada");
    await recordedView;
    await page.getByRole("combobox", { name: "Find a person" }).press(
      "ArrowDown",
    );
    await expect(
      page.locator("#global-people-search-results strong").filter({
        hasText: "Zulu Ada",
      }),
    ).toBeVisible();
    await page.locator("#global-people-search-input").fill("Ada");
    await expect(
      page.locator("#global-people-search-results strong").filter({
        hasText: "Zulu Ada",
      }),
    ).toBeVisible();
    await page.locator("[data-global-people-search-close]").click();
    await page.getByRole("button", { name: "Quick capture", exact: true })
      .click();
    await expect(
      page.locator('[name="participantIds"] option').filter({
        hasText: "Zulu Ada",
      }),
    ).toHaveCount(1);
    await expect(
      page.locator('[name="participantIds"] option').filter({
        hasText: "Sunny",
      }),
    ).toHaveCount(1);
    await page.locator("[data-interaction-cancel]").click();
    await page.goto(`/app/people/${partialId}`);
    await expect(page.locator("#person-profile-name")).toHaveText("Sunny");
    await expect(page.locator("#person-profile-partial")).toBeVisible();

    await page.goto("/app/people");
    await openMemberPopover(page);
    await page.getByLabel("Active workspace").selectOption(otherWorkspaceId);
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "given-name",
    );
    await expect(labels).toHaveText(["Ada Zulu", "Zoe Alpha"]);
    await openMemberPopover(page);
    await page.getByLabel("Active workspace").selectOption(workspaceId);
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "family-name",
    );
    await expect(labels).toContainText(["Alpha Zoe", "Zulu Ada"]);
  },
);

test(
  "[AUTH-004] [WORKSPACE-001] member settings and role-safe workspace administration are tenant-safe",
  {
    annotation: [
      { type: "flow", description: "AUTH-004" },
      { type: "flow", description: "WORKSPACE-001" },
    ],
  },
  async ({ browser, browserName, context, page, request }) => {
    test.setTimeout(240_000);
    const suffix = `${browserName}-${Date.now()}`;
    const ownerEmail = `settings-owner-${suffix}@example.test`;
    const memberEmail = `settings-member-${suffix}@example.test`;
    const foreignEmail = `settings-foreign-${suffix}@example.test`;
    await registerVerified(request, ownerEmail, `Owner ${suffix}`);
    await registerVerified(request, memberEmail, `Member ${suffix}`);
    await registerVerified(request, foreignEmail, `Foreign ${suffix}`);
    const ownerWorkspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(ownerEmail)
      }`,
    );
    const memberUserId = databaseValue(
      `select id::text from crm.users where email = ${sqlLiteral(memberEmail)}`,
    );
    const foreignMemberId = databaseValue(
      `select wm.id::text from crm.workspace_members wm join crm.users u on u.id = wm.user_id where u.email = ${
        sqlLiteral(foreignEmail)
      }`,
    );
    const foreignWorkspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(foreignEmail)
      }`,
    );
    const ownerUserId = databaseValue(
      `select id::text from crm.users where email = ${sqlLiteral(ownerEmail)}`,
    );
    databaseSql(
      `with inserted as (insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at) values (gen_random_uuid(), ${
        sqlLiteral(ownerWorkspaceId)
      }::uuid, ${
        sqlLiteral(memberUserId)
      }::uuid, 'member', 'active', now(), now(), now()) returning id) insert into crm.member_preferences (member_id) select id from inserted`,
    );
    databaseSql(
      `with inserted as (insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at) values (gen_random_uuid(), ${
        sqlLiteral(foreignWorkspaceId)
      }::uuid, ${
        sqlLiteral(ownerUserId)
      }::uuid, 'admin', 'active', now(), now(), now()) returning id) insert into crm.member_preferences (member_id) select id from inserted`,
    );

    await signIn(page, ownerEmail);
    await page.goto("/app/settings/profile");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.profile",
    );
    await expect(page.getByLabel("First name")).toHaveValue("Test");
    await page.getByLabel("First name").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toContainText("Review");
    await expect(page.getByLabel("First name")).toBeFocused();
    await expectAccessible(page);
    await page.getByLabel("First name").fill("Ada");
    await page.getByLabel("Last name").fill("Owner");
    await expect(page.getByText("Unsaved changes.")).toBeVisible();
    const navigationChoice = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("beforeunload");
        await dialog.dismiss();
        resolve();
      });
    });
    await page.getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Settings", exact: true }).click();
    await navigationChoice;
    await expect(page).toHaveURL(/\/app\/settings\/profile$/);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Profile saved" }))
      .toBeVisible();
    await expect(page.getByText("All changes saved.")).toBeVisible();

    await page.goto("/app/settings/preferences");
    await page.getByLabel("Locale").fill("sr-Latn");
    const timeZone = page.getByLabel("Time zone");
    await timeZone.fill("Not/AZone");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toContainText("Review");
    await expect(page.getByText("Enter a valid IANA time zone.")).toBeVisible();
    await expect(timeZone).toHaveAttribute("aria-invalid", "true");
    await expect(timeZone).toBeFocused();
    await timeZone.fill("Europe/Belgrade");
    const currency = page.getByLabel("Currency");
    await currency.fill("ZZZ");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Choose a supported currency.")).toBeVisible();
    await expect(currency).toHaveAttribute("aria-invalid", "true");
    await expect(currency).toBeFocused();
    await currency.fill("EUR");
    await page.getByLabel("Use fluid layout").check();
    await expect(page.getByText("Unsaved changes.")).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Preferences saved" }),
    ).toBeVisible();
    const originalBodyBackground = await page.locator("body").evaluate(
      (body) => getComputedStyle(body).backgroundColor,
    );
    const theme = page.getByLabel("Theme");
    await theme.selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() =>
      page.locator("body").evaluate((body) =>
        getComputedStyle(body).backgroundColor
      )
    ).not.toBe(originalBodyBackground);
    await expect(
      page.getByRole("status").filter({ hasText: "Dark theme saved" }),
    ).toBeVisible();
    await expectAccessible(page);
    await page.evaluate(() => localStorage.removeItem("kinship.theme"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.getByLabel("Theme")).toHaveValue("dark");
    await page.getByLabel("Theme").selectOption("system");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    await expect(
      page.getByRole("status").filter({ hasText: "System theme saved" }),
    ).toBeVisible();

    const otherContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, ownerEmail);
    await page.goto("/app/settings/security");
    await expect(page.getByText(/2 active/)).toBeVisible();
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByText(/1 active/)).toBeVisible();
    await otherPage.goto("/app");
    await expect(
      otherPage.getByRole("heading", { name: "Sign in to Kinship" }),
    ).toBeVisible();
    await otherContext.close();

    await page.goto("/app/settings/workspace");
    await page.evaluate(
      (workspaceId) =>
        sessionStorage.setItem("kinship.active-workspace", workspaceId),
      ownerWorkspaceId,
    );
    await page.reload();
    const workspaceName = page.getByLabel("Workspace name");
    const workspaceSwitcher = page.getByLabel("Active workspace");
    await expect(workspaceName).toHaveValue(`Owner ${suffix}`);
    await workspaceName.fill(`Unsaved ${suffix}`);
    await openMemberPopover(page);
    const cancelSwitch = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        expect(dialog.message()).toMatch(/unsaved changes/i);
        await dialog.dismiss();
        resolve();
      });
    });
    await workspaceSwitcher.selectOption(foreignWorkspaceId);
    await cancelSwitch;
    await expect(workspaceSwitcher).toHaveValue(ownerWorkspaceId);
    await expect(workspaceName).toHaveValue(`Unsaved ${suffix}`);
    await expect(page.getByText("Unsaved changes.")).toBeVisible();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("kinship.active-workspace")
      ),
    ).toBe(ownerWorkspaceId);
    expect(databaseValue(
      `select name from crm.workspaces where id = ${
        sqlLiteral(ownerWorkspaceId)
      }::uuid`,
    )).not.toBe(`Unsaved ${suffix}`);

    await openMemberPopover(page);
    const discardSwitch = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.accept();
        resolve();
      });
    });
    await workspaceSwitcher.selectOption(foreignWorkspaceId);
    await discardSwitch;
    await expect(page).toHaveURL(/\/app\/settings\/workspace$/);
    await expect(workspaceSwitcher).toHaveValue(foreignWorkspaceId);
    await expect(workspaceName).toHaveValue(`Foreign ${suffix}`);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("kinship.active-workspace")
      ),
    ).toBe(foreignWorkspaceId);
    await openMemberPopover(page);
    await workspaceSwitcher.selectOption(ownerWorkspaceId);
    await expect(workspaceName).toHaveValue(`Owner ${suffix}`);

    await page.getByLabel("Workspace name").fill(`Trusted ${suffix}`);
    await page.getByLabel("Workspace slug").fill(
      `trusted-${browserName}-${Date.now()}`,
    );
    await page.getByLabel("Default locale").fill("sr-Latn");
    await page.getByLabel("Default time zone").fill("Europe/Belgrade");
    const defaultCurrency = page.getByLabel("Default currency");
    await defaultCurrency.fill("ZZZ");
    await page.getByLabel("Default reminder time").fill("09:30");
    await expect(page.getByText("Unsaved changes.")).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Choose a supported currency.")).toBeVisible();
    await expect(defaultCurrency).toHaveAttribute("aria-invalid", "true");
    await expect(defaultCurrency).toBeFocused();
    await defaultCurrency.fill("EUR");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Workspace settings saved" }),
    ).toBeVisible();

    await page.goto("/app/settings/members");
    const memberRole = page.getByLabel(`Access level for ${memberEmail}`);
    const memberRow = memberRole.locator("xpath=ancestor::li");
    await memberRole.selectOption("admin");
    await memberRow.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(`${memberEmail} updated.`)).toBeVisible();
    const ownerRole = page.getByLabel(`Access level for ${ownerEmail}`);
    const ownerRow = ownerRole.locator("xpath=ancestor::li");
    await ownerRole.selectOption("member");
    await ownerRow.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText(/At least one active workspace owner must remain/i),
    ).toBeVisible();
    await memberRole.selectOption("member");
    await memberRow.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(`${memberEmail} updated.`)).toBeVisible();
    const crossed = await request.patch(
      `${origin}/api/v1/settings/members/${foreignMemberId}`,
      {
        headers: {
          cookie: await sessionCookie(context),
          origin,
          "X-Workspace-Id": ownerWorkspaceId,
        },
        data: { role: "admin", status: "active" },
      },
    );
    expect(crossed.status()).toBe(404);

    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, memberEmail);
    await memberPage.evaluate(
      (workspaceId) =>
        sessionStorage.setItem("kinship.active-workspace", workspaceId),
      ownerWorkspaceId,
    );
    await memberPage.goto("/app/settings/workspace");
    await expect(
      memberPage.getByRole("heading", {
        name: "Workspace settings unavailable",
      }),
    ).toBeVisible();
    await memberContext.close();
  },
);
