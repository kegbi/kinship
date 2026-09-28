import { describe, expect, it } from "vitest";
import type { NotificationItem } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  badgeText,
  bellLabel,
  initialNotifications,
  notificationsReducer,
  notificationText,
} from "./notifications.ts";

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  href: "/app/people/p?section=reminders",
  id: "00000000-0000-4000-8000-000000000001",
  kind: "reminder",
  occurredAt: "2026-09-28T12:00:00.000Z",
  person: { archived: false, id: "p", name: "Ada Lovelace" },
  title: "Call Ada",
  unread: true,
  ...overrides,
});

/** An item without a person or a title. */
const bare = (kind: NotificationItem["kind"]): NotificationItem => {
  const { person: _person, title: _title, ...rest } = item({ kind });
  return rest;
};

const page = (items: readonly NotificationItem[], unreadCount: number) => ({
  items: [...items],
  status: "ready" as const,
  unreadCount,
});

describe("TODAY-002 notification wording", () => {
  it("bounds the badge at 99+ and names the count on the button", () => {
    expect(badgeText(0)).toBe("");
    expect(badgeText(7)).toBe("7");
    expect(badgeText(99)).toBe("99");
    expect(badgeText(100)).toBe("99+");
    expect(bellLabel(0)).toBe("Notifications");
    expect(bellLabel(1)).toBe("Notifications, 1 unread");
    expect(bellLabel(100)).toBe("Notifications, more than 99 unread");
  });

  it("words each kind of notification", () => {
    expect(notificationText(item())).toEqual({
      detail: "Reminder about Ada Lovelace",
      title: "Call Ada",
    });
    expect(notificationText(bare("reminder")))
      .toEqual({ detail: "Reminder", title: "Reminder" });
    expect(notificationText(item({ kind: "reminder-email-failed" }))).toEqual({
      detail: "Call Ada · Ada Lovelace",
      title: "A reminder email could not be delivered",
    });
    expect(notificationText(bare("export-ready"))).toEqual({
      detail: "Download it from Export before it expires.",
      title: "Your export is ready",
    });
    expect(notificationText(bare("reminder-email-failed")).detail).toBe(
      "Reminder",
    );
    expect(notificationText(item({ kind: "import-finished" })).title).toBe(
      "Your import finished",
    );
    expect(notificationText(item({ kind: "invitation-accepted" })).title).toBe(
      "An invitation you sent was accepted",
    );
  });
});

describe("TODAY-002 notification reducer", () => {
  it("reads a page and keeps the list while a refresh runs", () => {
    const loading = notificationsReducer(initialNotifications, {
      type: "read-started",
    });
    expect(loading.status).toBe("loading");
    const ready = notificationsReducer(loading, {
      page: page([item()], 1),
      type: "read-loaded",
    });
    expect(ready).toMatchObject({ status: "ready", unreadCount: 1 });
    expect(ready.items).toHaveLength(1);
    const refreshing = notificationsReducer(ready, { type: "read-started" });
    expect(refreshing.status, "a refresh keeps what is shown").toBe("ready");
    expect(refreshing.items).toHaveLength(1);
    const failedRefresh = notificationsReducer(refreshing, {
      type: "read-failed",
    });
    expect(failedRefresh.status, "a failed refresh keeps the list").toBe(
      "ready",
    );
    expect(
      notificationsReducer(loading, { type: "read-failed" }).status,
    ).toBe("error");
  });

  it("marks everything shown read and clears the badge", () => {
    const ready = notificationsReducer(initialNotifications, {
      page: page([item(), item({ id: "b", unread: false })], 12),
      type: "read-loaded",
    });
    const marking = notificationsReducer(ready, { type: "mark-started" });
    expect(marking.marking).toBe(true);
    const marked = notificationsReducer(marking, { type: "mark-saved" });
    expect(marked).toMatchObject({
      marking: false,
      notice: "All notifications marked read.",
      unreadCount: 0,
    });
    expect(marked.items.every((entry) => !entry.unread)).toBe(true);
    const failed = notificationsReducer(marking, {
      detail: "Your member UI state could not be saved.",
      type: "mark-failed",
    });
    expect(failed).toMatchObject({
      marking: false,
      notice: "Your member UI state could not be saved.",
      unreadCount: 12,
    });
  });

  it("names the newest item a mark-all-read reads through", () => {
    const ready = notificationsReducer(initialNotifications, {
      page: page([item({ occurredAt: "2026-09-28T12:00:00.000Z" })], 1),
      type: "read-loaded",
    });
    expect(ready.items[0]?.occurredAt).toBe("2026-09-28T12:00:00.000Z");
  });
});

describe("TODAY-002 notification session", () => {
  it("waits for the session and hides when it is gone", () => {
    expect(initialNotifications.session).toBe("pending");
    expect(
      notificationsReducer(initialNotifications, {
        session: "ready",
        type: "session",
      }).session,
    ).toBe("ready");
    expect(
      notificationsReducer(initialNotifications, {
        session: "gone",
        type: "session",
      }).session,
    ).toBe("gone");
  });
});
