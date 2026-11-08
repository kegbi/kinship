import { expect, test } from "./support/test.ts";
import { randomUUID } from "node:crypto";
import { activateGlobalSearch } from "./support/islands.ts";
import { settlePersonWorkspace } from "./support/navigation.ts";
import { registerVerified } from "./support/api.ts";
import { databaseSql, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin, sessionCookieName } from "./support/env.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signIn } from "./support/sign-in.ts";

test(
  "[PEOPLE-002] finds a person only in the active workspace",
  { annotation: { type: "flow", description: "PEOPLE-002" } },
  async ({ browserName, context, page, request }) => {
    test.setTimeout(180_000);
    const email = `directory-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Directory",
      lastName: "Reader",
      workspaceName: "Directory circle",
    });
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
      insert into crm.person_tags (person_id, tag_id, workspace_id)
      values ('${adaId}'::uuid, '${friendsTagId}'::uuid, (select scope.workspace_id from crm.people scope where scope.id = '${adaId}'::uuid));
      insert into crm.person_tags (person_id, tag_id, workspace_id)
      select '${adaId}'::uuid, tag.id,
        (select scope.workspace_id from crm.people scope where scope.id = '${adaId}'::uuid)
      from crm.tags tag
      where tag.workspace_id = '${workspaceId}'::uuid
        and tag.slug between 'bulk-01' and 'bulk-07';
      insert into crm.workspaces (id, name, status)
      values ('${foreignWorkspaceId}'::uuid, 'Foreign circle', 'active');
      insert into crm.people (id, workspace_id, given_name, family_name)
      values ('${foreignPersonId}'::uuid, '${foreignWorkspaceId}'::uuid, 'Foreign', 'Person');
      insert into crm.tags (id, workspace_id, name, slug)
      values ('${foreignTagId}'::uuid, '${foreignWorkspaceId}'::uuid, 'Private', 'private');
    `);
    // Tagging Ada with the foreign tag is refused by the database itself
    // (ADR 0008; tests/integration/workspace_isolation_postgres_test.ts), so
    // the foreign tag exists only in its own workspace.

    await activateGlobalSearch(page);
    const globalSearch = page.getByRole("combobox", {
      name: "Find a person",
    });
    await globalSearch.fill("Ada Lovelace");
    await expect(
      page.getByRole("option", { name: /Ada Lovelace.*Scientist/ }),
    ).toBeVisible();
    await globalSearch.press("Enter");
    await expect(page).toHaveURL(new RegExp(`/app/people/${adaId}$`));

    await settlePersonWorkspace(page);
    await page.goto("/app/people");
    await activateGlobalSearch(page);
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
    await activateGlobalSearch(page);

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
    await activateGlobalSearch(page);

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
    // FEQ-11: the tag filter reads its options once the reader reaches it.
    await page.getByRole("combobox", { name: "Tag", exact: true }).focus();
    await expect(page.locator("#people-tag-options-status")).toHaveText(
      "20 tag options shown.",
    );
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
    await page.setViewportSize({ width: 390, height: 844 });
    const count = page.locator("#people-directory-announcement");
    await expect(count).toHaveCSS("position", "static");
    await expect(count).toHaveCSS("pointer-events", "auto");
    const selected = page.getByRole("checkbox", {
      name: "Select Ada Lovelace “Scientist”",
      exact: true,
    });
    await selected.check();
    await page.getByRole("button", { name: "Load more people" })
      .scrollIntoViewIfNeeded();
    await expect(page.locator("#people-directory-list > li")).toHaveCount(22);
    await expect(selected).toBeChecked();
    await expect(page.getByRole("toolbar", { name: "Bulk actions" }))
      .toContainText("1 selected");
    await page.setViewportSize({ width: 1280, height: 900 });
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
      cookie.name === sessionCookieName
    );
    expect(sessionCookie).toBeTruthy();
    const apiHeaders = {
      cookie: `${sessionCookieName}=${sessionCookie!.value}`,
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
