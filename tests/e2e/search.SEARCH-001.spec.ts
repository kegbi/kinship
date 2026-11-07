import { expect, test } from "./support/test.ts";
import { randomUUID } from "node:crypto";
import { createPerson, registerVerified } from "./support/api.ts";
import { databaseSql, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { activateGlobalSearch } from "./support/islands.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signIn } from "./support/sign-in.ts";

test(
  "[SEARCH-001] finds people, notes, activities, journal posts, and tasks from the palette",
  {
    annotation: [{ type: "flow", description: "SEARCH-001" }, {
      type: "leaf",
      description: "GAP-048",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    const email = `search-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Search",
      lastName: "Reader",
      workspaceName: "Search circle",
    });
    await signIn(page, email);
    const session = await (await page.request.get(`${origin}/api/v1/session`))
      .json();
    const workspace = sqlLiteral(session.workspace.id);
    const member = sqlLiteral(session.member.id);
    const adaId = await createPerson(page.request, {
      familyName: "Lighthouse",
      givenName: "Ada",
    });
    const archieId = await createPerson(page.request, {
      familyName: "Keeper",
      givenName: "Archie",
    });
    const noteId = randomUUID();
    const postId = randomUUID();
    const itemId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    const foreignPersonId = randomUUID();
    const activityId = randomUUID();
    databaseSql(`
      update crm.people set archived_at = now()
      where id = ${sqlLiteral(archieId)}::uuid;
      insert into crm.notes (id, workspace_id, person_id, body,
        created_by_member_id, created_at, updated_at)
      values (${sqlLiteral(noteId)}::uuid, ${workspace}::uuid,
        ${sqlLiteral(adaId)}::uuid, 'Met at the lighthouse café',
        ${member}::uuid, now(), now()),
        (gen_random_uuid(), ${workspace}::uuid, ${sqlLiteral(archieId)}::uuid,
        'Told the lighthouse storm story', ${member}::uuid,
        now() - interval '1 day', now() - interval '1 day');
      insert into crm.activities (id, workspace_id, summary, happened_at,
        created_by_member_id)
      values (${sqlLiteral(activityId)}::uuid, ${workspace}::uuid,
        'Lighthouse walk', now(), ${member}::uuid);
      insert into crm.activity_participants (activity_id, person_id)
      values (${sqlLiteral(activityId)}::uuid, ${sqlLiteral(adaId)}::uuid);
      insert into crm.journal_posts (id, workspace_id, title, body,
        created_by_member_id)
      values (${sqlLiteral(postId)}::uuid, ${workspace}::uuid, null,
        'A quiet lighthouse evening', ${member}::uuid);
      insert into crm.journal_items (id, workspace_id, occurred_at,
        journal_post_id, created_by_member_id)
      values (${sqlLiteral(itemId)}::uuid, ${workspace}::uuid, now(),
        ${sqlLiteral(postId)}::uuid, ${member}::uuid);
      insert into crm.tasks (workspace_id, person_id, title,
        created_by_member_id)
      values (${workspace}::uuid, ${sqlLiteral(adaId)}::uuid,
        'Book the lighthouse tour', ${member}::uuid);
      insert into crm.workspaces (id, name, status)
      values (${sqlLiteral(foreignWorkspaceId)}::uuid, 'Foreign circle',
        'active');
      insert into crm.people (id, workspace_id, given_name)
      values (${sqlLiteral(foreignPersonId)}::uuid,
        ${sqlLiteral(foreignWorkspaceId)}::uuid, 'Foreign Lighthouse');
      insert into crm.notes (workspace_id, person_id, body)
      values (${sqlLiteral(foreignWorkspaceId)}::uuid,
        ${sqlLiteral(foreignPersonId)}::uuid, 'Foreign lighthouse note');
    `);

    await page.goto("/app");
    await activateGlobalSearch(page);
    const field = page.getByRole("combobox", { name: "Find a person" });
    await expect(field).toHaveAttribute("maxlength", "200");
    await field.fill("lighthouse");
    const dialog = page.getByRole("dialog", { name: "Find a person" });
    const results = page.locator("#global-people-search-results");
    await expect(page.locator("#global-people-search-status")).toHaveText(
      "1 person, 2 notes, 1 activity, 1 journal post, and 1 task found",
    );
    const group = (name: string) => results.getByRole("group", { name });
    const people = group("People").getByRole("option");
    await expect(people).toHaveCount(2);
    await expect(people.first()).toContainText("Ada Lighthouse");
    await expect(people.nth(1)).toContainText(
      'Add "lighthouse" as a new person',
    );
    const notes = group("Notes").getByRole("option");
    await expect(notes).toHaveCount(2);
    await expect(notes.first()).toContainText("Met at the lighthouse café");
    // An archived person is not a people result, as in the directory, while
    // their note is still found and says so.
    await expect(notes.nth(1)).toContainText("Archie Keeper");
    await expect(notes.nth(1)).toContainText("Archived");
    await expect(group("Activities").getByRole("option")).toContainText(
      "Lighthouse walk",
    );
    await expect(group("Journal posts").getByRole("option")).toContainText(
      "A quiet lighthouse evening",
    );
    await expect(group("Tasks").getByRole("option")).toContainText(
      "Book the lighthouse tour",
    );
    await expect(dialog).not.toContainText("Foreign");
    await expectAccessible(page);

    // The arrow keys move through every group; Enter opens the note in its
    // person's Notes section.
    await expect(field).toBeFocused();
    await expect(people.first()).toHaveAttribute("aria-selected", "true");
    await field.press("ArrowDown");
    await expect(people.nth(1)).toHaveAttribute("aria-selected", "true");
    await field.press("ArrowDown");
    await expect(notes.first()).toHaveAttribute("aria-selected", "true");
    await field.press("ArrowDown");
    await expect(notes.nth(1)).toHaveAttribute("aria-selected", "true");
    await field.press("ArrowUp");
    await expect(notes.first()).toHaveAttribute("aria-selected", "true");
    await field.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`/app/people/${adaId}\\?section=notes$`),
    );
    await expect(page.locator("#profile-section-notes")).toBeVisible();
    await expect(page.locator("#person-timeline")).toContainText(
      "Met at the lighthouse café",
    );

    await activateGlobalSearch(page);
    await page.getByRole("combobox", { name: "Find a person" }).fill(
      "Archie",
    );
    await expect(page.locator("#global-people-search-status")).toHaveText(
      "0 people found",
    );
    await expect(
      page.locator("#global-people-search-results").getByRole("option", {
        name: 'Add "Archie" as a new person',
      }),
    ).toBeVisible();
    await page.getByRole("combobox", { name: "Find a person" }).fill(
      "zzqqnothing",
    );
    await expect(page.getByText("Nothing in this workspace matches"))
      .toBeVisible();

    const tooLong = await page.request.get(
      `${origin}/api/v1/search?q=${"x".repeat(201)}`,
    );
    expect(tooLong.status()).toBe(400);
    expect((await tooLong.json()).code).toBe("search_query_invalid");
  },
);
