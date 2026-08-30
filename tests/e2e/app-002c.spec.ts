import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
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

async function mailToken(
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
      if (!link) continue;
      const candidate = new URL(link).searchParams.get("token");
      if (candidate) token = candidate;
    }
    return token;
  }).toBeTruthy();
  return token!;
}

async function createVerifiedUser(
  request: APIRequestContext,
  email: string,
): Promise<void> {
  const registered = await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Ada",
      lastName: "Lovelace",
      password: "correct horse battery staple",
      workspaceName: "Analytical circle",
    },
  });
  expect(registered.status()).toBe(202);
  const verified = await request.post(
    `${origin}/api/v1/email-verifications`,
    { data: { token: await mailToken(request, email) } },
  );
  expect(verified.status()).toBe(200);
}

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill("correct horse battery staple");
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/v1/sessions" &&
    response.request().method() === "POST"
  );
  await page.getByRole("button", { name: "Sign in" }).click();
  const response = await responsePromise;
  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1, name: "Welcome back." }))
    .toBeVisible();
  return (await response.allHeaders())["set-cookie"] ?? "";
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

async function keyboardReachMemberMenuToggle(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" }))
    .toBeFocused();
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
  await expect(page.getByRole("link", { name: "Journal", exact: true }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("combobox", { name: "Find a person" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Quick capture" }))
    .toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Add person" })).toBeFocused();
  await page.keyboard.press("Tab");
  const menuToggle = page.getByRole("button", { name: "Open member menu" });
  await expect(menuToggle).toBeFocused();
}

async function keyboardOpenMemberMenu(page: Page): Promise<void> {
  await keyboardReachMemberMenuToggle(page);
  const menuToggle = page.getByRole("button", { name: "Open member menu" });
  await page.keyboard.press("Enter");
  await expect(menuToggle).toHaveAttribute("aria-expanded", "true");
}

async function keyboardReachSignOutTail(page: Page): Promise<void> {
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Profile" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Settings" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "Sign out" })).toBeFocused();
}

async function keyboardReachSignOutWithMultipleWorkspaces(
  page: Page,
): Promise<void> {
  await keyboardOpenMemberMenu(page);
  await page.keyboard.press("Tab");
  await expect(page.getByLabel("Active workspace")).toBeFocused();
  await keyboardReachSignOutTail(page);
}

async function keyboardReachSignOutWithSingleWorkspace(
  page: Page,
): Promise<void> {
  await keyboardOpenMemberMenu(page);
  await expect(page.getByLabel("Active workspace")).toBeHidden();
  await keyboardReachSignOutTail(page);
}

test(
  "[APP-002C] protects the responsive Today and settings shells across workspace and session states",
  { annotation: { type: "leaf", description: "APP-002C" } },
  async ({ browser, browserName, context, page, request }) => {
    test.setTimeout(120_000);
    const email = `app-002c-${browserName}-${Date.now()}@example.test`;
    await createVerifiedUser(request, email);
    const signInSetCookie = await signIn(page, email);

    await keyboardOpenMemberMenu(page);

    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "app.today",
    );
    const navigation = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    for (const destination of ["Today", "People", "Tasks", "Journal"]) {
      await expect(navigation).toContainText(destination);
    }
    const peopleNavigation = navigation.getByRole("link", {
      name: "People",
      exact: true,
    });
    await expect(peopleNavigation).toBeVisible();
    await expect(peopleNavigation).toHaveAttribute("href", "/app/people");
    const addPerson = page.getByRole("link", { name: "Add person" });
    await expect(addPerson).toBeVisible();
    await expect(addPerson).toHaveAttribute("href", "/app/people/new");
    await expect(page.getByLabel("Active workspace")).toBeHidden();
    await expect(page.getByText(/ordered in your effective time zone/))
      .toBeVisible();
    const todayDate = page.locator("[data-today-date]");
    await expect(todayDate).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}$/);
    await expect(todayDate).not.toHaveText("Loading date…");
    await expect(page.locator(".success-loop > li")).toHaveCount(3);
    expect(await page.locator("main h1, main h2").allTextContents()).toEqual([
      "Welcome back.",
      "Needs attention",
      "People to reconnect",
      "Upcoming",
      "Recently viewed people",
      "Favorite notes",
      "Recent activity",
    ]);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
    await expectAccessible(page);

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Profile" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Settings" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/app\/settings$/);
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.index",
    );
    for (
      const scope of ["Personal", "Workspace", "Data", "Developer", "Billing"]
    ) {
      await expect(page.getByRole("heading", { level: 2, name: scope }))
        .toBeVisible();
    }
    await page.getByLabel("Search settings").fill("password");
    await expect(
      page.getByRole("heading", { level: 3, name: "Security & sessions" }),
    )
      .toBeVisible();
    await expect(page.getByRole("heading", { level: 3, name: "Profile" }))
      .toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(peopleNavigation).toBeVisible();
    await expect(peopleNavigation).toHaveAttribute("href", "/app/people");
    const peopleNavigationBox = await peopleNavigation.boundingBox();
    expect(peopleNavigationBox).not.toBeNull();
    expect(peopleNavigationBox!.width).toBeGreaterThanOrEqual(44);
    expect(peopleNavigationBox!.height).toBeGreaterThanOrEqual(44);
    const addAction = page.getByRole("link", { name: "Add person" });
    await expect(addAction).toBeVisible();
    await expect(addAction).toHaveAttribute("href", "/app/people/new");
    const addActionBox = await addAction.boundingBox();
    expect(addActionBox).not.toBeNull();
    expect(addActionBox!.width).toBeGreaterThanOrEqual(44);
    expect(addActionBox!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("navigation", { name: "Settings categories" }))
      .toBeVisible();
    await expectAccessible(page);
    await page.setViewportSize({ width: 1280, height: 900 });

    const secondWorkspaceId = randomUUID();
    const secondMemberId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    databaseSql(`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      select '${secondWorkspaceId}'::uuid, 'Community circle', 'active', id
        from crm.users where email = ${sqlLiteral(email)};
      insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at)
      select '${secondMemberId}'::uuid, '${secondWorkspaceId}'::uuid, id, 'member', 'active', now()
        from crm.users where email = ${sqlLiteral(email)};
      insert into crm.workspaces (id, name, status, created_by_user_id)
      select '${foreignWorkspaceId}'::uuid, 'Foreign circle', 'active', id
        from crm.users where email = ${sqlLiteral(email)};
    `);
    await page.goto("/app");
    const switcher = page.getByLabel("Active workspace");
    await expect(switcher).toBeHidden();
    await expect(switcher.locator("option")).toHaveCount(2);
    await keyboardOpenMemberMenu(page);
    await page.keyboard.press("Tab");
    await expect(switcher).toBeFocused();
    await expect(switcher).toBeVisible();
    await expect(switcher.locator("option")).toHaveCount(2);
    await page.setViewportSize({ width: 390, height: 844 });
    const switcherBox = await switcher.boundingBox();
    expect(switcherBox).not.toBeNull();
    expect(switcherBox!.width).toBeGreaterThanOrEqual(44);
    expect(switcherBox!.height).toBeGreaterThanOrEqual(44);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(switcher).toBeFocused();
    await switcher.selectOption(secondWorkspaceId);
    await expect(page.locator("#app-toasts > li")).toHaveCount(0);
    await expect(switcher).toHaveValue(secondWorkspaceId);
    const originalWorkspaceId = await switcher.locator("option").first()
      .getAttribute("value");
    expect(originalWorkspaceId).toBeTruthy();
    expect(originalWorkspaceId).not.toBe(secondWorkspaceId);
    await page.route("**/api/v1/session", (route) => {
      if (
        route.request().headers()["x-workspace-id"] === originalWorkspaceId
      ) {
        return route.abort("failed");
      }
      return route.continue();
    });
    await expect(switcher).toBeHidden();
    await keyboardOpenMemberMenu(page);
    await page.keyboard.press("Tab");
    await expect(switcher).toBeFocused();
    await switcher.selectOption(originalWorkspaceId!);
    await expect(page.locator("#app-toasts")).toContainText(
      "current workspace was not changed",
    );
    await expect(switcher).toHaveValue(secondWorkspaceId);
    await expect(switcher).toBeFocused();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("kinship.active-workspace")
      ),
    ).toBe(secondWorkspaceId);
    await page.unroute("**/api/v1/session");

    const sessionCookie = (await context.cookies()).find((cookie) =>
      cookie.name === "kinship_session"
    );
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.secure).toBe(true);
    expect(sessionCookie?.path).toBe("/");
    expect(signInSetCookie).toContain("SameSite=Strict");
    const crossed = await request.get(`${origin}/api/v1/session`, {
      headers: {
        cookie: `kinship_session=${sessionCookie!.value}`,
        "X-Workspace-Id": foreignWorkspaceId,
      },
    });
    expect(crossed.status()).toBe(401);
    const forgedSignOut = await request.post(`${origin}/api/v1/sign-out`, {
      headers: {
        cookie: `kinship_session=${sessionCookie!.value}`,
        origin: "https://attacker.invalid",
      },
    });
    expect(forgedSignOut.status()).toBe(403);
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Welcome back." }))
      .toBeVisible();

    await page.route("**/api/v1/sign-out", (route) => route.abort("failed"));
    const signOutButton = page.getByRole("button", { name: "Sign out" });
    await keyboardReachSignOutWithMultipleWorkspaces(page);
    await page.keyboard.press("Enter");
    await expect(page.locator("#app-toasts")).toContainText(
      "could not be revoked",
    );
    await expect(signOutButton).toBeFocused();
    await page.unroute("**/api/v1/sign-out");

    databaseSql(`
      update crm.workspace_members set status = 'suspended'
      where id = '${secondMemberId}'::uuid;
    `);
    await page.reload();
    await keyboardOpenMemberMenu(page);
    await expect(page.getByLabel("Active workspace")).toBeHidden();
    await expect(
      page.locator("#main-content .page-heading").getByText(
        "Analytical circle",
        { exact: true },
      ),
    ).toBeVisible();

    databaseSql(`
      update crm.workspace_members set status = 'suspended'
      where user_id = (select id from crm.users where email = ${
      sqlLiteral(email)
    });
    `);
    await page.reload();
    await expect(page.getByRole("link", { name: "Go to sign-in" }))
      .toBeVisible();

    databaseSql(`
      update crm.workspace_members set status = 'active'
      where workspace_id = (
        select workspace_id from crm.workspace_members wm
        join crm.users u on u.id = wm.user_id
        where u.email = ${
      sqlLiteral(email)
    } order by wm.joined_at asc nulls last limit 1
      );
    `);
    await signIn(page, email);
    await keyboardReachSignOutWithSingleWorkspace(page);
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/auth\/sign-in$/);
    await page.goto("/app");
    await expect(page.getByRole("link", { name: "Go to sign-in" }))
      .toBeVisible();

    const anonymous = await browser.newContext({
      baseURL: origin,
      ignoreHTTPSErrors: true,
    });
    try {
      const anonymousPage = await anonymous.newPage();
      await anonymousPage.goto("/app");
      await expect(anonymousPage.getByRole("link", { name: "Go to sign-in" }))
        .toBeVisible();
    } finally {
      await anonymous.close();
    }
  },
);
