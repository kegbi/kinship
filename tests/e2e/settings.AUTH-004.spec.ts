import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { expect, test } from "./support/test.ts";
import { mkdirSync } from "node:fs";
import { registerVerified } from "./support/api.ts";
import { databaseSql, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { activateGlobalSearch } from "./support/islands.ts";
import {
  expectAccessible,
  recordPolicyViolations,
} from "./support/page-checks.ts";
import { openMemberPopover } from "./support/shell.ts";
import { signIn } from "./support/sign-in.ts";

async function registerAccount(
  request: APIRequestContext,
  email: string,
  workspaceName: string,
): Promise<void> {
  await registerVerified(request, {
    email,
    firstName: "Test",
    lastName: "Member",
    workspaceName,
  });
}

async function sessionCookie(context: BrowserContext): Promise<string> {
  const cookie = (await context.cookies()).find((item) =>
    item.name === "kinship_session"
  );
  expect(cookie).toBeTruthy();
  return `kinship_session=${cookie!.value}`;
}

test(
  "[AUTH-004] APR-010 fluid layout follows saved membership preferences across desktop, mobile, and navigation",
  { annotation: [{ type: "flow", description: "AUTH-004" }] },
  async ({ page, request, browserName }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    const suffix = `${browserName}-${Date.now()}`;
    const email = `layout-${suffix}@example.test`;
    const otherEmail = `layout-other-${suffix}@example.test`;
    await registerAccount(request, email, `Layout ${suffix}`);
    await registerAccount(request, otherEmail, `Other layout ${suffix}`);
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(email)
      }`,
    );
    const otherWorkspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(otherEmail)
      }`,
    );
    databaseSql(
      `with inserted as (insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at) select gen_random_uuid(), ${
        sqlLiteral(otherWorkspaceId)
      }::uuid, id, 'member', 'active', now(), now(), now() from crm.users where email = ${
        sqlLiteral(email)
      } returning id) insert into crm.member_preferences (member_id) select id from inserted`,
    );
    await signIn(page, email);
    const created = await page.request.post(`${origin}/api/v1/people`, {
      headers: { "X-Workspace-Id": workspaceId, Origin: origin },
      data: { givenName: "Layout", familyName: "Person", isPartial: false },
    });
    expect(created.status()).toBe(201);
    const personId = (await created.json()).person.id;
    const frame = page.locator(".page-frame");
    const width = (selector: string) =>
      page.locator(selector).evaluate((element) =>
        element.getBoundingClientRect().width
      );
    const noOverflow = async () =>
      expect(
        await page.evaluate(() =>
          document.documentElement.scrollWidth <= innerWidth
        ),
      ).toBe(true);
    const snapshotDirectory = ".artifacts/apr-010-review";
    mkdirSync(snapshotDirectory, { recursive: true });
    const snapshot = (name: string) =>
      page.screenshot({
        path: `${snapshotDirectory}/${browserName}-${name}.png`,
        fullPage: true,
      });

    await page.goto("/app/settings/preferences");
    const checkbox = page.getByLabel("Use fluid layout");
    await expect(checkbox).toBeEnabled();
    await expect(checkbox).not.toBeChecked();
    await expect.poll(() => width(".page-frame")).toBe(1180);
    await snapshot("constrained-desktop");
    await checkbox.check();
    expect(await width(".page-frame")).toBe(1180);
    await page.getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator("#settings-status")).toHaveText(
      "Preferences saved.",
    );
    await expect.poll(() => width(".page-frame")).toBe(1888);
    expect(await width(".header-row")).toBe(1888);
    expect(await width("#preferences-form")).toBeLessThanOrEqual(864);
    await noOverflow();
    await snapshot("fluid-desktop");

    await page.getByRole("navigation", { name: "Primary navigation" })
      .getByRole("link", { name: "People", exact: true }).click();
    await expect(page).toHaveURL(/\/app\/people$/);
    await expect.poll(() => width(".page-frame")).toBe(1888);
    await page.goto(`/app/people/${personId}`);
    await expect(page.locator(".person-workspace")).toBeVisible();
    await expect.poll(() => width(".page-frame")).toBe(1888);
    const cards = page.locator(".profile-rail-block:visible");
    expect(await cards.count()).toBeGreaterThan(1);
    expect(
      await cards.evaluateAll((items) =>
        items.every((item) => item.getBoundingClientRect().width >= 210)
      ),
    ).toBe(true);
    const prose = page.locator(".page-frame p").first();
    expect(
      await prose.evaluate((element) =>
        parseFloat(getComputedStyle(element).maxInlineSize)
      ),
    ).toBeLessThan(900);
    await noOverflow();
    await snapshot("profile-fluid-desktop");

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => width(".page-frame")).toBeLessThanOrEqual(374);
    const stacked = () =>
      page.locator(".profile-facts-rail").evaluate((element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length
      );
    expect(await stacked()).toBe(1);
    await noOverflow();
    await snapshot("profile-fluid-mobile");
    await page.goto("/app/settings/preferences");
    await expect(checkbox).toBeChecked();
    await noOverflow();
    await openMemberPopover(page);
    await page.getByLabel("Active workspace").selectOption(otherWorkspaceId);
    await expect(checkbox).toBeEnabled();
    await expect(checkbox).not.toBeChecked();
    await expect(page.locator("#protected-shell")).toHaveAttribute(
      "data-fluid-layout",
      "false",
    );
    await noOverflow();
    await snapshot("constrained-mobile");

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(() => width(".page-frame")).toBe(1180);
    await openMemberPopover(page);
    await page.getByLabel("Active workspace").selectOption(workspaceId);
    await expect(checkbox).toBeChecked();
    await expect.poll(() => width(".page-frame")).toBe(1888);
    await checkbox.uncheck();
    await page.getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(page.locator("#settings-status")).toHaveText(
      "Preferences saved.",
    );
    await expect.poll(() => width(".page-frame")).toBe(1180);
    await page.goto(`/app/people/${personId}`);
    await expect(page.locator(".person-workspace")).toBeVisible();
    await expect.poll(() => width(".page-frame")).toBe(1280);
    expect(
      await cards.evaluateAll((items) =>
        items.every((item) => item.getBoundingClientRect().width >= 210)
      ),
    ).toBe(true);
    await snapshot("profile-constrained-desktop");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await stacked()).toBe(1);
    await noOverflow();
    await snapshot("profile-constrained-mobile");
    await page.goto("/app");
    await expect(frame).toBeVisible();
    await expect(page.locator("#protected-shell")).toHaveAttribute(
      "data-fluid-layout",
      "false",
    );
    await noOverflow();
  },
);

test(
  "[AUTH-004] APR-009 saved locale and effective timezone agree across profile, timeline, reminders, and audit",
  {
    annotation: [{ type: "flow", description: "AUTH-004" }],
  },
  async ({ page, request, browserName }) => {
    test.setTimeout(180_000);
    page.setDefaultTimeout(15_000);
    const email = `time-presentation-${browserName}-${Date.now()}@example.test`;
    await registerAccount(request, email, "Time presentation circle");
    await signIn(page, email);
    const session = await (await page.request.get(`${origin}/api/v1/session`))
      .json();
    const workspaceId = session.workspace.id;
    const memberId = session.member.id;
    const created = await page.request.post(`${origin}/api/v1/people`, {
      headers: { "X-Workspace-Id": workspaceId, Origin: origin },
      data: { givenName: "Time", familyName: "Person", isPartial: false },
    });
    expect(created.status()).toBe(201);
    const personId = (await created.json()).person.id;
    const instant = "2026-09-04T22:10:00Z";
    const noteId = crypto.randomUUID();
    const reminderId = crypto.randomUUID();
    const calendarId = crypto.randomUUID();
    const partialId = crypto.randomUUID();
    databaseSql(
      `update crm.workspace_settings set default_timezone = 'Europe/Belgrade' where workspace_id = ${
        sqlLiteral(workspaceId)
      }::uuid;
    insert into crm.calls (workspace_id, person_id, called_at, content) values (${
        sqlLiteral(workspaceId)
      }::uuid, ${sqlLiteral(personId)}::uuid, '${instant}', 'APR-009 contact');
    insert into crm.notes (id, workspace_id, person_id, body, created_by_member_id, created_at) values (${
        sqlLiteral(noteId)
      }::uuid, ${sqlLiteral(workspaceId)}::uuid, ${
        sqlLiteral(personId)
      }::uuid, 'APR-009 midnight note', ${
        sqlLiteral(memberId)
      }::uuid, '${instant}');
    insert into crm.life_events (id, workspace_id, person_id, name, year, month, day, precision) values
      (${sqlLiteral(calendarId)}::uuid, ${sqlLiteral(workspaceId)}::uuid, ${
        sqlLiteral(personId)
      }::uuid, 'APR-009 calendar date', 2026, 9, 5, 'full'),
      (${sqlLiteral(partialId)}::uuid, ${sqlLiteral(workspaceId)}::uuid, ${
        sqlLiteral(personId)
      }::uuid, 'APR-009 year unknown', null, 2, 29, 'month_day');
    insert into crm.reminders (id, workspace_id, person_id, title, anchor_on, created_by_member_id) values (${
        sqlLiteral(reminderId)
      }::uuid, ${sqlLiteral(workspaceId)}::uuid, ${
        sqlLiteral(personId)
      }::uuid, 'APR-009 reminder', '2026-09-05', ${sqlLiteral(memberId)}::uuid);
    insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on, deliver_at, status) values (${
        sqlLiteral(reminderId)
      }::uuid, ${
        sqlLiteral(memberId)
      }::uuid, '2026-09-05', '${instant}', 'failed');
    insert into crm.audit_events (workspace_id, actor_member_id, actor_name_snapshot, person_id, subject_type, subject_id, action, occurred_at) values
      (${sqlLiteral(workspaceId)}::uuid, ${
        sqlLiteral(memberId)
      }::uuid, 'Test Member', ${sqlLiteral(personId)}::uuid, 'note', ${
        sqlLiteral(noteId)
      }::uuid, 'note.created', '${instant}');`,
    );
    const setPreferences = async (locale: string, timezone: string) => {
      await page.goto("/app/settings/preferences");
      await page.locator('[name="locale"]').fill(locale);
      const zone = page.getByRole("combobox", { name: "Time zone" });
      await zone.fill(timezone);
      if (timezone) {
        await page.getByRole("option", { name: timezone, exact: true }).click();
      } else {
        await zone.press("Tab");
      }
      await expect(zone).toHaveValue(timezone);
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Preferences saved" }),
      ).toBeVisible();
    };
    const checkProfile = async (
      expected: string,
      calendar: string,
      partial: string,
    ) => {
      await page.goto(`/app/people/${personId}?view=timeline`);
      await expect(page.locator("[data-profile-last-contact]")).toHaveText(
        expected,
      );
      await expect(page.locator("[data-reminder-list]")).toContainText(
        `failed · ${expected}`,
      );
      await expect(
        page.locator(`[data-timeline-id="${noteId}"] [data-timeline-date]`),
      ).toHaveText(expected);
      await expect(
        page.locator(`[data-timeline-id="${calendarId}"] [data-timeline-date]`),
      ).toHaveText(calendar);
      await expect(page.locator(`[data-timeline-id="${calendarId}"] time`))
        .toHaveAttribute("datetime", "2026-09-05");
      await expect(
        page.locator(`[data-timeline-id="${partialId}"] [data-timeline-date]`),
      ).toHaveText(partial);
      await page.goto(`/app/people/${personId}/audit`);
      await expect(
        page.locator("[data-audit-list] .audit-event").filter({
          hasText: "Note created",
        }).locator("time"),
      ).toHaveText(expected);
    };
    await setPreferences("de-DE", "");
    const inherited =
      await (await page.request.get(`${origin}/api/v1/settings/preferences`))
        .json();
    expect(inherited.preferences.effectiveTimezone).toBe("Europe/Belgrade");
    expect(inherited.preferences.timezone).toBeUndefined();
    await checkProfile("05.09.2026, 00:10", "5. September 2026", "29. Februar");
    await setPreferences("en-US", "America/Los_Angeles");
    await checkProfile(
      "Sep 4, 2026, 3:10 PM",
      "September 5, 2026",
      "February 29",
    );
  },
);

test(
  "[AUTH-004] APR-008 saved name and sort preferences follow the active membership",
  {
    annotation: [
      { type: "flow", description: "AUTH-004" },
    ],
  },
  async ({ page, request, browserName }) => {
    test.setTimeout(240_000);
    page.setDefaultTimeout(15_000);
    const suffix = `${browserName}-${Date.now()}`;
    const email = `names-${suffix}@example.test`;
    const otherEmail = `names-other-${suffix}@example.test`;
    await registerAccount(request, email, `Names ${suffix}`);
    await registerAccount(request, otherEmail, `Other names ${suffix}`);
    const workspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(email)
      }`,
    );
    const otherWorkspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(otherEmail)
      }`,
    );
    const userId = databaseValue(
      `select id::text from crm.users where email = ${sqlLiteral(email)}`,
    );
    databaseSql(
      `with inserted as (insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at) values (gen_random_uuid(), ${
        sqlLiteral(otherWorkspaceId)
      }::uuid, ${
        sqlLiteral(userId)
      }::uuid, 'member', 'active', now(), now(), now()) returning id) insert into crm.member_preferences (member_id) select id from inserted`,
    );
    await signIn(page, email);
    const createPerson = async (
      targetWorkspaceId: string,
      identity: {
        givenName: string;
        familyName?: string;
        nickname?: string;
        isPartial?: boolean;
      },
    ) => {
      const created = await page.request.post(`${origin}/api/v1/people`, {
        headers: { "X-Workspace-Id": targetWorkspaceId, Origin: origin },
        data: { ...identity, isPartial: identity.isPartial ?? false },
      });
      expect(created.status()).toBe(201);
      return (await created.json() as { person: { id: string } }).person.id;
    };
    const adaId = await createPerson(workspaceId, {
      givenName: "Ada",
      familyName: "Zulu",
    });
    await createPerson(workspaceId, { givenName: "Zoe", familyName: "Alpha" });
    const partialId = await createPerson(workspaceId, {
      givenName: "",
      nickname: "Sunny",
      isPartial: true,
    });
    await createPerson(otherWorkspaceId, {
      givenName: "Ada",
      familyName: "Zulu",
    });
    await createPerson(otherWorkspaceId, {
      givenName: "Zoe",
      familyName: "Alpha",
    });

    await page.goto("/app/settings/preferences");
    await page.getByLabel("Name display").selectOption("family_given_nickname");
    await page.locator('[name="contactSortOrder"]').selectOption(
      "family_name_asc",
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Preferences saved" }),
    ).toBeVisible();
    await page.goto("/app/people");
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "family-name",
    );
    const labels = page.locator("#people-directory-list h2");
    await expect(labels).toHaveCount(3);
    const familyLabels = await labels.allTextContents();
    expect(familyLabels.indexOf("Alpha Zoe")).toBeLessThan(
      familyLabels.indexOf("Zulu Ada"),
    );
    expect(familyLabels).toContain("Sunny");
    await page.goto("/app/people?sort=given-name");
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "given-name",
    );
    await expect(labels).toHaveCount(3);
    const explicitLabels = await labels.allTextContents();
    expect(explicitLabels.indexOf("Zulu Ada")).toBeLessThan(
      explicitLabels.indexOf("Alpha Zoe"),
    );
    await page.reload();
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "given-name",
    );

    const recordedView = page.waitForResponse((response) =>
      response.url().endsWith(`/api/v1/people/${adaId}/view`) &&
      response.request().method() === "POST" && response.status() === 200
    );
    await page.goto(`/app/people/${adaId}`);
    await expect(page.locator("#person-profile-name")).toHaveText("Zulu Ada");
    await recordedView;
    // The palette mounts on intent (FER-01); ArrowDown then opens it.
    await activateGlobalSearch(page);
    await page.getByRole("combobox", { name: "Find a person" }).press(
      "ArrowDown",
    );
    await expect(
      page.locator("#global-people-search-results strong").filter({
        hasText: "Zulu Ada",
      }),
    ).toBeVisible();
    await page.locator("#global-people-search-input").fill("Ada");
    await expect(
      page.locator("#global-people-search-results strong").filter({
        hasText: "Zulu Ada",
      }),
    ).toBeVisible();
    await page.locator("[data-global-people-search-close]").click();
    await page.getByRole("button", { name: "Quick capture", exact: true })
      .click();
    await expect(
      page.locator('[name="participantIds"] option').filter({
        hasText: "Zulu Ada",
      }),
    ).toHaveCount(1);
    await expect(
      page.locator('[name="participantIds"] option').filter({
        hasText: "Sunny",
      }),
    ).toHaveCount(1);
    await page.locator("[data-interaction-cancel]").click();
    await page.goto(`/app/people/${partialId}`);
    await expect(page.locator("#person-profile-name")).toHaveText("Sunny");
    await expect(page.locator("#person-profile-partial")).toBeVisible();

    await page.goto("/app/people");
    await openMemberPopover(page);
    await page.getByLabel("Active workspace").selectOption(otherWorkspaceId);
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "given-name",
    );
    await expect(labels).toHaveText(["Ada Zulu", "Zoe Alpha"]);
    await openMemberPopover(page);
    await page.getByLabel("Active workspace").selectOption(workspaceId);
    await expect(page.locator("#people-directory-sort")).toHaveValue(
      "family-name",
    );
    await expect(labels).toContainText(["Alpha Zoe", "Zulu Ada"]);
  },
);

test(
  "[AUTH-004] [WORKSPACE-001] member settings and role-safe workspace administration are tenant-safe",
  {
    annotation: [
      { type: "flow", description: "AUTH-004" },
      { type: "flow", description: "WORKSPACE-001" },
    ],
  },
  async ({ browser, browserName, context, page, request }) => {
    test.setTimeout(240_000);
    const policyViolations = recordPolicyViolations(page);
    const suffix = `${browserName}-${Date.now()}`;
    const ownerEmail = `settings-owner-${suffix}@example.test`;
    const memberEmail = `settings-member-${suffix}@example.test`;
    const foreignEmail = `settings-foreign-${suffix}@example.test`;
    await registerAccount(request, ownerEmail, `Owner ${suffix}`);
    await registerAccount(request, memberEmail, `Member ${suffix}`);
    await registerAccount(request, foreignEmail, `Foreign ${suffix}`);
    const ownerWorkspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(ownerEmail)
      }`,
    );
    const memberUserId = databaseValue(
      `select id::text from crm.users where email = ${sqlLiteral(memberEmail)}`,
    );
    const foreignMemberId = databaseValue(
      `select wm.id::text from crm.workspace_members wm join crm.users u on u.id = wm.user_id where u.email = ${
        sqlLiteral(foreignEmail)
      }`,
    );
    const foreignWorkspaceId = databaseValue(
      `select w.id::text from crm.workspaces w join crm.users u on u.id = w.created_by_user_id where u.email = ${
        sqlLiteral(foreignEmail)
      }`,
    );
    const ownerUserId = databaseValue(
      `select id::text from crm.users where email = ${sqlLiteral(ownerEmail)}`,
    );
    databaseSql(
      `with inserted as (insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at) values (gen_random_uuid(), ${
        sqlLiteral(ownerWorkspaceId)
      }::uuid, ${
        sqlLiteral(memberUserId)
      }::uuid, 'member', 'active', now(), now(), now()) returning id) insert into crm.member_preferences (member_id) select id from inserted`,
    );
    databaseSql(
      `with inserted as (insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at, created_at, updated_at) values (gen_random_uuid(), ${
        sqlLiteral(foreignWorkspaceId)
      }::uuid, ${
        sqlLiteral(ownerUserId)
      }::uuid, 'admin', 'active', now(), now(), now()) returning id) insert into crm.member_preferences (member_id) select id from inserted`,
    );

    await signIn(page, ownerEmail);
    await page.goto("/app/settings/profile");
    await expect(page.locator("body")).toHaveAttribute(
      "data-page-id",
      "settings.profile",
    );
    await expect(page.getByLabel("First name")).toHaveValue("Test");
    await page.getByLabel("First name").fill("");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toContainText("Review");
    await expect(page.getByLabel("First name")).toBeFocused();
    await expectAccessible(page);
    await page.getByLabel("First name").fill("Ada");
    await page.getByLabel("Last name").fill("Owner");
    await expect(page.getByText("Unsaved changes.")).toBeVisible();
    const navigationChoice = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("beforeunload");
        await dialog.dismiss();
        resolve();
      });
    });
    await page.getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("link", { name: "Settings", exact: true }).click();
    await navigationChoice;
    await expect(page).toHaveURL(/\/app\/settings\/profile$/);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Profile saved" }))
      .toBeVisible();
    await expect(page.getByText("All changes saved.")).toBeVisible();

    await page.goto("/app/settings/preferences");
    await page.getByLabel("Locale").fill("sr-Latn");
    const timeZone = page.getByRole("combobox", { name: "Time zone" });
    await timeZone.fill("Not/AZone");
    await timeZone.press("Tab");
    await expect(timeZone).toHaveValue("Not/AZone");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("alert")).toContainText("Review");
    await expect(page.getByText("Enter a valid IANA time zone.")).toBeVisible();
    await expect(timeZone).toHaveAttribute("aria-invalid", "true");
    await expect(timeZone).toBeFocused();
    await timeZone.fill("Belgrade");
    await page.getByRole("option", { name: "Europe/Belgrade" }).click();
    await expect(timeZone).toHaveValue("Europe/Belgrade");
    // The currency is a choice among the supported codes (GIFTS-001), so an
    // unsupported one can no longer be typed.
    const currency = page.getByLabel("Currency");
    await expect(currency.locator("option").first()).toHaveText(
      "Workspace default",
    );
    await currency.selectOption("EUR");
    await page.getByLabel("Use fluid layout").check();
    await expect(page.getByText("Unsaved changes.")).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Preferences saved" }),
    ).toBeVisible();
    const originalBodyBackground = await page.locator("body").evaluate(
      (body) => getComputedStyle(body).backgroundColor,
    );
    // The header's theme switch is labelled "Theme: …"; the select is the
    // one combobox named Theme.
    const theme = page.getByRole("combobox", { name: "Theme" });
    await theme.selectOption("dark");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect.poll(() =>
      page.locator("body").evaluate((body) =>
        getComputedStyle(body).backgroundColor
      )
    ).not.toBe(originalBodyBackground);
    await expect(
      page.getByRole("status").filter({ hasText: "Dark theme saved" }),
    ).toBeVisible();
    await expectAccessible(page);
    await page.evaluate(() => localStorage.removeItem("kinship.theme"));
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(theme).toHaveValue("dark");
    await theme.selectOption("system");
    await expect(page.locator("html")).not.toHaveAttribute("data-theme");
    await expect(
      page.getByRole("status").filter({ hasText: "System theme saved" }),
    ).toBeVisible();

    // The header switch steps the same saved theme and the select follows.
    const headerTheme = page.getByRole("button", { name: /^Theme: System/ });
    await headerTheme.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(theme).toHaveValue("light");
    await expect(
      page.getByRole("status").filter({ hasText: "Light theme saved" }),
    ).toBeVisible();
    await page.goto("/auth/sign-in");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.goto("/app/settings/preferences");
    await theme.selectOption("system");
    await expect(
      page.getByRole("status").filter({ hasText: "System theme saved" }),
    ).toBeVisible();

    const otherContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const otherPage = await otherContext.newPage();
    await signIn(otherPage, ownerEmail);
    await page.goto("/app/settings/security");
    await expect(page.getByText(/2 active/)).toBeVisible();
    await page.getByRole("button", { name: "Revoke", exact: true }).click();
    await expect(page.getByText(/1 active/)).toBeVisible();
    await otherPage.goto("/app");
    await expect(
      otherPage.getByRole("heading", { name: "Sign in to Kinship" }),
    ).toBeVisible();
    await otherContext.close();

    await page.goto("/app/settings/workspace");
    await page.evaluate(
      (workspaceId) =>
        sessionStorage.setItem("kinship.active-workspace", workspaceId),
      ownerWorkspaceId,
    );
    await page.reload();
    const workspaceName = page.getByLabel("Workspace name");
    const workspaceSwitcher = page.getByLabel("Active workspace");
    await expect(workspaceName).toHaveValue(`Owner ${suffix}`);
    await workspaceName.fill(`Unsaved ${suffix}`);
    await openMemberPopover(page);
    const cancelSwitch = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        expect(dialog.message()).toMatch(/unsaved changes/i);
        await dialog.dismiss();
        resolve();
      });
    });
    await workspaceSwitcher.selectOption(foreignWorkspaceId);
    await cancelSwitch;
    await expect(workspaceSwitcher).toHaveValue(ownerWorkspaceId);
    await expect(workspaceName).toHaveValue(`Unsaved ${suffix}`);
    await expect(page.getByText("Unsaved changes.")).toBeVisible();
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("kinship.active-workspace")
      ),
    ).toBe(ownerWorkspaceId);
    expect(databaseValue(
      `select name from crm.workspaces where id = ${
        sqlLiteral(ownerWorkspaceId)
      }::uuid`,
    )).not.toBe(`Unsaved ${suffix}`);

    await openMemberPopover(page);
    const discardSwitch = new Promise<void>((resolve) => {
      page.once("dialog", async (dialog) => {
        expect(dialog.type()).toBe("confirm");
        await dialog.accept();
        resolve();
      });
    });
    await workspaceSwitcher.selectOption(foreignWorkspaceId);
    await discardSwitch;
    await expect(page).toHaveURL(/\/app\/settings\/workspace$/);
    await expect(workspaceSwitcher).toHaveValue(foreignWorkspaceId);
    await expect(workspaceName).toHaveValue(`Foreign ${suffix}`);
    expect(
      await page.evaluate(() =>
        sessionStorage.getItem("kinship.active-workspace")
      ),
    ).toBe(foreignWorkspaceId);
    await openMemberPopover(page);
    await workspaceSwitcher.selectOption(ownerWorkspaceId);
    await expect(workspaceName).toHaveValue(`Owner ${suffix}`);

    await page.getByLabel("Workspace name").fill(`Trusted ${suffix}`);
    await page.getByLabel("Workspace slug").fill(
      `trusted-${browserName}-${Date.now()}`,
    );
    await page.getByLabel("Default locale").fill("sr-Latn");
    const defaultZone = page.getByRole("combobox", {
      name: "Default time zone",
    });
    await defaultZone.fill("Belgrade");
    await page.getByRole("option", { name: "Europe/Belgrade" }).click();
    await expect(defaultZone).toHaveValue("Europe/Belgrade");
    const defaultCurrency = page.getByLabel("Default currency");
    await expect(defaultCurrency.locator("option").first()).toHaveText(
      "None (US dollars)",
    );
    await defaultCurrency.selectOption("EUR");
    await page.getByLabel("Default reminder time").fill("09:30");
    await expect(page.getByText("Unsaved changes.")).toBeVisible();
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "Workspace settings saved" }),
    ).toBeVisible();

    await page.goto("/app/settings/members");
    const memberRole = page.getByLabel(`Access level for ${memberEmail}`);
    const memberRow = memberRole.locator("xpath=ancestor::li");
    await memberRole.selectOption("admin");
    await memberRow.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(`${memberEmail} updated.`)).toBeVisible();
    const ownerRole = page.getByLabel(`Access level for ${ownerEmail}`);
    const ownerRow = ownerRole.locator("xpath=ancestor::li");
    await ownerRole.selectOption("member");
    await ownerRow.getByRole("button", { name: "Save" }).click();
    await expect(
      page.getByText(/At least one active workspace owner must remain/i),
    ).toBeVisible();
    await memberRole.selectOption("member");
    await memberRow.getByRole("button", { name: "Save" }).click();
    await expect(page.getByText(`${memberEmail} updated.`)).toBeVisible();
    const crossed = await request.patch(
      `${origin}/api/v1/settings/members/${foreignMemberId}`,
      {
        headers: {
          cookie: await sessionCookie(context),
          origin,
          "X-Workspace-Id": ownerWorkspaceId,
        },
        data: { role: "admin", status: "active" },
      },
    );
    expect(crossed.status()).toBe(404);

    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    await signIn(memberPage, memberEmail);
    await memberPage.evaluate(
      (workspaceId) =>
        sessionStorage.setItem("kinship.active-workspace", workspaceId),
      ownerWorkspaceId,
    );
    await memberPage.goto("/app/settings/workspace");
    await expect(
      memberPage.getByRole("heading", {
        name: "Workspace settings unavailable",
      }),
    ).toBeVisible();
    await memberContext.close();
    expect(policyViolations).toEqual([]);
  },
);
