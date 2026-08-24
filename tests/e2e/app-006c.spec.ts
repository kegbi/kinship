import { expect, test } from "@playwright/test";
import axe from "axe-core";

const mailOrigin = process.env.TEST_MAIL_ORIGIN ?? "http://127.0.0.1:18025";
const origin = process.env.TEST_WEB_ORIGIN ?? "http://127.0.0.1:4321";
const password = "correct horse battery staple";

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
    expect((await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Today",
        lastName: "Reviewer",
        password,
        workspaceName: "Today circle",
      },
    })).status()).toBe(202);
    let token = "";
    await expect.poll(async () => {
      const search = await request.get(
        `${mailOrigin}/api/v1/search?query=${
          encodeURIComponent(`to:${email}`)
        }`,
      );
      const messages = (await search.json() as {
        messages?: Array<{ ID: string }>;
      }).messages ?? [];
      for (const message of messages) {
        const detail = await request.get(
          `${mailOrigin}/api/v1/message/${message.ID}`,
        );
        token = ((await detail.json() as { Text?: string }).Text ?? "").match(
          /token=([^\s]+)/,
        )?.[1] ?? token;
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

    const preferencesResponse = await page.request.get(
      `${origin}/api/v1/settings/preferences`,
    );
    expect(preferencesResponse.status()).toBe(200);
    const preferences = (await preferencesResponse.json() as {
      preferences: Record<string, unknown>;
    }).preferences;
    expect((await page.request.put(`${origin}/api/v1/settings/preferences`, {
      data: { ...preferences, timezone: "Europe/Belgrade" },
      headers: { origin },
    })).status()).toBe(200);

    async function createPerson(givenName: string, familyName: string) {
      const response = await page.request.post(`${origin}/api/v1/people`, {
        data: { givenName, familyName, isPartial: false },
        headers: { origin },
      });
      expect(response.status()).toBe(201);
      return (await response.json() as { person: { id: string } }).person.id;
    }
    const adaId = await createPerson("Ada", "Lovelace");
    const graceId = await createPerson("Grace", "Hopper");
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
        participantIds: [graceId],
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
    await expect(page.locator("#shell-status")).toBeEmpty();
    await page.reload();
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "app.today",
    );
    await expect(page.locator("#shell-status")).toBeEmpty();
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
    await openAllTasks.focus();
    const focusedOpenAll = await openAllTasks.evaluate((element) => {
      const style = getComputedStyle(element);
      return { boxShadow: style.boxShadow, outlineOffset: style.outlineOffset };
    });
    expect(focusedOpenAll.outlineOffset).not.toBe("3px");
    expect(focusedOpenAll.boxShadow).toContain("inset");
    await openAllTasks.click();
    await expect(page).toHaveURL(/\/app\/tasks$/);
    const stateFilter = page.locator("[data-task-status-filter]");
    await expect(stateFilter).toHaveCSS("min-height", "44px");
    await expect(stateFilter).toHaveCSS("cursor", "pointer");
    await expect(stateFilter).toHaveCSS(
      "background-color",
      "rgb(255, 255, 255)",
    );
    await stateFilter.focus();
    await expect(stateFilter).toHaveCSS("outline-offset", "0px");
    expect(
      await stateFilter.evaluate((element) =>
        getComputedStyle(element).boxShadow
      ),
    ).toContain("inset");
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
    await page.addScriptTag({ content: axe.source });
    expect(
      await page.evaluate(async () =>
        (await (globalThis as typeof globalThis & {
          axe: { run(): Promise<{ violations: unknown[] }> };
        }).axe.run()).violations
      ),
    ).toEqual([]);
  },
);
