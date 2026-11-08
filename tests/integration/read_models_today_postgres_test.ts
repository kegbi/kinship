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
import {
  assertCrossWorkspaceRefused,
  revokeMembership,
} from "../support/database.ts";
import {
  describePlan,
  explainedPlan,
  planNodes,
  rowsProduced,
  scansOf,
  unionBranches,
  withScratchCrm,
} from "../support/query_plan.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  actors,
  addActivity,
  addNote,
  addPerson,
  closeResources,
  connection,
  databaseUrl,
  memberOf,
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
      occurs_on, deliver_at, channel, status, title_snapshot, workspace_id)
    values (${occurrenceId}, ${reminderId}, ${actor.memberId},
      ${deliverAt.slice(0, 10)}::date, ${deliverAt}, 'in_app', 'pending',
      ${title}, (select scope.workspace_id from crm.reminders scope where scope.id = ${reminderId}::uuid))
  `;
  return occurrenceId;
}

async function addCadence(personId: string, dueAt: string): Promise<string> {
  const id = crypto.randomUUID();
  await sql`
    insert into crm.stay_in_touch_cadences (id, person_id, interval_count,
      interval_unit, next_due_at, workspace_id)
    values (${id}, ${personId}, 2, 'week', ${dueAt}, (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid))
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
    insert into crm.member_preferences (member_id, workspace_id, ui_state)
    values (${reader.memberId}, ${reader.workspaceId}, ${
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
    insert into crm.member_preferences (member_id, timezone, workspace_id)
    values (${reader.memberId}, 'Europe/Paris', ${reader.workspaceId})
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
  // facade never writes one, and the database refuses one seeded directly
  // (ADR 0008), so the read model has nothing foreign to project.
  await assertCrossWorkspaceRefused(
    () => addPersonReminder(reader, foreign.personId, "Linked", inDays(2)),
    "a reminder about another workspace's person",
  );
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
  // Neither link can be stored (ADR 0008): a task about another workspace's
  // person, and that person as an activity participant.
  await assertCrossWorkspaceRefused(
    () => addTask(reader, "Linked task", inDays(1), foreign.personId),
    "a task about another workspace's person",
  );
  const task = await addTask(reader, "Local task", inDays(1));
  const activity = await addActivity(
    reader,
    "Linked activity",
    "2026-06-10T12:00:00.000Z",
    [reader.personId],
  );
  await assertCrossWorkspaceRefused(
    () =>
      sql`
        insert into crm.activity_participants (activity_id, person_id, workspace_id)
        values (${activity}::uuid, ${foreign.personId}::uuid, ${reader.workspaceId}::uuid)
      `,
    "another workspace's person as an activity participant",
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
      linkedTask.person === undefined &&
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

/**
 * One delivery row of an existing reminder occurrence: `occurs_on` and the
 * absent lead time are the source row's, so rows differing only in channel
 * are the same occurrence delivered two ways.
 */
async function addDelivery(
  actor: SeededActor,
  occurrenceId: string,
  channel: "email" | "in_app",
  status: "failed" | "manual_attention" | "pending" | "sent",
): Promise<string> {
  const id = crypto.randomUUID();
  const sent = status === "sent";
  const result = sent
    ? "confirmed"
    : status === "manual_attention"
    ? "ambiguous"
    : "unattempted";
  await sql`
    insert into crm.reminder_occurrences (id, reminder_id, member_id,
      occurs_on, deliver_at, channel, status, title_snapshot, sent_at,
      provider_result_state, provider_receipt, provider_effect_at, visible_at, workspace_id)
    select ${id}, source.reminder_id, ${actor.memberId}, source.occurs_on,
      source.deliver_at, ${channel}, ${status}, source.title_snapshot,
      case when ${sent} then source.deliver_at end,
      ${result},
      case when ${sent} then 'receipt' end,
      case when ${sent} then source.deliver_at end,
      case when ${sent} then source.deliver_at end,
        (select scope.workspace_id from crm.reminders scope where scope.id = source.reminder_id)
    from crm.reminder_occurrences source where source.id = ${occurrenceId}
  `;
  return id;
}

/** A reminder of `actor`'s delivered by email alone, in the given state. */
async function addEmailReminder(
  actor: SeededActor,
  title: string,
  deliverAt: string,
  status: "failed" | "manual_attention" | "pending" | "sent",
): Promise<string> {
  const seed = await addPersonReminder(actor, actor.personId, title, deliverAt);
  const email = await addDelivery(actor, seed, "email", status);
  await sql`delete from crm.reminder_occurrences where id = ${seed}`;
  return email;
}

Deno.test("[TODAY-001] [PLANNING-003] REL-059 PostgreSQL Today attention lists the reader's undelivered email reminders once", async () => {
  const { foreign, reader } = await twoWorkspaces("today-attention-email");
  const colleague = await memberOf(reader, "member");
  const failed = await addEmailReminder(
    reader,
    "Email failed",
    inDays(-2),
    "failed",
  );
  const unclear = await addEmailReminder(
    reader,
    "Email unclear",
    inDays(-1),
    "manual_attention",
  );
  await addEmailReminder(reader, "Email sent", inDays(-1), "sent");
  await addEmailReminder(reader, "Email pending", inDays(1), "pending");
  // `both`: the in-app copy was shown and the email copy failed.
  const shown = await addPersonReminder(
    reader,
    reader.personId,
    "Both failed",
    inDays(-3),
  );
  const bothFailed = await addDelivery(reader, shown, "email", "failed");
  await sql`
    update crm.reminder_occurrences set status = 'sent', sent_at = deliver_at,
      provider_result_state = 'confirmed', provider_receipt = 'in_app:shown',
      provider_effect_at = deliver_at, visible_at = deliver_at
    where id = ${shown}
  `;
  // `both`: the in-app copy is still pending and the email copy is unclear.
  const pending = await addPersonReminder(
    reader,
    reader.personId,
    "Both pending",
    inDays(-4),
  );
  const bothUnclear = await addDelivery(
    reader,
    pending,
    "email",
    "manual_attention",
  );
  // `both`: both copies failed, so the tie goes to the in-app copy.
  const twiceFailed = await addPersonReminder(
    reader,
    reader.personId,
    "Both failed twice",
    inDays(-5),
  );
  await sql`
    update crm.reminder_occurrences set status = 'failed'
    where id = ${twiceFailed}
  `;
  await addDelivery(reader, twiceFailed, "email", "failed");
  await addEmailReminder(colleague, "Colleague failed", inDays(-1), "failed");
  await addEmailReminder(foreign, "Foreign failed", inDays(-1), "failed");

  const snapshot = await new PostgresTodayAttentionRepository(connection.db)
    .getSnapshot({
      ...actorOf(reader),
      now: NOW,
      perAttentionGroupLimit: 20,
      upcomingLimit: 30,
    });
  assert(snapshot.status === "ready", `attention refused: ${snapshot.status}`);
  const listed = snapshot.items.map((item) =>
    item.kind === "reminder"
      ? `${item.title}:${item.channel}:${item.reminderStatus}:${item.id}`
      : `${item.kind}:${item.title}`
  ).sort();
  assert(
    JSON.stringify(listed) === JSON.stringify([
      `Both failed twice:in_app:failed:${twiceFailed}`,
      `Both failed:email:failed:${bothFailed}`,
      `Both pending:email:manual_attention:${bothUnclear}`,
      `Email failed:email:failed:${failed}`,
      `Email unclear:email:manual_attention:${unclear}`,
    ]),
    `Today attention did not list exactly the reader's undelivered email reminders once: ${
      JSON.stringify(listed)
    }`,
  );
});

Deno.test("[TODAY-001] AUD-Q1 an activity or note with no text is not shown on Today", async () => {
  const { reader } = await twoWorkspaces("today-empty");
  const shown = await addNote(
    reader,
    reader.personId,
    "Moved house",
    "2026-06-01T12:00:00.000Z",
  );
  await addActivity(reader, "", "2026-06-02T12:00:00.000Z", [
    reader.personId,
  ]);
  await addNote(reader, reader.personId, "", "2026-06-03T12:00:00.000Z", true);
  const repository = new PostgresTodayInteractionsRepository(connection.db);
  const recent = await repository.getRecentActivity({
    ...actorOf(reader),
    recentLimit: 20,
  });
  const favourites = await repository.getFavoriteNotes({
    ...actorOf(reader),
    favoriteLimit: 8,
  });
  assert(
    recent.status === "ready" && favourites.status === "ready" &&
      JSON.stringify(recent.items.map((item) => item.id)) ===
        JSON.stringify([shown]) &&
      favourites.items.length === 0,
    `an empty activity or note was shown: ${
      JSON.stringify({ favourites, recent })
    }`,
  );
});

Deno.test("[TODAY-001] AUD-Q1 each attention arm takes only what its buckets can show", async () => {
  const { reader } = await twoWorkspaces("today-attention-arms");
  const [perGroup, upcoming] = [2, 3];
  const most = 3 * perGroup + upcoming;
  const birthday = new Date(inDays(12));
  for (let index = 0; index < most + 3; index++) {
    const person = await addPerson(reader, `Birthday ${index}`);
    await sql`
      insert into crm.person_dates (person_id, kind, month, day, precision, workspace_id)
      values (${person}, 'birthday', ${birthday.getUTCMonth() + 1},
        ${birthday.getUTCDate()}, 'month_day', (select scope.workspace_id from crm.people scope where scope.id = ${person}::uuid))
    `;
    await addCadence(person, inDays(2 + index / 100));
    await addPersonReminder(reader, person, `Check in ${index}`, inDays(3));
  }
  // A task its own reminder brings forward is listed once, at the earlier
  // time, however many rows each arm keeps.
  const task = await addTask(reader, "Send the photos", inDays(20));
  const reminderId = crypto.randomUUID();
  await sql`
    insert into crm.reminders (id, workspace_id, task_id, target_kind, title,
      anchor_on, recurrence_unit, created_by_member_id)
    values (${reminderId}, ${reader.workspaceId}, ${task}, 'task',
      'Send the photos', ${inDays(1).slice(0, 10)}::date, 'none',
      ${reader.memberId})
  `;
  await sql`
    insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
      deliver_at, channel, status, title_snapshot, workspace_id)
    values (${reminderId}, ${reader.memberId}, ${inDays(1).slice(0, 10)}::date,
      ${
    inDays(1)
  }, 'in_app', 'pending', 'Send the photos', (select scope.workspace_id from crm.reminders scope where scope.id = ${reminderId}::uuid))
  `;
  const command = {
    ...actorOf(reader),
    now: NOW,
    perAttentionGroupLimit: perGroup,
    upcomingLimit: upcoming,
  };
  const plan = await explainedPlan(
    connection.db,
    (statement) => statement.includes("reminder_source"),
    (database) =>
      new PostgresTodayAttentionRepository(database).getSnapshot(command),
    [{}],
  );
  const arms = unionBranches(plan).filter((branches) => branches.length >= 5);
  assert(arms.length > 0, `attention merges no arms: ${describePlan(plan)}`);
  for (const arm of arms.flat()) {
    assert(
      rowsProduced(arm) <= most,
      `an attention arm hands ${
        rowsProduced(arm)
      } rows to the ranking, more than its buckets show (${most}): ${
        describePlan(plan)
      }`,
    );
  }

  const snapshot = await new PostgresTodayAttentionRepository(connection.db)
    .getSnapshot(command);
  assert(snapshot.status === "ready", "attention reads");
  const listed = snapshot.items.filter((item) => item.id === task);
  assert(
    listed.length === 1 && listed[0]!.dueAt.slice(0, 10) ===
        inDays(1).slice(0, 10),
    `the task is not listed once at its reminder's time: ${
      JSON.stringify(listed)
    }`,
  );
});

/**
 * A scaled share of the large capacity profile in one workspace: enough
 * history that reading all of it is visibly different from reading the page,
 * and below ANALYZE's sample size so the plan is the same on every run.
 */
const SCALED = { activities: 4000, notes: 8000, people: 2000 } as const;
const RECENT_LIMIT = 20;
/**
 * The tables whose recent rows the recent-activity statement must reach
 * through an index, reading about a page of them rather than the history:
 * `activities_workspace_time_idx` and, since v13 (AUD-V1),
 * `notes_workspace_created_idx`.
 */
const RECENT_ACTIVITY_INDEXED = ["activities", "notes"] as const;

Deno.test("[TODAY-001] AUD-Q1 Today's recent activity and recent people read their page, not the workspace's history", async () => {
  await withScratchCrm(sql, databaseUrl, async ({ sql: scratch, url }) => {
    const [userId, workspaceId, memberId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];
    await scratch`insert into crm.users (id, email) values (${userId}, 'plan@example.test')`;
    await scratch`
      insert into crm.workspaces (id, name, created_by_user_id)
      values (${workspaceId}, 'Large', ${userId})
    `;
    await scratch`
      insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at)
      values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active', now())
    `;
    await scratch`
      insert into crm.people (workspace_id, given_name)
      select ${workspaceId}::uuid, 'Person ' || n
      from generate_series(1, ${SCALED.people}) n
    `;
    await scratch`
      create temporary table plan_people as
      select id, row_number() over (order by id) as n from crm.people
    `;
    await scratch`
      with created as (
        insert into crm.activities (workspace_id, summary, happened_at)
        select ${workspaceId}::uuid, 'Walk ' || n,
          now() - (n || ' minutes')::interval
        from generate_series(1, ${SCALED.activities}) n
        returning id, happened_at
      ), numbered as (
        select id, row_number() over (order by happened_at) as n from created
      )
      insert into crm.activity_participants (activity_id, person_id, workspace_id)
      select numbered.id, person.id,
        ${workspaceId}::uuid
      from numbered
      join plan_people person
        on person.n in (1 + numbered.n % ${SCALED.people},
          1 + (numbered.n * 7) % ${SCALED.people})
    `;
    await scratch`
      insert into crm.notes (workspace_id, person_id, body, created_at, updated_at)
      select ${workspaceId}::uuid, person.id, 'Note ' || i,
        now() - (i || ' seconds')::interval, now()
      from generate_series(1, ${SCALED.notes}) i
      join plan_people person on person.n = 1 + i % ${SCALED.people}
    `;
    const recentIds = (await scratch<{ readonly id: string }[]>`
      select id::text from plan_people order by n desc limit 8
    `).map((row) => row.id);
    await scratch`
      insert into crm.member_preferences (member_id, workspace_id, ui_state)
      values (${memberId}, ${workspaceId},
        ${scratch.json({ recentPersonIds: recentIds })})
    `;
    await scratch`drop table plan_people`;
    await scratch`analyze`;

    const explaining = connectDatabase(url);
    try {
      const actor = {
        memberId,
        role: "owner" as const,
        userId,
        workspaceId,
      };
      const recentActivity = await explainedPlan(
        explaining.db,
        (statement) =>
          statement.includes("crm.activities") &&
          statement.includes("crm.notes"),
        (database) =>
          new PostgresTodayInteractionsRepository(database).getRecentActivity({
            ...actor,
            recentLimit: RECENT_LIMIT,
          }),
      );
      const plan = describePlan(recentActivity);
      for (const relation of RECENT_ACTIVITY_INDEXED) {
        const scans = scansOf(recentActivity, relation);
        assert(scans.length > 0, `${relation} is not read: ${plan}`);
        assert(
          scans.every((scan) => scan["Node Type"] !== "Seq Scan"),
          `recent activity scans all of ${relation}: ${plan}`,
        );
        const read = scans.reduce((sum, scan) => sum + rowsProduced(scan), 0);
        assert(
          read <= 2 * RECENT_LIMIT,
          `recent activity reads ${read} ${relation} rows for ${RECENT_LIMIT}: ${plan}`,
        );
      }
      const participantLoops = Math.max(
        0,
        ...scansOf(recentActivity, "activity_participants").map((scan) =>
          scan["Actual Loops"] ?? 1
        ),
      );
      assert(
        participantLoops <= RECENT_LIMIT,
        `participants are gathered for ${participantLoops} activities, not the ${RECENT_LIMIT} shown: ${plan}`,
      );

      const recentPeople = await explainedPlan(
        explaining.db,
        (statement) =>
          statement.includes("unnest(") && statement.includes("crm.people"),
        (database) =>
          new PostgresTodayRecentPeopleRepository(database).list({
            ...actor,
            limit: 8,
          }),
      );
      const peopleScans = scansOf(recentPeople, "people");
      assert(
        peopleScans.length > 0 &&
          peopleScans.every((scan) => scan["Node Type"] !== "Seq Scan") &&
          peopleScans.reduce((sum, scan) => sum + rowsProduced(scan), 0) <=
            recentIds.length,
        `recent people do not look their ${recentIds.length} people up by index: ${
          describePlan(recentPeople)
        }`,
      );
    } finally {
      await explaining.destroy();
    }
  });
});

Deno.test("[TODAY-001] AUD-V1 attention reads a member's open occurrences, not their delivered history", async () => {
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
    // Years of delivered reminders for both members, and one open
    // occurrence per reminder: the open ones are what attention lists.
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
        provider_receipt, provider_effect_at, visible_at, workspace_id)
      select reminder.id, member.id, current_date - months.n * 30,
        now() - months.n * interval '30 days', 'in_app', 'sent',
        now() - months.n * interval '30 days', 'confirmed', 'in-app',
        now() - months.n * interval '30 days',
        now() - months.n * interval '30 days',
        ${workspaceId}::uuid
      from reminder
      cross join generate_series(1, 20) months(n)
      cross join (values (${memberId}::uuid), (${otherMemberId}::uuid))
        member(id)
    `;
    await scratch`
      insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
        deliver_at, channel, status, workspace_id)
      select reminder.id, ${memberId}::uuid, ${inDays(10).slice(0, 10)}::date,
        ${inDays(10)}::timestamptz, 'in_app', 'pending',
        (select scope.workspace_id from crm.reminders scope where scope.id = reminder.id)
      from crm.reminders reminder
    `;
    await scratch`analyze`;

    const explaining = connectDatabase(url);
    try {
      const plan = await explainedPlan(
        explaining.db,
        (statement) => statement.includes("reminder_source"),
        (database) =>
          new PostgresTodayAttentionRepository(database).getSnapshot({
            memberId,
            now: NOW,
            perAttentionGroupLimit: 2,
            role: "owner",
            upcomingLimit: 3,
            userId,
            workspaceId,
          }),
        [{}],
      );
      const occurrences = scansOf(plan, "reminder_occurrences");
      const read = occurrences.reduce(
        (sum, scan) =>
          sum + rowsProduced(scan) +
          ((scan as { readonly "Rows Removed by Filter"?: number })[
              "Rows Removed by Filter"
            ] ?? 0) * (scan["Actual Loops"] ?? 1),
        0,
      );
      assert(
        occurrences.length > 0 &&
          occurrences.every((scan) => scan["Node Type"] !== "Seq Scan") &&
          planNodes(plan).some((node) =>
            node["Index Name"] === "reminder_occurrences_member_open_idx"
          ) && read <= 600,
        `attention reads ${read} occurrences to find the member's 300 open ones: ${
          describePlan(plan)
        }`,
      );
    } finally {
      await explaining.destroy();
    }
  });
});

Deno.test({
  name: "GAP-037 Today read-model PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
