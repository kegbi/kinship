import { assertEquals } from "../../../testing/assert.ts";
import * as fixtures from "../../../testing/fixtures.ts";
import {
  createNotifications,
  type NotificationRecord,
  NOTIFICATIONS_PAGE_SIZE,
  NOTIFICATIONS_UNREAD_CAP,
  type NotificationsRepository,
} from "../public.ts";

const actor = fixtures.actor();
const personId = fixtures.personId();

const reminder = (index: number, at: string): NotificationRecord => ({
  id: fixtures.uuid(100 + index),
  kind: "reminder",
  occurredAt: at,
  person: { archived: false, id: personId, name: "Ada Lovelace" },
  title: `Call Ada ${index}`,
});

function notifications(
  options: {
    readonly records?: readonly NotificationRecord[];
    /** The watermark as the count statement reads it from the column. */
    readonly readThrough?: unknown;
    readonly revalidation?: "active" | "revoked";
    readonly unread?: number;
  } = {},
) {
  const lists: Parameters<NotificationsRepository["list"]>[0][] = [];
  const counts: Parameters<NotificationsRepository["countUnread"]>[0][] = [];
  const repository: NotificationsRepository = {
    countUnread(command) {
      counts.push(command);
      return Promise.resolve({
        count: options.unread ?? 0,
        ...(options.readThrough === undefined
          ? {}
          : { readThrough: options.readThrough }),
      });
    },
    list(command) {
      lists.push(command);
      return Promise.resolve(options.records ?? []);
    },
  };
  const subject = createNotifications({
    actors: {
      revalidate: () => Promise.resolve(options.revalidation ?? "active"),
    },
    repository,
    transaction: { run: (work) => work({ opaque: undefined }) },
  });
  return { counts, lists, subject };
}

Deno.test("[TODAY-002] notifications are newest first, linked, and unread after the watermark", async () => {
  const { counts, lists, subject } = notifications({
    records: [
      reminder(1, "2026-09-28T12:00:00.000Z"),
      {
        id: fixtures.uuid(201),
        kind: "export-ready",
        occurredAt: "2026-09-28T11:00:00.000Z",
      },
      {
        id: fixtures.uuid(202),
        kind: "import-finished",
        occurredAt: "2026-09-28T10:00:00.000Z",
        subjectId: fixtures.uuid(300),
      },
      {
        id: fixtures.uuid(203),
        kind: "invitation-accepted",
        occurredAt: "2026-09-28T09:00:00.000Z",
      },
      {
        id: fixtures.uuid(204),
        kind: "reminder-email-failed",
        occurredAt: "2026-09-28T08:00:00.000Z",
        person: { archived: true, id: personId, name: "Ada Lovelace" },
        title: "Send the card",
      },
    ],
    readThrough: "2026-09-28T11:00:00.000Z",
    unread: 1,
  });
  // An owner, who may open the members page an accepted invitation links to.
  const result = await subject.list({ ...actor, role: "owner" }, {});
  assertEquals(result, {
    items: [
      {
        href: `/app/people/${personId}?section=reminders`,
        id: fixtures.uuid(101),
        kind: "reminder",
        occurredAt: "2026-09-28T12:00:00.000Z",
        person: { archived: false, id: personId, name: "Ada Lovelace" },
        title: "Call Ada 1",
        unread: true,
      },
      {
        href: "/app/settings/export",
        id: fixtures.uuid(201),
        kind: "export-ready",
        occurredAt: "2026-09-28T11:00:00.000Z",
        unread: false,
      },
      {
        href: `/app/settings/import/${fixtures.uuid(300)}`,
        id: fixtures.uuid(202),
        kind: "import-finished",
        occurredAt: "2026-09-28T10:00:00.000Z",
        unread: false,
      },
      {
        href: "/app/settings/members",
        id: fixtures.uuid(203),
        kind: "invitation-accepted",
        occurredAt: "2026-09-28T09:00:00.000Z",
        unread: false,
      },
      {
        href: `/app/people/${personId}?section=reminders`,
        id: fixtures.uuid(204),
        kind: "reminder-email-failed",
        occurredAt: "2026-09-28T08:00:00.000Z",
        person: { archived: true, id: personId, name: "Ada Lovelace" },
        title: "Send the card",
        unread: false,
      },
    ],
    readThrough: "2026-09-28T11:00:00.000Z",
    status: "ready",
    unreadCount: 1,
  });
  assertEquals(lists[0]?.workspaceId, actor.workspaceId);
  assertEquals(lists[0]?.memberId, actor.memberId);
  assertEquals(lists[0]?.limit, NOTIFICATIONS_PAGE_SIZE + 1);
  assertEquals(counts[0]?.memberId, actor.memberId);
  assertEquals(counts[0]?.cap, NOTIFICATIONS_UNREAD_CAP);
});

Deno.test("[TODAY-002] without a watermark everything is unread", async () => {
  const { counts, subject } = notifications({
    records: [reminder(1, "2026-09-28T12:00:00.000Z")],
    readThrough: "not an instant",
    unread: 1,
  });
  const result = await subject.list(actor, {});
  assertEquals(result.status, "ready");
  if (result.status !== "ready") return;
  assertEquals(result.readThrough, undefined);
  assertEquals(result.items[0]?.unread, true);
  assertEquals(counts.length, 1);
});

Deno.test("[TODAY-002] a custom reminder without a person opens Today", async () => {
  const { subject } = notifications({
    records: [{
      id: fixtures.uuid(1),
      kind: "reminder",
      occurredAt: "2026-09-28T12:00:00.000Z",
      title: "Water the plants",
    }],
  });
  const result = await subject.list(actor, {});
  assertEquals(result.status === "ready" && result.items[0]?.href, "/app");
});

Deno.test("[TODAY-002] the feed pages by cursor and refuses a foreign one", async () => {
  const records = Array.from(
    { length: NOTIFICATIONS_PAGE_SIZE + 1 },
    (_, index) =>
      reminder(
        index,
        new Date(Date.UTC(2026, 8, 28, 12) - index * 60_000).toISOString(),
      ),
  );
  const { lists, subject } = notifications({ records });
  const first = await subject.list(actor, {});
  assertEquals(first.status, "ready");
  if (first.status !== "ready") return;
  assertEquals(first.items.length, NOTIFICATIONS_PAGE_SIZE);
  const last = records[NOTIFICATIONS_PAGE_SIZE - 1]!;
  const second = await subject.list(actor, { cursor: first.nextCursor! });
  assertEquals(second.status, "ready");
  assertEquals(lists[1]?.after, { at: last.occurredAt, id: last.id });
  for (
    const cursor of [
      "not-a-cursor",
      btoa(JSON.stringify({ at: "yesterday", id: last.id, version: 1 })),
      btoa(JSON.stringify({ at: last.occurredAt, id: "nope", version: 1 })),
      btoa(JSON.stringify({ at: last.occurredAt, id: last.id, version: 9 })),
    ]
  ) {
    assertEquals(
      await subject.list(actor, { cursor }),
      { status: "invalid-cursor" },
      cursor,
    );
  }
  assertEquals(lists.length, 2, "an invalid cursor reads nothing");
});

Deno.test("[TODAY-002] a revoked member reads no notifications", async () => {
  const { lists, subject } = notifications({ revalidation: "revoked" });
  assertEquals(await subject.list(actor, {}), { status: "forbidden" });
  assertEquals(lists, []);
});

Deno.test("[TODAY-002] an accepted invitation links to members only for those who manage them", async () => {
  const records: readonly NotificationRecord[] = [{
    id: fixtures.uuid(1),
    kind: "invitation-accepted",
    occurredAt: "2026-09-28T12:00:00.000Z",
  }];
  const hrefFor = async (role: "admin" | "member" | "owner") => {
    const result = await notifications({ records }).subject.list(
      { ...actor, role },
      {},
    );
    return result.status === "ready" ? result.items[0]?.href : undefined;
  };
  assertEquals(await hrefFor("owner"), "/app/settings/members");
  assertEquals(await hrefFor("admin"), "/app/settings/members");
  assertEquals(
    await hrefFor("member"),
    "/app",
    "a demoted inviter is not sent to a page they cannot open",
  );
});
