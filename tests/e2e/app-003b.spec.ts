import {
  type APIRequestContext,
  expect,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { settleNavigation } from "./support/navigation.ts";

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
): Promise<void> {
  expect((await request.post(`${origin}/api/v1/registrations`, {
    data: {
      email,
      firstName: "Directory",
      lastName: "Reader",
      password,
      workspaceName: "Directory circle",
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
  "[PEOPLE-002] finds a person only in the active workspace",
  { annotation: { type: "flow", description: "PEOPLE-002" } },
  async ({ browserName, context, page, request }) => {
    test.setTimeout(180_000);
    const email = `directory-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);

    let releaseDirectory = () => {};
    const directoryAllowed = new Promise<void>((resolve) => {
      releaseDirectory = resolve;
    });
    const directoryPattern = "**/api/v1/people?*";
    await page.route(directoryPattern, async (route) => {
      await directoryAllowed;
      await route.continue();
    });
    await page.getByRole("link", { name: "People", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/people$/);
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "people.index",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: "Loading people…" }),
    ).toBeVisible();
    releaseDirectory();
    await expect(
      page.getByRole("heading", { level: 2, name: "No people yet" }),
    ).toBeVisible();
    await page.unroute(directoryPattern);
    await expectAccessible(page);

    await page.route(directoryPattern, async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          code: "people_unavailable",
          detail: "Temporary test outage",
          status: 503,
          title: "People unavailable",
          type: "about:blank",
        }),
        contentType: "application/problem+json",
        status: 503,
      });
    });
    await page.reload();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "People temporarily unavailable",
      }),
    ).toBeVisible();
    await expect(page.locator("#people-directory-error")).toBeFocused();
    await page.unroute(directoryPattern);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: "No people yet" }),
    ).toBeVisible();

    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(email)
      }`,
    );
    const memberId = databaseValue(
      `select member.id::text from crm.workspace_members member join crm.users u on u.id = member.user_id where u.email = ${
        sqlLiteral(email)
      } and member.workspace_id = '${workspaceId}'::uuid`,
    );
    const adaId = randomUUID();
    const graceId = randomUUID();
    const archivedId = randomUUID();
    const friendsTagId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    const foreignPersonId = randomUUID();
    const foreignTagId = randomUUID();
    databaseSql(`
      insert into crm.people (id, workspace_id, created_by_member_id, given_name, family_name, nickname, is_starred, created_at)
      values
        ('${adaId}'::uuid, '${workspaceId}'::uuid, '${memberId}'::uuid, 'Ada', 'Lovelace', 'Scientist', true, '2026-08-12T12:00:00Z'),
        ('${graceId}'::uuid, '${workspaceId}'::uuid, '${memberId}'::uuid, 'Grace', 'Hopper', 'Scientist', false, '2026-08-13T12:00:00Z'),
        ('${archivedId}'::uuid, '${workspaceId}'::uuid, '${memberId}'::uuid, 'Harriet', 'Tubman', null, false, '2026-08-11T12:00:00Z');
      update crm.people set archived_at = now() where id = '${archivedId}'::uuid;
      insert into crm.people (id, workspace_id, created_by_member_id, given_name, family_name, created_at)
      select gen_random_uuid(), '${workspaceId}'::uuid, '${memberId}'::uuid, 'Person ' || lpad(sequence::text, 2, '0'), 'Contact ' || lpad(sequence::text, 2, '0'), '2026-08-01T12:00:00Z'::timestamptz + sequence * interval '1 minute'
      from generate_series(1, 20) sequence;
      insert into crm.tags (id, workspace_id, name, slug)
      values ('${friendsTagId}'::uuid, '${workspaceId}'::uuid, 'Friends', 'friends');
      insert into crm.tags (id, workspace_id, name, slug)
      select gen_random_uuid(), '${workspaceId}'::uuid,
        'Bulk ' || lpad(sequence::text, 2, '0'),
        'bulk-' || lpad(sequence::text, 2, '0')
      from generate_series(1, 25) sequence;
      insert into crm.person_tags (person_id, tag_id)
      values ('${adaId}'::uuid, '${friendsTagId}'::uuid);
      insert into crm.person_tags (person_id, tag_id)
      select '${adaId}'::uuid, tag.id
      from crm.tags tag
      where tag.workspace_id = '${workspaceId}'::uuid
        and tag.slug between 'bulk-01' and 'bulk-07';
      insert into crm.workspaces (id, name, status)
      values ('${foreignWorkspaceId}'::uuid, 'Foreign circle', 'active');
      insert into crm.people (id, workspace_id, given_name, family_name)
      values ('${foreignPersonId}'::uuid, '${foreignWorkspaceId}'::uuid, 'Foreign', 'Person');
      insert into crm.tags (id, workspace_id, name, slug)
      values ('${foreignTagId}'::uuid, '${foreignWorkspaceId}'::uuid, 'Private', 'private');
      insert into crm.person_tags (person_id, tag_id)
      values ('${adaId}'::uuid, '${foreignTagId}'::uuid);
    `);

    const globalSearch = page.getByRole("combobox", {
      name: "Find a person",
    });
    await globalSearch.fill("Ada Lovelace");
    await expect(
      page.getByRole("option", { name: /Ada Lovelace.*Scientist/ }),
    ).toBeVisible();
    await globalSearch.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/app/people/${adaId}$`));

    await settleNavigation(page);
    await page.goto("/app/people");
    const peopleNavigation = page.getByRole("link", {
      exact: true,
      name: "People",
    });
    await peopleNavigation.focus();
    await page.keyboard.press("Control+KeyK");
    await expect(page.locator("#global-people-search-dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#global-people-search-dialog")).not
      .toBeVisible();
    await expect(peopleNavigation).toBeFocused();

    const paletteResults = page.locator("#global-people-search-results");
    const commandInput = page.getByRole("combobox", {
      name: "Find a person",
    });
    await commandInput.fill("> import");
    const importCommand = paletteResults.getByRole("option", {
      exact: true,
      name: "Data · Import",
    });
    await expect(importCommand).toHaveCount(1);
    await expect(importCommand).toBeVisible();
    await commandInput.press("Enter");
    await expect(page).toHaveURL(/\/app\/settings\/import$/);

    const logCommandInput = page.getByRole("combobox", {
      name: "Find a person",
    });
    await logCommandInput.fill("> log");
    const logCommand = paletteResults.getByRole("option", {
      exact: true,
      name: "Log interaction",
    });
    await expect(logCommand).toHaveCount(1);
    await expect(logCommand).toBeVisible();
    await logCommandInput.press("Enter");
    const quickCaptureDialog = page.locator("#interaction-capture-dialog");
    await expect(quickCaptureDialog).toHaveCount(1);
    await expect(quickCaptureDialog).toBeVisible();
    await quickCaptureDialog.getByRole("button", { name: "Cancel" }).click();
    await page.goto("/app/people");

    await page.getByRole("combobox", { name: "Find a person" }).fill(
      "Marie Dupont",
    );
    await page.getByRole("option", {
      name: 'Add "Marie Dupont" as a new person',
    }).click();
    await expect(page).toHaveURL(
      /\/app\/people\/new\?givenName=Marie&familyName=Dupont$/,
    );
    await expect(page.getByLabel("Given name")).toHaveValue("Marie");
    await expect(page.getByLabel("Family name")).toHaveValue("Dupont");
    await page.goto("/app/people");

    await page.reload();
    await expect(page.locator("#people-directory-list > li")).toHaveCount(20);
    const adaDirectoryLink = page.locator(
      `#people-directory-list a[href="/app/people/${adaId}"]`,
    );
    await expect(adaDirectoryLink.locator(".directory-person-tags > li"))
      .toHaveCount(6);
    await expect(
      adaDirectoryLink.locator(".directory-person-tags-more"),
    ).toHaveText("+3 more");
    await expect(adaDirectoryLink).not.toContainText("Friends");
    await expect(adaDirectoryLink).not.toContainText("Private");
    await expect(
      page.getByRole("button", { name: "Load more people" }),
    ).toBeVisible();
    await expect(page.locator("#people-directory-tag option")).toHaveCount(21);
    await expect(page.getByRole("option", { name: "Friends" })).toHaveCount(0);
    await expect(page.getByRole("option", { name: "Private" })).toHaveCount(0);
    await page.getByRole("button", { name: "Load more tags" }).click();
    await expect(page.getByRole("option", { name: "Friends" })).toHaveCount(1);
    await expect(page.locator("#people-directory-tag option")).toHaveCount(27);
    await page.getByLabel("Search tag options").fill("Friends");
    await page.getByRole("button", { name: "Search tags" }).click();
    await expect(page.getByRole("option", { name: "Friends" })).toHaveCount(1);
    await expect(page.locator("#people-directory-tag option")).toHaveCount(2);

    await page.getByLabel("Search people").fill("Scientist");
    await page.getByLabel("Sort by").selectOption("family-name");
    await page.getByRole("button", { name: "Find people" }).click();
    await expect(page.locator("#people-directory-list h2")).toHaveText([
      "Grace Hopper “Scientist”",
      "Ada Lovelace “Scientist”",
    ]);
    await expect(page).toHaveURL(/search=Scientist.*sort=family-name/);

    await page.getByLabel("Search people").fill("");
    await page.getByRole("combobox", { name: "Tag", exact: true }).selectOption(
      friendsTagId,
    );
    await page.getByRole("button", { name: "Find people" }).click();
    await expect(page.locator("#people-directory-list > li")).toHaveCount(1);
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "Ada Lovelace “Scientist”",
        exact: true,
      }),
    ).toBeVisible();
    const filteredAdaLink = page.locator(
      `#people-directory-list a[href="/app/people/${adaId}"]`,
    );
    await expect(filteredAdaLink.locator(".directory-person-tags > li"))
      .toHaveCount(6);
    await expect(filteredAdaLink.locator(".directory-person-tags-more"))
      .toHaveText("+3 more");
    await expect(filteredAdaLink).not.toContainText("Private");

    await page.getByRole("combobox", { name: "Tag", exact: true }).selectOption(
      "",
    );
    await page.getByLabel("Search people").fill("Nobody here");
    await page.getByRole("button", { name: "Find people" }).click();
    await expect(
      page.getByRole("heading", {
        level: 2,
        name: "No people match these filters",
      }),
    ).toBeVisible();

    await page.getByLabel("Search people").fill("");
    await page.getByLabel("Sort by").selectOption("given-name");
    await page.getByRole("button", { name: "Find people" }).click();
    await expect(page.locator("#people-directory-list > li")).toHaveCount(20);
    await page.getByRole("button", { name: "Load more people" }).click();
    await expect(page.locator("#people-directory-list > li")).toHaveCount(22);
    await expectAccessible(page);

    await page.getByRole("link", { name: "View archived people" }).click();
    await expect(page).toHaveURL(/\/app\/people\/archived$/);
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "people.archived",
    );
    await expect(page.locator("#people-directory-list > li")).toHaveCount(1);
    await expect(
      page.getByRole("heading", { level: 2, name: "Harriet Tubman" }),
    ).toBeVisible();
    await expect(page.getByText("Archived · read-only")).toBeVisible();
    await expectAccessible(page);
    await page.getByRole("link", { name: /Harriet Tubman/ }).click();
    await expect(page).toHaveURL(new RegExp(`/app/people/${archivedId}$`));
    await expect(
      page.getByRole("heading", { level: 1, name: "Harriet Tubman" }),
    ).toBeVisible();
    await expect(page.getByText("Archived person · read-only")).toBeVisible();

    const sessionCookie = (await context.cookies()).find((cookie) =>
      cookie.name === "kinship_session"
    );
    expect(sessionCookie).toBeTruthy();
    const apiHeaders = {
      cookie: `kinship_session=${sessionCookie!.value}`,
      "X-Workspace-Id": workspaceId,
    };
    const archivedRead = await request.get(
      `${origin}/api/v1/people/${archivedId}`,
      { headers: apiHeaders },
    );
    expect(archivedRead.status()).toBe(200);
    expect((await archivedRead.json()).status).toBe("archived");
    expect((await request.get(`${origin}/api/v1/people/${foreignPersonId}`, {
      headers: apiHeaders,
    })).status()).toBe(404);
    expect((await request.get(`${origin}/api/v1/people/${randomUUID()}`, {
      headers: apiHeaders,
    })).status()).toBe(404);

    const cursorPage = await request.get(
      `${origin}/api/v1/people?sort=given-name&limit=1`,
      { headers: apiHeaders },
    );
    const cursorPageBody = await cursorPage.json() as {
      readonly nextCursor: string;
      readonly people: readonly {
        readonly tagCount: number;
        readonly tags: readonly { readonly name: string }[];
      }[];
      readonly [key: string]: unknown;
    };
    const cursor = cursorPageBody.nextCursor;
    expect(cursor).toBeTruthy();
    expect(cursorPageBody).not.toHaveProperty("availableTags");
    expect(cursorPageBody.people[0]?.tags).toHaveLength(5);
    expect(cursorPageBody.people[0]?.tagCount).toBe(8);
    expect(cursorPageBody.people[0]?.tags.some((tag) => tag.name === "Private"))
      .toBe(false);
    const tagOptionsPage = await request.get(
      `${origin}/api/v1/people/tag-options?selected=${friendsTagId}`,
      { headers: apiHeaders },
    );
    const tagOptionsBody = await tagOptionsPage.json() as {
      readonly nextCursor?: string;
      readonly options: readonly { readonly id: string }[];
      readonly selected?: { readonly id: string };
    };
    expect(tagOptionsPage.status()).toBe(200);
    expect(tagOptionsBody.options).toHaveLength(20);
    expect(tagOptionsBody.nextCursor).toBeTruthy();
    expect(tagOptionsBody.selected?.id).toBe(friendsTagId);
    expect(tagOptionsBody.options.some((tag) => tag.id === foreignTagId))
      .toBe(false);
    const peopleContinuation = await request.get(
      `${origin}/api/v1/people?sort=given-name&limit=1&cursor=${
        encodeURIComponent(cursor)
      }`,
      { headers: apiHeaders },
    );
    expect(await peopleContinuation.json()).not.toHaveProperty(
      "availableTags",
    );
    databaseSql(
      `update crm.people set given_name = 'Zada' where id = '${adaId}'::uuid`,
    );
    const stale = await request.get(
      `${origin}/api/v1/people?sort=given-name&limit=1&cursor=${
        encodeURIComponent(cursor)
      }`,
      { headers: apiHeaders },
    );
    expect(stale.status()).toBe(409);
    expect((await stale.json()).code).toBe("stale_cursor");
  },
);
