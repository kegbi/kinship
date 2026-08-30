import { expect, type Page, test } from "@playwright/test";
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

function databaseValue(statement: string): string {
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
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    statement,
  ], { cwd: process.cwd(), encoding: "utf8", env: process.env }).trim();
}

async function openMemberPopover(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Open member menu" });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

test(
  "[WORKSPACE-003] configures profile modules and controlled vocabularies",
  { annotation: { type: "flow", description: "WORKSPACE-003" } },
  async ({ browser, browserName, page, request }) => {
    test.setTimeout(300_000);
    const email = `personalization-${browserName}-${Date.now()}@example.test`;
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Workspace",
        lastName: "Owner",
        password,
        workspaceName: "Personalized circle",
      },
    })).status()).toBe(202);
    let token = "";
    await expect.poll(async () => {
      const search = await request.get(
        `${mailOrigin}/api/v1/search?query=${
          encodeURIComponent(`to:${email}`)
        }`,
      );
      const body = await search.json() as { messages?: Array<{ ID: string }> };
      for (const message of body.messages ?? []) {
        const detail = await request.get(
          `${mailOrigin}/api/v1/message/${message.ID}`,
        );
        const text = (await detail.json() as { Text?: string }).Text ?? "";
        token = text.match(/token=([^\s]+)/)?.[1] ?? token;
      }
      return token;
    }).toBeTruthy();
    expect((await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token },
    })).status()).toBe(200);
    await page.goto("/auth/sign-in");
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/app$/);
    const ownerWorkspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(email)
      }`,
    );
    const ownerUserId = databaseValue(
      `select id::text from crm.users where email = ${sqlLiteral(email)}`,
    );
    const switchWorkspaceName = `Switch target ${browserName}`;
    const switchWorkspaceId = databaseValue(`
      with workspace as (
        insert into crm.workspaces (name, created_by_user_id)
        values (${sqlLiteral(switchWorkspaceName)}, ${
      sqlLiteral(ownerUserId)
    }::uuid)
        returning id
      ), member as (
        insert into crm.workspace_members (workspace_id, user_id, role, status, joined_at)
        select id, ${sqlLiteral(ownerUserId)}::uuid, 'owner', 'active', now()
        from workspace returning id
      ), settings as (
        insert into crm.workspace_settings (workspace_id)
        select id from workspace
      ), preferences as (
        insert into crm.member_preferences (member_id)
        select id from member
      )
      select id::text from workspace
    `);

    await page.goto("/app/settings/personalization?section=tags");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.personalization",
    );
    await expect(page.getByRole("heading", { name: "Tags", exact: true }))
      .toBeVisible();
    await expect(page.locator("[data-personalization-section]")).toHaveCount(
      11,
    );
    const create = page.locator("#personalization-create");
    const dirtyNavigation = async (
      action: () => Promise<unknown>,
      discard: boolean,
    ): Promise<void> => {
      const dialogPromise = page.waitForEvent("dialog");
      const actionPromise = action();
      const dialog = await dialogPromise;
      expect(dialog.message()).toContain("unsaved personalization changes");
      if (discard) await dialog.accept();
      else await dialog.dismiss();
      await actionPromise;
    };
    await create.getByLabel("New option name").fill("Draft option");
    await expect(page.locator("#personalization-dirty")).toHaveText(
      "Unsaved changes.",
    );
    await dirtyNavigation(
      () => page.getByRole("link", { name: "Gender options" }).click(),
      false,
    );
    await expect(page).toHaveURL(/section=tags/);
    await expect(create.getByLabel("New option name")).toHaveValue(
      "Draft option",
    );
    await dirtyNavigation(
      () => page.getByRole("link", { name: "Gender options" }).click(),
      true,
    );
    await expect(page).toHaveURL(/section=gender-options/);
    await expect(page.getByRole("heading", { name: "Gender options" }))
      .toBeFocused();
    await expect(page.locator("#personalization-dirty")).toHaveText(
      "Changes discarded.",
    );
    await page.goBack();
    await expect(page).toHaveURL(/section=tags/);
    await expect(page.getByRole("heading", { name: "Tags", exact: true }))
      .toBeFocused();
    await page.goForward();
    await expect(page).toHaveURL(/section=gender-options/);
    await expect(page.getByRole("heading", { name: "Gender options" }))
      .toBeFocused();
    await create.getByLabel("New option name").fill("Back draft");
    await dirtyNavigation(() => page.goBack(), false);
    await expect(page).toHaveURL(/section=gender-options/);
    await expect(create.getByLabel("New option name")).toHaveValue(
      "Back draft",
    );
    await dirtyNavigation(() => page.goBack(), true);
    await expect(page).toHaveURL(/section=tags/);
    await expect(page.locator("#personalization-dirty")).toHaveText(
      "Changes discarded.",
    );
    await create.getByLabel("New option name").fill("Forward draft");
    await dirtyNavigation(() => page.goForward(), false);
    await expect(page).toHaveURL(/section=tags/);
    await expect(create.getByLabel("New option name")).toHaveValue(
      "Forward draft",
    );
    await dirtyNavigation(() => page.goForward(), true);
    await expect(page).toHaveURL(/section=gender-options/);
    await expect(page.locator("#personalization-dirty")).toHaveText(
      "Changes discarded.",
    );
    await expect(page.getByRole("heading", { name: "Gender options" }))
      .toBeFocused();
    await page.getByRole("link", { name: "Profile modules" }).click();
    await expect(page).toHaveURL(/section=profile-modules/);
    await expect(
      page.getByRole("heading", { name: "Profile modules", exact: true }),
    ).toBeVisible();

    await create.getByLabel("New option name").fill("Tags");
    await create.getByRole("button", { name: "Create option" }).click();
    await expect(page.getByLabel("Name for Tags")).toHaveValue("Tags");
    await expect(page.locator("#personalization-dirty")).toHaveText(
      "All changes saved.",
    );
    let tagsModule = page.locator(".personalization-row").filter({
      has: page.getByLabel("Name for Tags"),
    });
    const moduleDisable = tagsModule.getByRole("button", { name: "Disable" });
    await expect(moduleDisable).toBeVisible();
    const modulePatchRequests: string[] = [];
    page.on("request", (requested) => {
      if (
        requested.method() === "PATCH" &&
        requested.url().includes("/personalization/profile-modules/")
      ) modulePatchRequests.push(requested.url());
    });
    await tagsModule.getByLabel("Name for Tags").fill("Tags profile");
    await expect(moduleDisable).toBeDisabled();
    await expect(create.getByRole("button", { name: "Create option" }))
      .toBeDisabled();
    const moduleRevert = tagsModule.getByRole("button", { name: "Revert" });
    await expect(moduleRevert).toBeVisible();
    await moduleRevert.focus();
    await page.keyboard.press("Enter");
    await expect(tagsModule.getByLabel("Name for Tags")).toHaveValue("Tags");
    await expect(tagsModule.getByLabel("Name for Tags")).toBeFocused();
    await expect(page.locator("#personalization-dirty")).toHaveText(
      "Changes reverted.",
    );
    await expect(create.getByRole("button", { name: "Create option" }))
      .toBeEnabled();
    await tagsModule.getByLabel("Name for Tags").fill("Tags profile");
    await moduleDisable.evaluate((button: HTMLButtonElement) => button.click());
    expect(modulePatchRequests).toHaveLength(0);
    await expect(tagsModule.getByLabel("Name for Tags")).toHaveValue(
      "Tags profile",
    );
    await tagsModule.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#personalization-status")).toHaveText(
      "Option saved.",
    );
    tagsModule = page.locator(".personalization-row").filter({
      has: page.getByLabel("Name for Tags profile"),
    });
    await tagsModule.getByRole("button", { name: "Disable" }).click();
    await expect(page.locator("#personalization-status")).toHaveText(
      "Option updated.",
    );
    await expect(tagsModule.getByRole("button", { name: "Enable" }))
      .toBeVisible();
    expect(modulePatchRequests).toHaveLength(2);
    await tagsModule.getByRole("button", { name: "Enable" }).click();
    await expect(page.locator("#personalization-status")).toHaveText(
      "Option updated.",
    );
    await page.getByRole("link", { name: "Tags", exact: true }).click();
    await expect(page).toHaveURL(/section=tags/);
    await expect(page.getByRole("heading", { name: "Tags", exact: true }))
      .toBeVisible();

    await create.getByLabel("New option name").fill("Close friends");
    await create.getByRole("button", { name: "Create option" }).click();
    await expect(page.getByLabel("Name for Close friends")).toHaveValue(
      "Close friends",
    );
    await create.getByLabel("New option name").fill(" close FRIENDS ");
    await create.getByRole("button", { name: "Create option" }).click();
    await expect(page.locator("#personalization-status")).toContainText(
      "Choose a unique name",
    );
    await create.getByLabel("New option name").fill("Trusted people");
    await create.getByRole("button", { name: "Create option" }).click();
    await expect(page.getByLabel("Name for Trusted people")).toHaveValue(
      "Trusted people",
    );

    const closeFriendsDraft = page.getByLabel("Name for Close friends");
    await closeFriendsDraft.fill("Workspace switch draft");
    const workspaceSwitcher = page.getByLabel("Active workspace");
    await expect(workspaceSwitcher.locator("option")).toHaveCount(2);
    await openMemberPopover(page);
    await workspaceSwitcher.focus();
    let switchDialog = page.waitForEvent("dialog");
    let switchAction = workspaceSwitcher.selectOption(switchWorkspaceId);
    await (await switchDialog).dismiss();
    await switchAction;
    await expect(workspaceSwitcher).toHaveValue(ownerWorkspaceId);
    await expect(closeFriendsDraft).toHaveValue("Workspace switch draft");
    await expect(closeFriendsDraft).toBeVisible();

    let failWorkspaceTarget = true;
    await page.route("**/api/v1/session", async (route) => {
      if (
        failWorkspaceTarget &&
        route.request().headers()["x-workspace-id"] === switchWorkspaceId
      ) {
        await route.fulfill({
          body: JSON.stringify({
            code: "session_unavailable",
            detail: "Target workspace unavailable.",
            status: 503,
            title: "Session unavailable",
            type: "https://kinship.test/problems/session_unavailable",
          }),
          contentType: "application/problem+json",
          status: 503,
        });
        return;
      }
      await route.continue();
    });
    await openMemberPopover(page);
    switchDialog = page.waitForEvent("dialog");
    switchAction = workspaceSwitcher.selectOption(switchWorkspaceId);
    await (await switchDialog).accept();
    await switchAction;
    await expect(page.locator("#app-toasts")).toContainText(
      "current workspace was not changed",
    );
    await expect(workspaceSwitcher).toHaveValue(ownerWorkspaceId);
    await expect(closeFriendsDraft).toHaveValue("Workspace switch draft");
    await expect(page.locator("#personalization-dirty")).toHaveText(
      "Unsaved changes.",
    );

    failWorkspaceTarget = false;
    await openMemberPopover(page);
    let workspaceNavigation = page.waitForEvent(
      "framenavigated",
      (frame) => frame === page.mainFrame(),
    );
    switchDialog = page.waitForEvent("dialog");
    switchAction = workspaceSwitcher.selectOption(switchWorkspaceId);
    await (await switchDialog).accept();
    await switchAction;
    await workspaceNavigation;
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("kinship.active-workspace")
      ),
    ).toBe(switchWorkspaceId);
    await expect(page.getByRole("heading", { name: "Tags", exact: true }))
      .toBeVisible();
    await expect(page.getByLabel("Name for Close friends")).toHaveCount(0);
    await openMemberPopover(page);
    workspaceNavigation = page.waitForEvent(
      "framenavigated",
      (frame) => frame === page.mainFrame(),
    );
    await page.getByLabel("Active workspace").selectOption(ownerWorkspaceId);
    await workspaceNavigation;
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("kinship.active-workspace")
      ),
    ).toBe(ownerWorkspaceId);
    await expect(page.getByLabel("Name for Close friends")).toHaveValue(
      "Close friends",
    );
    await page.unroute("**/api/v1/session");

    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Ada");
    await page.getByLabel("Family name").fill("Lovelace");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    const profilePath = new URL(page.url()).pathname;
    await page.goto(profilePath);
    await expect(page.locator('[data-profile-fact-section="tags"]'))
      .toHaveAttribute("data-section-state", "ready");
    await page.getByRole("button", { name: "Edit tags" }).click();
    await page.getByLabel("Assigned tags").selectOption({
      label: "Close friends",
    });
    await page.getByRole("button", { name: "Save profile fact" }).click();
    await expect(page.locator("#person-profile-tags")).toContainText(
      "Close friends",
    );

    await page.goto("/app/settings/personalization?section=tags");
    const closeFriends = page.locator(".personalization-row").filter({
      has: page.getByLabel("Name for Close friends"),
    });
    await expect(closeFriends).toContainText("1 reference");
    await closeFriends.getByRole("button", { name: "Replace and delete" })
      .click();
    await expect(page.locator("#personalization-status")).toContainText(
      "require a replacement",
    );
    await closeFriends.getByLabel("Replacement for Close friends").selectOption(
      { label: "Trusted people" },
    );
    await closeFriends.getByRole("button", { name: "Replace and delete" })
      .click();
    await expect(page.getByLabel("Name for Close friends"))
      .toHaveCount(0);
    await page.goto(profilePath);
    await expect(page.locator("#person-profile-tags")).toContainText(
      "Trusted people",
    );

    await page.goto("/app/settings/personalization?section=profile-modules");
    await tagsModule.getByRole("button", { name: "Disable" }).click();
    await expect(page.locator("#personalization-status")).toHaveText(
      "Option updated.",
    );
    await expect(tagsModule.getByRole("button", { name: "Enable" }))
      .toBeVisible();
    await page.goto(profilePath);
    await expect(page.locator('[data-profile-fact-section="tags"]'))
      .toHaveAttribute("data-section-state", "hidden");
    await expect(page.getByRole("button", { name: "Edit tags" }))
      .toHaveCount(0);
    await page.goto("/app/settings/personalization?section=profile-modules");
    await tagsModule.getByRole("button", { name: "Enable" }).click();
    await expect(page.locator("#personalization-status")).toHaveText(
      "Option updated.",
    );
    await expect(tagsModule.getByRole("button", { name: "Disable" }))
      .toBeVisible();
    await page.goto(profilePath);
    await expect(page.locator("#person-profile-tags")).toContainText(
      "Trusted people",
    );
    await expect(page.getByRole("button", { name: "Edit tags" }))
      .toBeVisible();

    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/app/settings/personalization?section=reminder-rules");
    await expect(page.getByRole("heading", { name: "Reminder rules" }))
      .toBeVisible();
    await create.getByLabel("Days before").fill("7");
    await create.getByRole("button", { name: "Create option" }).click();
    const reminderRule = page.locator(".personalization-row").filter({
      has: page.getByLabel("Days before for 7 days before"),
    });
    await reminderRule.getByLabel("Days before for 7 days before").fill("3");
    await expect(page.locator("#personalization-dirty")).toHaveText(
      "Unsaved changes.",
    );
    await reminderRule.getByRole("button", { name: "Save" }).click();
    await expect(page.locator("#personalization-status")).toHaveText(
      "Option saved.",
    );
    await expect(page.locator("#personalization-dirty")).toHaveText(
      "All changes saved.",
    );
    await page.reload();
    await expect(page.getByLabel("Days before for 3 days before"))
      .toHaveValue("3");
    const mobileLayout = await page.locator(".personalization-layout")
      .evaluate((element) => ({
        gridTemplateColumns: getComputedStyle(element).gridTemplateColumns,
        width: element.getBoundingClientRect().width,
      }));
    const mobileTracks = mobileLayout.gridTemplateColumns.trim().split(/\s+/)
      .map(Number.parseFloat);
    expect(mobileTracks).toHaveLength(1);
    expect(Math.abs(mobileTracks[0] - mobileLayout.width)).toBeLessThanOrEqual(
      1,
    );
    await page.addScriptTag({ content: axe.source });
    expect(
      await page.evaluate(async () =>
        (await (globalThis as typeof globalThis & {
          axe: { run(): Promise<{ violations: unknown[] }> };
        }).axe.run()).violations
      ),
    ).toEqual([]);

    const petCategoryName = `E2E ${browserName} companion category`;
    databaseSql(
      `insert into crm.pet_categories (name, is_common, is_active, sort_order) values (${
        sqlLiteral(petCategoryName)
      }, true, true, 9000)`,
    );
    await page.goto("/app/settings/personalization?section=pet-categories");
    await expect(page.locator("#personalization-create")).toBeHidden();
    const petCategory = page.locator(".personalization-row").filter({
      hasText: petCategoryName,
    });
    await expect(petCategory).toContainText(
      "Read-only shared option",
    );
    await expect(petCategory.locator("button")).toHaveCount(0);
    await expect(page.locator(".personalization-actions button")).toHaveCount(
      0,
    );

    const memberEmail =
      `personalization-member-${browserName}-${Date.now()}@example.test`;
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email: memberEmail,
        firstName: "Workspace",
        lastName: "Member",
        password,
        workspaceName: "Member circle",
      },
    })).status()).toBe(202);
    let memberToken = "";
    await expect.poll(async () => {
      const search = await request.get(
        `${mailOrigin}/api/v1/search?query=${
          encodeURIComponent(`to:${memberEmail}`)
        }`,
      );
      const body = await search.json() as { messages?: Array<{ ID: string }> };
      for (const message of body.messages ?? []) {
        const detail = await request.get(
          `${mailOrigin}/api/v1/message/${message.ID}`,
        );
        const text = (await detail.json() as { Text?: string }).Text ?? "";
        memberToken = text.match(/token=([^\s]+)/)?.[1] ?? memberToken;
      }
      return memberToken;
    }).toBeTruthy();
    expect((await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token: memberToken },
    })).status()).toBe(200);
    const memberUserId = databaseValue(
      `select id::text from crm.users where email = ${sqlLiteral(memberEmail)}`,
    );
    databaseSql(
      `insert into crm.workspace_members (workspace_id, user_id, role, status) values (${
        sqlLiteral(ownerWorkspaceId)
      }::uuid, ${sqlLiteral(memberUserId)}::uuid, 'member', 'active')`,
    );
    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    await memberPage.goto("/auth/sign-in");
    await memberPage.getByLabel("Email address").fill(memberEmail);
    await memberPage.getByLabel("Password").fill(password);
    await memberPage.getByRole("button", { name: "Sign in" }).click();
    await expect(memberPage).toHaveURL(/\/app$/);
    await memberPage.evaluate(
      (workspaceId) =>
        sessionStorage.setItem("kinship.active-workspace", workspaceId),
      ownerWorkspaceId,
    );
    await memberPage.goto("/app/settings");
    await expect(memberPage.getByRole("link", { name: "Personalization" }))
      .toHaveCount(0);
    await memberPage.goto("/app/settings/personalization?section=tags");
    await expect(
      memberPage.getByRole("heading", { name: "Personalization unavailable" }),
    )
      .toBeVisible();
    await memberContext.close();
  },
);
