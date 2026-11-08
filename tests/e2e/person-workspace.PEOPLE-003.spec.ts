import { expect, test } from "./support/test.ts";
import { registerVerified } from "./support/api.ts";
import { databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { signInAcceptingCompliance } from "./support/sign-in.ts";

test("[PEOPLE-003] reads the complete canonical person workspace", {
  annotation: [{ type: "flow", description: "PEOPLE-003" }, {
    type: "leaf",
    description: "APP-008C",
  }],
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  page.setDefaultTimeout(20_000);
  const email = `complete-profile-${browserName}-${Date.now()}@example.test`;
  await registerVerified(request, {
    email,
    firstName: "Profile",
    lastName: "Reader",
    workspaceName: "Complete profile circle",
  }, bareToken);
  await signInAcceptingCompliance(page, email, { expectToday: true });

  const created = await page.request.post(`${origin}/api/v1/people`, {
    data: {
      familyName: "Lovelace",
      givenName: "Ada",
      isPartial: true,
    },
    headers: { origin },
  });
  expect(created.status()).toBe(201);
  const personId = (await created.json() as { person: { id: string } }).person
    .id;
  expect((await page.request.post(`${origin}/api/v1/tasks`, {
    data: {
      personId,
      requestId: crypto.randomUUID(),
      title: "Review correspondence",
    },
    headers: { origin },
  })).status()).toBe(201);
  expect((await page.request.post(`${origin}/api/v1/reminders`, {
    data: {
      anchorOn: "2030-09-15",
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "none",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title: "Write to Ada",
    },
    headers: { origin },
  })).status()).toBe(201);
  expect((await page.request.post(`${origin}/api/v1/stay-in-touch-cadences`, {
    data: {
      intervalCount: 1,
      intervalUnit: "month",
      personId,
      requestId: crypto.randomUUID(),
    },
    headers: { origin },
  })).status()).toBe(201);

  const workspaceId = databaseValue(
    `select w.id::text from crm.workspaces w join crm.users u
      on u.id = w.created_by_user_id where u.email = ${sqlLiteral(email)}`,
  );
  databaseValue(`insert into crm.life_events
    (workspace_id, person_id, name, note, year, month, precision)
    values ('${workspaceId}'::uuid, '${personId}'::uuid, 'Published Notes',
      'The first published computer algorithm.', 1843, 12, 'year_month')`);
  const foreignWorkspaceId = crypto.randomUUID();
  const foreignPersonId = crypto.randomUUID();
  databaseValue(`insert into crm.workspaces (id, name, status)
    values ('${foreignWorkspaceId}'::uuid, 'Foreign profile', 'active');
    insert into crm.people (id, workspace_id, given_name)
    values ('${foreignPersonId}'::uuid, '${foreignWorkspaceId}'::uuid, 'Private')`);

  const taskRequests: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && sent.url().includes("/api/v1/tasks")) {
      taskRequests.push(new URL(sent.url()).pathname);
    }
  });
  await page.goto(`/app/people/${personId}?section=life-events`);
  await expect(page.locator("body")).toHaveAttribute(
    "data-page-id",
    "people.profile",
  );
  await expect(page.getByRole("heading", { name: "Ada Lovelace" }))
    .toBeVisible();
  await expect(page.getByText("Partial identity · unknown values preserved"))
    .toBeVisible();
  await expect(page.locator("#person-profile-due-state")).toHaveText(
    "Every 1 month",
  );
  await expect(page.locator('[data-person-vital-value="next-reminder"]'))
    .toContainText("2030");
  await expect(page.locator("[data-cadence-list]")).toContainText(
    "Every 1 month",
  );

  const sections = page.locator("[data-profile-section]");
  await expect(sections).toHaveCount(22);
  await page.locator('[data-zone="things"]').scrollIntoViewIfNeeded();
  await page.locator('[data-zone="admin"]').scrollIntoViewIfNeeded();
  await expect.poll(async () =>
    await sections.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.sectionState)
        .filter((state) =>
          state === "loading" || state === "unavailable" ||
          state === "error" || state === "forbidden"
        ).length
    )
  ).toBe(0);
  const history = page.locator("#profile-section-life-events");
  await expect(history).toHaveAttribute("data-section-state", "ready");
  await expect(history).toBeFocused();
  const timeline = page.locator("#person-timeline");
  const publishedNotesTimelineRow = timeline.locator("[data-timeline-id]", {
    hasText: "Published Notes",
  });
  await expect(publishedNotesTimelineRow).toHaveCount(1);
  await expect(publishedNotesTimelineRow).toContainText("December 1843");
  await expect(publishedNotesTimelineRow).toContainText("Published Notes");
  // JOURNAL-002 made life events editable from this section.
  await expect(history.getByRole("button", { name: "Add life event" }))
    .toBeVisible();

  const tasks = page.locator("#profile-section-tasks");
  const openTasks = tasks.locator("[data-task-open-list] > li");
  await expect(openTasks).toHaveCount(1);
  await expect(openTasks).toContainText("Review correspondence");
  await tasks.getByRole("button", { name: "Add task" }).click();
  await tasks.getByLabel("Title").fill("Owning facade proof");
  await tasks.getByRole("button", { name: "Save task" }).click();
  await expect(tasks.getByText("Owning facade proof")).toBeVisible();
  expect(taskRequests).toEqual(["/api/v1/tasks"]);

  await page.route(
    `**/api/v1/people/${personId}/life-events`,
    (route) =>
      route.fulfill({
        body: JSON.stringify({
          detail: "History temporarily unavailable.",
          status: 503,
          title: "Unavailable",
          type: "about:blank",
        }),
        contentType: "application/problem+json",
        status: 503,
      }),
  );
  await page.reload();
  await expect(history).toHaveAttribute("data-section-state", "error");
  await expect(history).toContainText("History temporarily unavailable.");
  await expect(page.locator("#profile-section-tasks")).not.toHaveAttribute(
    "data-section-state",
    "error",
  );
  await page.unroute(`**/api/v1/people/${personId}/life-events`);
  await history.getByRole("button", { name: "Retry life events" }).click();
  await expect(history).toHaveAttribute("data-section-state", "ready");

  databaseValue(`insert into crm.workspace_profile_modules
    (workspace_id, key, name, is_active) values
    ('${workspaceId}'::uuid, 'life-events', 'Life events', false)
    on conflict (workspace_id, key) do update set is_active = false`);
  await page.reload();
  await expect(history).toBeHidden();
  await expect(page.locator('[data-section-link="life-events"]')).toBeHidden();
  expect(databaseValue(
    `select count(*) from crm.life_events where workspace_id =
      '${workspaceId}'::uuid and person_id = '${personId}'::uuid`,
  )).toBe("1");
  expect((await page.request.get(
    `${origin}/api/v1/people/${foreignPersonId}/life-events`,
  )).status()).toBe(404);

  await expectAccessible(page);
});

test(
  "[PEOPLE-003] reads only what a blank person shows, and a note refreshes only the timeline",
  {
    annotation: [{ type: "flow", description: "PEOPLE-003" }, {
      type: "finding",
      description: "FEQ-04 FEQ-10",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(20_000);
    const email = `blank-profile-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Blank",
      lastName: "Reader",
      workspaceName: "Blank profile circle",
    }, bareToken);
    await signInAcceptingCompliance(page, email, { expectToday: true });
    const created = await page.request.post(`${origin}/api/v1/people`, {
      data: { familyName: "Hopper", givenName: "Grace", isPartial: false },
      headers: { origin },
    });
    expect(created.status()).toBe(201);
    const personId = (await created.json() as { person: { id: string } }).person
      .id;

    const api: string[] = [];
    page.on("request", (sent) => {
      const url = new URL(sent.url());
      if (url.pathname.startsWith("/api/v1/")) {
        api.push(`${sent.method()} ${url.pathname}${url.search}`);
      }
    });
    await page.goto(`/app/people/${personId}`);
    await expect(page.locator("#person-profile-ready")).toHaveAttribute(
      "data-workspace-settled",
      "",
    );
    await expect(page.locator("#person-first-run")).toBeVisible();
    // FEQ-04: an empty section reads nothing, and still offers its Add control.
    await expect(
      page.locator('[data-profile-section="contact-methods"]'),
    ).toHaveAttribute("data-section-state", "ready");
    await expect(
      page.getByRole("button", { name: "Add contact methods" }),
    ).toBeEnabled();
    expect(api.length, api.join("\n")).toBeLessThanOrEqual(10);
    expect(api.filter((line) => line.includes("/relationship-types")))
      .toEqual([]);

    // A note saved from the hero before the Timeline cards mount: the cards
    // that mount afterwards read it, whatever the summary counted.
    const capture = page.getByRole("dialog", {
      name: "Record an activity or note",
    });
    await page.locator("[data-person-profile-actions]").getByRole("button", {
      name: "Add note",
    }).click();
    await expect(capture).toBeVisible();
    await capture.getByRole("textbox", { name: "Note", exact: true }).fill(
      "Wrote the first compiler manual.",
    );
    await capture.getByRole("button", { name: "Save interaction" }).click();
    await expect(capture.getByText("Note saved.")).toBeVisible();
    await capture.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Show all sections" }).click();
    const notes = page.locator("#profile-section-notes");
    await expect(notes).toContainText("1 recent note");
    await expect(page.locator("#person-timeline")).toContainText(
      "Wrote the first compiler manual.",
    );

    // FEQ-10: a note makes one write and refreshes only the timeline.
    await page.goto(`/app/people/${personId}?view=timeline`);
    await expect(page.locator("#person-profile-ready")).toHaveAttribute(
      "data-workspace-settled",
      "",
    );
    await expect(notes).toHaveAttribute("data-section-state", "ready");
    await notes.getByRole("button", { name: "Add note" }).click();
    await expect(capture).toBeVisible();
    await capture.getByRole("textbox", { name: "Note", exact: true }).fill(
      "Invented the first compiler.",
    );
    api.length = 0;
    await capture.getByRole("button", { name: "Save interaction" }).click();
    await expect(capture.getByText("Note saved.")).toBeVisible();
    await expect(page.locator("#person-timeline")).toContainText(
      "Invented the first compiler.",
    );
    await expect(notes).toContainText("2 recent notes");
    expect(api.filter((line) => line.startsWith("POST "))).toEqual([
      "POST /api/v1/interactions",
    ]);
    expect(api.filter((line) => line.startsWith("GET ")).length, api.join("\n"))
      .toBeLessThanOrEqual(1);
  },
);

test(
  "[PEOPLE-003] opens a rich person at laptop size in at most six requests, and a failed rail section shows its own error",
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
    const email = `rich-profile-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Rich",
      lastName: "Reader",
      workspaceName: "Rich profile circle",
    }, bareToken);
    await signInAcceptingCompliance(page, email, { expectToday: true });
    const create = async (givenName: string, familyName: string) => {
      const created = await page.request.post(`${origin}/api/v1/people`, {
        data: { familyName, givenName, isPartial: false },
        headers: { origin },
      });
      expect(created.status()).toBe(201);
      return (await created.json() as { person: { id: string } }).person.id;
    };
    const personId = await create("Ada", "Lovelace");
    const relatedId = await create("Charles", "Babbage");
    const post = async (path: string, data: Record<string, unknown>) =>
      expect(
        (await page.request.post(`${origin}${path}`, {
          data,
          headers: { origin },
        })).status(),
      ).toBe(201);
    await post(`/api/v1/people/${personId}/dates`, {
      day: 10,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: 12,
      precision: "full",
      year: 1815,
    });
    await post("/api/v1/reminders", {
      anchorOn: "2030-09-15",
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "none",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title: "Write to Ada",
    });
    await post("/api/v1/stay-in-touch-cadences", {
      intervalCount: 1,
      intervalUnit: "month",
      personId,
      requestId: crypto.randomUUID(),
    });
    await post("/api/v1/tasks", {
      personId,
      requestId: crypto.randomUUID(),
      title: "Review correspondence",
    });
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u
        on u.id = w.created_by_user_id where u.email = ${sqlLiteral(email)}`,
    );
    const memberId = databaseValue(
      `select id::text from crm.workspace_members
        where workspace_id = '${workspaceId}'::uuid`,
    );
    const typeId = crypto.randomUUID();
    const locationId = crypto.randomUUID();
    const relationshipTypeId = crypto.randomUUID();
    // Every rail section holds something, so no summary count spares a read.
    databaseValue(`
      insert into crm.contact_method_types
        (id, workspace_id, name, kind, protocol, sort_order)
        values ('${typeId}'::uuid, '${workspaceId}'::uuid, 'Rail email',
          'email', 'mailto', 99);
      insert into crm.person_contact_methods
        (workspace_id, person_id, type_id, value)
        values ('${workspaceId}'::uuid, '${personId}'::uuid, '${typeId}'::uuid, 'ada@example.test');
      insert into crm.locations (id, workspace_id, city)
        values ('${locationId}'::uuid, '${workspaceId}'::uuid, 'London');
      insert into crm.person_addresses (workspace_id, person_id, location_id)
        values ('${workspaceId}'::uuid, '${personId}'::uuid, '${locationId}'::uuid);
      insert into crm.person_first_meetings (workspace_id, person_id, place_text)
        values ('${workspaceId}'::uuid, '${personId}'::uuid, 'At the Analytical Society');
      insert into crm.person_occupations (workspace_id, person_id, title)
        values ('${workspaceId}'::uuid, '${personId}'::uuid, 'Mathematician');
      update crm.people set food_preferences = 'Tea'
        where id = '${personId}'::uuid;
      insert into crm.pets (workspace_id, person_id, name)
        values ('${workspaceId}'::uuid, '${personId}'::uuid, 'Puff');
      insert into crm.tags (id, workspace_id, name, slug)
        values (gen_random_uuid(), '${workspaceId}'::uuid, 'Analyst',
          'analyst');
      insert into crm.person_tags (workspace_id, person_id, tag_id)
        select '${workspaceId}'::uuid, '${personId}'::uuid, id from crm.tags
        where workspace_id = '${workspaceId}'::uuid;
      insert into crm.relationship_types
        (id, workspace_id, forward_label, reverse_label, sort_order)
        values ('${relationshipTypeId}'::uuid, '${workspaceId}'::uuid,
          'colleague', 'colleague', 99);
      insert into crm.relationships
        (workspace_id, from_person_id, to_person_id, relationship_type_id)
        values ('${workspaceId}'::uuid, '${personId}'::uuid,
          '${relatedId}'::uuid, '${relationshipTypeId}'::uuid);
      insert into crm.notes (workspace_id, person_id, body,
          created_by_member_id)
        select '${workspaceId}'::uuid, '${personId}'::uuid,
          'Corresponded about the engine, letter ' || sequence,
          '${memberId}'::uuid
        from generate_series(1, 24) sequence;
      insert into crm.calls (workspace_id, person_id, called_at,
          created_by_member_id)
        values ('${workspaceId}'::uuid, '${personId}'::uuid,
          '2026-08-18T09:00:00.000Z', '${memberId}'::uuid);
      insert into crm.life_events
        (workspace_id, person_id, name, year, month, precision)
        values ('${workspaceId}'::uuid, '${personId}'::uuid,
          'Published Notes', 1843, 12, 'year_month')`);

    const api: string[] = [];
    page.on("request", (sent) => {
      const url = new URL(sent.url());
      if (url.pathname.startsWith("/api/v1/")) {
        api.push(`${sent.method()} ${url.pathname}${url.search}`);
      }
    });
    const settled = page.locator("#person-profile-ready");
    const contact = page.locator('[data-profile-section="contact-methods"]');
    const addresses = page.locator('[data-profile-section="addresses"]');
    await page.goto(`/app/people/${personId}`);
    await expect(settled).toHaveAttribute("data-workspace-settled", "");
    await expect(contact).toHaveAttribute("data-section-state", "ready");
    await expect(contact).toContainText("ada@example.test");
    await expect(addresses).toContainText("London");
    await expect(page.locator('[data-profile-section="relationships"]'))
      .toContainText("Charles Babbage");
    await expect(page.locator("[data-cadence-list]")).toContainText(
      "Every 1 month",
    );
    // At laptop size the page opens in at most six requests (FEQ-04): the
    // session, the person with its rail in one read (step 4, AUD-Q3), the
    // notifications, the unified timeline, and the view. No rail section reads
    // its own first page, and the Timeline cards below the fold wait for the
    // settled layout (step 3, AUD-F5-fix).
    expect(
      api.filter((line) => line.includes(`/people/${personId}?`)),
      api.join("\n"),
    ).toEqual([`GET /api/v1/people/${personId}?include=rail`]);
    expect(
      api.filter((line) =>
        /\/(facts|dates|relationships|relationship-types|reminders)/.test(
          line,
        )
      ),
      api.join("\n"),
    ).toEqual([]);
    expect(api.length, api.join("\n")).toBeLessThanOrEqual(6);

    // One rail section the server could not compose shows its own outage;
    // the sections beside it still render, and its retry reads its own
    // endpoint.
    const railRead = `**/api/v1/people/${personId}?include=rail`;
    await page.route(railRead, async (route) => {
      const response = await route.fetch();
      const body = await response.json() as {
        readonly rail: Record<string, unknown>;
      };
      await route.fulfill({
        json: {
          ...body,
          rail: { ...body.rail, addresses: { status: "unavailable" } },
        },
        response,
      });
    });
    await page.reload();
    await expect(settled).toHaveAttribute("data-workspace-settled", "");
    await expect(addresses).toHaveAttribute("data-section-state", "error");
    await expect(addresses).toContainText(
      "This profile section is temporarily unavailable.",
    );
    await expect(contact).toHaveAttribute("data-section-state", "ready");
    await expect(contact).toContainText("ada@example.test");
    await page.unroute(railRead);
    await addresses.getByRole("button", { name: "Retry" }).click();
    await expect(addresses).toHaveAttribute("data-section-state", "ready");
    await expect(addresses).toContainText("London");

    await expectAccessible(page);
  },
);
