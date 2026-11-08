import { expect, test } from "./support/test.ts";
import { randomUUID } from "node:crypto";
import { registerVerified } from "./support/api.ts";
import { databaseSql, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signIn } from "./support/sign-in.ts";

test(
  "[APP-003C] opens the canonical person workspace shell",
  { annotation: { type: "flow", description: "PEOPLE-003" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    const email = `profile-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Profile",
      lastName: "Reader",
      workspaceName: "Profile circle",
    });
    await signIn(page, email);

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
    const personId = randomUUID();
    const emptyPersonId = randomUUID();
    const foreignWorkspaceId = randomUUID();
    const foreignPersonId = randomUUID();
    const genderId = randomUUID();
    databaseSql(`
      insert into crm.gender_options (id, workspace_id, name)
      values ('${genderId}'::uuid, '${workspaceId}'::uuid, 'Woman');
      insert into crm.people (
        id, workspace_id, created_by_member_id, gender_option_id, given_name,
        family_name, nickname, description, is_starred, is_deceased
      ) values (
        '${personId}'::uuid, '${workspaceId}'::uuid, '${memberId}'::uuid,
        '${genderId}'::uuid, 'Ada', 'Lovelace', 'Enchantress of Numbers',
        'Mathematician and correspondent.', true, true
      ), (
        '${emptyPersonId}'::uuid, '${workspaceId}'::uuid, '${memberId}'::uuid,
        null, 'Empty', 'Profile', null, null, false, false
      );
      update crm.workspace_members set self_person_id = '${personId}'::uuid
      where id = '${memberId}'::uuid;
      insert into crm.tags (id, workspace_id, name, slug)
      select gen_random_uuid(), '${workspaceId}'::uuid,
        'Profile ' || lpad(sequence::text, 2, '0'),
        'profile-' || lpad(sequence::text, 2, '0')
      from generate_series(1, 10) sequence;
      insert into crm.person_tags (person_id, tag_id)
      select '${personId}'::uuid, tag.id from crm.tags tag
      where tag.workspace_id = '${workspaceId}'::uuid;
      insert into crm.workspaces (id, name, status)
      values ('${foreignWorkspaceId}'::uuid, 'Foreign profile', 'active');
      insert into crm.people (id, workspace_id, given_name)
      values ('${foreignPersonId}'::uuid, '${foreignWorkspaceId}'::uuid, 'Foreign');
    `);

    let releaseProfile = () => {};
    const profileAllowed = new Promise<void>((resolve) => {
      releaseProfile = resolve;
    });
    const profilePattern = `**/api/v1/people/${personId}*`;
    await page.route(profilePattern, async (route) => {
      await profileAllowed;
      await route.continue();
    });
    await page.goto(`/app/people/${personId}?section=documents`);
    await expect(page.locator("#person-profile-ready")).toBeVisible();
    await expect(page.locator("#person-profile-ready")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    await expect(page.locator("#person-profile-state")).toBeHidden();
    releaseProfile();

    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "people.profile",
    );
    await expect(
      page.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
    ).toBeVisible();
    await expect(page.getByText("Identity saved")).toBeVisible();
    await expect(page.getByText("Favorite", { exact: true })).toBeVisible();
    await expect(page.getByText("Deceased", { exact: true })).toBeVisible();
    await expect(page.getByText("Your person record")).toBeVisible();
    await expect(page.getByText("Mathematician and correspondent."))
      .toBeVisible();
    await expect(page.locator("#person-profile-tags > li")).toHaveCount(9);
    await expect(page.locator("#person-profile-tags > li").last()).toHaveText(
      "+2 more",
    );
    await expect(page.locator("#person-profile-due-state")).toHaveText(
      "Not set",
    );
    await expect(page.locator('[data-person-vital-value="next-reminder"]'))
      .toHaveText("Not recorded");
    await expect(page.locator("[data-profile-section]")).toHaveCount(22);
    await expect(
      page.locator('[data-profile-section][data-section-state="unavailable"]'),
    ).toHaveCount(0);
    await expect(page.locator("#profile-section-relationships"))
      .toHaveAttribute("data-section-state", "ready");
    await expect(page.locator("#profile-section-important-dates"))
      .toHaveAttribute("data-section-state", "ready");
    await expect(page.locator("#profile-section-activities"))
      .toHaveAttribute("data-section-state", "ready");
    await expect(page.locator("#profile-section-notes"))
      .toHaveAttribute("data-section-state", "ready");
    await expect(page.locator("#profile-section-documents").locator(".."))
      .toHaveAttribute("data-zone", "things");
    await expect(page.locator("#profile-section-documents")).toBeFocused();
    await expect(
      page.locator('[data-section-link="documents"]'),
    ).toHaveAttribute("aria-current", "location");
    await expect(
      page.locator(`a[href^="/app/people/${personId}/"]`),
    ).toHaveCount(2);
    await expect(page.locator("[data-activity-report-link]")).toHaveAttribute(
      "href",
      `/app/people/${personId}/activity-report`,
    );
    const tasks = page.locator("#profile-section-tasks");
    await page.locator('[data-zone="planning"]').scrollIntoViewIfNeeded();
    await expect(tasks).toHaveAttribute("data-section-state", "ready");
    await expect(tasks.locator("[data-task-state]")).toHaveText(
      "No tasks in this view.",
    );
    await expect(tasks.locator("[data-task-open-list] > li")).toHaveCount(0);
    await expect(page.locator("#profile-section-documents")).toBeFocused();
    await page.unroute(profilePattern);
    await expectAccessible(page);

    await page.locator(".profile-section-directory summary").click();
    await page.locator('[data-section-link="photos"]').click();
    await expect(page).toHaveURL(
      new RegExp(`/app/people/${personId}\\?section=photos$`),
    );
    await expect(page.locator("#profile-section-photos")).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL(
      new RegExp(`/app/people/${personId}\\?section=documents$`),
    );
    await expect(page.locator("#profile-section-documents")).toBeFocused();

    const importantDatesLink = page.locator(
      '[data-section-link="important-dates"]',
    );
    await page.locator(".profile-section-directory summary").click();
    await importantDatesLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`/app/people/${personId}\\?section=important-dates$`),
    );
    await expect(page.locator("#profile-section-important-dates"))
      .toBeFocused();
    await page.reload();
    await expect(page.locator("#profile-section-important-dates"))
      .toBeFocused();

    await page.goto(`/app/people/${personId}`);
    const profileHeading = page.getByRole("heading", {
      level: 1,
      name: "Ada Lovelace",
    });
    await expect(profileHeading).toBeFocused();
    await page.locator(".profile-section-directory summary").click();
    await page.locator('[data-section-link="photos"]').click();
    await expect(page).toHaveURL(
      new RegExp(`/app/people/${personId}\\?section=photos$`),
    );
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`/app/people/${personId}$`));
    await expect(
      page.locator("[data-section-link][aria-current]"),
    ).toHaveCount(0);
    await expect(profileHeading).toBeFocused();

    await page.setViewportSize({ height: 844, width: 390 });
    await page.locator(".profile-section-directory summary").click();
    await expect(page.locator("#person-profile-sections")).toBeVisible();
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <= globalThis.innerWidth
      ),
    ).toBe(true);
    await expectAccessible(page);

    await page.goto(`/app/people/${emptyPersonId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Empty Profile" }),
    ).toBeVisible();
    // The tags rail's status line also reads "No tags saved." once its facts
    // load; this step checks the hero's tag list.
    await expect(
      page.getByRole("list", { name: "Person tags" }).getByText(
        "No tags saved",
      ),
    ).toBeVisible();
    await expect(page.getByText("No description saved.")).toBeVisible();
    await expect(page.locator("#person-first-run")).toBeVisible();
    const emptyZones = page.locator("[data-zone]");
    await expect(emptyZones).toHaveCount(4);
    for (const zone of await emptyZones.all()) await expect(zone).toBeHidden();
    await expect(page.locator("[data-profile-section]")).toHaveCount(22);
    await expectAccessible(page);
    await page.getByRole("button", { name: "Show all sections" }).click();
    await expect(page.locator("#person-first-run")).toBeHidden();
    for (const zone of await emptyZones.all()) await expect(zone).toBeVisible();

    databaseSql(
      `update crm.people set archived_at = now() where id = '${personId}'::uuid`,
    );
    await page.goto(`/app/people/${personId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Ada Lovelace" }),
    ).toBeVisible();
    await expect(page.getByText("Archived person · read-only")).toBeVisible();

    await page.goto(`/app/people/${foreignPersonId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Person not found" }),
    ).toBeVisible();
    await page.goto(`/app/people/${randomUUID()}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Person not found" }),
    ).toBeVisible();

    const deniedId = randomUUID();
    await page.route(`**/api/v1/people/${deniedId}*`, (route) =>
      route.fulfill({
        body: JSON.stringify({
          code: "people_forbidden",
          detail: "Denied for test",
          status: 403,
          title: "Person unavailable",
          type: "about:blank",
        }),
        contentType: "application/problem+json",
        status: 403,
      }));
    await page.goto(`/app/people/${deniedId}`);
    await expect(
      page.getByRole("heading", { level: 1, name: "Person unavailable" }),
    ).toBeVisible();
    await page.unroute(`**/api/v1/people/${deniedId}*`);

    const unavailableId = randomUUID();
    await page.route(
      `**/api/v1/people/${unavailableId}*`,
      (route) =>
        route.fulfill({
          body: JSON.stringify({
            code: "people_unavailable",
            detail: "Unavailable for test",
            status: 503,
            title: "Person unavailable",
            type: "about:blank",
          }),
          contentType: "application/problem+json",
          status: 503,
        }),
    );
    await page.goto(`/app/people/${unavailableId}`);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Person temporarily unavailable",
      }),
    ).toBeVisible();
    await page.unroute(`**/api/v1/people/${unavailableId}*`);
  },
);

test(
  "[PEOPLE-003] reads the Timeline cards below the unified timeline only as the reader nears them",
  {
    annotation: [{ type: "flow", description: "PEOPLE-003" }, {
      type: "finding",
      description: "FEQ-04",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ height: 900, width: 1280 });
    const email = `rich-timeline-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Timeline",
      lastName: "Reader",
      workspaceName: "Rich timeline circle",
    });
    await signIn(page, email);
    const created = await page.request.post(`${origin}/api/v1/people`, {
      data: { familyName: "Lovelace", givenName: "Ada", isPartial: false },
      headers: { origin },
    });
    expect(created.status()).toBe(201);
    const personId = (await created.json() as { person: { id: string } }).person
      .id;
    for (let index = 1; index <= 12; index += 1) {
      expect((await page.request.post(`${origin}/api/v1/interactions`, {
        data: {
          body: `Correspondence note ${String(index).padStart(2, "0")}`,
          kind: "note",
          personId,
          requestId: randomUUID(),
        },
        headers: { origin },
      })).status()).toBe(201);
    }
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u
        on u.id = w.created_by_user_id where u.email = ${sqlLiteral(email)}`,
    );
    databaseSql(`
      insert into crm.life_events
        (workspace_id, person_id, name, year, month, precision)
      values ('${workspaceId}'::uuid, '${personId}'::uuid, 'Published Notes',
        1843, 12, 'year_month');
      insert into crm.calls (workspace_id, person_id, called_at)
      values ('${workspaceId}'::uuid, '${personId}'::uuid,
        now() - interval '2 days');
    `);

    const api: string[] = [];
    page.on("request", (sent) => {
      const url = new URL(sent.url());
      if (url.pathname.startsWith("/api/v1/")) {
        api.push(`${sent.method()} ${url.pathname}${url.search}`);
      }
    });
    const lowerReads = () =>
      api.filter((line) =>
        /\/(activity-report|communications|life-events)\b/.test(line)
      );
    await page.goto(`/app/people/${personId}`);
    const ready = page.locator("#person-profile-ready");
    await expect(ready).toHaveAttribute("data-workspace-settled", "");
    await expect(page.locator("#person-timeline [data-timeline-id]"))
      .not.toHaveCount(0);
    // The unified timeline has drawn, and the cards below it sit beyond the
    // 400 px margin of a 900 px window: none of them has read.
    const notes = page.locator("#profile-section-notes");
    expect((await notes.boundingBox())!.y).toBeGreaterThan(900 + 400);
    expect(lowerReads(), api.join("\n")).toEqual([]);

    await notes.scrollIntoViewIfNeeded();
    await expect(notes).toContainText("12 recent notes");
    expect(lowerReads().some((line) => line.includes("activity-report")))
      .toBe(true);

    // A deep link to a card below the timeline still reads it at open.
    api.length = 0;
    await page.goto(`/app/people/${personId}?section=notes`);
    await expect(ready).toHaveAttribute("data-workspace-settled", "");
    await expect(notes).toContainText("12 recent notes");
    await expect(notes).toBeFocused();
    expect(api.some((line) => line.includes("/activity-report"))).toBe(true);
  },
);

test(
  "[PEOPLE-003] settles a short person only once the Timeline cards in reach have answered",
  {
    annotation: [{ type: "flow", description: "PEOPLE-003" }, {
      type: "finding",
      description: "FEQ-04 REL-046",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(20_000);
    await page.setViewportSize({ height: 900, width: 1280 });
    const email = `short-timeline-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Short",
      lastName: "Reader",
      workspaceName: "Short timeline circle",
    });
    await signIn(page, email);
    const created = await page.request.post(`${origin}/api/v1/people`, {
      data: { familyName: "Hopper", givenName: "Grace", isPartial: false },
      headers: { origin },
    });
    expect(created.status()).toBe(201);
    const personId = (await created.json() as { person: { id: string } }).person
      .id;
    expect((await page.request.post(`${origin}/api/v1/interactions`, {
      data: {
        body: "Wrote the first compiler manual.",
        kind: "note",
        personId,
        requestId: randomUUID(),
      },
      headers: { origin },
    })).status()).toBe(201);
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u
        on u.id = w.created_by_user_id where u.email = ${sqlLiteral(email)}`,
    );
    databaseSql(`
      insert into crm.life_events
        (workspace_id, person_id, name, year, month, precision)
      values ('${workspaceId}'::uuid, '${personId}'::uuid, 'Commissioned',
        1943, 12, 'year_month');
      insert into crm.calls (workspace_id, person_id, called_at)
      values ('${workspaceId}'::uuid, '${personId}'::uuid,
        now() - interval '2 days');
    `);

    // The cards below the unified timeline answer slowly, so a workspace
    // that settled without them would say so while they are still reading.
    const lower =
      /\/api\/v1\/people\/[^/]+\/(activity-report|communications|life-events)\b/;
    await page.route(lower, async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await route.continue();
    });
    let started = 0;
    let answered = 0;
    page.on("request", (sent) => {
      if (lower.test(new URL(sent.url()).pathname)) started += 1;
    });
    page.on("requestfinished", (sent) => {
      if (lower.test(new URL(sent.url()).pathname)) answered += 1;
    });
    await page.goto(`/app/people/${personId}`);
    const ready = page.locator("#person-profile-ready");
    await expect(ready).toHaveAttribute("data-workspace-settled", "");
    const atSettle = { answered, started };
    // The page is short: the cards below the timeline were within reach of
    // the settled layout, read, and answered before the workspace settled.
    expect(atSettle.started).toBeGreaterThanOrEqual(3);
    expect(atSettle.answered).toBe(atSettle.started);
    await expect(page.locator("#profile-section-notes")).toContainText(
      "1 recent note",
    );
    await page.unroute(lower);
  },
);
