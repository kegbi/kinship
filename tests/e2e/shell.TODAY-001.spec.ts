import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { registerVerified } from "./support/api.ts";
import { databaseSql, sqlLiteral } from "./support/database.ts";
import { origin, password } from "./support/env.ts";
import { linkToken } from "./support/mail.ts";
import { settleNavigation } from "./support/navigation.ts";
import { expectAccessible } from "./support/page-checks.ts";
import {
  keyboardOpenMemberMenu,
  keyboardReachMemberMenuToggle,
} from "./support/shell.ts";

async function createVerifiedUser(
  request: APIRequestContext,
  email: string,
  workspaceName = "Analytical circle",
): Promise<void> {
  await registerVerified(request, {
    email,
    firstName: "Ada",
    lastName: "Lovelace",
    workspaceName,
  }, linkToken);
}

async function signIn(page: Page, email: string): Promise<string> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
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
  "[APP-002C] [APR-007] keeps mobile navigation and actions compact and keyboard reachable",
  { annotation: { type: "leaf", description: "APP-002C" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(120_000);
    const email = `apr-007-${browserName}-${Date.now()}@example.test`;
    const workspaceName =
      "Family, friends and community across many places and generations";
    await createVerifiedUser(request, email, workspaceName);
    const secondWorkspaceId = randomUUID();
    databaseSql(`
      insert into crm.workspaces (id, name, status, created_by_user_id)
      select '${secondWorkspaceId}'::uuid, ${
      sqlLiteral(`${workspaceName} overseas`)
    }, 'active', id
        from crm.users where email = ${sqlLiteral(email)};
      insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at)
      select '${randomUUID()}'::uuid, '${secondWorkspaceId}'::uuid, id, 'member', 'active', now()
        from crm.users where email = ${sqlLiteral(email)};
    `);
    await signIn(page, email);
    const artifactDirectory = join(
      process.cwd(),
      ".artifacts",
      "apr-007-review",
    );
    await mkdir(artifactDirectory, { recursive: true });
    const screenshotPhase = process.env.APR007_SCREENSHOT_PHASE ?? "after";
    const routes = [
      ["today", "/app"],
      ["people", "/app/people"],
      ["tasks", "/app/tasks"],
      ["settings", "/app/settings"],
    ] as const;
    const headerHeights: number[] = [];
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 844 });
      for (const [name, route] of routes) {
        await page.goto(route);
        await expect(page.locator("#protected-shell")).toBeVisible();
        await expect(page.locator("header [data-quick-capture]")).toBeEnabled();
        await page.waitForLoadState("networkidle");
        await page.screenshot({
          path: join(
            artifactDirectory,
            `${screenshotPhase}-${browserName}-${name}-${width}.png`,
          ),
        });
        const header = (await page.locator(".app-header").boundingBox())!;
        headerHeights.push(header.height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width);
        expect((await page.locator("main h1").boundingBox())!.y)
          .toBeGreaterThanOrEqual(header.height);
        const navigation = page.getByRole("navigation", {
          name: "Primary navigation",
        });
        for (
          const [label, href] of [
            ["Today", "/app"],
            ["People", "/app/people"],
            ["Tasks", "/app/tasks"],
            ["Journal", "/app/journal"],
          ]
        ) {
          const link = navigation.getByRole("link", {
            name: label,
            exact: true,
          });
          await expect(link).toHaveAttribute("href", href);
          await expect(link).toBeInViewport();
          const box = (await link.boundingBox())!;
          expect(box.width).toBeGreaterThanOrEqual(44);
          expect(box.height).toBeGreaterThanOrEqual(44);
        }
        const toggle = page.getByRole("button", { name: "Open member menu" });
        await toggle.click();
        await expect(
          page.locator(".app-header").getByRole("link", {
            name: "Add person",
            exact: true,
          }),
        ).toHaveAttribute("href", "/app/people/new");
        await expect(page.getByLabel("Active workspace")).toBeInViewport();
        expect(await page.evaluate(() => document.documentElement.scrollWidth))
          .toBe(width);
        await page.keyboard.press("Escape");
        await expect(toggle).toBeFocused();
        await expect(toggle).toHaveAttribute("aria-expanded", "false");
      }
    }
    expect(Math.max(...headerHeights)).toBeLessThanOrEqual(124);

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/app");
    await expect(page.locator("header [data-quick-capture]")).toBeEnabled();
    const search = page.getByRole("button", {
      name: "Find a person",
      exact: true,
    });
    const capture = page.getByRole("button", {
      name: "Quick capture",
      exact: true,
    });
    const toggle = page.getByRole("button", { name: "Open member menu" });
    for (
      const target of [
        page.getByRole("link", { name: "Skip to main content" }),
        page.getByRole("link", { name: "Kinship Today" }),
        ...["Today", "People", "Tasks", "Journal"].map((name) =>
          page.getByRole("navigation", { name: "Primary navigation" })
            .getByRole("link", { name, exact: true })
        ),
        search,
        capture,
        toggle,
      ]
    ) {
      await page.keyboard.press("Tab");
      await expect(target).toBeFocused();
      await expect(target).toBeInViewport();
      expect(
        await target.evaluate((element) =>
          getComputedStyle(element).outlineStyle
        ),
      ).not.toBe("none");
    }
    await page.keyboard.press("Enter");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Active workspace")).toBeFocused();
    await expect(page.getByLabel("Active workspace")).toBeInViewport();
    await page.screenshot({
      path: join(
        artifactDirectory,
        `${screenshotPhase}-${browserName}-menu-320-short.png`,
      ),
    });
    await expectAccessible(page, { networkIdle: true });
    for (
      const target of [
        page.locator(".app-header").getByRole("link", {
          name: "Add person",
          exact: true,
        }),
        page.getByRole("link", { name: "Profile", exact: true }),
        page.getByRole("link", { name: "Settings", exact: true }),
        page.getByRole("button", { name: "Sign out", exact: true }),
      ]
    ) {
      await page.keyboard.press("Tab");
      await expect(target).toBeFocused();
      await expect(target).toBeInViewport();
    }
    const outsideLink = page.getByRole("link", {
      name: "Open all tasks",
      exact: true,
    });
    if (browserName === "webkit") {
      // Exercise a concrete outside tab stop, not WebKit's default implicit-anchor policy.
      await outsideLink.evaluate((element) => element.tabIndex = 0);
    }
    await page.keyboard.press("Tab");
    await expect(outsideLink).toBeFocused();
    await expect(outsideLink).toBeInViewport();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await page.locator(".app-header").click({ position: { x: 4, y: 4 } });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");

    await search.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "Find a person" }))
      .toBeVisible();
    await page.keyboard.press("Escape");
    await expect(search).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(capture).toBeFocused();
    await page.keyboard.press("Enter");
    const captureDialog = page.getByRole("dialog", {
      name: "Record an activity or note",
    });
    await expect(captureDialog).toBeVisible();
    await expect(captureDialog.getByLabel("What are you recording?"))
      .toBeEnabled();
    await page.keyboard.press("Escape");
    await expect(captureDialog).toBeHidden();
    await expect(capture).toBeFocused();

    await toggle.click();
    await page.locator(".app-header").getByRole("link", {
      name: "Add person",
      exact: true,
    }).click();
    await expect(page).toHaveURL(/\/app\/people\/new$/);
    await expect(page.locator("main h1")).toBeVisible();

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/app");
    await expect(capture).toBeEnabled();
    await keyboardReachMemberMenuToggle(page);
    await expect(page.locator(".app-header")).toHaveCSS("position", "sticky");
    await page.screenshot({
      path: join(
        artifactDirectory,
        `${screenshotPhase}-${browserName}-today-1280.png`,
      ),
    });
    await page.keyboard.press("Enter");
    const switcher = page.getByLabel("Active workspace");
    const activeWorkspaceId = await switcher.inputValue();
    for (const action of ["workspace", "sign-out"] as const) {
      let releaseRequest!: () => void;
      const pending = new Promise<void>((resolve) => releaseRequest = resolve);
      const endpoint = action === "workspace" ? "session" : "sign-out";
      await page.route(`**/api/v1/${endpoint}`, async (route) => {
        await pending;
        await route.abort("failed");
      });
      const control = action === "workspace"
        ? switcher
        : page.getByRole("button", { name: "Sign out", exact: true });
      await control.focus();
      if (action === "workspace") {
        await switcher.selectOption(secondWorkspaceId);
      } else await page.keyboard.press("Enter");
      await expect(control).toBeDisabled();
      await expect(page.locator("#member-popover")).toBeVisible();
      releaseRequest();
      await expect(control).toBeEnabled();
      await expect(control).toBeFocused();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.locator("#app-toasts")).toContainText(
        action === "workspace"
          ? "current workspace was not changed"
          : "could not be revoked",
      );
      await expect(switcher).toHaveValue(activeWorkspaceId);
      await page.unroute(`**/api/v1/${endpoint}`);
    }
  },
);

test(
  "[APP-002C] protects the responsive Today and settings shells across workspace and session states",
  {
    annotation: [
      { type: "flow", description: "TODAY-001" },
      { type: "flow", description: "AUTH-003" },
      { type: "leaf", description: "APP-002C" },
    ],
  },
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
    await expectAccessible(page, { networkIdle: true });

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
    await page.getByRole("button", { name: "Open member menu" }).click();
    await expect(addAction).toBeVisible();
    await expect(addAction).toHaveAttribute("href", "/app/people/new");
    const addActionBox = await addAction.boundingBox();
    expect(addActionBox).not.toBeNull();
    expect(addActionBox!.width).toBeGreaterThanOrEqual(44);
    expect(addActionBox!.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("navigation", { name: "Settings categories" }))
      .toBeVisible();
    await expectAccessible(page, { networkIdle: true });
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
    await settleNavigation(page);
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
