/**
 * The notification bell's pure half (GAP-053, `TODAY-002`): its wording and
 * the one reducer the bell moves through. Nothing here touches the DOM.
 *
 * Read state is the member's read-through watermark, not a flag per item:
 * "Mark all read" saves the newest shown item's time, and every item at or
 * before it is read. So a saved mark clears every item shown and the whole
 * unread count at once, and the next refresh brings anything newer.
 */

import type {
  NotificationItem,
  NotificationsPage,
} from "../../../../../../packages/contracts/generated/auth-client.ts";

/** The unread count's bound: the server counts no further than 100. */
const UNREAD_CAP = 100;

/** The badge: nothing at zero, and 99+ once the count reaches its bound. */
export function badgeText(unread: number): string {
  if (unread <= 0) return "";
  return unread >= UNREAD_CAP ? "99+" : String(unread);
}

/** The bell's accessible name, which carries the unread count. */
export function bellLabel(unread: number): string {
  if (unread <= 0) return "Notifications";
  return unread >= UNREAD_CAP
    ? "Notifications, more than 99 unread"
    : `Notifications, ${unread} unread`;
}

/** What one notification says: a title and a line of detail. */
export function notificationText(
  item: NotificationItem,
): { readonly detail: string; readonly title: string } {
  const person = item.person?.name;
  switch (item.kind) {
    case "reminder":
      return {
        detail: person ? `Reminder about ${person}` : "Reminder",
        title: item.title ?? "Reminder",
      };
    case "reminder-email-failed":
      return {
        detail: [item.title ?? "Reminder", person].filter(Boolean).join(" · "),
        title: "A reminder email could not be delivered",
      };
    case "export-ready":
      return {
        detail: "Download it from Export before it expires.",
        title: "Your export is ready",
      };
    case "import-finished":
      return {
        detail: "Review what was imported.",
        title: "Your import finished",
      };
    case "invitation-accepted":
      return {
        detail: "A new member joined this workspace.",
        title: "An invitation you sent was accepted",
      };
  }
}

export interface NotificationsState {
  /**
   * The session: `pending` until it resolves, `ready` once the bell may
   * read, and `gone` when the session was lost, which hides the bell.
   */
  readonly session: "gone" | "pending" | "ready";
  /** `loading` and `error` only until a first page is shown. */
  readonly status: "error" | "idle" | "loading" | "ready";
  readonly items: readonly NotificationItem[];
  /** At most 100, which means more than 99. */
  readonly unreadCount: number;
  /** Mark all read is saving; the button waits. */
  readonly marking: boolean;
  /** What the panel's status line says about the last mark. */
  readonly notice: string;
}

export type NotificationsAction =
  | {
    readonly type: "session";
    readonly session: NotificationsState["session"];
  }
  | { readonly type: "read-started" }
  | { readonly type: "read-loaded"; readonly page: NotificationsPage }
  | { readonly type: "read-failed" }
  | { readonly type: "mark-started" }
  | { readonly type: "mark-saved" }
  | { readonly type: "mark-failed"; readonly detail: string };

export const initialNotifications: NotificationsState = {
  items: [],
  marking: false,
  notice: "",
  session: "pending",
  status: "idle",
  unreadCount: 0,
};

export function notificationsReducer(
  state: NotificationsState,
  action: NotificationsAction,
): NotificationsState {
  switch (action.type) {
    case "session":
      return { ...state, session: action.session };
    case "read-started":
      // A refresh keeps what is shown; only a first read shows loading.
      return state.status === "ready" ? state : { ...state, status: "loading" };
    case "read-loaded":
      return {
        ...state,
        items: action.page.items,
        status: "ready",
        unreadCount: action.page.unreadCount,
      };
    case "read-failed":
      return state.status === "ready" ? state : { ...state, status: "error" };
    case "mark-started":
      return { ...state, marking: true, notice: "" };
    case "mark-saved":
      return {
        ...state,
        items: state.items.map((item) =>
          item.unread ? { ...item, unread: false } : item
        ),
        marking: false,
        notice: "All notifications marked read.",
        unreadCount: 0,
      };
    case "mark-failed":
      return { ...state, marking: false, notice: action.detail };
  }
}
