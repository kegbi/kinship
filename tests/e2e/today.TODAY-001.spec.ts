import { expect, test } from "./support/test.ts";
import { createPerson, registerVerified } from "./support/api.ts";
import { databaseSql, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { bareToken } from "./support/mail.ts";
import { expectAccessible } from "./support/page-checks.ts";
import { submitSignIn } from "./support/sign-in.ts";

test(
  "[TODAY-001] groups actual calendar dates and opens their person names",
  { annotation: [{ type: "flow", description: "TODAY-001" }] },
  async ({ browserName, page, request }) => {
    test.setTimeout(90_000);
    const email = `today-reminder-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Reminder",
      lastName: "Reviewer",
      workspaceName: "Reminder dates",
    }, bareToken);
    await submitSignIn(page, email);
    const personId = await createPerson(page.request, {
      givenName: "Ada ·",
      familyName: "Lovelace",
    });
    // Exercise the real projection: calendar dates need no notification rule.
    const response = await page.request.get(`${origin}/api/v1/today/attention`);
    expect(response.status()).toBe(200);
    const snapshot = await response.json() as { date: string };
    const base = sqlLiteral(snapshot.date);
    databaseSql(`
      insert into crm.person_dates (person_id, kind, label, month, day, precision)
      select ${sqlLiteral(personId)}::uuid, 'custom', label,
        extract(month from ${base}::date + days),
        extract(day from ${base}::date + days), 'month_day'
      from (values (7, 'Birthday next week'), (9, 'Birthday upcoming'),
        (34, 'Birthday next month')) as dates(days, label);
    `);
    await page.goto("/app");
    await expect(page.locator("#today-next-seven-list")).toContainText(
      "Birthday next week",
    );
    await expect(page.locator("#today-next-seven-list")).not.toContainText(
      "Birthday upcoming",
    );
    await expect(page.locator("#today-upcoming-list")).toContainText(
      "Birthday upcoming",
    );
    await expect(page.locator("#today-upcoming-list")).not.toContainText(
      "Birthday next month",
    );
    for (
      const [selector, title] of [
        ["#today-next-seven-list", "Birthday next week"],
        ["#today-upcoming-list", "Birthday upcoming"],
      ]
    ) {
      const row = page.locator(`${selector} li`, { hasText: title });
      await expect(row).toContainText("Important date");
      await expect(row).not.toContainText("Reminder due");
      const name = row.getByRole("link", {
        name: "Ada · Lovelace",
        exact: true,
      });
      await expect(name).toHaveAttribute(
        "href",
        `/app/people/${personId}?section=important-dates`,
      );
      await name.focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(
        `/app/people/${personId}?section=important-dates`,
      );
      await expect(
        page.getByRole("heading", { name: "Ada · Lovelace", exact: true }),
      ).toBeVisible();
      await page.goBack();
      await expect(row).toBeVisible();
    }
    await expectAccessible(page);
  },
);

test(
  "[TODAY-001] reviews and advances today's relationship priorities",
  {
    annotation: [
      { type: "flow", description: "TODAY-001" },
      { type: "leaf", description: "APP-006C" },
    ],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const email = `today-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Today",
      lastName: "Reviewer",
      workspaceName: "Today circle",
    }, bareToken);
    await submitSignIn(page, email);

    const preferencesResponse = await page.request.get(
      `${origin}/api/v1/settings/preferences`,
    );
    expect(preferencesResponse.status()).toBe(200);
    const preferences = (await preferencesResponse.json() as {
      preferences: Record<string, unknown>;
    }).preferences;
    expect((await page.request.put(`${origin}/api/v1/settings/preferences`, {
      data: {
        contactNameOrder: preferences.contactNameOrder,
        contactSortOrder: preferences.contactSortOrder,
        currencyCode: preferences.currencyCode,
        fluidLayout: preferences.fluidLayout,
        locale: preferences.locale,
        measurementSystem: preferences.measurementSystem,
        temperatureScale: preferences.temperatureScale,
        timezone: "Europe/Belgrade",
      },
      headers: { origin },
    })).status()).toBe(200);

    const adaId = await createPerson(page.request, {
      givenName: "Ada",
      familyName: "Lovelace",
    });
    const graceId = await createPerson(page.request, {
      givenName: "Grace",
      familyName: "Hopper",
    });
    const katherineId = await createPerson(page.request, {
      givenName: "Katherine",
      familyName: "Johnson",
    });
    const viewRecorded = page.waitForResponse((response) =>
      response.url() === `${origin}/api/v1/people/${adaId}/view` &&
      response.request().method() === "POST"
    );
    await page.goto(`/app/people/${adaId}`);
    expect((await viewRecorded).status()).toBe(200);
    await expect(page.getByRole("heading", { name: "Ada Lovelace" }))
      .toBeVisible();
    await page.goto("/app");
    await expect(page.locator("#today-recent-people-list li", {
      hasText: "Ada Lovelace",
    })).toBeVisible();

    const attention = await page.request.get(
      `${origin}/api/v1/today/attention`,
    );
    expect(attention.status()).toBe(200);
    const attentionBody = await attention.json() as {
      date: string;
      timezone: string;
    };
    expect(attentionBody.timezone).toBe("Europe/Belgrade");
    expect((await page.request.post(
      `${origin}/api/v1/stay-in-touch-cadences`,
      {
        data: {
          intervalCount: 1,
          intervalUnit: "day",
          personId: adaId,
          requestId: crypto.randomUUID(),
        },
        headers: { origin },
      },
    )).status()).toBe(201);

    const now = Date.now();
    async function createTask(title: string, dueAt: string) {
      const response = await page.request.post(`${origin}/api/v1/tasks`, {
        data: {
          dueAt,
          personId: adaId,
          requestId: crypto.randomUUID(),
          title,
        },
        headers: { origin },
      });
      expect(response.status()).toBe(201);
      return (await response.json() as { task: { id: string } }).task.id;
    }
    const overdueId = await createTask(
      "Return Ada's book",
      new Date(now - 48 * 60 * 60_000).toISOString(),
    );
    await createTask(
      "Review Ada's update today",
      `${attentionBody.date}T12:00:00.000Z`,
    );
    await createTask(
      "Plan Ada's call",
      new Date(now + 48 * 60 * 60_000).toISOString(),
    );
    await createTask(
      "Prepare Ada's visit",
      new Date(now + 14 * 24 * 60 * 60_000).toISOString(),
    );
    expect((await page.request.post(`${origin}/api/v1/interactions`, {
      data: {
        body: "Grace prefers concise written updates.",
        isFavorited: true,
        kind: "note",
        personId: graceId,
        requestId: crypto.randomUUID(),
      },
      headers: { origin },
    })).status()).toBe(201);
    expect((await page.request.post(`${origin}/api/v1/interactions`, {
      data: {
        happenedAt: new Date(now - 60_000).toISOString(),
        kind: "activity",
        participantIds: [graceId, katherineId],
        requestId: crypto.randomUUID(),
        summary: "Reviewed Grace's compiler notes",
      },
      headers: { origin },
    })).status()).toBe(201);

    await page.goto("/app");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "app.today",
    );
    await expect(page.locator("#app-toasts > li")).toHaveCount(0);
    await page.reload();
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "app.today",
    );
    await expect(page.locator("#app-toasts > li")).toHaveCount(0);
    await expect(page.locator("main#main-content > section h2")).toHaveText([
      "Needs attention",
      "People to reconnect",
      "Upcoming",
      "Recently viewed people",
      "Favorite notes",
      "Recent activity",
    ]);
    await expect(page.locator("[data-today-date]")).toHaveAttribute(
      "datetime",
      attentionBody.date,
    );
    await expect(page.getByRole("heading", { name: "Today", exact: true }))
      .toBeVisible();
    const overdue = page.locator("#today-overdue-list li", {
      hasText: "Return Ada's book",
    });
    const nextSeven = page.locator("#today-next-seven-list li", {
      hasText: "Plan Ada's call",
    });
    const dueToday = page.locator("#today-due-today-list li", {
      hasText: "Review Ada's update today",
    });
    const upcoming = page.locator("#today-upcoming-list li", {
      hasText: "Prepare Ada's visit",
    });
    await expect(overdue).toBeVisible();
    await expect(dueToday).toBeVisible();
    await expect(nextSeven).toBeVisible();
    await expect(upcoming).toBeVisible();
    const cadence = page.locator("#today-cadences-list li", {
      hasText: "Ada Lovelace",
    });
    await expect(cadence).toContainText("No contact recorded");
    const recentPerson = page.locator("#today-recent-people-list li", {
      hasText: "Ada Lovelace",
    });
    const favorite = page.locator("#today-favorite-notes li", {
      hasText: "Grace prefers concise written updates.",
    });
    const seedActivity = page.locator("#today-recent-activity li", {
      hasText: "Reviewed Grace's compiler notes",
    });
    await expect(recentPerson).toBeVisible();
    await expect(favorite).toBeVisible();
    await expect(seedActivity).toBeVisible();
    await expect(favorite.getByRole("link", { name: "Grace Hopper" }))
      .toHaveAttribute("href", `/app/people/${graceId}`);
    const recentNote = page.locator("#today-recent-activity li", {
      hasText: "Grace prefers concise written updates.",
    });
    await expect(recentNote.getByRole("link", { name: "Grace Hopper" }))
      .toHaveAttribute("href", `/app/people/${graceId}`);
    for (
      const [name, id] of [
        ["Grace Hopper", graceId],
        ["Katherine Johnson", katherineId],
      ] as const
    ) {
      const participant = seedActivity.getByRole("link", { name, exact: true });
      await expect(participant).toHaveAttribute("href", `/app/people/${id}`);
      await participant.click();
      await expect(page).toHaveURL(`/app/people/${id}`);
      await expect(page.getByRole("heading", { name, exact: true }))
        .toBeVisible();
      await page.goBack();
      await expect(page).toHaveURL(/\/app$/);
      await expect(seedActivity).toBeVisible();
    }

    const openAllTasks = page.getByRole("link", { name: "Open all tasks" });
    const openAllPresentation = await openAllTasks.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        alignItems: style.alignItems,
        boxShadow: style.boxShadow,
        display: style.display,
        minHeight: style.minHeight,
        outlineOffset: style.outlineOffset,
        paddingRight: style.paddingRight,
        textDecorationLine: style.textDecorationLine,
      };
    });
    expect(openAllPresentation).toMatchObject({
      alignItems: "center",
      textDecorationLine: "none",
    });
    expect(["flex", "inline-flex"]).toContain(openAllPresentation.display);
    expect(Number.parseFloat(openAllPresentation.minHeight))
      .toBeGreaterThanOrEqual(
        44,
      );
    expect(Number.parseFloat(openAllPresentation.paddingRight)).toBeGreaterThan(
      0,
    );
    if (browserName === "webkit") {
      // Exercise focus presentation with an explicit WebKit fixture tab stop;
      // default implicit-anchor reachability is outside this assertion.
      await openAllTasks.evaluate((element) => element.tabIndex = 0);
    }
    await openAllTasks.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    await expect(openAllTasks).toBeFocused();
    expect(
      await openAllTasks.evaluate((element) =>
        element.matches(":focus-visible")
      ),
    )
      .toBe(true);
    const focusedOpenAll = await openAllTasks.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        boxShadow: style.boxShadow,
        outlineOffset: style.outlineOffset,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      };
    });
    expect(focusedOpenAll).toMatchObject({
      outlineOffset: "2px",
      outlineStyle: "solid",
      outlineWidth: "2px",
    });
    expect(focusedOpenAll.boxShadow).not.toContain("inset");
    await openAllTasks.click();
    await expect(page).toHaveURL(/\/app\/tasks$/);
    const stateFilter = page.locator("[data-task-status-filter]");
    await expect(stateFilter).toHaveCSS("min-height", "44px");
    await expect(stateFilter).toHaveCSS("cursor", "pointer");
    const filterColors = await stateFilter.evaluate((element) => {
      const normalizeColor = (value: string): string => {
        const probe = document.createElement("span");
        probe.style.color = value.trim();
        document.body.append(probe);
        const normalized = getComputedStyle(probe).color;
        probe.remove();
        return normalized;
      };
      return {
        background: normalizeColor(getComputedStyle(element).backgroundColor),
        surface: normalizeColor(
          getComputedStyle(document.documentElement).getPropertyValue(
            "--surface-1",
          ),
        ),
      };
    });
    expect(filterColors.background).toBe(filterColors.surface);
    await stateFilter.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    // A focused select keeps a flush outline and shows the focus halo.
    await expect(stateFilter).toHaveCSS("outline-offset", "0px");
    await expect(stateFilter).toHaveCSS("outline-style", "solid");
    expect(
      await stateFilter.evaluate((element) =>
        getComputedStyle(element).boxShadow
      ),
    ).not.toContain("inset");
    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);

    const taskLink = nextSeven.getByRole("link", { name: "Plan Ada's call" });
    await expect(taskLink).toHaveAttribute(
      "href",
      `/app/people/${adaId}?section=tasks`,
    );
    await taskLink.click();
    await expect(page).toHaveURL(`/app/people/${adaId}?section=tasks`);
    await expect(page.locator("#profile-section-tasks")).toHaveAttribute(
      "data-section-state",
      "ready",
    );
    await page.goBack();
    await expect(page).toHaveURL(/\/app$/);
    await expect(page.locator("#today-recent-activity li", {
      hasText: "Reviewed Grace's compiler notes",
    })).toBeVisible();

    const preserved = [
      ["cadence", "#today-cadences-list li", "Ada Lovelace"],
      ["recent-person", "#today-recent-people-list li", "Ada Lovelace"],
      ["favorite", "#today-favorite-notes li", "Grace prefers concise"],
      ["activity", "#today-recent-activity li", "Reviewed Grace's compiler"],
    ] as const;
    const preservedText = new Map<string, string>();
    for (const [marker, selector, text] of preserved) {
      const row = page.locator(selector, { hasText: text });
      preservedText.set(marker, await row.innerText());
      await row.evaluate((element, value) => {
        (element as HTMLElement).dataset.todayFlowMarker = value;
      }, marker);
    }
    const completion = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/tasks/${overdueId}/completion`) &&
      response.request().method() === "PUT"
    );
    await page.locator("#today-overdue-list li", {
      hasText: "Return Ada's book",
    }).getByRole("button", { name: "Complete" }).click();
    expect((await completion).status()).toBe(200);
    await expect(page.locator("#today-overdue-list li", {
      hasText: "Return Ada's book",
    })).toHaveCount(0);
    for (const [marker] of preserved) {
      const row = page.locator(`[data-today-flow-marker="${marker}"]`);
      await expect(row).toHaveCount(1);
      expect(await row.innerText()).toBe(preservedText.get(marker));
    }
    await expect(page.locator("#today-upcoming-list li", {
      hasText: "Prepare Ada's visit",
    })).toBeVisible();

    const cadenceBeforeResponse = await page.request.get(
      `${origin}/api/v1/today/reminders`,
    );
    expect(cadenceBeforeResponse.status()).toBe(200);
    const cadenceBefore = (await cadenceBeforeResponse.json() as {
      cadences: Array<{
        dueAt: string;
        lastContactedAt?: string;
        person: { id: string };
      }>;
    }).cadences.find((item) => item.person.id === adaId);
    expect(cadenceBefore?.lastContactedAt).toBeUndefined();

    const reconnect = page.locator("#today-cadences-list li", {
      hasText: "Ada Lovelace",
    }).getByRole("button", { name: "Log interaction" });
    await expect(reconnect).toBeEnabled();
    await reconnect.click();
    const capture = page.getByRole("dialog", {
      name: "Record an activity or note",
    });
    await expect(capture).toBeVisible();
    await expect(capture.getByLabel("What are you recording?"))
      .toHaveValue("activity");
    await expect(capture.getByLabel("Participants", { exact: true }))
      .toHaveValue(adaId);
    await expect(capture.getByLabel("Summary")).toBeFocused();
    await capture.getByLabel("Summary").fill("Reconnected with Ada");
    const advancedOccurrence = await page.evaluate(() => {
      const date = new Date(Date.now() + 2 * 60_000);
      return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
        .toISOString().slice(0, 16);
    });
    await capture.getByLabel("When it happened").fill(advancedOccurrence);
    const interaction = page.waitForResponse((response) =>
      response.url().endsWith("/api/v1/interactions") &&
      response.request().method() === "POST"
    );
    await capture.getByRole("button", { name: "Save interaction" }).click();
    expect((await interaction).status()).toBe(201);
    await expect(capture).toBeHidden();
    await expect(page.locator("#today-cadences-list li", {
      hasText: "Ada Lovelace",
    })).toContainText("Last contact");
    await expect(page.locator("#today-next-seven-list li", {
      hasText: "Reconnect with Ada Lovelace",
    })).toContainText("Last contact");
    await expect(page.locator("#today-recent-activity li", {
      hasText: "Reconnected with Ada",
    })).toBeVisible();
    await expect(page.locator("#today-cadences-state")).toBeFocused();
    await expect.poll(async () => {
      const response = await page.request.get(
        `${origin}/api/v1/today/reminders`,
      );
      const body = await response.json() as {
        cadences?: Array<{
          dueAt: string;
          lastContactedAt?: string;
          person: { id: string };
        }>;
      };
      const current = body.cadences?.find((item) => item.person.id === adaId);
      return Boolean(
        current?.lastContactedAt && cadenceBefore &&
          Date.parse(current.dueAt) > Date.parse(cadenceBefore.dueAt),
      );
    }).toBe(true);
    expect(
      await page.locator('[data-today-flow-marker="favorite"]').innerText(),
    ).toBe(preservedText.get("favorite"));

    const personLink = page.locator("#today-recent-people-list").getByRole(
      "link",
      { name: "Ada Lovelace" },
    );
    await expect(personLink).toHaveAttribute("href", `/app/people/${adaId}`);
    await personLink.click();
    await expect(page).toHaveURL(`/app/people/${adaId}`);
    await expect(page.getByRole("heading", { name: "Ada Lovelace" }))
      .toBeVisible();

    await page.route("**/api/v1/today/favorite-notes", async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          code: "today_favorite_notes_unavailable",
          detail: "Favorite notes are temporarily unavailable.",
          status: 503,
          title: "Favorite notes unavailable",
          type: "about:blank",
        }),
        contentType: "application/problem+json",
        status: 503,
      });
    }, { times: 1 });
    await page.goto("/app");
    await expect(page.locator("#today-favorite-notes-state")).toContainText(
      "Favorite notes could not be loaded",
    );
    const favoriteRetry = page.getByRole("button", {
      name: "Retry favorite notes",
    });
    await expect(favoriteRetry).toBeVisible();
    await expect(
      page.locator("#today-next-seven-list li", {
        hasText: "Plan Ada's call",
      }).getByRole("button", { name: "Complete" }),
    ).toBeEnabled();
    await expect(page.locator("#today-upcoming-list li", {
      hasText: "Prepare Ada's visit",
    })).toBeVisible();
    await expect(page.locator("#today-recent-activity li", {
      hasText: "Reconnected with Ada",
    })).toBeVisible();
    await favoriteRetry.click();
    await expect(page.locator("#today-favorite-notes li", {
      hasText: "Grace prefers concise written updates.",
    })).toBeVisible();
    await expect(favoriteRetry).toBeHidden();

    // REL-088: an email reminder that was never delivered can be dismissed.
    const session = await (await page.request.get(`${origin}/api/v1/session`))
      .json() as { member: { id: string }; workspace: { id: string } };
    const undeliveredReminderId = crypto.randomUUID();
    const undeliveredId = crypto.randomUUID();
    const undeliveredTitle = "Send Ada the conference notes";
    const undeliveredAt = new Date(Date.now() - 86_400_000).toISOString();
    databaseSql(
      `insert into crm.reminders (id, workspace_id, person_id, target_kind, title, anchor_on, created_by_member_id) values (${
        sqlLiteral(undeliveredReminderId)
      }::uuid, ${sqlLiteral(session.workspace.id)}::uuid, ${
        sqlLiteral(adaId)
      }::uuid, 'person', ${sqlLiteral(undeliveredTitle)}, '${
        undeliveredAt.slice(0, 10)
      }', ${sqlLiteral(session.member.id)}::uuid);
    insert into crm.reminder_occurrences (id, reminder_id, member_id, occurs_on, deliver_at, channel, status, attempt_count, title_snapshot) values (${
        sqlLiteral(undeliveredId)
      }::uuid, ${sqlLiteral(undeliveredReminderId)}::uuid, ${
        sqlLiteral(session.member.id)
      }::uuid, '${
        undeliveredAt.slice(0, 10)
      }', '${undeliveredAt}', 'email', 'failed', 1, ${
        sqlLiteral(undeliveredTitle)
      });`,
    );
    await page.reload();
    const undelivered = page.locator("#today-overdue-list li", {
      hasText: undeliveredTitle,
    });
    await expect(undelivered).toContainText("Email reminder not delivered");
    const acknowledgement = page.waitForResponse((response) =>
      response.url().endsWith(
        `/api/v1/reminder-occurrences/${undeliveredId}/acknowledgement`,
      ) && response.request().method() === "PUT"
    );
    await undelivered.getByRole("button", {
      name: `Dismiss ${undeliveredTitle}`,
    }).click();
    expect((await acknowledgement).status()).toBe(200);
    await expect(undelivered).toHaveCount(0);
    await page.reload();
    await expect(page.locator("#today-attention-state")).not.toContainText(
      "Loading",
    );
    await expect(page.locator("#today-overdue-list li", {
      hasText: undeliveredTitle,
    })).toHaveCount(0);
    await expectAccessible(page);
  },
);

/** One layout shift the page reported without recent input (FER-06). */
interface RecordedShift {
  readonly value: number;
  readonly at: number;
  readonly sources: readonly string[];
}

test(
  "[TODAY-001] Today does not shift while it loads",
  { annotation: [{ type: "flow", description: "TODAY-001" }] },
  async ({ browserName, page, request }) => {
    test.setTimeout(180_000);
    const email = `today-shift-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Shift",
      lastName: "Reviewer",
      workspaceName: "Steady Today",
    }, bareToken);
    await submitSignIn(page, email);

    // A busy workspace: a long attention queue, people to reconnect with,
    // upcoming work, recently viewed people, favorite notes, and activity.
    const names = [
      ["Ada", "Lovelace"],
      ["Grace", "Hopper"],
      ["Katherine", "Johnson"],
      ["Dorothy", "Vaughan"],
      ["Mary", "Jackson"],
      ["Hedy", "Lamarr"],
    ] as const;
    const people: string[] = [];
    for (const [givenName, familyName] of names) {
      people.push(await createPerson(page.request, { givenName, familyName }));
    }
    const post = async (path: string, data: Record<string, unknown>) => {
      const response = await page.request.post(`${origin}/api/v1${path}`, {
        data: { requestId: crypto.randomUUID(), ...data },
        headers: { origin },
      });
      expect(response.status(), path).toBeLessThan(300);
    };
    for (const personId of people.slice(0, 4)) {
      await post("/stay-in-touch-cadences", {
        intervalCount: 1,
        intervalUnit: "day",
        personId,
      });
    }
    const hour = 60 * 60_000;
    const now = Date.now();
    const dues = [
      -96,
      -72,
      -50,
      -26,
      2,
      30,
      54,
      78,
      102,
      126,
      14 * 24,
      18 * 24,
      22 * 24,
    ];
    for (const [index, offset] of dues.entries()) {
      await post("/tasks", {
        dueAt: new Date(now + offset * hour).toISOString(),
        personId: people[index % people.length],
        title: `Follow up on the shared project, part ${index + 1}`,
      });
    }
    for (const [index, personId] of people.slice(0, 4).entries()) {
      await post("/interactions", {
        body: `Prefers written updates and a short agenda before calls (${
          index + 1
        }).`,
        isFavorited: true,
        kind: "note",
        personId,
      });
    }
    for (let index = 0; index < 8; index += 1) {
      await post("/interactions", {
        happenedAt: new Date(now - (index + 1) * hour).toISOString(),
        kind: "activity",
        participantIds: [people[index % people.length]],
        summary: `Caught up over coffee about the next steps (${index + 1})`,
      });
    }
    for (const personId of people.slice(0, 5)) {
      expect((await page.request.post(
        `${origin}/api/v1/people/${personId}/view`,
        { headers: { origin } },
      )).status()).toBe(200);
    }

    await page.addInitScript(() => {
      const shifts: RecordedShift[] = [];
      const supported = PerformanceObserver.supportedEntryTypes?.includes(
        "layout-shift",
      ) ?? false;
      Object.assign(globalThis, {
        __todayShifts: shifts,
        __todayShiftSupported: supported,
      });
      // Only Chromium reports layout shifts; elsewhere nothing is measured.
      if (!supported) return;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const shift = entry as PerformanceEntry & {
            hadRecentInput: boolean;
            value: number;
            sources?: ReadonlyArray<{ node?: Node | null }>;
          };
          if (shift.hadRecentInput) continue;
          shifts.push({
            at: Math.round(shift.startTime),
            sources: (shift.sources ?? []).map(({ node }) =>
              node instanceof Element
                ? `${node.tagName.toLowerCase()}${
                  node.id ? `#${node.id}` : ""
                }${
                  node.className && typeof node.className === "string"
                    ? `.${node.className.trim().split(/\s+/).join(".")}`
                    : ""
                }`
                : String(node?.nodeName ?? "?")
            ),
            value: shift.value,
          });
        }
      }).observe({ type: "layout-shift", buffered: true });
    });

    const states = [
      "#today-attention-state",
      "#today-upcoming-state",
      "#today-cadences-state",
      "#today-reminders-state",
      "#today-recent-people-state",
      "#today-favorite-notes-state",
      "#today-recent-activity-state",
    ];
    for (
      const viewport of [
        { height: 768, width: 1366 },
        { height: 915, width: 412 },
      ]
    ) {
      await page.setViewportSize(viewport);
      await page.goto("/app");
      for (const state of states) {
        await expect(page.locator(state)).not.toHaveText(/Loading/);
      }
      await expect(page.locator("[data-today-date]")).not.toHaveText(
        /Loading/,
      );
      await expect(page.locator("#today-recent-activity li")).toHaveCount(12);
      // Let anything the answers start (fonts, images, the shell) land.
      await page.evaluate(() =>
        new Promise((resolve) => setTimeout(resolve, 1_500))
      );
      const { shifts, supported } = await page.evaluate(() => {
        const recorded = globalThis as unknown as {
          __todayShifts: RecordedShift[];
          __todayShiftSupported: boolean;
        };
        return {
          shifts: recorded.__todayShifts,
          supported: recorded.__todayShiftSupported,
        };
      });
      if (browserName === "chromium") {
        // A broken observer must fail loudly, never pass with nothing seen.
        expect(supported, "Chromium reports layout-shift entries").toBe(true);
      }
      if (!supported) {
        if (viewport.width === 1366) {
          test.info().annotations.push({
            type: "layout-shift",
            description:
              `not measured: ${browserName} reports no layout-shift entries`,
          });
        }
        continue;
      }
      const total = shifts.reduce((sum, shift) => sum + shift.value, 0);
      expect.soft(
        total,
        `layout shift at ${viewport.width}x${viewport.height}: ${
          JSON.stringify(shifts)
        }`,
      ).toBeLessThan(0.1);
    }
    // The long queue paints its first five priorities and expands in place.
    const queue = page.locator(".attention-groups li");
    await expect(queue).toHaveCount(5);
    const showAll = page.getByRole("button", {
      name: /^Show all \d+ priorities$/,
    });
    await expect(showAll).toHaveAttribute("aria-expanded", "false");
    await showAll.click();
    await expect(page.getByRole("button", { name: "Show fewer" }))
      .toHaveAttribute("aria-expanded", "true");
    expect(await queue.count()).toBeGreaterThan(5);
    await expect(page).toHaveURL(/\/app$/);
    await expectAccessible(page);
  },
);
