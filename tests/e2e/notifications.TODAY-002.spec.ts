import { expect, test } from "@playwright/test";
import { createPerson, registerVerified } from "./support/api.ts";
import { databaseSql, databaseValue, sqlLiteral } from "./support/database.ts";
import { origin } from "./support/env.ts";
import { waitForIsland } from "./support/islands.ts";
import { bareToken } from "./support/mail.ts";
import {
  settleNavigation,
  settlePersonWorkspace,
} from "./support/navigation.ts";
import {
  expectAccessible,
  recordPolicyViolations,
} from "./support/page-checks.ts";
import { signIn } from "./support/sign-in.ts";

test(
  "[TODAY-002] sees a delivered reminder in the bell, follows it, and marks all read",
  {
    annotation: [{ type: "flow", description: "TODAY-002" }, {
      type: "leaf",
      description: "GAP-053",
    }],
  },
  async ({ browserName, page, request }) => {
    test.setTimeout(300_000);
    page.setDefaultTimeout(15_000);
    const violations = recordPolicyViolations(page);
    const email = `notify-${browserName}-${Date.now()}@example.test`;
    await registerVerified(request, {
      email,
      firstName: "Notice",
      lastName: "Keeper",
      workspaceName: "Notice circle",
    }, bareToken);
    await signIn(page, email);

    // A new member has nothing to read.
    await waitForIsland(page, "notification-bell");
    const bell = page.getByRole("button", { name: /^Notifications/ });
    await expect(bell).toBeEnabled();
    await expect(bell).toHaveAccessibleName("Notifications");
    await bell.click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel.getByText("No notifications yet.", { exact: false }))
      .toBeVisible();
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(bell).toBeFocused();

    // A reminder due in a minute and a finished export of their own.
    const ada = await createPerson(page.request, {
      familyName: "Lovelace",
      givenName: "Ada",
    });
    const target = new Date(Date.now() + 75_000);
    const created = await page.request.post(`${origin}/api/v1/reminders`, {
      data: {
        anchorOn: target.toISOString().slice(0, 10),
        personId: ada,
        recurrenceInterval: 1,
        recurrenceUnit: "none",
        requestId: crypto.randomUUID(),
        sendTime: target.toISOString().slice(11, 16),
        title: "Call Ada soon",
      },
      headers: { origin },
    });
    expect(created.status()).toBe(201);
    const member = databaseValue(
      `select m.id::text from crm.workspace_members m
        join crm.users u on u.id = m.user_id
        where u.email = ${sqlLiteral(email)}`,
    );
    const workspace = databaseValue(
      `select workspace_id::text from crm.people where id = ${
        sqlLiteral(ada)
      }::uuid`,
    );
    databaseSql(`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        occurred_at
      ) values (
        ${sqlLiteral(workspace)}::uuid, ${sqlLiteral(member)}::uuid,
        'data_export', gen_random_uuid(), 'export.completed',
        now() - interval '1 hour'
      );
    `);

    // The worker delivers the reminder.
    await expect.poll(async () => {
      const response = await page.request.get(
        `${origin}/api/v1/notifications`,
      );
      if (response.status() !== 200) return "unavailable";
      const body = await response.json() as {
        items: Array<{ kind: string; title?: string }>;
      };
      return body.items.some((item) =>
          item.kind === "reminder" && item.title === "Call Ada soon"
        )
        ? "delivered"
        : "waiting";
    }, { timeout: 150_000 }).toBe("delivered");

    // The badge counts both on the next page.
    await page.goto("/app");
    await settleNavigation(page);
    await waitForIsland(page, "notification-bell");
    await expect(bell).toHaveAccessibleName("Notifications, 2 unread");
    await expect(page.locator(".notification-bell-badge")).toHaveText("2");
    await bell.click();
    const list = panel.getByRole("list", { name: "Recent notifications" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    const reminder = list.getByRole("link", { name: /Call Ada soon/ });
    await expect(reminder).toContainText("Reminder about Ada Lovelace");
    await expect(list.getByRole("link", { name: /Your export is ready/ }))
      .toHaveAttribute("href", "/app/settings/export");
    await expectAccessible(page);

    // The reminder opens Ada's reminders section.
    await reminder.click();
    await expect(page).toHaveURL(
      new RegExp(`/app/people/${ada}\\?section=reminders$`),
    );
    await settlePersonWorkspace(page);
    await waitForIsland(page, "notification-bell");
    await expect(bell).toHaveAccessibleName("Notifications, 2 unread");

    // Mark all read clears the badge, and it stays clear on the next page.
    await bell.click();
    await panel.getByRole("button", { name: "Mark all read" }).click();
    await expect(panel.getByRole("status")).toHaveText(
      "All notifications marked read.",
    );
    await expect(bell).toHaveAccessibleName("Notifications");
    await expect(page.locator(".notification-bell-badge")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.goto("/app");
    await settleNavigation(page);
    await waitForIsland(page, "notification-bell");
    await expect(bell).toBeEnabled();
    await expect(bell).toHaveAccessibleName("Notifications");
    expect(violations).toEqual([]);
  },
);
