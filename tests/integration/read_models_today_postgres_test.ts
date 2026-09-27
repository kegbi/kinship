/**
 * The five Today repositories against real PostgreSQL (GAP-037): due tasks,
 * recent interactions and favourite notes, recent people, reminders and
 * cadences, and the attention snapshot. Each is read for one workspace with a
 * second workspace's rows present, and each facade refuses a reader whose
 * membership has been revoked.
 */

import { PostgresTodayAttentionRepository } from "../../packages/backend/read-models/today/adapters/postgres/today_attention_repository.ts";
import { PostgresTodayInteractionsRepository } from "../../packages/backend/read-models/today/adapters/postgres/today_interactions_repository.ts";
import { PostgresTodayRecentPeopleRepository } from "../../packages/backend/read-models/today/adapters/postgres/today_recent_people_repository.ts";
import { PostgresTodayRemindersRepository } from "../../packages/backend/read-models/today/adapters/postgres/today_reminders_repository.ts";
import { PostgresTodayTasksRepository } from "../../packages/backend/read-models/today/adapters/postgres/today_tasks_repository.ts";
import {
  createTodayAttention,
  createTodayInteractions,
  createTodayRecentPeople,
  createTodayReminders,
  createTodayTasks,
} from "../../packages/backend/read-models/today/public.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import { revokeMembership } from "../support/database.ts";
import {
  actors,
  addActivity,
  addNote,
  addPerson,
  closeResources,
  connection,
  type SeededActor,
  sql,
  transaction,
  twoWorkspaces,
} from "./read_models.test-helper.ts";

// Two years ahead of the real clock: the seeded reminder occurrences are
// pending and in-app, and a delivery worker driven by another suite in the
// same run claims every due occurrence in the database, so none may be due.
const NOW = new Date(
  Date.UTC(new Date().getUTCFullYear() + 2, 5, 15, 12, 0, 0),
);
const clock = { now: () => new Date(NOW) };

function actorOf(seeded: SeededActor) {
  return {
    memberId: seeded.memberId,
    role: seeded.role,
    userId: seeded.userId,
    workspaceId: seeded.workspaceId,
  };
}

function inDays(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

async function addTask(
  actor: SeededActor,
  title: string,
  dueAt: string,
  personId: string | null = null,
  status: "cancelled" | "open" = "open",
): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.tasks (id, workspace_id, person_id, title, status, due_at,
      created_by_member_id)
    values (${id}, ${actor.workspaceId}, ${personId}, ${title}, ${status},
      ${dueAt}, ${actor.memberId})
  `;
  return id;
}

async function addPersonReminder(
  actor: SeededActor,
  personId: string,
  title: string,
  deliverAt: string,
): Promise<string> {
  const reminderId = crypto.randomUUID();
  const occurrenceId = crypto.randomUUID();
  await sql`
    insert into crm.reminders (id, workspace_id, person_id, target_kind, title,
      anchor_on, recurrence_unit, created_by_member_id)
    values (${reminderId}, ${actor.workspaceId}, ${personId}, 'person',
      ${title}, ${deliverAt.slice(0, 10)}::date, 'none', ${actor.memberId})
  `;
  await sql`
    insert into crm.reminder_occurrences (id, reminder_id, member_id,
      occurs_on, deliver_at, channel, status, title_snapshot)
    values (${occurrenceId}, ${reminderId}, ${actor.memberId},
      ${deliverAt.slice(0, 10)}::date, ${deliverAt}, 'in_app', 'pending',
      ${title})
  `;
  return occurrenceId;
}

async function addCadence(personId: string, dueAt: string): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.stay_in_touch_cadences (id, person_id, interval_count,
      interval_unit, next_due_at)
    values (${id}, ${personId}, 2, 'week', ${dueAt})
  `;
  return id;
}

async function deletedPerson(actor: SeededActor, name: string) {
  const id = await addPerson(actor, name);
  await sql`update crm.people set deleted_at = now() where id = ${id}`;
  return id;
}

Deno.test("[TODAY-001] GAP-037 PostgreSQL Today tasks stay in the reader's workspace", async () => {
  const { foreign, reader } = await twoWorkspaces("today-tasks");
  const gone = await deletedPerson(reader, "Gone");
  const linked = await addTask(reader, "Call back", inDays(1), reader.personId);
  const orphaned = await addTask(reader, "Orphaned", inDays(2), gone);
  const loose = await addTask(reader, "Loose end", inDays(3));
  await addTask(reader, "Far away", inDays(45));
  await addTask(reader, "Cancelled", inDays(1), null, "cancelled");
  await addTask(foreign, "Foreign task", inDays(1), foreign.personId);
  const repository = new PostgresTodayTasksRepository(connection.db);

  const due = await repository.getDueTasks({
    ...actorOf(reader),
    dueBefore: new Date(inDays(30)),
    limit: 20,
  });
  assert(due.status === "ready", `Today tasks refused: ${due.status}`);
  const serialized = JSON.stringify(due);
  const orphanedItem = due.items[1];
  assert(
    JSON.stringify(due.items.map((task) => task.id)) ===
        JSON.stringify([linked, orphaned, loose]) &&
      due.items[0]?.person?.name === "Reader subject" &&
      orphanedItem?.person?.unavailable === true &&
      orphanedItem.person.name === "Deleted/Unavailable person" &&
      !serialized.includes("Foreign"),
    `Today tasks crossed workspaces or leaked a deleted name: ${serialized}`,
  );

  const facade = createTodayTasks({ actors, clock, repository, transaction });
  const allowed = await facade.getDueTasks(actorOf(reader));
  await revokeMembership(sql, reader.memberId);
  const refused = await facade.getDueTasks(actorOf(reader));
  assert(
    allowed.status === "ready" && allowed.items.length === 3 &&
      refused.status === "forbidden",
    "the Today tasks facade did not follow the reader's membership",
  );
});

Deno.test("[TODAY-001] GAP-037 PostgreSQL Today interactions stay in the reader's workspace", async () => {
  const { foreign, reader } = await twoWorkspaces("today-interactions");
  const gone = await deletedPerson(reader, "Gone");
  const activity = await addActivity(
    reader,
    "Lunch together",
    "2026-06-10T12:00:00.000Z",
    [reader.personId, gone],
  );
  const favourite = await addNote(
    reader,
    reader.personId,
    "Loves jazz",
    "2026-06-11T12:00:00.000Z",
    true,
  );
  const plain = await addNote(
    reader,
    reader.personId,
    "Moved house",
    "2026-06-12T12:00:00.000Z",
  );
  await addNote(reader, gone, "Hidden with the person", "2026-06-13T12:00:00Z");
  await addActivity(foreign, "Foreign lunch", "2026-06-14T12:00:00Z", [
    foreign.personId,
  ]);
  await addNote(
    foreign,
    foreign.personId,
    "Foreign favourite",
    "2026-06-14T13:00:00.000Z",
    true,
  );
  const repository = new PostgresTodayInteractionsRepository(connection.db);
  const actor = actorOf(reader);

  const recent = await repository.getRecentActivity({
    ...actor,
    recentLimit: 20,
  });
  const favourites = await repository.getFavoriteNotes({
    ...actor,
    favoriteLimit: 8,
  });
  assert(
    recent.status === "ready" && favourites.status === "ready",
    "Today interactions refused an active reader",
  );
  const serialized = JSON.stringify({ favourites, recent });
  const activityItem = recent.items[2];
  assert(
    JSON.stringify(recent.items.map((item) => item.id)) ===
        JSON.stringify([plain, favourite, activity]) &&
      activityItem?.kind === "activity" &&
      JSON.stringify(activityItem.participants.map((person) => person.id)) ===
        JSON.stringify([reader.personId]) &&
      JSON.stringify(favourites.items.map((item) => item.id)) ===
        JSON.stringify([favourite]) &&
      !serialized.includes("Foreign") && !serialized.includes("Hidden"),
    `Today interactions crossed workspaces or deleted people: ${serialized}`,
  );

  const facade = createTodayInteractions({ actors, repository, transaction });
  await revokeMembership(sql, reader.memberId);
  const [refusedRecent, refusedFavourites] = await Promise.all([
    facade.getRecentActivity(actor),
    facade.getFavoriteNotes(actor),
  ]);
  assert(
    refusedRecent.status === "forbidden" &&
      refusedFavourites.status === "forbidden",
    "a revoked member read Today interactions",
  );
});

Deno.test("[TODAY-001] GAP-037 PostgreSQL Today recent people resolve only the reader's people", async () => {
  const { foreign, reader } = await twoWorkspaces("today-recent");
  const friend = await addPerson(reader, "Friend");
  const gone = await deletedPerson(reader, "Gone");
  const repository = new PostgresTodayRecentPeopleRepository(connection.db);
  const actor = actorOf(reader);

  const withoutPreferences = await repository.list({ ...actor, limit: 8 });
  assert(
    withoutPreferences.status === "ready" &&
      withoutPreferences.people.length === 0,
    "a member without preferences was shown recent people",
  );

  await sql`
    insert into crm.member_preferences (member_id, ui_state)
    values (${reader.memberId}, ${
    sql.json({
      recentPersonIds: [
        foreign.personId,
        friend.toUpperCase(),
        "not-a-uuid",
        friend,
        gone,
        reader.personId,
      ],
    })
  })
  `;
  const recent = await repository.list({ ...actor, limit: 8 });
  assert(
    recent.status === "ready" &&
      JSON.stringify(recent.people.map((person) => person.id)) ===
        JSON.stringify([friend, reader.personId]),
    `recent people crossed workspaces: ${JSON.stringify(recent)}`,
  );

  const facade = createTodayRecentPeople({ actors, repository, transaction });
  await revokeMembership(sql, reader.memberId);
  const refused = await facade.get(actor);
  assert(refused.status === "forbidden", "a revoked member read recent people");
});

Deno.test("[TODAY-001] GAP-037 PostgreSQL Today reminders and cadences stay in the reader's workspace", async () => {
  const { foreign, reader } = await twoWorkspaces("today-reminders");
  await sql`
    insert into crm.member_preferences (member_id, timezone)
    values (${reader.memberId}, 'Europe/Paris')
  `;
  const occurrence = await addPersonReminder(
    reader,
    reader.personId,
    "Birthday call",
    inDays(2),
  );
  const cadence = await addCadence(reader.personId, inDays(3));
  await addPersonReminder(foreign, foreign.personId, "Foreign", inDays(2));
  await addCadence(foreign.personId, inDays(3));
  const repository = new PostgresTodayRemindersRepository(connection.db);

  const today = await repository.get({ ...actorOf(reader), now: NOW });
  assert(today.status === "ready", `Today reminders refused: ${today.status}`);
  const serialized = JSON.stringify(today);
  assert(
    today.timezone === "Europe/Paris" &&
      JSON.stringify(today.reminders.map((item) => item.id)) ===
        JSON.stringify([occurrence]) &&
      today.reminders[0]?.person.id === reader.personId &&
      JSON.stringify(today.cadences.map((item) => item.id)) ===
        JSON.stringify([cadence]) &&
      !serialized.includes("Foreign"),
    `Today reminders crossed workspaces: ${serialized}`,
  );

  const facade = createTodayReminders({
    actors,
    clock,
    repository,
    transaction,
  });
  await revokeMembership(sql, reader.memberId);
  const refused = await facade.get(actorOf(reader));
  assert(refused.status === "forbidden", "a revoked member read reminders");
});

Deno.test("[TODAY-001] GAP-037 PostgreSQL Today reminders never name a foreign person", async () => {
  const { foreign, reader } = await twoWorkspaces("today-reminder-link");
  // A reminder row whose person belongs to another workspace: the planning
  // facade never writes one, so it is seeded directly, and the read model must
  // still not project the foreign person.
  await addPersonReminder(reader, foreign.personId, "Linked", inDays(2));
  const repository = new PostgresTodayRemindersRepository(connection.db);

  const today = await repository.get({ ...actorOf(reader), now: NOW });
  const attention = await new PostgresTodayAttentionRepository(connection.db)
    .getSnapshot({
      ...actorOf(reader),
      now: NOW,
      perAttentionGroupLimit: 20,
      upcomingLimit: 30,
    });
  const serialized = JSON.stringify({ attention, today });
  // Attention drops a reminder whose person is not in the workspace, and the
  // reminders panel mirrors it rather than naming the person.
  assert(
    today.status === "ready" && today.reminders.length === 0 &&
      attention.status === "ready" && attention.items.length === 0 &&
      !serialized.includes(foreign.personId) &&
      !serialized.includes("Foreign secret"),
    `Today projected a cross-workspace reminder person: ${serialized}`,
  );
});

Deno.test("[TODAY-001] GAP-037 PostgreSQL Today tasks and interactions never name a foreign person", async () => {
  const { foreign, reader } = await twoWorkspaces("today-foreign-links");
  const task = await addTask(
    reader,
    "Linked task",
    inDays(1),
    foreign.personId,
  );
  const activity = await addActivity(
    reader,
    "Linked activity",
    "2026-06-10T12:00:00.000Z",
    [reader.personId, foreign.personId],
  );
  const actor = actorOf(reader);

  const tasks = await new PostgresTodayTasksRepository(connection.db)
    .getDueTasks({ ...actor, dueBefore: new Date(inDays(30)), limit: 20 });
  const recent = await new PostgresTodayInteractionsRepository(connection.db)
    .getRecentActivity({ ...actor, recentLimit: 20 });
  assert(
    tasks.status === "ready" && recent.status === "ready",
    "Today refused an active reader",
  );
  const linkedTask = tasks.items[0];
  const linkedActivity = recent.items[0];
  assert(
    tasks.items.length === 1 && linkedTask?.id === task &&
      linkedTask.person?.unavailable === true &&
      linkedTask.person.name === "Deleted/Unavailable person" &&
      linkedActivity?.id === activity &&
      JSON.stringify(linkedActivity.participants.map((person) => person.id)) ===
        JSON.stringify([reader.personId]) &&
      !JSON.stringify({ recent, tasks }).includes("Foreign secret"),
    `Today named a cross-workspace person: ${
      JSON.stringify({ recent, tasks })
    }`,
  );
});

Deno.test("[TODAY-001] GAP-037 PostgreSQL Today attention stays in the reader's workspace", async () => {
  const { foreign, reader } = await twoWorkspaces("today-attention");
  const task = await addTask(reader, "Overdue", inDays(-1), reader.personId);
  const occurrence = await addPersonReminder(
    reader,
    reader.personId,
    "Check in",
    inDays(1),
  );
  const cadence = await addCadence(reader.personId, inDays(4));
  const foreignTask = await addTask(foreign, "Foreign", inDays(-1));
  await addPersonReminder(foreign, foreign.personId, "Foreign", inDays(1));
  await addCadence(foreign.personId, inDays(4));
  const repository = new PostgresTodayAttentionRepository(connection.db);

  const snapshot = await repository.getSnapshot({
    ...actorOf(reader),
    now: NOW,
    perAttentionGroupLimit: 20,
    upcomingLimit: 30,
  });
  assert(snapshot.status === "ready", `attention refused: ${snapshot.status}`);
  const serialized = JSON.stringify(snapshot);
  assert(
    snapshot.timezone === "UTC" &&
      JSON.stringify(snapshot.items.map((item) => item.id).sort()) ===
        JSON.stringify([task, occurrence, cadence].sort()) &&
      !serialized.includes(foreignTask) && !serialized.includes("Foreign"),
    `Today attention crossed workspaces: ${serialized}`,
  );

  const facade = createTodayAttention({
    actors,
    clock,
    repository,
    transaction,
  });
  const allowed = await facade.get(actorOf(reader));
  await revokeMembership(sql, reader.memberId);
  const refused = await facade.get(actorOf(reader));
  assert(
    allowed.status === "ready" && refused.status === "forbidden",
    "the attention facade did not follow the reader's membership",
  );
});

Deno.test({
  name: "GAP-037 Today read-model PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
