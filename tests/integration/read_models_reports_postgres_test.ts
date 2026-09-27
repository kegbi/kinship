/**
 * The report read models against real PostgreSQL (GAP-037): a person's
 * activity report, the audit history, and the journal timeline, each read
 * through its PostgreSQL repository and public facade, with the rows of a
 * second workspace present and never returned.
 */

import { PostgresActivityReportRepository } from "../../packages/backend/read-models/activity-report/adapters/postgres/activity_report_repository.ts";
import { createActivityReport } from "../../packages/backend/read-models/activity-report/public.ts";
import { PostgresAuditHistoryRepository } from "../../packages/backend/read-models/audit-history/adapters/postgres/audit_history_repository.ts";
import { PostgresJournalTimelineRepository } from "../../packages/backend/read-models/journal-timeline/adapters/postgres/journal_timeline_repository.ts";
import { createJournalTimeline } from "../../packages/backend/read-models/journal-timeline/public.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { revokeMembership } from "../support/database.ts";
import {
  actors,
  addActivity,
  addNote,
  addPerson,
  closeResources,
  connection,
  memberOf,
  type SeededActor,
  sql,
  transaction,
  twoWorkspaces,
} from "./read_models.test-helper.ts";

function actorOf(seeded: SeededActor) {
  return {
    memberId: seeded.memberId,
    role: seeded.role,
    userId: seeded.userId,
    workspaceId: seeded.workspaceId,
  };
}

// --- Activity report -----------------------------------------------------

Deno.test("[INTERACTION-001] GAP-037 PostgreSQL activity report reads one person in one workspace", async () => {
  const { foreign, reader } = await twoWorkspaces("activity-report");
  const friend = await addPerson(reader, "Friend");
  const walk = await addActivity(
    reader,
    "Walk in the park",
    "2025-03-01T10:00:00.000Z",
    [reader.personId, friend],
  );
  const note = await addNote(
    reader,
    reader.personId,
    "Remember the birthday",
    "2026-02-01T09:00:00.000Z",
    true,
  );
  await addActivity(reader, "Without the subject", "2026-02-02T09:00:00Z", [
    friend,
  ]);
  const foreignActivity = await addActivity(
    foreign,
    "Foreign activity",
    "2026-02-03T09:00:00.000Z",
    [foreign.personId],
  );
  await addNote(
    foreign,
    foreign.personId,
    "Foreign note",
    "2026-02-04T09:00:00.000Z",
  );
  // A participant row that crosses the tenant boundary: the foreign person is
  // linked to the reader's activity and must neither surface nor be named.
  await sql`
    insert into crm.activity_participants (activity_id, person_id)
    values (${walk}, ${foreign.personId})
  `;
  const repository = new PostgresActivityReportRepository(connection.db);
  const actor = actorOf(reader);

  const page = await repository.list({
    ...actor,
    limit: 10,
    personId: reader.personId,
  });
  assert("items" in page, `activity report refused: ${JSON.stringify(page)}`);
  const serialized = JSON.stringify(page);
  assert(
    page.status === "ready" && page.person.name === "Reader subject" &&
      JSON.stringify(page.items.map((item) => item.id)) ===
        JSON.stringify([note, walk]) &&
      !serialized.includes(foreign.personId) &&
      !serialized.includes("Foreign"),
    `activity report crossed its person or workspace: ${serialized}`,
  );
  const walkItem = page.items[1];
  assert(
    walkItem?.kind === "activity" &&
      JSON.stringify(walkItem.participants.map((person) => person.id)) ===
        JSON.stringify([friend, reader.personId]),
    "activity participants were not the reader's two people",
  );

  const notesOnly = await repository.list({
    ...actor,
    kind: "note",
    limit: 10,
    personId: reader.personId,
  });
  const inYear = await repository.list({
    ...actor,
    limit: 10,
    personId: reader.personId,
    year: 2025,
  });
  assert(
    "items" in notesOnly && notesOnly.items.length === 1 &&
      notesOnly.items[0]?.id === note && "items" in inYear &&
      inYear.items.length === 1 && inYear.items[0]?.id === walk,
    "the kind and year filters did not narrow the report",
  );

  const first = await repository.list({
    ...actor,
    limit: 1,
    personId: reader.personId,
  });
  assert("items" in first && first.next, "the first page did not continue");
  const second = await repository.list({
    ...actor,
    after: first.next,
    limit: 1,
    personId: reader.personId,
  });
  assert(
    "items" in second && second.items[0]?.id === walk && !second.next,
    "the continuation dropped or repeated an item",
  );

  const foreignPerson = await repository.list({
    ...actor,
    limit: 10,
    personId: foreign.personId,
  });
  const foreignAnchor = await repository.list({
    ...actor,
    after: { id: foreignActivity, timestamp: "2026-02-03T09:00:00.000Z" },
    limit: 10,
    personId: reader.personId,
  });
  assert(
    foreignPerson.status === "not-found" &&
      foreignAnchor.status === "stale-cursor",
    "a foreign person or anchor was answered inside the reader's workspace",
  );
});

Deno.test("[INTERACTION-001] GAP-037 PostgreSQL activity report facade refuses a revoked reader", async () => {
  const { reader } = await twoWorkspaces("activity-report-revoked");
  await addNote(reader, reader.personId, "Private", "2026-01-01T00:00:00Z");
  await sql`
    update crm.people set archived_at = now() where id = ${reader.personId}
  `;
  const report = createActivityReport({
    actors,
    repository: new PostgresActivityReportRepository(connection.db),
    transaction,
  });

  const archived = await report.list(actorOf(reader), reader.personId);
  assert(
    archived.status === "archived" && "items" in archived &&
      archived.items.length === 1,
    `an archived person's report was not readable: ${archived.status}`,
  );
  await revokeMembership(sql, reader.memberId);
  const refused = await report.list(actorOf(reader), reader.personId);
  assert(
    refused.status === "forbidden",
    `a revoked member read a report: ${refused.status}`,
  );
});

// --- Audit history -------------------------------------------------------

async function addAuditEvent(
  actor: SeededActor,
  action: string,
  occurredAt: string,
  personId: string | null = actor.personId,
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.audit_events (
      id, workspace_id, actor_member_id, actor_name_snapshot, person_id,
      subject_type, subject_id, action, payload, occurred_at
    ) values (
      ${id}, ${actor.workspaceId}, ${actor.memberId}, 'Audit Owner',
      ${personId}, 'person', ${personId}, ${action},
      ${sql.json({ fields: ["given_name"] })}, ${occurredAt}
    )
  `;
  return id;
}

Deno.test("[GOVERNANCE-002] GAP-037 PostgreSQL audit history stays in the reader's workspace", async () => {
  const { foreign, reader } = await twoWorkspaces("audit-history");
  const created = await addAuditEvent(
    reader,
    "people.person-created",
    "2026-03-01T10:00:00.000Z",
  );
  const updated = await addAuditEvent(
    reader,
    "people.person-updated",
    "2026-03-02T10:00:00.000Z",
  );
  const workspaceEvent = await addAuditEvent(
    reader,
    "workspaces.settings-updated",
    "2026-03-03T10:00:00.000Z",
    null,
  );
  const foreignEvent = await addAuditEvent(
    foreign,
    "people.person-created",
    "2026-03-04T10:00:00.000Z",
  );
  const repository = new PostgresAuditHistoryRepository(connection.db);
  const actor = actorOf(reader);

  const all = await repository.list({ ...actor, limit: 10 });
  assert("items" in all, `audit history refused: ${JSON.stringify(all)}`);
  assert(
    JSON.stringify(all.items.map((item) => item.id)) ===
        JSON.stringify([workspaceEvent, updated, created]) &&
      !JSON.stringify(all).includes(foreign.personId),
    `audit history crossed workspaces: ${JSON.stringify(all.items)}`,
  );
  const person = await repository.list({
    ...actor,
    limit: 10,
    personId: reader.personId,
  });
  const filtered = await repository.list({
    ...actor,
    action: "people.person-created",
    from: "2026-03-01T00:00:00.000Z",
    limit: 10,
    to: "2026-03-02T00:00:00.000Z",
  });
  assert(
    "items" in person && person.items.length === 2 &&
      person.person?.name === "Reader subject" && "items" in filtered &&
      filtered.items.length === 1 && filtered.items[0]?.id === created &&
      filtered.items[0].actor.name === "Audit Owner" &&
      JSON.stringify(filtered.items[0].payload) ===
        JSON.stringify({ fields: ["given_name"] }),
    "the person, action, and window filters did not narrow the history",
  );

  const first = await repository.list({ ...actor, limit: 2 });
  assert("items" in first && first.next, "the first audit page did not end");
  const rest = await repository.list({ ...actor, after: first.next, limit: 2 });
  assert(
    "items" in rest && rest.items.length === 1 && rest.items[0]?.id === created,
    "the audit continuation dropped or repeated an event",
  );

  const foreignPerson = await repository.list({
    ...actor,
    limit: 10,
    personId: foreign.personId,
  });
  const foreignActor = await repository.list({
    ...actor,
    actorMemberId: foreign.memberId,
    limit: 10,
  });
  const foreignAnchor = await repository.list({
    ...actor,
    after: { id: foreignEvent, timestamp: "2026-03-04T10:00:00.000Z" },
    limit: 10,
  });
  const foreignWorkspace = await repository.list({
    ...actor,
    limit: 10,
    workspaceId: foreign.workspaceId,
  });
  assert(
    foreignPerson.status === "not-found" &&
      foreignActor.status === "not-found" &&
      foreignAnchor.status === "stale-cursor" &&
      foreignWorkspace.status === "forbidden",
    "a foreign person, actor, anchor, or workspace was answered",
  );
});

Deno.test("[GOVERNANCE-002] GAP-037 PostgreSQL audit history is for owners and admins only", async () => {
  const { reader } = await twoWorkspaces("audit-history-roles");
  await addAuditEvent(reader, "people.person-created", "2026-03-01T10:00:00Z");
  const admin = await memberOf(reader, "admin");
  const member = await memberOf(reader, "member");
  const repository = new PostgresAuditHistoryRepository(connection.db);

  const adminRead = await repository.list({ ...actorOf(admin), limit: 10 });
  const memberRead = await repository.list({ ...actorOf(member), limit: 10 });
  // A caller that claims a role its membership does not hold is refused too.
  const claimedRole = await repository.list({
    ...actorOf(member),
    limit: 10,
    role: "owner",
  });
  await revokeMembership(sql, reader.memberId);
  const revoked = await repository.list({ ...actorOf(reader), limit: 10 });
  assert(
    "items" in adminRead && adminRead.items.length === 1 &&
      memberRead.status === "forbidden" &&
      claimedRole.status === "forbidden" && revoked.status === "forbidden",
    "audit history answered a member, a claimed role, or a revoked owner",
  );
});

// --- Journal timeline ----------------------------------------------------

async function addJournalPost(
  actor: SeededActor,
  body: string,
  occurredAt: string,
): Promise<string> {
  const postId = crypto.randomUUID();
  const itemId = crypto.randomUUID();
  await sql`
    insert into crm.journal_posts (id, workspace_id, title, body,
      created_by_member_id)
    values (${postId}, ${actor.workspaceId}, 'Entry', ${body},
      ${actor.memberId})
  `;
  await sql`
    insert into crm.journal_items (id, workspace_id, occurred_at,
      journal_post_id, created_by_member_id)
    values (${itemId}, ${actor.workspaceId}, ${occurredAt}, ${postId},
      ${actor.memberId})
  `;
  return itemId;
}

Deno.test("[JOURNAL-001] GAP-037 PostgreSQL journal timeline stays in the reader's workspace", async () => {
  const { foreign, reader } = await twoWorkspaces("journal-timeline");
  const post = await addJournalPost(
    reader,
    "A quiet day",
    "2026-04-01T20:00:00.000Z",
  );
  const ratingId = crypto.randomUUID();
  const ratingItem = crypto.randomUUID();
  await sql`
    insert into crm.journal_day_ratings (id, workspace_id, rated_on, rating,
      comment, created_by_member_id)
    values (${ratingId}, ${reader.workspaceId}, '2026-04-02', 3, 'Fine',
      ${reader.memberId})
  `;
  await sql`
    insert into crm.journal_items (id, workspace_id, occurred_at,
      day_rating_id)
    values (${ratingItem}, ${reader.workspaceId}, '2026-04-02T20:00:00Z',
      ${ratingId})
  `;
  const linked = await addActivity(
    reader,
    "Linked dinner",
    "2026-04-03T19:00:00.000Z",
    [reader.personId],
  );
  const linkedItem = crypto.randomUUID();
  await sql`
    insert into crm.journal_items (id, workspace_id, occurred_at, activity_id)
    values (${linkedItem}, ${reader.workspaceId}, '2026-04-03T19:00:00Z',
      ${linked})
  `;
  const unlinked = await addActivity(
    reader,
    "Unlinked coffee",
    "2026-04-04T09:00:00.000Z",
    [reader.personId],
  );
  const foreignItem = await addJournalPost(
    foreign,
    "Foreign diary",
    "2026-04-05T20:00:00.000Z",
  );
  await addActivity(foreign, "Foreign lunch", "2026-04-05T12:00:00Z", [
    foreign.personId,
  ]);
  const repository = new PostgresJournalTimelineRepository(connection.db);
  const actor = actorOf(reader);

  const page = await repository.read(actor, { limit: 10 });
  assert(page.status === "ready", `journal refused: ${page.status}`);
  const serialized = JSON.stringify(page);
  assert(
    JSON.stringify(page.items.map((item) => `${item.type}:${item.id}`)) ===
        JSON.stringify([
          `activity:${linkedItem}`,
          `day-rating:${ratingItem}`,
          `post:${post}`,
        ]) &&
      JSON.stringify(page.activities.map((activity) => activity.id)) ===
        JSON.stringify([unlinked]) &&
      !serialized.includes("Foreign"),
    `journal timeline crossed workspaces: ${serialized}`,
  );

  const first = await repository.read(actor, { limit: 2 });
  assert(
    first.status === "ready" && first.next,
    "the journal did not continue",
  );
  const rest = await repository.read(actor, { after: first.next, limit: 2 });
  assert(
    rest.status === "ready" && rest.items.length === 1 &&
      rest.items[0]?.id === post && !rest.next,
    "the journal continuation dropped or repeated an item",
  );

  const own = await repository.read(actor, { itemId: ratingItem, limit: 1 });
  const stranger = await repository.read(actor, {
    itemId: foreignItem,
    limit: 1,
  });
  assert(
    own.status === "ready" && own.items[0]?.type === "day-rating" &&
      stranger.status === "not-found",
    "a foreign journal item was answered inside the reader's workspace",
  );
});

Deno.test("[JOURNAL-001] GAP-037 PostgreSQL journal timeline never reads a foreign activity", async () => {
  const { foreign, reader } = await twoWorkspaces("journal-foreign-link");
  const foreignActivity = await addActivity(
    foreign,
    "Foreign dinner",
    "2026-04-05T19:00:00.000Z",
    [foreign.personId],
  );
  // A journal item whose activity belongs to another workspace: the journal
  // facade never writes one, so it is seeded directly.
  const item = crypto.randomUUID();
  await sql`
    insert into crm.journal_items (id, workspace_id, occurred_at, activity_id)
    values (${item}, ${reader.workspaceId}, '2026-04-05T19:00:00Z',
      ${foreignActivity})
  `;
  const page = await new PostgresJournalTimelineRepository(connection.db)
    .read(actorOf(reader), { limit: 10 });
  assert(page.status === "ready", `journal refused: ${page.status}`);
  const linked = page.items[0];
  assert(
    linked?.type === "activity" && linked.id === item &&
      linked.activity.summary === "Activity unavailable" &&
      page.activities.length === 0 &&
      !JSON.stringify(page).includes("Foreign"),
    `the journal read a cross-workspace activity: ${JSON.stringify(page)}`,
  );
});

Deno.test("[JOURNAL-001] GAP-037 PostgreSQL journal timeline facade refuses a revoked reader", async () => {
  const { reader } = await twoWorkspaces("journal-timeline-revoked");
  const item = await addJournalPost(reader, "Mine", "2026-04-01T20:00:00Z");
  const timeline = createJournalTimeline({
    actors,
    repository: new PostgresJournalTimelineRepository(connection.db),
    transaction,
  });

  const listed = await timeline.list(actorOf(reader));
  const found = await timeline.get(actorOf(reader), item);
  assert(
    listed.status === "ready" && found.status === "ready",
    "an active reader could not read the journal",
  );
  await revokeMembership(sql, reader.memberId);
  const refusedList = await timeline.list(actorOf(reader));
  const refusedGet = await timeline.get(actorOf(reader), item);
  assert(
    refusedList.status === "forbidden" && refusedGet.status === "forbidden",
    "a revoked member read the journal",
  );
});

Deno.test({
  name: "GAP-037 report read-model PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
