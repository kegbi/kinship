/**
 * The member's notifications (GAP-053, `TODAY-002`): a bounded, newest-first
 * feed of what happened for them, with the read state the product owner
 * chose — one read-through watermark per member, not a flag per item.
 *
 * The watermark is `notificationsReadThrough` in the member's interface
 * state, read and validated by the same `workspaces` rule the save goes
 * through. A notification is unread while its time is after it; without one,
 * every notification is. Marking read is the `workspaces` interface-state
 * save, never this read model, which only reads.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import {
  actorMayRead,
  type ActorRevalidation,
  readThroughInstant,
} from "../../../modules/workspaces/public.ts";
import type {
  NotificationKind,
  NotificationPerson,
  NotificationPosition,
  NotificationRecord,
  NotificationsActor,
  NotificationsRepository,
} from "../ports/notifications_repository.ts";

export interface ReadModelTransaction {
  readonly opaque: unknown;
}

/** The most notifications one page answers. */
export const NOTIFICATIONS_PAGE_SIZE = 50;
/** The unread count is counted no further; the badge shows "99+" there. */
export const NOTIFICATIONS_UNREAD_CAP = 100;

export interface NotificationItem {
  /** Where the notification opens, inside the application. */
  readonly href: string;
  readonly id: string;
  readonly kind: NotificationKind;
  readonly occurredAt: string;
  readonly person?: NotificationPerson;
  readonly title?: string;
  readonly unread: boolean;
}

export type ListNotificationsResult =
  | Failure<"forbidden">
  | { readonly status: "invalid-cursor" }
  | {
    readonly items: readonly NotificationItem[];
    readonly nextCursor?: string;
    readonly readThrough?: string;
    readonly status: "ready";
    /** At most `NOTIFICATIONS_UNREAD_CAP`, which means more than 99. */
    readonly unreadCount: number;
  };

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-58][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function base64Url(value: string): string {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

function encodeCursor(position: NotificationPosition): string {
  return base64Url(JSON.stringify({ ...position, version: 1 }));
}

function decodeCursor(value: string): NotificationPosition | undefined {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
    const parsed: unknown = JSON.parse(atob(normalized));
    if (typeof parsed !== "object" || parsed === null) return undefined;
    const cursor = parsed as Record<string, unknown>;
    const at = readThroughInstant(cursor.at);
    if (
      cursor.version !== 1 || !at || typeof cursor.id !== "string" ||
      !UUID_PATTERN.test(cursor.id)
    ) return undefined;
    return { at, id: cursor.id };
  } catch {
    return undefined;
  }
}

/**
 * Where a notification opens. An accepted invitation opens the members page
 * only for a member who may manage members; an inviter since demoted to
 * member lands on Today instead of a page that would refuse them.
 */
function href(
  record: NotificationRecord,
  role: NotificationsActor["role"],
): string {
  switch (record.kind) {
    case "reminder":
    case "reminder-email-failed":
      return record.person
        ? `/app/people/${record.person.id}?section=reminders`
        : "/app";
    case "export-ready":
      return "/app/settings/export";
    case "import-finished":
      return record.subjectId
        ? `/app/settings/import/${record.subjectId}`
        : "/app/settings/import";
    case "invitation-accepted":
      return role === "member" ? "/app" : "/app/settings/members";
  }
}

function item(
  record: NotificationRecord,
  readThrough: string | undefined,
  role: NotificationsActor["role"],
): NotificationItem {
  return {
    href: href(record, role),
    id: record.id,
    kind: record.kind,
    occurredAt: record.occurredAt,
    ...(record.person ? { person: record.person } : {}),
    ...(record.title ? { title: record.title } : {}),
    unread: readThrough === undefined || record.occurredAt > readThrough,
  };
}

export function createNotifications(dependencies: {
  readonly actors: ActorRevalidation;
  readonly repository: NotificationsRepository;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
    ): Promise<T>;
  };
}) {
  return {
    list: async (
      actor: NotificationsActor,
      input: { readonly cursor?: string },
    ): Promise<ListNotificationsResult> => {
      const after = input.cursor ? decodeCursor(input.cursor) : undefined;
      if (input.cursor && !after) return { status: "invalid-cursor" };
      if (!await actorMayRead(dependencies, actor)) {
        return { status: "forbidden" };
      }
      // The count reads the watermark itself, so the page and the count
      // start together and wait on no read before them.
      const [records, unread] = await Promise.all([
        dependencies.repository.list({
          ...actor,
          ...(after ? { after } : {}),
          limit: NOTIFICATIONS_PAGE_SIZE + 1,
        }),
        dependencies.repository.countUnread({
          ...actor,
          cap: NOTIFICATIONS_UNREAD_CAP,
        }),
      ]);
      const readThrough = readThroughInstant(unread.readThrough);
      const unreadCount = unread.count;
      const page = records.slice(0, NOTIFICATIONS_PAGE_SIZE);
      const final = page.at(-1);
      return {
        items: page.map((record) => item(record, readThrough, actor.role)),
        ...(records.length > NOTIFICATIONS_PAGE_SIZE && final
          ? { nextCursor: encodeCursor({ at: final.occurredAt, id: final.id }) }
          : {}),
        ...(readThrough ? { readThrough } : {}),
        status: "ready",
        unreadCount: Math.min(unreadCount, NOTIFICATIONS_UNREAD_CAP),
      };
    },
  };
}

export type Notifications = ReturnType<typeof createNotifications>;
