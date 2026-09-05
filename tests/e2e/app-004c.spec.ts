import {
  type APIRequestContext,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test";
import axe from "axe-core";
import { randomUUID } from "node:crypto";
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
  expect(
    (await request.post(`${origin}/api/v1/registrations`, {
      data: {
        email,
        firstName: "Facts",
        lastName: "Writer",
        password,
        workspaceName: "Profile facts circle",
      },
    })).status(),
  ).toBe(202);
  expect(
    (await request.post(`${origin}/api/v1/email-verifications`, {
      data: { token: await verificationToken(request, email) },
    })).status(),
  ).toBe(200);
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/auth/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/app$/);
}

async function openPersonMenu(page: Page): Promise<void> {
  const toggle = page.getByRole("button", { name: "Open person menu" });
  if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

async function expectAccessible(page: Page): Promise<void> {
  await page.addScriptTag({ content: axe.source });
  expect(
    await page.evaluate(async () =>
      (await (globalThis as typeof globalThis & {
        axe: { run(): Promise<{ violations: unknown[] }> };
      }).axe.run()).violations
    ),
  ).toEqual([]);
}

async function openLocalEditor(
  trigger: Locator,
  editor: Locator,
): Promise<void> {
  await expect(trigger).toHaveCount(1);
  await expect(editor).toHaveCount(1);
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await expect(editor).toBeVisible();
}

async function controlPresentation(control: Locator) {
  await expect(control).toBeVisible();
  return await control.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      alignItems: style.alignItems,
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      borderRadius: style.borderRadius,
      borderStyle: style.borderStyle,
      borderWidth: style.borderWidth,
      color: style.color,
      display: style.display,
      fontFamily: style.fontFamily,
      height: element.getBoundingClientRect().height,
      justifyContent: style.justifyContent,
      minHeight: style.minHeight,
      paddingBottom: style.paddingBottom,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      paddingTop: style.paddingTop,
    };
  });
}

async function expectAlignedControls(
  first: Locator,
  second: Locator,
): Promise<void> {
  const [firstStyle, secondStyle] = await Promise.all([
    controlPresentation(first),
    controlPresentation(second),
  ]);
  expect(Math.abs(firstStyle.height - secondStyle.height)).toBeLessThanOrEqual(
    0.5,
  );
  for (
    const property of [
      "alignItems",
      "borderRadius",
      "borderStyle",
      "borderWidth",
      "display",
      "fontFamily",
      "justifyContent",
      "minHeight",
      "paddingBottom",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
    ] as const
  ) {
    expect(firstStyle[property]).toBe(secondStyle[property]);
  }
}

test(
  "[PEOPLE-006] APR-006 keeps profile summaries truthful after local edits",
  { annotation: { type: "flow", description: "PEOPLE-006" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(120_000);
    const email = `profile-summary-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(email)
      }`,
    );
    const tagIds = Array.from({ length: 12 }, () => randomUUID());
    databaseSql(
      `insert into crm.tags (id, workspace_id, name, slug) values ${
        tagIds.map((id, index) =>
          `('${id}'::uuid, '${workspaceId}'::uuid, 'Summary tag ${index}', 'summary-${id}')`
        ).join(",")
      }`,
    );
    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Truthful");
    await page.getByLabel("Family name").fill("Summary");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    const profilePath = new URL(page.url()).pathname;
    const heroCadence = page.locator("#person-profile-due-state");
    const nextReminder = page.locator(
      '[data-person-vital-value="next-reminder"]',
    );
    const tags = page.locator('[data-profile-fact-section="tags"]');
    await expect(heroCadence).toHaveText("Not set");
    await expect(nextReminder).toHaveText("Not recorded");
    await expect(tags.locator("[data-profile-fact-state]")).toHaveText(
      "No tags saved.",
    );
    await expect(page.locator("#person-profile-tags")).toHaveText(
      "No tags saved",
    );
    await page.getByRole("button", { name: "Show all sections" }).click();

    const tasks = page.locator("#profile-section-tasks");
    await tasks.getByRole("button", { name: "Add task", exact: true }).click();
    await tasks.getByLabel("Title", { exact: true }).fill("Send a letter");
    await tasks.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(tasks.locator("[data-task-open-list]")).toContainText(
      "Send a letter",
    );
    // The task-only profile response must leave cadence unset.
    await page.goto(`${profilePath}?section=tasks`);
    await expect(heroCadence).toHaveText("Not set");
    await expect(nextReminder).toHaveText("Not recorded");
    await tasks.locator("[data-task-open-list]").getByRole("button", {
      name: "Complete",
      exact: true,
    }).click();
    await expect(tasks.locator("[data-task-completed-list]")).toContainText(
      "Send a letter",
    );

    const reminders = page.locator("#profile-section-reminders");
    await reminders.getByRole("button", { name: "Add reminder", exact: true })
      .click();
    const reminderForm = reminders.locator("[data-reminder-form]");
    await reminderForm.getByLabel("Title", { exact: true }).fill(
      "Reconnect soon",
    );
    const targetDate = new Date(Date.now() + 7 * 86_400_000).toISOString()
      .slice(0, 10);
    await reminderForm.getByLabel("First date").fill(targetDate);
    await reminderForm.getByLabel("Send time").fill("09:00");
    await reminderForm.getByLabel("Repeat").selectOption("none");
    await reminderForm.getByRole("button", {
      name: "Save reminder",
      exact: true,
    }).click();
    await expect(reminders.locator("[data-reminder-state]")).toHaveText(
      "1 reminder.",
    );
    await expect(nextReminder).not.toHaveText(
      /Not recorded|Refreshing|Unavailable/,
    );
    await expect(nextReminder).not.toHaveText(/\d{4}-\d{2}-\d{2}T/);
    await expect(heroCadence).toHaveText("Not set");

    const cadence = page.locator("#profile-section-stay-in-touch");
    await cadence.getByRole("button", {
      name: "Add stay-in-touch cadence",
      exact: true,
    }).click();
    await cadence.getByLabel("Reconnect every").fill("2");
    await cadence.getByLabel("Calendar unit").selectOption("week");
    await cadence.getByRole("button", { name: "Save cadence", exact: true })
      .click();
    await expect(heroCadence).toHaveText("Every 2 weeks");
    await tags.getByRole("button", { name: "Edit tags", exact: true }).click();
    const selectedTags = tags.locator('select[name="tagIds"]');
    await expect(selectedTags.locator("option")).toHaveCount(12);
    await selectedTags.selectOption(tagIds);
    await tags.getByRole("button", { name: "Save profile fact", exact: true })
      .click();
    await expect(tags.locator("[data-profile-fact-state]")).toHaveText(
      "12 tags saved. Profile fact saved.",
    );
    await expect(page.locator("#person-profile-tags")).toContainText("+4 more");
    await expect(page.locator("#person-profile-tags")).not.toContainText(
      "No tags saved",
    );
    await tags.getByRole("button", { name: "Edit tags", exact: true }).click();
    await selectedTags.selectOption([]);
    await tags.getByRole("button", { name: "Save profile fact", exact: true })
      .click();
    await expect(tags.locator("[data-profile-fact-state]")).toHaveText(
      "No tags saved. Profile fact saved.",
    );
    await expect(page.locator("#person-profile-tags")).toHaveText(
      "No tags saved",
    );
    await reminders.getByRole("button", {
      name: "Add reminder",
      exact: true,
    }).click();
    await reminderForm.getByLabel("Title", { exact: true }).fill(
      "Second reminder",
    );
    await reminderForm.getByLabel("First date").fill(targetDate);
    await reminderForm.getByLabel("Send time").fill("10:00");
    await reminderForm.getByLabel("Repeat").selectOption("none");
    await reminderForm.getByRole("button", {
      name: "Save reminder",
      exact: true,
    }).click();
    await expect(reminders.locator("[data-reminder-state]")).toHaveText(
      "2 reminders.",
    );
    const firstDisable = reminders.locator("li", { hasText: "Reconnect soon" })
      .getByRole("button", { name: "Disable reminder", exact: true });
    const secondDisable = reminders.locator("li", {
      hasText: "Second reminder",
    }).getByRole("button", { name: "Disable reminder", exact: true });
    let releaseSummary!: () => void;
    const summaryReleased = new Promise<void>((resolve) =>
      releaseSummary = resolve
    );
    let summaryWaiting = false;
    await page.route("**/api/v1/people/*?include=summary", async (route) => {
      const upstream = await route.fetch();
      summaryWaiting = true;
      await summaryReleased;
      await route.fulfill({ response: upstream });
    }, { times: 1 });
    try {
      await firstDisable.click();
      await expect.poll(() => summaryWaiting).toBe(true);
      await expect(secondDisable).toBeDisabled();
      await expect(reminderForm.locator('button[type="submit"]'))
        .toBeDisabled();
      await expect(cadence.locator('[data-cadence-form] button[type="submit"]'))
        .toBeDisabled();
      await expect(reminders).toHaveAttribute("aria-busy", "true");
      await expect(nextReminder).toHaveText("Refreshing…");
    } finally {
      releaseSummary();
    }
    await expect(secondDisable).toBeEnabled();
    await secondDisable.click();
    await expect(nextReminder).toHaveText("Not recorded");
    await expect(heroCadence).toHaveText("Every 2 weeks");
  },
);

test(
  "[PEOPLE-006] APR-004 keeps mobile fact sheets modal and restores editor focus",
  { annotation: { type: "flow", description: "PEOPLE-006" } },
  async ({ browserName, page, request }, testInfo) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `mobile-editors-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);
    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Mobile");
    await page.getByLabel("Family name").fill("Editors");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    await expect(
      page.locator('.profile-facts-rail [data-section-state="loading"]'),
    ).toHaveCount(0);
    const food = page.locator("#profile-section-food-preferences");
    const foodForm = food.locator("form");
    const foodAdd = food.getByRole("button", {
      name: "Add food preferences",
      exact: true,
    });
    const foodField = foodForm.getByLabel(
      "Food, allergy, and dietary preferences",
    );
    let acceptDiscard = false;
    let decisions = 0;
    page.on("dialog", async (dialog) => {
      expect(dialog.message()).toBe(
        "You have unsaved changes in this editor. Discard them and close the editor?",
      );
      decisions++;
      if (acceptDiscard) await dialog.accept();
      else await dialog.dismiss();
    });

    // Every existing rail consumer receives the same presentation boundary.
    for (
      const section of [
        "food-preferences",
        "pets",
        "important-dates",
        "stay-in-touch",
        "relationships",
        "contact-methods",
        "addresses",
        "first-meeting",
        "work",
      ]
    ) {
      const block = page.locator(`#profile-section-${section}`);
      const opener = block.locator(".profile-rail-add");
      const form = block.locator("form");
      const title = await block.locator(".profile-section-heading h3")
        .innerText();
      await expect(opener).toBeVisible();
      await expect(opener).toBeEnabled();
      await openLocalEditor(opener, form);
      const sheet = page.getByRole("dialog", { name: title, exact: true });
      await expect(sheet).toBeVisible();
      await expect(sheet).toHaveAttribute("aria-modal", "true");
      expect(await sheet.evaluate((element) => element.matches(":modal")))
        .toBe(true);
      const first = form.locator(
        "input:not([type=hidden]):visible:enabled, select:visible:enabled, textarea:visible:enabled, button:visible:enabled",
      ).first();
      const cancel = form.getByRole("button", { name: "Cancel", exact: true });
      await first.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(cancel).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(first).toBeFocused();
      // Native modality must reject background focus, not only intercept Tab.
      await opener.evaluate((element) => (element as HTMLElement).focus());
      await expect(first).toBeFocused();
      if (section === "food-preferences") {
        await expectAccessible(page);
        const scroll = await page.evaluate(() => scrollY);
        await page.mouse.click(5, 5);
        await page.mouse.wheel(0, 500);
        await expect(sheet).toBeVisible();
        expect(await page.evaluate(() => scrollY)).toBe(scroll);
      }
      await page.keyboard.press("Escape");
      await expect(form).toBeHidden();
      await expect(opener).toBeFocused();
    }
    expect(decisions).toBe(0);

    await openLocalEditor(foodAdd, foodForm);
    await foodField.fill("Keep this draft");
    await page.keyboard.press("Escape");
    await expect.poll(() => decisions).toBe(1);
    await expect(foodField).toHaveValue("Keep this draft");
    await expect(foodField).toBeFocused();
    acceptDiscard = true;
    await page.keyboard.press("Escape");
    await expect.poll(() => decisions).toBe(2);
    await expect(foodForm).toBeHidden();
    await expect(foodAdd).toBeFocused();
    await openLocalEditor(foodAdd, foodForm);
    await expect(foodField).toHaveValue("");
    await foodField.fill("Cancel explicitly discards");
    await foodForm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(foodAdd).toBeFocused();
    expect(decisions).toBe(2);

    // Resizing preserves the same form, draft, and focused control.
    await openLocalEditor(foodAdd, foodForm);
    await foodField.fill("Saved food preference");
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(foodField).toBeFocused();
    expect(
      await foodForm.evaluate((element) => getComputedStyle(element).position),
    ).toBe("static");
    await page.setViewportSize({ width: 320, height: 568 });
    await expect(
      page.getByRole("dialog", { name: "Food preferences", exact: true }),
    ).toBeVisible();
    await expect(foodField).toBeFocused();
    await expect(foodField).toHaveValue("Saved food preference");
    let releaseSave!: () => void;
    const saveBlocked = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    await page.route("**/facts/food-preferences", async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await saveBlocked;
      await route.fulfill({
        status: 503,
        contentType: "application/problem+json",
        body: JSON.stringify({
          type: "about:blank",
          title: "Temporarily unavailable",
          status: 503,
          detail: "Mobile save is temporarily unavailable.",
        }),
      });
    });
    acceptDiscard = false;
    await foodForm.getByRole("button", {
      name: "Save profile fact",
      exact: true,
    }).click();
    await expect(foodForm).toHaveAttribute("inert", "");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Food preferences", exact: true }),
    ).toBeVisible();
    expect(decisions).toBe(2);
    releaseSave();
    await expect(foodForm.locator("[data-profile-fact-form-state]")).toHaveText(
      "Mobile save is temporarily unavailable.",
    );
    await expect(foodForm.locator("[data-profile-fact-form-state]"))
      .toBeFocused();
    await page.keyboard.press("Escape");
    await expect.poll(() => decisions).toBe(3);
    await expect(foodField).toHaveValue("Saved food preference");
    await page.unroute("**/facts/food-preferences");
    await foodForm.getByRole("button", {
      name: "Save profile fact",
      exact: true,
    }).click();
    await expect(foodForm).toBeHidden();
    await expect(food.locator("[data-profile-fact-state]")).toBeFocused();
    const editFood = food.getByRole("button", {
      name: /^Edit Saved food preference/,
    });
    await openLocalEditor(editFood, foodForm);
    await foodForm.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(editFood).toBeFocused();

    // A long editor scrolls within the viewport; keyboard focus remains visible.
    const dates = page.locator("#profile-section-important-dates");
    const dateForm = dates.locator("form");
    for (
      const viewport of [{ width: 320, height: 568 }, {
        width: 390,
        height: 360,
      }]
    ) {
      await page.setViewportSize(viewport);
      await openLocalEditor(dates.locator(".profile-rail-add"), dateForm);
      const sheet = page.getByRole("dialog", {
        name: "Important dates",
        exact: true,
      });
      const bounds = await sheet.boundingBox();
      expect(bounds!.x).toBeGreaterThanOrEqual(0);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(Math.abs(bounds!.y + bounds!.height - viewport.height))
        .toBeLessThanOrEqual(1);
      expect(
        await sheet.evaluate((element) =>
          element.scrollHeight > element.clientHeight
        ),
      ).toBe(true);
      await dateForm.getByRole("button", { name: "Cancel", exact: true })
        .focus();
      const cancelBounds = await dateForm.getByRole("button", {
        name: "Cancel",
        exact: true,
      }).boundingBox();
      expect(cancelBounds!.y).toBeGreaterThan(bounds!.y);
      expect(cancelBounds!.y + cancelBounds!.height).toBeLessThanOrEqual(
        viewport.height - 4,
      );
      expect(await sheet.evaluate((element) => element.scrollTop))
        .toBeGreaterThan(0);
      await expectAccessible(page);
      if (viewport.height === 360) {
        const screenshotPath = testInfo.outputPath(
          "mobile-sheet-390-short.png",
        );
        await page.screenshot({ path: screenshotPath });
        await testInfo.attach("mobile-sheet-390-short", {
          path: screenshotPath,
          contentType: "image/png",
        });
        await page.emulateMedia({ forcedColors: "active" });
        await page.screenshot({
          path: testInfo.outputPath("mobile-sheet-forced-colors.png"),
        });
      }
      expect(
        await dateForm.getByRole("button", { name: "Cancel", exact: true })
          .evaluate((element) => {
            const style = getComputedStyle(element);
            return Number.parseFloat(style.outlineWidth) >= 2 &&
              Number.parseFloat(style.outlineOffset) >= 2;
          }),
      ).toBe(true);
      await page.keyboard.press("Escape");
    }
    expect(decisions).toBe(3);
    await page.reload();
    await expect(food).toContainText("Saved food preference");
  },
);

test(
  "[PEOPLE-006] APR-004 keeps relationship and cadence errors inside mobile editors",
  { annotation: { type: "flow", description: "PEOPLE-006" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const email = `mobile-errors-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);
    for (const name of ["Charles", "Mobile errors"]) {
      await page.goto("/app/people/new");
      await page.getByLabel("Given name").fill(name);
      await page.getByRole("button", { name: "Save person", exact: true })
        .click();
      await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    }
    const relationships = page.locator("#profile-section-relationships");
    const form = relationships.locator("#relationship-form");
    const opener = relationships.getByRole("button", {
      name: "Add relationship",
      exact: true,
    });
    await expect(opener).toBeVisible();
    await openLocalEditor(opener, form);
    const sheet = page.getByRole("dialog", {
      name: "Relationships",
      exact: true,
    });
    const feedback = sheet.locator("#relationships-state");
    const save = form.getByRole("button", {
      name: "Save relationship",
      exact: true,
    });
    await save.click();
    await expect(feedback).toHaveText(
      "Choose or create another person and select a relationship type.",
    );
    await expect(feedback).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(form.getByLabel("Search people", { exact: true }))
      .toBeFocused();

    await page.route("**/api/v1/people?*", (route) => route.abort("failed"));
    await form.getByLabel("Search people", { exact: true }).fill("Charles");
    await form.getByRole("button", { name: "Search people", exact: true })
      .click();
    await expect(feedback).toHaveText(
      "People search is temporarily unavailable. Try again.",
    );
    await expect(feedback).toBeFocused();
    await expect(form.getByLabel("Search people", { exact: true })).toHaveValue(
      "Charles",
    );
    await page.unroute("**/api/v1/people?*");
    await form.getByRole("button", { name: "Search people", exact: true })
      .click();
    await form.getByRole("combobox", { name: "Related person", exact: true })
      .selectOption({
        label: "Charles",
      });
    await form.getByRole("combobox", { name: "Relationship type", exact: true })
      .selectOption({
        index: 1,
      });
    await page.route(
      "**/relationships",
      (route) =>
        route.request().method() === "POST"
          ? route.abort("failed")
          : route.fallback(),
    );
    await save.click();
    await expect(feedback).toHaveText(
      "Relationship creation is temporarily unavailable.",
    );
    await expect(feedback).toBeFocused();
    await page.unroute("**/relationships");
    await form.getByRole("combobox", { name: "Related person", exact: true })
      .selectOption("");
    await form.getByLabel("New person given name", { exact: true }).fill(
      "Draft person",
    );
    await page.route(
      "**/relationships/related-person",
      (route) => route.abort("failed"),
    );
    await save.click();
    await expect(feedback).toHaveText(
      "Related person creation is temporarily unavailable.",
    );
    await expect(feedback).toBeFocused();
    await expect(form.getByLabel("New person given name", { exact: true }))
      .toHaveValue("Draft person");
    await expectAccessible(page);
    await form.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(opener).toBeFocused();
    await expect(relationships.locator(":scope > #relationships-state"))
      .toBeVisible();

    const cadence = page.locator("#profile-section-stay-in-touch");
    const cadenceForm = cadence.locator("form");
    await openLocalEditor(cadence.locator(".profile-rail-add"), cadenceForm);
    await cadenceForm.getByLabel("Reconnect every").fill("4");
    await page.route(
      "**/stay-in-touch-cadences",
      (route) =>
        route.request().method() === "POST"
          ? route.abort("failed")
          : route.fallback(),
    );
    await cadenceForm.getByRole("button", { name: "Save cadence", exact: true })
      .click();
    const cadenceSheet = page.getByRole("dialog", {
      name: "Stay in touch",
      exact: true,
    });
    const cadenceFeedback = cadenceSheet.locator("[data-cadence-state]");
    await expect(cadenceFeedback).toHaveText("Cadence could not be saved.");
    await expect(cadenceFeedback).toBeFocused();
    await expect(cadenceForm.getByLabel("Reconnect every")).toHaveValue("4");
    await page.keyboard.press("Tab");
    await expect(cadenceForm.getByLabel("Reconnect every")).toBeFocused();
    await expectAccessible(page);
    await cadenceForm.getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(cadence.locator(":scope > [data-cadence-state]"))
      .toBeVisible();
  },
);

test(
  "[PEOPLE-006] APR-003 retries failed fact reads without losing adjacent drafts",
  { annotation: { type: "flow", description: "PEOPLE-006" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const email = `fact-retry-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);
    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Local");
    await page.getByLabel("Family name").fill("Recovery");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    const food = page.locator("#profile-section-food-preferences");
    const pets = page.locator("#profile-section-pets");
    const foodForm = food.locator("form[data-profile-fact-form]");
    const petForm = pets.locator("form[data-profile-fact-form]");
    await openLocalEditor(
      food.getByRole("button", { name: "Add food preferences", exact: true }),
      foodForm,
    );
    await foodForm.getByLabel("Food, allergy, and dietary preferences").fill(
      "Saved tea preference",
    );
    await foodForm.getByRole("button", {
      name: "Save profile fact",
      exact: true,
    })
      .click();
    await expect(food.getByText("Profile fact saved.", { exact: true }))
      .toBeVisible();
    await openLocalEditor(
      pets.getByRole("button", { name: "Add pets", exact: true }),
      petForm,
    );
    await petForm.getByLabel("Pet name").fill("Mochi");
    await petForm.getByLabel("Pet notes").fill("Enjoys the garden");
    await petForm.getByRole("button", {
      name: "Save profile fact",
      exact: true,
    })
      .click();
    await expect(pets.getByText("Profile fact saved.", { exact: true }))
      .toBeVisible();
    let mode:
      | "failed"
      | "repeated"
      | "ready"
      | "empty"
      | "archived"
      | "hidden"
      | "forbidden" = "failed";
    let releaseRetry!: () => void;
    const retryReleased = new Promise<void>((resolve) =>
      releaseRetry = resolve
    );
    let delayedRead: Promise<void> | undefined;
    await page.route("**/facts/pets", async (route) => {
      if (delayedRead) await delayedRead;
      if (mode === "failed") {
        await route.abort("failed");
      } else if (mode === "repeated" || mode === "forbidden") {
        const status = mode === "forbidden" ? 403 : 503;
        if (mode === "repeated") await retryReleased;
        await route.fulfill({
          status,
          json: {
            code: "unavailable",
            detail: "Private failure details",
            status,
            title: "Unavailable",
            type: "about:blank",
          },
        });
      } else if (mode === "ready") await route.continue();
      else {
        const upstream = await route.fetch();
        expect(upstream.ok()).toBe(true);
        const snapshot = await upstream.json();
        await route.fulfill({
          response: upstream,
          json: {
            ...snapshot,
            records: mode === "archived" ? snapshot.records : [],
            status: mode === "empty" ? "ready" : mode,
          },
        });
      }
    });
    const reads: string[] = [];
    page.on("request", (outgoing) => {
      if (outgoing.url().includes("/facts/")) {
        reads.push(new URL(outgoing.url()).pathname);
      }
    });
    let prompts = 0;
    page.on("dialog", async (dialog) => {
      prompts++;
      await dialog.dismiss();
    });
    for (
      const outcome of [
        "ready",
        "empty",
        "archived",
        "hidden",
        "forbidden",
      ] as const
    ) {
      mode = "failed";
      await page.reload();
      await expect(pets).toHaveAttribute("data-section-state", "error");
      await expect(page.locator(
        '[data-profile-fact-section][data-section-state="loading"]',
      )).toHaveCount(0);
      const retry = pets.getByRole("button", { name: "Retry", exact: true });
      await expect(retry).toBeVisible();
      await openLocalEditor(
        food.getByRole("button", {
          name: "Edit food preferences",
          exact: true,
        }),
        foodForm,
      );
      const draft = foodForm.getByLabel(
        "Food, allergy, and dietary preferences",
      );
      await draft.fill("Keep this neighboring draft");
      reads.length = 0;
      if (outcome === "ready") {
        mode = "repeated";
        await retry.click();
        await expect(retry).toBeDisabled();
        await expect(pets).toHaveAttribute("data-section-state", "loading");
        releaseRetry();
        await expect(pets).toHaveAttribute("data-section-state", "error");
        await expect(retry).toBeEnabled();
        await expect(retry).toBeFocused();
        await expect(retry).toHaveCount(1);
      }
      mode = outcome;
      await retry.click();
      await expect(pets).toHaveAttribute(
        "data-section-state",
        outcome === "archived"
          ? "read-only"
          : outcome === "empty"
          ? "ready"
          : outcome,
      );
      await expect(retry).toHaveCount(0);
      await expect(foodForm).toBeVisible();
      await expect(draft).toHaveValue("Keep this neighboring draft");
      await expect(food.locator("[data-profile-fact-list]"))
        .toContainText("Saved tea preference");
      expect(reads.length).toBe(outcome === "ready" ? 2 : 1);
      expect(reads.every((path) => path.endsWith("/facts/pets"))).toBe(true);
      expect(prompts).toBe(0);
      expect(
        await page.evaluate(() =>
          globalThis.dispatchEvent(
            new Event("beforeunload", { cancelable: true }),
          )
        ),
      ).toBe(false);
      await expect(pets).not.toContainText("Private failure details");
      if (outcome === "ready" || outcome === "archived") {
        await expect(pets).toContainText("Mochi");
        await expect(pets).toContainText("Enjoys the garden");
      } else if (outcome === "empty") {
        await expect(pets.getByText("No pets saved.", { exact: true }))
          .toBeVisible();
        await expect(
          pets.getByRole("button", { name: "Add pets", exact: true }),
        )
          .toBeVisible();
      } else if (outcome === "hidden") await expect(pets).toBeHidden();
      if (["archived", "hidden", "forbidden"].includes(outcome)) {
        await expect(pets.locator("[data-profile-fact-add]")).toBeHidden();
        await expect(pets.locator("[data-profile-fact-list] button"))
          .toHaveCount(0);
      }
      await foodForm.getByRole("button", { name: "Cancel", exact: true })
        .click();
      if (outcome === "ready") {
        await openLocalEditor(
          pets.getByRole("button", { name: "Edit Mochi", exact: true }),
          petForm,
        );
        await expect(petForm.getByLabel("Pet name")).toHaveValue("Mochi");
        await expect(petForm.getByLabel("Pet notes")).toHaveValue(
          "Enjoys the garden",
        );
        await petForm.getByRole("button", { name: "Cancel", exact: true })
          .click();
      }
    }
    for (const outcome of ["success", "failure"] as const) {
      mode = "ready";
      await page.reload();
      await expect(pets).toHaveAttribute("data-section-state", "ready");
      const editPet = pets.getByRole("button", {
        name: "Edit Mochi",
        exact: true,
      });
      const addPet = pets.getByRole("button", {
        name: "Add pets",
        exact: true,
      });
      await openLocalEditor(editPet, petForm);
      await petForm.getByLabel("Pet notes").fill(
        `Saved before ${outcome} Retry`,
      );
      mode = "failed";
      await petForm.getByRole("button", {
        name: "Save profile fact",
        exact: true,
      }).click();
      await expect(petForm).toBeHidden();
      await expect(pets).toHaveAttribute("data-section-state", "error");
      let releaseRead!: () => void;
      delayedRead = new Promise<void>((resolve) => releaseRead = resolve);
      mode = outcome === "success" ? "ready" : "repeated";
      const retry = pets.getByRole("button", { name: "Retry", exact: true });
      await retry.click();
      await expect(pets).toHaveAttribute("data-section-state", "loading");
      await expect(retry).toBeDisabled();
      await expect(addPet).toBeDisabled();
      await expect(editPet).toBeDisabled();
      await expect(petForm).toBeHidden();
      await openLocalEditor(
        food.getByRole("button", {
          name: "Edit food preferences",
          exact: true,
        }),
        foodForm,
      );
      const draft = foodForm.getByLabel(
        "Food, allergy, and dietary preferences",
      );
      await draft.fill("New draft while Pets retries");
      releaseRead();
      delayedRead = undefined;
      await expect(pets).toHaveAttribute(
        "data-section-state",
        outcome === "success" ? "ready" : "error",
      );
      await expect(foodForm).toBeVisible();
      await expect(draft).toHaveValue("New draft while Pets retries");
      await expect(petForm).toBeHidden();
      await expect(addPet).toBeEnabled();
      await expect(editPet).toBeEnabled();
      if (outcome === "failure") await expect(retry).toBeEnabled();
      expect(prompts).toBe(0);
      await foodForm.getByRole("button", { name: "Cancel", exact: true })
        .click();
      await openLocalEditor(editPet, petForm);
      await petForm.getByLabel("Pet notes").fill("A safe new local draft");
      expect(
        await page.evaluate(() =>
          globalThis.dispatchEvent(
            new Event("beforeunload", { cancelable: true }),
          )
        ),
      ).toBe(false);
      await petForm.getByRole("button", { name: "Cancel", exact: true })
        .click();
    }
  },
);

test(
  "[PEOPLE-006] APR-002 confirms local-editor switches before discarding drafts",
  { annotation: { type: "flow", description: "PEOPLE-006" } },
  async ({ browserName, page, request }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: 1440, height: 1000 });
    const email = `editor-switch-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);
    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Editor");
    await page.getByLabel("Family name").fill("Switch");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    const profilePath = new URL(page.url()).pathname;
    const food = page.locator("#profile-section-food-preferences");
    const pets = page.locator("#profile-section-pets");
    const foodForm = food.locator("form[data-profile-fact-form]");
    const petsForm = pets.locator("form[data-profile-fact-form]");
    const dateForm = page.locator("#important-date-form");
    const cadenceForm = page.locator("form[data-cadence-form]");
    const editors = [
      {
        form: foodForm,
        opener: food.getByRole("button", {
          name: "Add food preferences",
          exact: true,
        }),
        field: foodForm.getByLabel("Food, allergy, and dietary preferences"),
        first: foodForm.getByLabel("Food, allergy, and dietary preferences"),
        draft: "Preserve my food draft",
      },
      {
        form: petsForm,
        opener: pets.getByRole("button", { name: "Add pets", exact: true }),
        field: petsForm.getByLabel("Pet notes"),
        first: petsForm.getByLabel("Pet name"),
        draft: "Preserve my pet draft",
      },
      {
        form: dateForm,
        opener: page.getByRole("button", {
          name: "Add important date",
          exact: true,
        }),
        field: dateForm.getByLabel("Notes (optional)", { exact: true }),
        first: dateForm.getByLabel("Date type"),
        draft: "Preserve my date draft",
      },
      {
        form: cadenceForm,
        opener: page.getByRole("button", {
          name: "Add stay-in-touch cadence",
          exact: true,
        }),
        field: cadenceForm.getByLabel("Reconnect every"),
        first: cadenceForm.getByLabel("Reconnect every"),
        draft: "4",
      },
    ];
    const activeEditors = page.locator(
      "form[data-profile-fact-form]:visible, #important-date-form:visible, form[data-cadence-form]:visible, #relationship-form:visible",
    );
    let acceptDiscard = false;
    let decisions = 0;
    const prompts: string[] = [];
    page.on("dialog", async (dialog) => {
      prompts.push(dialog.message());
      decisions++;
      if (acceptDiscard) await dialog.accept();
      else await dialog.dismiss();
    });
    for (
      const [from, to] of [[0, 1], [1, 0], [0, 2], [2, 3], [3, 0], [3, 2], [
        2,
        0,
      ]]
    ) {
      const source = editors[from!]!;
      const target = editors[to!]!;
      const before = decisions;
      await expect(source.opener).toBeVisible();
      await expect(target.opener).toBeVisible();
      await openLocalEditor(source.opener, source.form);
      await expect(source.first).toBeFocused();
      await openLocalEditor(target.opener, target.form);
      await expect(source.form).toBeHidden();
      await expect(target.first).toBeFocused();
      await expect(activeEditors).toHaveCount(1);
      expect(decisions).toBe(before);
      await target.form.getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(target.opener).toBeFocused();
      await openLocalEditor(source.opener, source.form);
      await source.field.fill(source.draft);
      await target.opener.focus();
      await target.opener.press("Enter");
      await expect.poll(() => decisions).toBe(before + 1);
      await expect(source.form).toBeVisible();
      await expect(source.field).toHaveValue(source.draft);
      await expect(source.field).toBeFocused();
      await expect(target.form).toBeHidden();
      await expect(activeEditors).toHaveCount(1);
      acceptDiscard = true;
      await openLocalEditor(target.opener, target.form);
      await expect.poll(() => decisions).toBe(before + 2);
      await expect(source.form).toBeHidden();
      await expect(target.first).toBeFocused();
      await expect(activeEditors).toHaveCount(1);
      await target.field.fill(target.draft);
      await target.form.getByRole("button", { name: "Cancel", exact: true })
        .click();
      await expect(target.form).toBeHidden();
      await expect(target.opener).toBeFocused();
      expect(decisions).toBe(before + 2);
      acceptDiscard = false;
    }
    expect(
      prompts.every((message) =>
        message ===
          "You have unsaved changes in this editor. Discard them and open another editor?"
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() =>
        globalThis.dispatchEvent(
          new Event("beforeunload", { cancelable: true }),
        )
      ),
    ).toBe(true);
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`${profilePath}$`));
    for (const editor of editors) {
      await expect(editor.opener).toBeVisible();
      await openLocalEditor(editor.opener, editor.form);
      await expect(editor.field).toHaveValue(editor === editors[3] ? "1" : "");
      await editor.form.getByRole("button", { name: "Cancel", exact: true })
        .click();
    }
  },
);

test(
  "[PEOPLE-006] APR-001 preserves a failed save through declined navigation and retry",
  {
    annotation: { type: "flow", description: "PEOPLE-006" },
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(120_000);
    const email = `unsaved-facts-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, email);
    await signIn(page, email);
    await page.goto("/app/people/new");
    await page.getByLabel("Given name").fill("Unsaved");
    await page.getByLabel("Family name").fill("Draft");
    await page.getByRole("button", { name: "Save person", exact: true })
      .click();
    await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
    const profilePath = new URL(page.url()).pathname;
    const food = page.locator("#profile-section-food-preferences");
    const form = food.locator("form[data-profile-fact-form]");
    const addFood = food.getByRole("button", {
      name: "Add food preferences",
      exact: true,
    });
    await expect(addFood).toBeVisible();
    await openLocalEditor(addFood, form);
    await form.getByLabel("Food, allergy, and dietary preferences").fill(
      "Tea with lunch",
    );
    await form.getByRole("button", { name: "Save profile fact", exact: true })
      .click();
    await expect(form).toBeHidden();
    await expect(food.getByText("Profile fact saved.", { exact: true }))
      .toBeVisible();
    await openLocalEditor(
      food.getByRole("button", { name: "Edit food preferences", exact: true }),
      form,
    );
    await form.getByLabel("Food, allergy, and dietary preferences").fill(
      "Vegetarian meals; no shellfish",
    );
    let releaseSave!: () => void;
    const saveReleased = new Promise<void>((resolve) => releaseSave = resolve);
    let failSave = true;
    await page.route("**/facts/food-preferences/**", async (route) => {
      if (failSave && route.request().method() === "PUT") {
        failSave = false;
        await saveReleased;
        await route.abort("failed");
      } else await route.continue();
    });
    await form.getByRole("button", { name: "Save profile fact", exact: true })
      .click();
    await expect(form).toHaveAttribute("inert", "");
    expect(
      await page.evaluate(() =>
        !globalThis.dispatchEvent(
          new Event("beforeunload", { cancelable: true }),
        )
      ),
    ).toBe(true);
    releaseSave();
    await expect(form.getByText("Save is temporarily unavailable."))
      .toBeVisible();
    await expect(form).not.toHaveAttribute("inert");
    const navigation = page.waitForEvent("dialog").then(async (dialog) => {
      expect(dialog.type()).toBe("beforeunload");
      await dialog.dismiss();
    });
    await Promise.all([
      navigation,
      page.locator('a[href="/app/people"]').first().click(),
    ]);
    await expect(page).toHaveURL(new RegExp(`${profilePath}$`));
    await expect(form.getByLabel("Food, allergy, and dietary preferences"))
      .toHaveValue(
        "Vegetarian meals; no shellfish",
      );
    await form.getByRole("button", { name: "Save profile fact", exact: true })
      .click();
    await expect(form).toBeHidden();
    await expect(food.getByText("Profile fact saved.", { exact: true }))
      .toBeVisible();
    expect(
      await page.evaluate(() =>
        !globalThis.dispatchEvent(
          new Event("beforeunload", { cancelable: true }),
        )
      ),
    ).toBe(false);
    await page.locator('a[href="/app/people"]').first().click();
    await expect(page).toHaveURL(/\/app\/people$/);
    await page.goto(profilePath);
    await expect(
      food.getByRole("paragraph").filter({
        hasText: /^Vegetarian meals; no shellfish$/,
      }),
    ).toBeVisible();
  },
);

test(
  "[PEOPLE-006] PRF-001 scans profile blocks and edits long facts across screen sizes",
  {
    annotation: { type: "flow", description: "PEOPLE-006" },
  },
  async ({ browserName, page, request }, testInfo) => {
    test.setTimeout(180_000);
    const email = `profile-blocks-${browserName}-${Date.now()}@example.test`;
    await page.emulateMedia({ reducedMotion: "reduce" });
    await registerVerified(request, email);
    await signIn(page, email);
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(email)
      }`,
    );
    const personId = randomUUID();
    const typeId = randomUUID();
    const revision = "2026-08-16T12:00:00.000000Z";
    const longEmail =
      "ada.lovelace.correspondence@analytical-engines.example.test";
    databaseSql(
      `insert into crm.people (id, workspace_id, given_name, family_name, description)
    values ('${personId}'::uuid, '${workspaceId}'::uuid, 'Ada', 'Lovelace', 'Mathematician, writer, and a friend from the Analytical Society.');
    insert into crm.notes (workspace_id, person_id, body)
    select '${workspaceId}'::uuid, '${personId}'::uuid,
      'Conversation ' || sequence || ': discussed mathematics and plans for the next visit.'
    from generate_series(1, 8) sequence;`,
    );
    await page.route(`**/people/${personId}/facts/*`, async (route) => {
      const section = new URL(route.request().url()).pathname.split("/").at(
        -1,
      )!;
      const values: Record<string, unknown> = {
        "contact-methods": {
          typeId,
          labelIds: [],
          isPrimary: true,
          value: longEmail,
        },
        addresses: {
          displayName: "Home",
          street: "1 Analytical Engine Way, Apartment 123",
          city: "London",
          region: "Greater London",
          postalCode: "SW1A 1AA",
          country: "United Kingdom",
          isPrimary: true,
          labelIds: [],
        },
        work: {
          title: "Mathematician and scientific correspondent",
          organizationName: "Analytical Engines Research Society",
          isCurrent: true,
        },
        "food-preferences": {
          foodPreferences:
            "Vegetarian meals; no shellfish. Loves a pot of tea after a long walk.",
        },
      };
      await route.fulfill({
        json: {
          options: section === "contact-methods"
            ? [{ id: typeId, kind: "contact-type", name: "Personal email" }]
            : [],
          personUpdatedAt: revision,
          status: "ready",
          records: values[section]
            ? [{
              id: randomUUID(),
              section,
              updatedAt: revision,
              value: values[section],
            }]
            : [],
        },
      });
    });
    await page.goto(`/app/people/${personId}`);
    const contacts = page.locator("#profile-section-contact-methods");
    const relationships = page.locator("#profile-section-relationships");
    const address = page.locator("#profile-section-addresses");
    await expect(contacts).toContainText(longEmail);
    await expect(address).toContainText("Greater London");
    await expect(page.locator("[data-timeline-list] > li")).toHaveCount(8);
    await expect(
      page.locator('.profile-facts-rail [data-section-state="loading"]'),
    ).toHaveCount(0);
    if (await page.locator("#person-first-run").isVisible()) {
      await page.getByRole("button", { name: "Show all sections" }).click();
    }
    const directory = page.locator(".profile-section-directory");
    for (
      const viewport of [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
        { width: 768, height: 900 },
        { width: 1050, height: 900 },
      ]
    ) {
      const { width } = viewport;
      await page.setViewportSize(viewport);
      const layout = await page.locator(".profile-facts-column").evaluate((
        element,
      ) => ({
        position: getComputedStyle(element).position,
        overflow: getComputedStyle(element).overflowY,
        maxHeight: getComputedStyle(element).maxHeight,
      }));
      expect(layout).toEqual({
        position: "static",
        overflow: "visible",
        maxHeight: "none",
      });
      const [contactBox, relationshipBox, streamBox] = await Promise.all([
        contacts.boundingBox(),
        relationships.boundingBox(),
        page.locator(".profile-section-list").boundingBox(),
      ]);
      expect(contactBox!.width).toBeGreaterThanOrEqual(
        width >= 1200 ? 245 : 300,
      );
      if (width >= 1200) {
        expect(relationshipBox!.x).toBeGreaterThan(
          contactBox!.x + contactBox!.width,
        );
        expect(Math.abs(relationshipBox!.y - contactBox!.y)).toBeLessThan(2);
        expect(streamBox!.width).toBeGreaterThanOrEqual(640);
      } else if (width < 600) {
        expect(relationshipBox!.x).toBe(contactBox!.x);
        expect(relationshipBox!.y).toBeGreaterThan(
          contactBox!.y + contactBox!.height,
        );
      }
      expect(
        await contacts.locator(".profile-fact-actions > button").evaluateAll((
          buttons,
        ) => buttons.map((button) => button.firstChild?.textContent)),
      ).toEqual(["Edit", "Delete"]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth))
        .toBeLessThanOrEqual(width);

      await page.locator("#profile-section-stay-in-touch")
        .scrollIntoViewIfNeeded();
      const summary = directory.locator("summary");
      expect.soft(
        await summary.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return document.elementFromPoint(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2,
          )?.closest("summary") === element;
        }),
      ).toBe(true);
      if (
        !await directory.evaluate((element) =>
          (element as HTMLDetailsElement).open
        )
      ) {
        await summary.click({ timeout: 5_000 });
      }
      await page.locator('[data-section-link="addresses"]').click();
      await expect(address).toBeFocused();
      await expect(page).toHaveURL(/section=addresses/);
      {
        const navigatorBounds = await page.locator(
          ".person-workspace-navigation",
        ).boundingBox();
        const headingBounds = await address.getByRole("heading", {
          name: "Addresses",
          exact: true,
        }).boundingBox();
        expect.soft(headingBounds!.y).toBeGreaterThanOrEqual(
          navigatorBounds!.y + navigatorBounds!.height + 8,
        );
      }
      await address.getByRole("button", { name: /^Edit Home/ }).click();
      const editor = address.locator("form[data-profile-fact-form]");
      await expect(editor).toBeVisible();
      for (
        const control of await editor.locator(
          "input:visible, select:visible, textarea:visible, button:visible",
        ).all()
      ) {
        const bounds = await control.boundingBox();
        expect(bounds!.x).toBeGreaterThanOrEqual(0);
        expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
      }
      if (width < 600) {
        expect(
          await page.getByRole("dialog", { name: "Addresses", exact: true })
            .evaluate((element) => getComputedStyle(element).position),
        ).toBe("fixed");
      }
      await editor.getByRole("button", { name: "Cancel" }).press("Enter");
      await expect(editor).toBeHidden();
      if (
        await directory.evaluate((element) =>
          (element as HTMLDetailsElement).open
        )
      ) {
        await directory.locator("summary").click();
      }
      await page.evaluate(() => globalThis.scrollTo(0, 0));
      await testInfo.attach(`profile-blocks-${width}`, {
        body: await page.screenshot({ fullPage: true }),
        contentType: "image/png",
      });
      if (width === 1440) {
        await page.locator('[data-person-vital-value="work"]').click();
        await expect(page.locator("#profile-section-work")).toBeFocused();
        await expect(page.locator("[data-timeline-list] > li")).toHaveCount(8);
        const navigatorBounds = await page.locator(
          ".person-workspace-navigation",
        ).boundingBox();
        const headingBounds = await page.locator(
          "#profile-section-work-heading",
        ).boundingBox();
        expect.soft(headingBounds!.y).toBeGreaterThanOrEqual(
          navigatorBounds!.y + navigatorBounds!.height + 8,
        );
      }
    }
    await page.setViewportSize({ width: 375, height: 667 });
    // Development chrome must not intercept the production menu's pointer test.
    await page.addStyleTag({
      content: "astro-dev-toolbar { display: none !important; }",
    });
    await directory.locator("summary").scrollIntoViewIfNeeded();
    await directory.locator("summary").click({ timeout: 5_000 });
    const menu = directory.locator("nav");
    await expect.poll(async () => {
      const bounds = await menu.boundingBox();
      return bounds!.y + bounds!.height;
    }).toBeLessThanOrEqual(659);
    const auditLink = menu.locator('[data-section-link="audit-summary"]');
    await auditLink.click({ timeout: 5_000 });
    await expect(page.locator("#profile-section-audit-summary")).toBeFocused();
    await expect(page).toHaveURL(/section=audit-summary/);
    await expect(menu).toBeHidden();
    // Reopen after the navigator has stuck while viewing the final section.
    await directory.locator("summary").click({ timeout: 5_000 });
    await expect.poll(async () => {
      const bounds = await menu.boundingBox();
      return bounds!.y + bounds!.height;
    }).toBeLessThanOrEqual(659);
    await auditLink.click();
    await expect(page.locator("#profile-section-audit-summary")).toBeFocused();
    await expect(menu).toBeHidden();
  },
);

test("[PEOPLE-006] maintains enabled profile facts in local person sections", {
  annotation: { type: "flow", description: "PEOPLE-006" },
}, async ({ browserName, page, request }) => {
  test.setTimeout(300_000);
  const email = `profile-facts-${browserName}-${Date.now()}@example.test`;
  await registerVerified(request, email);
  await signIn(page, email);
  const workspaceId = databaseValue(
    `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
      sqlLiteral(email)
    }`,
  );
  const typeId = randomUUID();
  const labelId = randomUUID();
  const petCategoryId = randomUUID();
  const tagId = randomUUID();
  const introducerId = randomUUID();
  const organizationId = randomUUID();
  databaseSql(`
    insert into crm.contact_method_types (id, workspace_id, name, kind)
    values ('${typeId}'::uuid, '${workspaceId}'::uuid, 'Email', 'email');
    insert into crm.contact_labels (id, workspace_id, label, applies_to)
    values ('${labelId}'::uuid, '${workspaceId}'::uuid, 'Home', 'any');
    insert into crm.pet_categories (id, name, is_common)
    values ('${petCategoryId}'::uuid, 'Cat ${petCategoryId}', true);
    insert into crm.tags (id, workspace_id, name, slug)
    values ('${tagId}'::uuid, '${workspaceId}'::uuid, 'Friend', 'friend-${tagId}');
    insert into crm.organizations (id, workspace_id, name)
    values ('${organizationId}'::uuid, '${workspaceId}'::uuid, 'Analytical Engines');
    insert into crm.organizations (workspace_id, name)
    select '${workspaceId}'::uuid,
      '000 Organization ' || lpad(series::text, 3, '0')
    from generate_series(1, 55) series;
    insert into crm.people (id, workspace_id, given_name, family_name)
    values ('${introducerId}'::uuid, '${workspaceId}'::uuid, 'Charles', 'Babbage');
  `);

  await page.goto("/app/people/new");
  await page.getByLabel("Given name").fill("Ada");
  await page.getByLabel("Family name").fill("Lovelace");
  let releaseContacts = () => {};
  const contactsReleased = new Promise<void>((resolve) =>
    releaseContacts = resolve
  );
  let delayContacts = true;
  await page.route("**/facts/contact-methods", async (route) => {
    if (delayContacts && route.request().method() === "GET") {
      delayContacts = false;
      await contactsReleased;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Save person", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/people\/[0-9a-f-]+$/);
  const profilePath = new URL(page.url()).pathname;
  await page.goto(profilePath);
  const contacts = page.locator("#profile-section-contact-methods");
  await expect(contacts).toHaveAttribute("data-section-state", "loading");
  await expect(contacts.getByText("Loading contact methods…")).toBeVisible();
  releaseContacts();
  await expect(contacts).toHaveAttribute("data-section-state", "ready");
  await expect(contacts.getByText("No contact methods saved.")).toBeVisible();
  await expect(
    page.locator(
      '[data-profile-fact-section][data-section-state="loading"]',
    ),
  ).toHaveCount(0);
  await expect(page.locator("#person-first-run")).toBeVisible();
  await page.getByRole("button", { name: "Show all sections" }).click();
  await expect(page.locator("#person-first-run")).toBeHidden();

  await openPersonMenu(page);
  const editPerson = page.getByRole("button", { name: "Edit person" });
  const exportVCard = page.getByRole("link", { name: "Export vCard" });
  await expectAlignedControls(editPerson, exportVCard);
  const [editPersonStyle, exportStyle] = await Promise.all([
    controlPresentation(editPerson),
    controlPresentation(exportVCard),
  ]);
  expect(exportStyle.borderColor).toBe(editPersonStyle.borderColor);

  await expectAlignedControls(
    page.getByRole("button", { name: "Log activity" }),
    page.getByRole("link", { name: "Open activity report" }),
  );

  const cadence = page.locator('[data-profile-section="stay-in-touch"]');
  await cadence.getByRole("button", { name: "Add stay-in-touch cadence" })
    .click();
  const [cadenceCountStyle, cadenceUnitStyle] = await Promise.all([
    controlPresentation(cadence.getByLabel("Reconnect every")),
    controlPresentation(cadence.getByLabel("Calendar unit")),
  ]);
  expect(Math.abs(cadenceCountStyle.height - cadenceUnitStyle.height))
    .toBeLessThanOrEqual(2);
  for (
    const property of [
      "backgroundColor",
      "borderColor",
      "borderRadius",
      "borderStyle",
      "borderWidth",
      "fontFamily",
      "minHeight",
      "paddingBottom",
      "paddingLeft",
      "paddingRight",
      "paddingTop",
    ] as const
  ) {
    expect(cadenceCountStyle[property]).toBe(cadenceUnitStyle[property]);
  }
  expect(cadenceCountStyle.borderColor).not.toBe(
    cadenceCountStyle.backgroundColor,
  );

  const coordinationFood = page.locator(
    "#profile-section-food-preferences",
  );
  const coordinationFoodEditor = coordinationFood.locator(
    "form[data-profile-fact-form]",
  );
  await openLocalEditor(
    coordinationFood.getByRole("button", { name: "Add food preferences" }),
    coordinationFoodEditor,
  );
  const coordinationAddress = page.locator("#profile-section-addresses");
  const coordinationAddressEditor = coordinationAddress.locator(
    "form[data-profile-fact-form]",
  );
  await openLocalEditor(
    coordinationAddress.getByRole("button", { name: "Add addresses" }),
    coordinationAddressEditor,
  );
  await expect(coordinationFoodEditor).toHaveCount(1);
  await expect(coordinationFoodEditor).toBeHidden();
  await expect(
    coordinationAddressEditor.locator(
      'input:not([type="hidden"]), select, textarea',
    ).first(),
  ).toBeFocused();
  await coordinationAddressEditor.getByRole("button", { name: "Cancel" })
    .click();

  const calls: string[] = [];
  page.on("request", (outgoing) => {
    if (outgoing.url().includes("/facts/")) {
      calls.push(`${outgoing.method()} ${new URL(outgoing.url()).pathname}`);
    }
  });
  const contactEditor = contacts.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    contacts.getByRole("button", { name: "Add contact methods" }),
    contactEditor,
  );
  const contactType = contactEditor.locator('select[name="typeId"]');
  await expect(contactType).toBeFocused();
  await expect.poll(() => calls).toEqual([
    `GET /api/v1/people/${profilePath.split("/").at(-1)}/facts/contact-methods`,
  ]);
  await contactType.selectOption(typeId);
  await contactEditor.getByLabel("Contact value").fill("ada@example.test");
  await contactEditor.getByLabel("Contact labels").selectOption([labelId]);
  await contactEditor.getByLabel("Primary for this contact type").check();
  calls.length = 0;
  await contactEditor.getByRole("button", { name: "Save profile fact" })
    .click();
  await expect(contacts.getByText("Profile fact saved.")).toBeFocused();
  await expect(contacts).toContainText("Email: ada@example.test");
  const editContact = contacts.getByRole("button", {
    name: "Edit Email: ada@example.test",
  });
  const deleteContact = contacts.getByRole("button", {
    name: "Delete Email: ada@example.test",
  });
  await expect(editContact).toHaveClass(/\bbutton-secondary\b/);
  await expect(deleteContact).toHaveClass(/\bbutton-danger\b/);
  const [editContactStyle, deleteContactStyle] = await Promise.all([
    controlPresentation(editContact),
    controlPresentation(deleteContact),
  ]);
  expect(deleteContactStyle.backgroundColor).not.toBe(
    editContactStyle.backgroundColor,
  );
  expect(deleteContactStyle.borderColor).not.toBe(
    editContactStyle.borderColor,
  );
  expect(deleteContactStyle.color).not.toBe(editContactStyle.color);
  await expect.poll(() => calls).toEqual([
    `POST /api/v1/people/${
      profilePath.split("/").at(-1)
    }/facts/contact-methods`,
    `GET /api/v1/people/${profilePath.split("/").at(-1)}/facts/contact-methods`,
  ]);

  const address = page.locator("#profile-section-addresses");
  const addressEditor = address.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    address.getByRole("button", { name: "Add addresses" }),
    addressEditor,
  );
  await addressEditor.getByLabel("Address name").fill("Home");
  await addressEditor.getByLabel("Street").fill("1 Analytical Engine Way");
  await addressEditor.getByLabel("City").fill("London");
  await addressEditor.locator('select[name="labelIds"]').selectOption([
    labelId,
  ]);
  await addressEditor.getByLabel("Primary address").check();
  await addressEditor.getByRole("button", { name: "Save profile fact" })
    .click();
  await expect(address.locator(".profile-address-summary > span")).toHaveText([
    "Home",
    "1 Analytical Engine Way",
    "London",
  ]);

  const firstMeeting = page.locator("#profile-section-first-meeting");
  const firstMeetingEditor = firstMeeting.locator(
    "form[data-profile-fact-form]",
  );
  await openLocalEditor(
    firstMeeting.getByRole("button", { name: "Add first meeting" }),
    firstMeetingEditor,
  );
  await firstMeetingEditor.getByLabel("Search people").fill("Charles");
  await firstMeetingEditor.getByRole("button", { name: "Search people" })
    .click();
  await firstMeetingEditor.getByLabel("Introduced by").selectOption(
    introducerId,
  );
  await firstMeetingEditor.getByLabel("Where or how you first met").fill(
    "London salon",
  );
  await firstMeetingEditor.getByLabel("First meeting story").fill(
    "Introduced while discussing mathematics",
  );
  await firstMeetingEditor.getByRole("button", { name: "Save profile fact" })
    .click();
  await expect(firstMeeting).toContainText(
    "London salon — Introduced while discussing mathematics",
  );

  const work = page.locator("#profile-section-work");
  const workEditor = work.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    work.getByRole("button", { name: "Add work" }),
    workEditor,
  );
  await workEditor.getByLabel("Role or title").fill("Mathematician");
  const organization = workEditor.getByLabel("Existing organization");
  expect(await organization.locator("option").count()).toBeLessThanOrEqual(51);
  await expect(organization.locator(`option[value="${organizationId}"]`))
    .toHaveCount(0);
  await workEditor.getByLabel("Search organizations").fill("Analytical");
  await workEditor.getByRole("button", { name: "Search organizations" })
    .click();
  await expect(organization.locator(`option[value="${organizationId}"]`))
    .toHaveCount(1);
  await organization.selectOption(
    organizationId,
  );
  await workEditor.getByLabel("Start date").fill("2026-01-02");
  await workEditor.getByLabel("End date").fill("2026-01-01");
  await workEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expect(
    workEditor.getByText("End date must be on or after the start date."),
  )
    .toBeVisible();
  await expect(workEditor.getByLabel("End date")).toBeFocused();
  await workEditor.getByLabel("End date").fill("2026-12-31");
  await workEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expect(work).toContainText("Mathematician at Analytical Engines");

  const tags = page.locator('[data-profile-fact-section="tags"]');
  const tagEditor = tags.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    tags.getByRole("button", { name: "Edit tags" }),
    tagEditor,
  );
  await tagEditor.getByLabel("Assigned tags").selectOption([tagId]);
  await tagEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expect(page.locator("#person-profile-tags")).toContainText("Friend");

  const pets = page.locator("#profile-section-pets");
  const petsEditor = pets.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    pets.getByRole("button", { name: "Add pets" }),
    petsEditor,
  );
  await petsEditor.getByLabel("Pet name").fill("Byron");
  await petsEditor.getByLabel("Pet category").selectOption(petCategoryId);
  await petsEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expect(pets).toContainText("Byron · Cat");

  const food = page.locator("#profile-section-food-preferences");
  const foodEditor = food.locator("form[data-profile-fact-form]");
  await openLocalEditor(
    food.getByRole("button", { name: "Add food preferences" }),
    foodEditor,
  );
  await foodEditor.getByLabel("Food, allergy, and dietary preferences").fill(
    "Tea; no shellfish",
  );
  await foodEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expect(food).toContainText("Tea; no shellfish");
  await food.getByRole("button", { name: "Clear food preferences" }).click();
  await food.getByRole("button", {
    name: "Confirm clear food preferences",
  }).click();
  await expect(
    food.getByRole("list", { name: "Saved food preferences" }).getByRole(
      "listitem",
    ),
  ).toHaveCount(0);
  await expect(food.getByRole("button", { name: "Add food preferences" }))
    .toBeVisible();
  await openLocalEditor(
    food.getByRole("button", { name: "Add food preferences" }),
    foodEditor,
  );
  await foodEditor.getByLabel("Food, allergy, and dietary preferences").fill(
    "Tea; no shellfish",
  );
  await foodEditor.getByRole("button", { name: "Save profile fact" }).click();
  await expectAccessible(page);

  await page.reload();
  await expect(contacts).toContainText("ada@example.test");
  await expect(address).toContainText("Analytical Engine Way");
  await expect(firstMeeting).toContainText("London salon");
  await expect(work).toContainText("Analytical Engines");
  await openLocalEditor(
    work.getByRole("button", {
      name: "Edit Mathematician at Analytical Engines",
    }),
    workEditor,
  );
  await expect(workEditor.getByLabel("Existing organization"))
    .toHaveValue(organizationId);
  await expect(
    workEditor.locator(`option[value="${organizationId}"]`),
  ).toHaveText("Analytical Engines");
  await workEditor.getByRole("button", { name: "Cancel" }).click();
  await expect(pets).toContainText("Byron");
  await expect(food).toContainText("no shellfish");
  expect(
    databaseValue(
      `select introduced_by_person_id::text from crm.person_first_meetings where person_id = '${
        profilePath.split("/").at(-1)
      }'::uuid`,
    ),
  ).toBe(introducerId);

  databaseSql(
    `insert into crm.workspace_profile_modules (workspace_id, key, is_active) values ('${workspaceId}'::uuid, 'tags', false)`,
  );
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: false },
      }),
    )
  );
  await expect(page.locator('[data-profile-fact-section="tags"]'))
    .toHaveAttribute("data-section-state", "hidden");
  await expect(page.locator("#person-profile-tags")).toBeHidden();
  await expect(page.locator("body")).not.toContainText("Friend");
  expect(await page.locator("body").innerHTML()).not.toContain(tagId);
  expect(
    databaseValue(
      `select count(*) from crm.person_tags link join crm.people person on person.id = link.person_id where person.workspace_id = '${workspaceId}'::uuid`,
    ),
  ).toBe("1");
  databaseSql(
    `update crm.workspace_profile_modules set is_active = true where workspace_id = '${workspaceId}'::uuid and key = 'tags'`,
  );
  await page.evaluate(() =>
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: false },
      }),
    )
  );
  await expect(page.locator("#person-profile-tags")).toContainText("Friend");

  databaseSql(
    `insert into crm.workspace_profile_modules (workspace_id, key, is_active) values ('${workspaceId}'::uuid, 'contact-methods', false)`,
  );
  await page.reload();
  await expect(contacts).toBeHidden();
  expect(
    databaseValue(
      `select count(*) from crm.person_contact_methods method join crm.people person on person.id = method.person_id where person.workspace_id = '${workspaceId}'::uuid`,
    ),
  ).toBe("1");

  databaseSql(
    `update crm.workspace_profile_modules set is_active = true where workspace_id = '${workspaceId}'::uuid and key = 'contact-methods'`,
  );
  await page.route("**/facts/contact-methods", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        contentType: "application/problem+json",
        json: {
          code: "unavailable",
          detail: "Fixture",
          status: 503,
          title: "Unavailable",
          type: "about:blank",
        },
        status: 503,
      });
    }
    await route.continue();
  });
  await page.reload();
  await expect(contacts).toHaveAttribute("data-section-state", "error");
  await expect(
    contacts.getByText(
      "This profile section is temporarily unavailable. Try again.",
    ),
  ).toBeVisible();
  await page.unroute("**/facts/contact-methods");
  await page.route("**/facts/contact-methods", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        contentType: "application/problem+json",
        json: {
          code: "people_forbidden",
          detail: "Fixture",
          status: 403,
          title: "Forbidden",
          type: "about:blank",
        },
        status: 403,
      });
    }
    await route.continue();
  });
  await page.reload();
  await expect(contacts).toHaveAttribute("data-section-state", "forbidden");
  await expect(
    contacts.getByText("Your active workspace no longer permits this action."),
  ).toBeVisible();
  await page.unroute("**/facts/contact-methods");
  await page.goto(profilePath);
  await openPersonMenu(page);
  await page.getByRole("button", { name: "Archive person" }).click();
  await expect(contacts).toHaveAttribute("data-section-state", "read-only");
  await expect(contacts.getByRole("button", { name: /Add|Edit|Delete/ }))
    .toHaveCount(0);
  await expect(contacts).toContainText("ada@example.test");
  await expectAccessible(page);
});
