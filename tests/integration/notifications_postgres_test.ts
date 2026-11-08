/**
 * The member's notification feed against PostgreSQL (GAP-053, TODAY-002).
 *
 * The feed's scoping lives only in SQL: each arm is addressed to one member
 * of one workspace. These suites prove that a member sees their own delivered
 * in-app reminders, their own undeliverable email reminders, their own
 * finished data jobs while they may still run them, and the invitations they
 * sent that were accepted — and never another member's or another
 * workspace's. They prove the read-through watermark is read from, and saved
 * through, the member's interface state, that it only moves forward, and
 * that the feed pages by cursor.
 */

import {
  CapturedVerificationMail,
  createConfiguredApiApp,
} from "../../apps/api/composition.ts";
import { browserSecurityPolicy } from "../../apps/api/security_config.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import {
  addMembership,
  openSql,
  requireDatabaseUrl,
  revokeMembership,
} from "../support/database.ts";
import { apiSupport, ORIGIN, type SignedInFixture } from "../support/api.ts";
import { createNotifications } from "../../packages/backend/read-models/notifications/public.ts";
import { PostgresNotificationsRepository } from "../../packages/backend/read-models/notifications/adapters/postgres/notifications_repository.ts";
import { peopleTransactionRunner } from "../../packages/backend/modules/people/composition.ts";
import { workspaceActors } from "../../packages/backend/modules/workspaces/composition.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { createPerson } from "../support/fixtures.ts";
import {
  describePlan,
  explainedPlan,
  planNodes,
  rowsProduced,
  scansOf,
  unionBranches,
  withScratchCrm,
} from "../support/query_plan.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl);
const mail = new CapturedVerificationMail();
const configured = createConfiguredApiApp(
  databaseUrl,
  mail,
  browserSecurityPolicy("test", ORIGIN),
);
const api = apiSupport(configured.app, mail, sql);

interface Page {
  readonly items: readonly {
    readonly href: string;
    readonly id: string;
    readonly kind: string;
    readonly occurredAt: string;
    readonly person?: { readonly id: string; readonly name: string };
    readonly title?: string;
    readonly unread: boolean;
  }[];
  readonly nextCursor?: string;
  readonly readThrough?: string;
  readonly unreadCount: number;
}

interface Member {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

function register(label: string): Promise<SignedInFixture> {
  return api.register(
    `notify-${label}-${crypto.randomUUID()}@example.test`,
    `Notify ${label}`,
  );
}

/** A second member of `workspaceId`, invited by `invitedBy` when given. */
async function colleague(
  workspaceId: string,
  role: "admin" | "member" = "member",
  invitedBy?: string,
): Promise<Member> {
  const userId = crypto.randomUUID();
  await sql`
    insert into crm.users (id, email, first_name, status)
    values (${userId}, ${`colleague-${userId}@example.test`}, 'Colleague',
      'active')
  `;
  const memberId = await addMembership(sql, userId, workspaceId, role);
  if (invitedBy) {
    await sql`
      update crm.workspace_members set invited_by_member_id = ${invitedBy}
      where id = ${memberId}
    `;
  }
  return { memberId, role, userId, workspaceId };
}

function person(owner: SignedInFixture, givenName: string): Promise<string> {
  return createPerson(api, owner, {
    duplicateOverride: true,
    familyName: "Lovelace",
    givenName,
    isPartial: false,
  });
}

/** A reminder about `personId` with one occurrence for `memberId`. */
async function occurrence(
  workspaceId: string,
  memberId: string,
  personId: string | null,
  options: {
    readonly at: string;
    readonly channel?: "email" | "in_app";
    readonly status?: "manual_attention" | "pending" | "sent";
    readonly title?: string;
  },
): Promise<string> {
  const [reminder] = await sql<{ readonly id: string }[]>`
    insert into crm.reminders (
      workspace_id, person_id, target_kind, title, anchor_on,
      created_by_member_id
    ) values (
      ${workspaceId}, ${personId}, ${personId ? "person" : "custom"},
      ${options.title ?? "Call Ada"}, ${options.at.slice(0, 10)}::date,
      ${memberId}
    ) returning id::text
  `;
  const status = options.status ?? "sent";
  const [row] = await sql<{ readonly id: string }[]>`
    insert into crm.reminder_occurrences (
      reminder_id, member_id, occurs_on, deliver_at, channel, status,
      sent_at, title_snapshot, provider_result_state, provider_receipt,
      provider_effect_at, visible_at
    ) values (
      ${reminder!.id}, ${memberId}, ${options.at.slice(0, 10)}::date,
      ${options.at}::timestamptz, ${options.channel ?? "in_app"}, ${status},
      ${status === "sent" ? options.at : null}::timestamptz,
      ${options.title ?? "Call Ada"},
      ${
    status === "sent"
      ? "confirmed"
      : status === "manual_attention"
      ? "ambiguous"
      : "unattempted"
  },
      ${status === "sent" ? "receipt" : null},
      ${status === "sent" ? options.at : null}::timestamptz,
      ${status === "sent" ? options.at : null}::timestamptz
    ) returning id::text
  `;
  return row!.id;
}

async function audit(
  workspaceId: string,
  action: string,
  options: {
    readonly actorMemberId?: string;
    readonly at: string;
    readonly payload?: Readonly<Record<string, unknown>>;
    readonly personId?: string;
    readonly subjectId?: string;
    readonly subjectType: string;
  },
): Promise<string> {
  const [row] = await sql<{ readonly id: string }[]>`
    insert into crm.audit_events (
      workspace_id, actor_member_id, person_id, subject_type, subject_id,
      action, payload, occurred_at
    ) values (
      ${workspaceId}, ${options.actorMemberId ?? null}, ${
    options.personId ?? null
  },
      ${options.subjectType}, ${options.subjectId ?? null}, ${action},
      ${JSON.stringify(options.payload ?? {})}::jsonb,
      ${options.at}::timestamptz
    ) returning id::text
  `;
  return row!.id;
}

async function feed(
  owner: SignedInFixture,
  cursor?: string,
): Promise<Page> {
  const response = await api.request(
    owner,
    `/api/v1/notifications${
      cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""
    }`,
  );
  assertEquals(response.status, 200, await response.clone().text());
  return await response.json() as Page;
}

/** The feed read for a member without a session, through the read model. */
async function feedOf(member: Member) {
  const connection = connectDatabase(databaseUrl);
  try {
    return await createNotifications({
      actors: workspaceActors(),
      repository: new PostgresNotificationsRepository(connection.db),
      transaction: peopleTransactionRunner(connection.db),
    }).list(member, {});
  } finally {
    await connection.destroy();
  }
}

Deno.test("[TODAY-002] a member sees only their own notifications, newest first", async () => {
  const owner = await register("scope");
  const other = await register("elsewhere");
  const ada = await person(owner, "Ada");
  const colleagueMember = await colleague(owner.workspaceId, "admin");
  const invited = await colleague(owner.workspaceId, "member", owner.memberId);
  const invitedByColleague = await colleague(
    owner.workspaceId,
    "member",
    colleagueMember.memberId,
  );

  const reminderId = await occurrence(owner.workspaceId, owner.memberId, ada, {
    at: "2026-09-28T12:00:00.123456Z",
  });
  // Another member's reminder, a pending one, and an email one stay out.
  await occurrence(owner.workspaceId, colleagueMember.memberId, ada, {
    at: "2026-09-28T12:30:00Z",
  });
  await occurrence(owner.workspaceId, owner.memberId, ada, {
    at: "2026-09-28T12:40:00Z",
    status: "pending",
  });
  await occurrence(owner.workspaceId, owner.memberId, ada, {
    at: "2026-09-28T12:50:00Z",
    channel: "email",
  });
  const exportId = crypto.randomUUID();
  const exportEvent = await audit(owner.workspaceId, "export.completed", {
    actorMemberId: owner.memberId,
    at: "2026-09-28T11:00:00Z",
    subjectId: exportId,
    subjectType: "data_export",
  });
  await audit(owner.workspaceId, "export.completed", {
    actorMemberId: colleagueMember.memberId,
    at: "2026-09-28T11:30:00Z",
    subjectId: crypto.randomUUID(),
    subjectType: "data_export",
  });
  const importId = crypto.randomUUID();
  const importEvent = await audit(owner.workspaceId, "import.committed", {
    actorMemberId: owner.memberId,
    at: "2026-09-28T10:00:00Z",
    subjectId: importId,
    subjectType: "data_import",
  });
  const joined = await audit(owner.workspaceId, "workspace.member-joined", {
    actorMemberId: invited.memberId,
    at: "2026-09-28T09:00:00Z",
    subjectId: invited.memberId,
    subjectType: "workspace_member",
  });
  await audit(owner.workspaceId, "workspace.member-joined", {
    actorMemberId: invitedByColleague.memberId,
    at: "2026-09-28T09:30:00Z",
    subjectId: invitedByColleague.memberId,
    subjectType: "workspace_member",
  });
  const failedEmail = await occurrence(
    owner.workspaceId,
    owner.memberId,
    ada,
    {
      at: "2026-09-28T07:00:00Z",
      channel: "email",
      status: "manual_attention",
      title: "Send the card",
    },
  );
  const emailEvent = await audit(
    owner.workspaceId,
    "planning.reminder-failed",
    {
      at: "2026-09-28T08:00:00Z",
      payload: { channel: "email", status: "failed" },
      personId: ada,
      subjectId: failedEmail,
      subjectType: "reminder_occurrence",
    },
  );
  const colleagueEmail = await occurrence(
    owner.workspaceId,
    colleagueMember.memberId,
    ada,
    {
      at: "2026-09-28T07:30:00Z",
      channel: "email",
      status: "manual_attention",
    },
  );
  await audit(owner.workspaceId, "planning.reminder-failed", {
    at: "2026-09-28T08:30:00Z",
    payload: { channel: "email", status: "failed" },
    personId: ada,
    subjectId: colleagueEmail,
    subjectType: "reminder_occurrence",
  });
  // Another workspace's rows name this member and this person: still out.
  await audit(other.workspaceId, "export.completed", {
    actorMemberId: owner.memberId,
    at: "2026-09-28T13:00:00Z",
    subjectId: crypto.randomUUID(),
    subjectType: "data_export",
  });

  const page = await feed(owner);
  assertEquals(
    page.items.map((item) => [item.kind, item.id, item.occurredAt]),
    [
      ["reminder", reminderId, "2026-09-28T12:00:00.123Z"],
      ["export-ready", exportEvent, "2026-09-28T11:00:00.000Z"],
      ["import-finished", importEvent, "2026-09-28T10:00:00.000Z"],
      ["invitation-accepted", joined, "2026-09-28T09:00:00.000Z"],
      ["reminder-email-failed", emailEvent, "2026-09-28T08:00:00.000Z"],
    ],
  );
  assertEquals(page.items[0]!.href, `/app/people/${ada}?section=reminders`);
  assertEquals(page.items[0]!.person?.name, "Ada Lovelace");
  assertEquals(page.items[0]!.title, "Call Ada");
  assertEquals(page.items[2]!.href, `/app/settings/import/${importId}`);
  assertEquals(page.items[4]!.title, "Send the card");
  assertEquals(page.unreadCount, 5);
  assert(page.items.every((item) => item.unread), "no watermark: all unread");
  assertEquals(page.readThrough, undefined);

  // The colleague sees their own reminder, export, invitation, and email.
  const theirs = await feedOf(colleagueMember);
  assert(theirs.status === "ready", "the colleague's feed reads");
  assertEquals(theirs.items.map((item) => item.kind), [
    "reminder",
    "export-ready",
    "invitation-accepted",
    "reminder-email-failed",
  ]);
  assert(
    theirs.items.every((item) =>
      ![reminderId, exportEvent, importEvent, joined, emailEvent].includes(
        item.id,
      )
    ),
    "none of the owner's notifications reach the colleague",
  );

  // The other workspace's owner sees none of this workspace's rows.
  const elsewhere = await feed(other);
  assertEquals(elsewhere.items, []);
  assertEquals(elsewhere.unreadCount, 0);
});

Deno.test("[TODAY-002] data jobs stay private to members who may run them", async () => {
  const owner = await register("roles");
  const member = await colleague(owner.workspaceId, "admin");
  await audit(owner.workspaceId, "export.completed", {
    actorMemberId: member.memberId,
    at: "2026-09-28T11:00:00Z",
    subjectId: crypto.randomUUID(),
    subjectType: "data_export",
  });
  const asAdmin = await feedOf(member);
  assert(asAdmin.status === "ready", "the admin's feed reads");
  assertEquals(asAdmin.items.map((item) => item.kind), ["export-ready"]);
  await sql`
    update crm.workspace_members set role = 'member'
    where id = ${member.memberId}
  `;
  const demoted = await feedOf({ ...member, role: "member" });
  assert(demoted.status === "ready", "the demoted member's feed reads");
  assertEquals(demoted.items, [], "a demoted member no longer sees exports");
  await revokeMembership(sql, member.memberId);
  assertEquals(
    (await feedOf({ ...member, role: "member" })).status,
    "forbidden",
    "a member who left reads nothing",
  );
});

Deno.test("[TODAY-002] the watermark is saved through interface state and only moves forward", async () => {
  const owner = await register("watermark");
  const ada = await person(owner, "Ada");
  for (const at of ["2026-09-28T10:00:00Z", "2026-09-28T11:00:00.456789Z"]) {
    await occurrence(owner.workspaceId, owner.memberId, ada, { at });
  }
  const before = await feed(owner);
  assertEquals(before.unreadCount, 2);
  const newest = before.items[0]!.occurredAt;
  assertEquals(newest, "2026-09-28T11:00:00.456Z");

  const marked = await api.request(owner, "/api/v1/member/ui-state", "PATCH", {
    notificationsReadThrough: newest,
  });
  assertEquals(marked.status, 200, await marked.clone().text());
  const after = await feed(owner);
  assertEquals(after.unreadCount, 0, "marking all read clears the count");
  assertEquals(after.readThrough, newest);
  assert(after.items.every((item) => !item.unread), "every item is read");

  const stale = await api.request(owner, "/api/v1/member/ui-state", "PATCH", {
    notificationsReadThrough: "2026-09-28T09:00:00.000Z",
  });
  assertEquals(stale.status, 200);
  assertEquals(
    (await stale.json()).uiState.notificationsReadThrough,
    newest,
    "an older watermark from a stale tab leaves the newer one",
  );
  const [stored] = await sql<{ readonly ui_state: Record<string, unknown> }[]>`
    select ui_state from crm.member_preferences where member_id = ${owner.memberId}
  `;
  assertEquals(stored!.ui_state.notificationsReadThrough, newest);

  await occurrence(owner.workspaceId, owner.memberId, ada, {
    at: "2026-09-28T12:00:00Z",
  });
  const later = await feed(owner);
  assertEquals(later.unreadCount, 1, "a newer reminder is unread");
  assertEquals(later.items.map((item) => item.unread), [true, false, false]);

  for (const value of ["tomorrow", "2026-02-30T10:00:00.000Z"]) {
    const invalid = await api.request(
      owner,
      "/api/v1/member/ui-state",
      "PATCH",
      { notificationsReadThrough: value },
    );
    assertEquals(invalid.status, 400, `${value} is refused as invalid`);
  }
});

Deno.test("[TODAY-002] the feed pages by cursor, bounds its count, and drops deleted people", async () => {
  const owner = await register("pages");
  const ada = await person(owner, "Ada");
  const grace = await person(owner, "Grace");
  const start = Date.UTC(2026, 8, 28, 12);
  for (let index = 0; index < 105; index++) {
    await occurrence(owner.workspaceId, owner.memberId, ada, {
      at: new Date(start - index * 60_000).toISOString(),
      title: `Reminder ${index}`,
    });
  }
  await occurrence(owner.workspaceId, owner.memberId, grace, {
    at: new Date(start + 60_000).toISOString(),
  });
  await sql`update crm.people set deleted_at = now() where id = ${grace}`;
  const custom = await occurrence(owner.workspaceId, owner.memberId, null, {
    at: new Date(start + 120_000).toISOString(),
    title: "Water the plants",
  });

  const first = await feed(owner);
  assertEquals(first.items.length, 50);
  assertEquals(first.unreadCount, 100, "the count stops at 100 (99+)");
  assertEquals(first.items[0]!.id, custom, "a custom reminder is listed");
  assertEquals(first.items[0]!.href, "/app");
  assert(
    first.items.every((item) => item.person?.id !== grace),
    "a deleted person's reminder is left out",
  );
  assert(first.nextCursor, "a first page continues");
  const second = await feed(owner, first.nextCursor);
  const third = await feed(owner, second.nextCursor);
  const seen = [...first.items, ...second.items, ...third.items].map((item) =>
    item.id
  );
  assertEquals(seen.length, 106);
  assertEquals(new Set(seen).size, 106, "no notification repeats across pages");
  assertEquals(third.nextCursor, undefined);
  const times = [...first.items, ...second.items, ...third.items].map((item) =>
    item.occurredAt
  );
  assertEquals(times, [...times].sort().reverse(), "newest first throughout");

  const refused = await api.request(
    owner,
    "/api/v1/notifications?cursor=not-a-cursor",
  );
  assertEquals(refused.status, 400);
});

Deno.test("[TODAY-002] a deleted reminder's undeliverable email is not a notification", async () => {
  const owner = await register("deleted-email");
  const ada = await person(owner, "Ada");
  const failed = await occurrence(owner.workspaceId, owner.memberId, ada, {
    at: "2026-09-28T07:00:00Z",
    channel: "email",
    status: "manual_attention",
  });
  await audit(owner.workspaceId, "planning.reminder-failed", {
    at: "2026-09-28T08:00:00Z",
    payload: { channel: "email", status: "failed" },
    personId: ada,
    subjectId: failed,
    subjectType: "reminder_occurrence",
  });
  assertEquals((await feed(owner)).items.map((item) => item.kind), [
    "reminder-email-failed",
  ]);
  await sql`
    update crm.reminders set deleted_at = now()
    where id = (select reminder_id from crm.reminder_occurrences
      where id = ${failed})
  `;
  const after = await feed(owner);
  assertEquals(after.items, [], "the deleted reminder's failure is gone");
  assertEquals(after.unreadCount, 0);
});

Deno.test("[TODAY-002] an inviter demoted to member is not linked to the members page", async () => {
  const owner = await register("demoted");
  const inviter = await colleague(owner.workspaceId, "admin");
  const invited = await colleague(
    owner.workspaceId,
    "member",
    inviter.memberId,
  );
  await audit(owner.workspaceId, "workspace.member-joined", {
    actorMemberId: invited.memberId,
    at: "2026-09-28T09:00:00Z",
    subjectId: invited.memberId,
    subjectType: "workspace_member",
  });
  const asAdmin = await feedOf(inviter);
  assert(asAdmin.status === "ready", "the admin's feed reads");
  assertEquals(asAdmin.items[0]?.href, "/app/settings/members");
  await sql`
    update crm.workspace_members set role = 'member'
    where id = ${inviter.memberId}
  `;
  const demoted = await feedOf({ ...inviter, role: "member" });
  assert(demoted.status === "ready", "the demoted member's feed reads");
  assertEquals(demoted.items[0]?.kind, "invitation-accepted");
  assertEquals(demoted.items[0]?.href, "/app");
});

Deno.test("[TODAY-002] AUD-Q1 each feed arm takes its own page before the arms are merged", async () => {
  const owner = await register("arms");
  const ada = await person(owner, "Ada");
  const start = Date.UTC(2026, 9, 1, 12);
  for (let index = 0; index < 30; index++) {
    await occurrence(owner.workspaceId, owner.memberId, ada, {
      at: new Date(start - index * 60_000).toISOString(),
      title: `Reminder ${index}`,
    });
    await audit(owner.workspaceId, "export.completed", {
      actorMemberId: owner.memberId,
      at: new Date(start - index * 60_000 - 1_000).toISOString(),
      subjectType: "export_job",
    });
  }
  const actor = {
    memberId: owner.memberId,
    role: "owner" as const,
    userId: owner.userId,
    workspaceId: owner.workspaceId,
  };
  const connection = connectDatabase(databaseUrl);
  try {
    const limit = 11;
    const statement = (text: string) => text.includes("crm.audit_events");
    for (
      const [name, read] of [
        [
          "the page",
          (database: typeof connection.db) =>
            new PostgresNotificationsRepository(database).list({
              ...actor,
              limit,
            }),
        ],
        [
          "the unread count",
          (database: typeof connection.db) =>
            new PostgresNotificationsRepository(database).countUnread({
              ...actor,
              cap: limit,
            }),
        ],
      ] as const
    ) {
      const plan = await explainedPlan(connection.db, statement, read);
      const merged = unionBranches(plan);
      assert(
        merged.length > 0,
        `${name} merges no arms: ${describePlan(plan)}`,
      );
      for (const branches of merged) {
        for (const arm of branches) {
          assert(
            rowsProduced(arm) <= limit,
            `an arm of ${name} hands ${
              rowsProduced(arm)
            } rows to the merge for ${limit}: ${describePlan(plan)}`,
          );
        }
      }
    }

    // Two reminders made visible within one millisecond: the feed orders
    // them by id inside that millisecond, as its cursor does, so an arm's
    // own page must be cut on the same key.
    const [first, second] = await Promise.all([
      occurrence(owner.workspaceId, owner.memberId, ada, {
        at: new Date(start + 60_000).toISOString(),
      }),
      occurrence(owner.workspaceId, owner.memberId, ada, {
        at: new Date(start + 60_000).toISOString(),
      }),
    ]);
    const [higher, lower] = first! > second! ? [first!, second!] : [
      second!,
      first!,
    ];
    await sql`
      update crm.reminder_occurrences set visible_at = case id
        when ${higher}::uuid then ${
      new Date(start + 60_000).toISOString()
    }::timestamptz + interval '100 microseconds'
        else ${
      new Date(start + 60_000).toISOString()
    }::timestamptz + interval '900 microseconds' end
      where id in (${higher}::uuid, ${lower}::uuid)
    `;
    const repository = new PostgresNotificationsRepository(connection.db);
    const top = await repository.list({ ...actor, limit: 1 });
    assertEquals(top.map((item) => item.id), [higher]);
    const next = await repository.list({
      ...actor,
      after: { at: top[0]!.occurredAt, id: higher },
      limit: 1,
    });
    assertEquals(next.map((item) => item.id), [lower]);
  } finally {
    await connection.destroy();
  }
});

Deno.test("[TODAY-002] AUD-V1 the reminder arm reads the member's newest delivered reminders in index order", async () => {
  await withScratchCrm(sql, databaseUrl, async ({ sql: scratch, url }) => {
    const [userId, otherUserId, workspaceId, memberId, otherMemberId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await scratch`
      insert into crm.users (id, email) values
        (${userId}, 'plan@example.test'), (${otherUserId}, 'other@example.test')
    `;
    await scratch`
      insert into crm.workspaces (id, name, created_by_user_id)
      values (${workspaceId}, 'Large', ${userId})
    `;
    await scratch`
      insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at)
      values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active', now()),
        (${otherMemberId}, ${workspaceId}, ${otherUserId}, 'member', 'active', now())
    `;
    // Years of delivered in-app reminders for two members, and the open
    // occurrence each reminder has next: the feed shows the newest page.
    await scratch`
      with person as (
        insert into crm.people (workspace_id, given_name)
        select ${workspaceId}::uuid, 'Person ' || n
        from generate_series(1, 300) n
        returning id
      ), reminder as (
        insert into crm.reminders (workspace_id, person_id, target_kind,
          title, anchor_on, recurrence_unit, created_by_member_id)
        select ${workspaceId}::uuid, person.id, 'person', 'Check in',
          current_date, 'month', ${memberId}::uuid
        from person
        returning id
      )
      insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
        deliver_at, channel, status, sent_at, provider_result_state,
        provider_receipt, provider_effect_at, visible_at)
      select reminder.id, member.id, current_date - months.n * 30,
        now() - months.n * interval '30 days', 'in_app', 'sent',
        now() - months.n * interval '30 days', 'confirmed', 'in-app',
        now() - months.n * interval '30 days',
        now() - months.n * interval '30 days' - random() * interval '1 day'
      from reminder
      cross join generate_series(1, 20) months(n)
      cross join (values (${memberId}::uuid), (${otherMemberId}::uuid))
        member(id)
    `;
    await scratch`analyze`;

    const explaining = connectDatabase(url);
    try {
      const limit = 11;
      const plan = await explainedPlan(
        explaining.db,
        (statement) => statement.includes("crm.audit_events"),
        (database) =>
          new PostgresNotificationsRepository(database).list({
            memberId,
            limit,
            role: "owner",
            userId,
            workspaceId,
          }),
      );
      const occurrences = scansOf(plan, "reminder_occurrences");
      const read = occurrences.reduce(
        (sum, scan) => sum + rowsProduced(scan),
        0,
      );
      assert(
        planNodes(plan).some((node) =>
          node["Index Name"] === "reminder_occurrences_member_feed_idx"
        ) &&
          occurrences.every((scan) => scan["Node Type"] !== "Seq Scan") &&
          read <= 4 * limit,
        `the reminder arm reads ${read} of 6,000 delivered occurrences for a page of ${limit}: ${
          describePlan(plan)
        }`,
      );
    } finally {
      await explaining.destroy();
    }
  });
});
