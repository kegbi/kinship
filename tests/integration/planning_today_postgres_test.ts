/**
 * The Today planning projection (split from `planning_postgres_test.ts`,
 * GAP-035): ordering, tenancy, retry attention, reminder targets, and one
 * repeatable snapshot.
 *
 * Its final test closes the app and pools it loaded from
 * `planning.test-helper.ts`.
 */

import postgres from "postgres";
import { PostgresTodayAttentionRepository } from "../../packages/backend/read-models/today/adapters/postgres/today_attention_repository.ts";
import { createTodayAttention } from "../../packages/backend/read-models/today/public.ts";
import * as generatedPlanningClient from "../../packages/contracts/generated/auth-client.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  apiConnection,
  createPerson,
  createReminder,
  createTask,
  databaseUrl,
  register,
  request,
  signInTo,
  sql,
} from "./planning.test-helper.ts";
import { addMembership } from "../support/database.ts";
import { closeResources } from "./planning.test-helper.ts";

Deno.test("TODAY-001 PostgreSQL calendar dates ignore notification timing, channels and state", async () => {
  const fixture = await register(
    `today-calendar-${crypto.randomUUID()}@example.test`,
    "Calendar dates",
  );
  const foreign = await register(
    `today-calendar-foreign-${crypto.randomUUID()}@example.test`,
    "Foreign dates",
  );
  const personId = await createPerson(fixture, "Calendar person");
  const foreignPerson = await createPerson(foreign, "Foreign event secret");
  const deletedPerson = await createPerson(fixture, "Deleted event secret");
  await sql`update crm.people set deleted_at = now() where id = ${deletedPerson}::uuid`;
  await sql`insert into crm.member_preferences (member_id, timezone, workspace_id) values (${fixture.memberId}::uuid, 'Europe/Belgrade', ${fixture.workspaceId}::uuid)
    on conflict (member_id) do update set timezone = excluded.timezone`;
  const date = async (
    label: string,
    month: number,
    day: number,
    person = personId,
    year: number | null = null,
  ) => {
    const id = crypto.randomUUID();
    await sql`insert into crm.person_dates (id, person_id, kind, label, year, month, day, precision, workspace_id)
      values (${id}::uuid, ${person}::uuid, 'custom', ${label}, ${year}, ${month}, ${day}, ${
      year === null ? "month_day" : "full"
    }, (select scope.workspace_id from crm.people scope where scope.id = ${person}::uuid))`;
    return id;
  };
  const november = await date("November birthday", 11, 22);
  const october = await date("October birthday", 10, 28);
  const today = await date("Today without reminder", 10, 19);
  const seventh = await date("Seventh day email only", 10, 26);
  const eighth = await date("Eighth day", 10, 27);
  const thirtieth = await date("Thirtieth day", 11, 18);
  const thirtyFirst = await date("Thirty-first day", 11, 19);
  const futureYear = await date(
    "Future first occurrence",
    10,
    24,
    personId,
    2027,
  );
  const leap = await date("Leap day", 2, 29);
  const newYear = await date("New year", 1, 1);
  await date("Foreign birthday", 10, 20, foreignPerson);
  await date("Deleted birthday", 10, 20, deletedPerson);
  const event = crypto.randomUUID();
  const oldEvent = crypto.randomUUID();
  const impreciseEvent = crypto.randomUUID();
  await sql`insert into crm.life_events (id, workspace_id, person_id, name, year, month, day, precision)
    values (${event}::uuid, ${fixture.workspaceId}::uuid, ${personId}::uuid, 'Future move', 2026, 10, 26, 'full'),
      (${oldEvent}::uuid, ${fixture.workspaceId}::uuid, ${personId}::uuid, 'Past move', 2025, 10, 26, 'full'),
      (${impreciseEvent}::uuid, ${fixture.workspaceId}::uuid, ${personId}::uuid, 'Unknown year move', null, 10, 26, 'month_day')`;
  // Since schema v14 (AUD-V2) a life event naming another workspace's person
  // is refused by the database itself, so it can never reach the calendar.
  let refused = false;
  try {
    await sql`insert into crm.life_events (workspace_id, person_id, name, year, month, day, precision)
      values (${fixture.workspaceId}::uuid, ${foreignPerson}::uuid, 'Foreign-linked move', 2026, 10, 26, 'full')`;
  } catch (error) {
    refused = (error as { readonly code?: string }).code === "23503";
  }
  assert(refused, "a life event naming another workspace's person was stored");
  const notify = async (
    id: string,
    occursOn: string,
    deliverAt: string,
    leads: number[],
    emailOnly = false,
  ) => {
    const reminder = crypto.randomUUID();
    await sql`insert into crm.reminders (id, workspace_id, person_date_id, target_kind, anchor_on, recurrence_unit, created_by_member_id)
      values (${reminder}::uuid, ${fixture.workspaceId}::uuid, ${id}::uuid, 'person_date', ${occursOn}::date, 'year', ${fixture.memberId}::uuid)`;
    for (const lead of leads) {
      for (const channel of emailOnly ? ["email"] : ["in_app", "email"]) {
        await sql`insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on, deliver_at, channel, status, lead_time_days, workspace_id)
          values (${reminder}::uuid, ${fixture.memberId}::uuid, ${occursOn}::date, ${deliverAt}::timestamptz, ${channel}, 'pending', ${lead}, (select scope.workspace_id from crm.reminders scope where scope.id = ${reminder}::uuid))`;
      }
    }
    return reminder;
  };
  await notify(november, "2026-11-22", "2026-10-23T09:00:00Z", [30]);
  const octoberReminder = await notify(
    october,
    "2026-10-28",
    "2026-10-21T09:00:00Z",
    [7, 1],
  );
  await notify(seventh, "2026-10-26", "2026-10-19T09:00:00Z", [7], true);
  // Enough advance notices to fill the query limit must not crowd actual dates
  // out before calendar filtering happens.
  for (let index = 0; index < 21; index++) {
    await notify(november, "2026-11-22", "2026-10-20T09:00:00Z", [30]);
  }
  const read = async (now: string) => {
    const result = await createTodayAttention({
      actors: { revalidate: () => Promise.resolve("active" as const) },
      transaction: { run: (work) => work({ opaque: undefined }) },
      clock: { now: () => new Date(now) },
      repository: new PostgresTodayAttentionRepository(apiConnection.db),
    }).get(fixture);
    assert(result.status === "ready", "calendar snapshot ready");
    return generatedPlanningClient.parseTodayAttention(result);
  };
  const initial = await read("2026-10-18T22:30:00Z");
  const ids = (items: readonly { readonly id: string }[]) =>
    items.map((item) => item.id);
  const all = (
    snapshot: typeof initial,
  ) => [...Object.values(snapshot.attention).flat(), ...snapshot.upcoming];
  assert(
    initial.date === "2026-10-19" &&
      ids(initial.attention.today).includes(today),
    "member local date chooses Today at UTC previous day",
  );
  assert(
    ids(initial.attention.nextSevenDays).join() === [seventh, event].join(),
    "day seven includes email-only birthday and complete event",
  );
  assert(
    ids(initial.upcoming).join() === [eighth, october, thirtieth].join(),
    "days eight through thirty sort by actual dates",
  );
  assert(
    !all(initial).some((item) =>
      [november, thirtyFirst, futureYear, oldEvent, impreciseEvent].some((id) =>
        id === item.id
      )
    ) && !JSON.stringify(initial).includes("secret") &&
      !JSON.stringify(initial).includes("Foreign"),
    "calendar bounds, precision, original year and tenant isolation",
  );
  await sql`update crm.reminder_occurrences set status = 'sent', sent_at = now(), provider_result_state = 'confirmed', provider_receipt = 'calendar-test', provider_effect_at = now(), visible_at = now() where reminder_id = ${octoberReminder}::uuid`;
  const afterSent = await read("2026-10-21T12:00:00Z");
  assert(
    all(afterSent).filter((item) => item.id === october).length === 1 &&
      ids(afterSent.attention.nextSevenDays).includes(october),
    "sent leads and multiple channels still show exactly one event",
  );
  const inNovember = await read("2026-11-15T12:00:00Z");
  assert(
    ids(inNovember.attention.nextSevenDays).includes(november),
    "November 22 enters next seven on November 15",
  );
  assert(
    !all(await read("2027-02-22T12:00:00Z")).some((item) => item.id === leap),
    "skip invalid February 29",
  );
  assert(
    ids((await read("2028-02-22T12:00:00Z")).attention.nextSevenDays).includes(
      leap,
    ),
    "include real February 29",
  );
  assert(
    ids((await read("2026-12-25T12:00:00Z")).attention.nextSevenDays).includes(
      newYear,
    ),
    "annual projection crosses year boundary",
  );
  const failedReminder = await notify(
    november,
    "2026-11-22",
    "2026-10-23T09:00:00Z",
    [30],
    true,
  );
  await sql`update crm.reminder_occurrences set status = 'failed' where reminder_id = ${failedReminder}::uuid`;
  const beforeFailureDate = await read("2026-10-19T12:00:00Z");
  assert(
    all(beforeFailureDate).every((item) => item.kind !== "reminder"),
    "future event delivery failures never fill calendar previews",
  );
  const afterFailure = await read("2026-10-24T12:00:00Z");
  assert(
    afterFailure.attention.overdue.some((item) =>
      item.kind === "reminder" && item.reminderStatus === "failed"
    ),
    "past event delivery failure remains operationally actionable",
  );
});

Deno.test("TODAY-001 PostgreSQL total-orders cross-kind UUID ties at both bounds", async () => {
  const fixture = await register(
    `today-order-${crypto.randomUUID()}@example.test`,
    "Today order",
  );
  const personId = await createPerson(fixture, "Tie person");
  const due = (days: number) =>
    new Date(Date.now() + days * 86_400_000).toISOString();
  const seed = async (count: number, before: string, at: string) => {
    const id = crypto.randomUUID();
    await sql`
      insert into crm.tasks (id, workspace_id, person_id, title, due_at, created_by_member_id)
      values (${id}::uuid, ${fixture.workspaceId}::uuid, ${personId}::uuid, 'Same title', ${at}::timestamptz, ${fixture.memberId}::uuid)
    `;
    await sql`
      insert into crm.tasks (workspace_id, person_id, title, due_at, created_by_member_id)
      select ${fixture.workspaceId}::uuid, ${personId}::uuid, 'Filler ' || n,
        ${before}::timestamptz, ${fixture.memberId}::uuid from generate_series(1, ${count}::int) n
    `;
    const reminder = await createReminder(fixture, personId, "Same title");
    await sql`
      update crm.reminder_occurrences set id = ${id}::uuid, deliver_at = ${at}::timestamptz, title_snapshot = 'Same title'
      where id = ${reminder.nextOccurrence!.id}::uuid
    `;
    return id;
  };
  const attentionTie = await seed(19, due(1), due(2));
  const upcomingTie = await seed(29, due(9), due(10));
  type Item = { readonly id: string; readonly kind: string };
  type Projection = {
    readonly attention: { readonly nextSevenDays: readonly Item[] };
    readonly upcoming: readonly Item[];
  };
  const read = async () =>
    await (await request(fixture, "/api/v1/today/attention"))
      .json() as Projection;
  const [first, replay] = await Promise.all([read(), read()]);
  const keys = (items: readonly Item[]) =>
    items.map((item) => `${item.kind}:${item.id}`);
  const attentionKeys = keys(first.attention.nextSevenDays);
  const upcomingKeys = keys(first.upcoming);
  assert(
    attentionKeys.length === 20 && upcomingKeys.length === 30 &&
      new Set(attentionKeys).size === 20 && new Set(upcomingKeys).size === 30 &&
      attentionKeys.includes(`reminder:${attentionTie}`) &&
      upcomingKeys.includes(`reminder:${upcomingTie}`) &&
      JSON.stringify(attentionKeys) ===
        JSON.stringify(keys(replay.attention.nextSevenDays)) &&
      JSON.stringify(upcomingKeys) === JSON.stringify(keys(replay.upcoming)),
    "Today cross-kind cutoff tie or lifecycle exclusion was unstable",
  );
});

Deno.test("TODAY-001 PostgreSQL never projects cross-workspace person links", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `today-person-tenant-${suffix}@example.test`,
    "Today person tenant",
  );
  const foreign = await register(
    `today-person-foreign-${suffix}@example.test`,
    "Today foreign person",
  );
  const foreignPersonId = await createPerson(foreign, "Foreign secret name");
  const deletedPersonId = await createPerson(fixture, "Deleted same workspace");
  const dueAt = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const directTaskId = crypto.randomUUID();
  const targetTaskId = crypto.randomUUID();
  const deletedTask = await createTask(
    fixture,
    "Same workspace deleted link",
    deletedPersonId,
    dueAt,
  );
  const foreignTask = await createTask(
    foreign,
    "Unrelated foreign workspace task",
    foreignPersonId,
    dueAt,
  );
  // Since schema v14 (AUD-V2) the database itself refuses a task that names
  // another workspace's person, even from the superuser; the tasks below are
  // what is left of such a link, a task without its person.
  let refused = false;
  try {
    await sql`
      insert into crm.tasks (id, workspace_id, person_id, title, due_at,
        created_by_member_id)
      values (${directTaskId}::uuid, ${fixture.workspaceId}::uuid,
        ${foreignPersonId}::uuid, 'Foreign-linked direct task',
        ${dueAt}::timestamptz, ${fixture.memberId}::uuid)
    `;
  } catch (error) {
    refused = (error as { readonly code?: string }).code === "23503";
  }
  assert(refused, "a task naming another workspace's person was stored");
  await sql`
    insert into crm.tasks (id, workspace_id, person_id, title, due_at,
      created_by_member_id)
    values
      (${directTaskId}::uuid, ${fixture.workspaceId}::uuid,
        null, 'Foreign-linked direct task',
        ${dueAt}::timestamptz, ${fixture.memberId}::uuid),
      (${targetTaskId}::uuid, ${fixture.workspaceId}::uuid,
        null, 'Foreign-linked target task', null,
        ${fixture.memberId}::uuid)
  `;
  await sql`
    update crm.people set deleted_at = now(), updated_at = now()
    where id = ${deletedPersonId}::uuid
  `;
  const targetReminderId = crypto.randomUUID();
  const targetOccurrenceId = crypto.randomUUID();
  const deletedTargetReminderId = crypto.randomUUID();
  const deletedTargetOccurrenceId = crypto.randomUUID();
  const earlierDueAt = new Date(Date.now() + 86_400_000).toISOString();
  await sql`
    insert into crm.reminders (id, workspace_id, task_id, target_kind, title,
      anchor_on, recurrence_unit, created_by_member_id)
    values
      (${targetReminderId}::uuid, ${fixture.workspaceId}::uuid,
        ${targetTaskId}::uuid, 'task', 'Foreign-linked target occurrence',
        ${dueAt.slice(0, 10)}::date, 'none', ${fixture.memberId}::uuid),
      (${deletedTargetReminderId}::uuid, ${fixture.workspaceId}::uuid,
        ${deletedTask.id}::uuid, 'task', 'Deleted person target occurrence',
        ${earlierDueAt.slice(0, 10)}::date, 'none', ${fixture.memberId}::uuid)
  `;
  await sql`
    insert into crm.reminder_occurrences (id, reminder_id, member_id,
      occurs_on, deliver_at, channel, status, title_snapshot, workspace_id)
    values
      (${targetOccurrenceId}::uuid, ${targetReminderId}::uuid,
        ${fixture.memberId}::uuid, ${dueAt.slice(0, 10)}::date,
        ${dueAt}::timestamptz, 'in_app', 'pending',
        'Foreign-linked target occurrence', (select scope.workspace_id from crm.reminders scope where scope.id = ${targetReminderId}::uuid)),
      (${deletedTargetOccurrenceId}::uuid, ${deletedTargetReminderId}::uuid,
        ${fixture.memberId}::uuid, ${earlierDueAt.slice(0, 10)}::date,
        ${earlierDueAt}::timestamptz, 'in_app', 'pending',
        'Deleted person target occurrence', (select scope.workspace_id from crm.reminders scope where scope.id = ${deletedTargetReminderId}::uuid))
  `;

  const response = await request(fixture, "/api/v1/today/attention");
  const body = await response.json() as {
    readonly attention: Readonly<
      Record<
        string,
        readonly {
          readonly id: string;
          readonly person?: {
            readonly id: string;
            readonly name: string;
            readonly unavailable?: boolean;
          };
        }[]
      >
    >;
    readonly upcoming: readonly {
      readonly id: string;
      readonly person?: {
        readonly id: string;
        readonly name: string;
        readonly unavailable?: boolean;
      };
    }[];
  };
  const items = [...Object.values(body.attention).flat(), ...body.upcoming];
  const direct = items.find((item) => item.id === directTaskId);
  const targeted = items.find((item) => item.id === targetTaskId);
  const deleted = items.find((item) => item.id === deletedTask.id);
  const serialized = JSON.stringify(body);
  assert(
    response.status === 200 && direct && !("person" in direct) && targeted &&
      !("person" in targeted) && deleted?.person?.id === deletedPersonId &&
      deleted.person.unavailable === true &&
      deleted.person.name === "Deleted/Unavailable person" &&
      !items.some((item) => item.id === foreignTask.id) &&
      !serialized.includes(foreignPersonId) &&
      !serialized.includes("Foreign secret name"),
    `Today leaked a cross-workspace person link: ${serialized}`,
  );
});

Deno.test("TODAY-001 PostgreSQL buckets retry attention by next attempt", async () => {
  const fixture = await register(
    `today-retry-due-${crypto.randomUUID()}@example.test`,
    "Today retry due",
  );
  const personId = await createPerson(fixture, "Retry attention person");
  const reminder = async (title: string) =>
    await createReminder(fixture, personId, title);
  const retryInside = await reminder("Retry inside");
  const retryOutside = await reminder("Retry outside");
  const pending = await reminder("Pending adjacent");
  const failed = await reminder("Failed adjacent");
  const manual = await reminder("Manual adjacent");
  const claimed = await reminder("Claimed excluded");
  const sent = await reminder("Sent excluded");
  const cancelled = await reminder("Cancelled excluded");
  const skipped = await reminder("Skipped excluded");
  const taskRetry = await reminder("Task retry inside");
  const taskId = crypto.randomUUID();
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  const nextDay = new Date(Date.now() + 86_400_000).toISOString();
  const nextTwoDays = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const nextThreeDays = new Date(Date.now() + 3 * 86_400_000).toISOString();
  const afterWindow = new Date(Date.now() + 31 * 86_400_000).toISOString();
  await sql`
    insert into crm.tasks (id, workspace_id, person_id, title,
      created_by_member_id)
    values (${taskId}::uuid, ${fixture.workspaceId}::uuid, ${personId}::uuid,
      'Task retry inside', ${fixture.memberId}::uuid)
  `;
  await sql`
    update crm.reminders set target_kind = 'task', task_id = ${taskId}::uuid
    where id = ${taskRetry.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      deliver_at = ${yesterday}::timestamptz,
      next_attempt_at = ${nextTwoDays}::timestamptz
    where id = ${retryInside.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      deliver_at = ${nextDay}::timestamptz,
      next_attempt_at = ${afterWindow}::timestamptz
    where id = ${retryOutside.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      deliver_at = ${yesterday}::timestamptz,
      next_attempt_at = ${nextThreeDays}::timestamptz
    where id = ${taskRetry.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set deliver_at = ${nextDay}::timestamptz
    where id = ${pending.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'failed',
      deliver_at = ${yesterday}::timestamptz
    where id = ${failed.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'manual_attention',
      provider_result_state = 'ambiguous', deliver_at = ${yesterday}::timestamptz
    where id = ${manual.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'claimed',
      claim_token = gen_random_uuid(), claim_owner = 'today-test',
      lease_expires_at = now() + interval '1 hour'
    where id = ${claimed.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'sent', sent_at = now(),
      provider_result_state = 'confirmed', provider_receipt = 'today-test',
      provider_effect_at = now(), visible_at = now()
    where id = ${sent.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'cancelled'
    where id = ${cancelled.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'skipped'
    where id = ${skipped.nextOccurrence!.id}::uuid
  `;

  type Item = { readonly dueAt: string; readonly id: string };
  const response = await request(fixture, "/api/v1/today/attention");
  const body = await response.json() as {
    readonly attention: {
      readonly nextSevenDays: readonly Item[];
      readonly overdue: readonly Item[];
    };
    readonly upcoming: readonly Item[];
  };
  const all = [...Object.values(body.attention).flat(), ...body.upcoming];
  const next = body.attention.nextSevenDays;
  const overdue = body.attention.overdue;
  const retryItem = next.find((item) =>
    item.id === retryInside.nextOccurrence!.id
  );
  const taskItem = next.find((item) => item.id === taskId);
  const pendingItem = next.find((item) =>
    item.id === pending.nextOccurrence!.id
  );
  const failedItem = overdue.find((item) =>
    item.id === failed.nextOccurrence!.id
  );
  const manualItem = overdue.find((item) =>
    item.id === manual.nextOccurrence!.id
  );
  const excluded = [
    retryOutside,
    claimed,
    sent,
    cancelled,
    skipped,
  ].map((item) => item.nextOccurrence!.id);
  assert(
    response.status === 200 &&
      retryItem?.dueAt.startsWith(nextTwoDays.slice(0, 19)) &&
      taskItem?.dueAt.startsWith(nextThreeDays.slice(0, 19)) &&
      pendingItem?.dueAt.startsWith(nextDay.slice(0, 19)) &&
      failedItem?.dueAt.startsWith(yesterday.slice(0, 19)) &&
      manualItem?.dueAt.startsWith(yesterday.slice(0, 19)) &&
      excluded.every((id) => !all.some((item) => item.id === id)),
    `Today retry lifecycle used the wrong effective due: ${
      JSON.stringify(body)
    }`,
  );
});

Deno.test("TODAY-001 PostgreSQL projects every v6 reminder target through its authoritative owner", async () => {
  const fixture = await register(
    `today-targets-${crypto.randomUUID()}@example.test`,
    "Today targets",
  );
  const personId = await createPerson(fixture, "Target person");
  const deliverAt = new Date(Date.now() + 60 * 60_000).toISOString();
  const anchorOn = deliverAt.slice(0, 10);
  const insertTask = async (title: string, dueAt?: string) => {
    const id = crypto.randomUUID();
    await sql`
      insert into crm.tasks (id, workspace_id, person_id, title, due_at, created_by_member_id)
      values (${id}::uuid, ${fixture.workspaceId}::uuid, ${personId}::uuid,
        ${title}, ${dueAt ?? null}::timestamptz, ${fixture.memberId}::uuid)
    `;
    return id;
  };
  const insertTarget = async (input: {
    readonly deliverAt?: string;
    readonly kind: "custom" | "life_event" | "person_date" | "task";
    readonly lifeEventId?: string;
    readonly occurrenceId?: string;
    readonly personDateId?: string;
    readonly personId?: string;
    readonly reminderId?: string;
    readonly taskId?: string;
    readonly title: string;
  }) => {
    const reminderId = input.reminderId ?? crypto.randomUUID();
    const occurrenceId = input.occurrenceId ?? crypto.randomUUID();
    const targetDeliverAt = input.deliverAt ?? deliverAt;
    await sql`
      insert into crm.reminders (id, workspace_id, person_id, person_date_id,
        life_event_id, task_id, target_kind, title, anchor_on,
        recurrence_unit, created_by_member_id)
      values (${reminderId}::uuid, ${fixture.workspaceId}::uuid,
        ${input.personId ?? null}::uuid, ${input.personDateId ?? null}::uuid,
        ${input.lifeEventId ?? null}::uuid, ${input.taskId ?? null}::uuid,
        ${input.kind}, ${input.title}, ${anchorOn}::date, 'none',
        ${fixture.memberId}::uuid)
    `;
    await sql`
      insert into crm.reminder_occurrences (id, reminder_id, member_id,
        occurs_on, deliver_at, channel, status, title_snapshot, workspace_id)
      values (${occurrenceId}::uuid, ${reminderId}::uuid,
        ${fixture.memberId}::uuid, ${anchorOn}::date, ${targetDeliverAt}::timestamptz,
        'in_app', 'pending', ${input.title}, (select scope.workspace_id from crm.reminders scope where scope.id = ${reminderId}::uuid))
    `;
    return { occurrenceId, reminderId };
  };

  const nullDueTask = await insertTask("Null due target");
  const farTask = await insertTask(
    "Far due target",
    new Date(Date.now() + 45 * 86_400_000).toISOString(),
  );
  const duplicateTask = await insertTask("Duplicate target", deliverAt);
  const stableSourceTask = await insertTask("Stable source target");
  const directPrecedenceTask = await insertTask(
    "Direct source wins",
    deliverAt,
  );
  const earlierOccurrenceTask = await insertTask(
    "Later direct source",
    new Date(new Date(deliverAt).getTime() + 60 * 60_000).toISOString(),
  );
  const completedTask = await insertTask("Completed target");
  const deletedTask = await insertTask("Deleted target");
  const nullDueOccurrence = await insertTarget({
    kind: "task",
    taskId: nullDueTask,
    title: "Null due occurrence",
  });
  await insertTarget({
    kind: "task",
    taskId: farTask,
    title: "Far due occurrence",
  });
  await insertTarget({
    kind: "task",
    taskId: duplicateTask,
    title: "Duplicate occurrence",
  });
  await insertTarget({
    kind: "task",
    occurrenceId: "00000000-0000-4000-8000-000000000022",
    reminderId: "00000000-0000-4000-8000-000000000032",
    taskId: stableSourceTask,
    title: "Larger source UUID",
  });
  await insertTarget({
    kind: "task",
    occurrenceId: "00000000-0000-4000-8000-000000000011",
    reminderId: "00000000-0000-4000-8000-000000000031",
    taskId: stableSourceTask,
    title: "Smaller source UUID",
  });
  await insertTarget({
    kind: "task",
    taskId: directPrecedenceTask,
    title: "Occurrence must lose equal due tie",
  });
  await insertTarget({
    kind: "task",
    taskId: earlierOccurrenceTask,
    title: "Earlier occurrence wins",
  });
  await insertTarget({
    kind: "task",
    taskId: completedTask,
    title: "Completed occurrence",
  });
  await insertTarget({
    kind: "task",
    taskId: deletedTask,
    title: "Deleted occurrence",
  });
  await sql`
    update crm.tasks set status = 'completed', completed_at = now()
    where id = ${completedTask}::uuid
  `;
  await sql`
    update crm.tasks set deleted_at = now() where id = ${deletedTask}::uuid
  `;

  const personDateId = crypto.randomUUID();
  await sql`
    insert into crm.person_dates (id, person_id, kind, month, day, precision, workspace_id)
    values (${personDateId}::uuid, ${personId}::uuid, 'birthday', ${
    Number(anchorOn.slice(5, 7))
  }, ${Number(anchorOn.slice(8, 10))},
      'month_day', (select scope.workspace_id from crm.people scope where scope.id = ${personId}::uuid))
  `;
  await insertTarget({
    kind: "person_date",
    personDateId,
    title: "Authoritative important date",
  });
  const lifeEventId = crypto.randomUUID();
  await sql`
    insert into crm.life_events (id, workspace_id, person_id, name, year, month, day, precision)
    values (${lifeEventId}::uuid, ${fixture.workspaceId}::uuid,
      ${personId}::uuid, 'Moved home', ${Number(anchorOn.slice(0, 4))}, ${
    Number(anchorOn.slice(5, 7))
  }, ${Number(anchorOn.slice(8, 10))}, 'full')
  `;
  await insertTarget({
    kind: "life_event",
    lifeEventId,
    title: "Authoritative life event",
  });
  const direct = await insertTarget({
    kind: "custom",
    personId,
    title: "Adjacent direct reminder",
  });

  type Item = {
    readonly dueAt: string;
    readonly id: string;
    readonly kind: string;
    readonly person?: { readonly id: string };
    readonly title: string;
  };
  const read = async () => {
    const response = await request(fixture, "/api/v1/today/attention");
    const body = await response.json() as {
      readonly attention: Readonly<Record<string, readonly Item[]>>;
      readonly upcoming: readonly Item[];
    };
    return { body, response };
  };
  const [{ body, response }, ...replays] = await Promise.all([
    read(),
    read(),
    read(),
  ]);
  const items = [...Object.values(body.attention).flat(), ...body.upcoming];
  const taskItems = items.filter((item) => item.kind === "task");
  const find = (kind: string, id: string) =>
    items.find((item) => item.kind === kind && item.id === id);
  assert(
    response.status === 200 &&
      find("task", nullDueTask)?.dueAt.startsWith(deliverAt.slice(0, 19)) &&
      find("task", farTask)?.title === "Far due occurrence" &&
      taskItems.filter((item) => item.id === duplicateTask).length === 1 &&
      find("task", stableSourceTask)?.title === "Smaller source UUID" &&
      find("task", directPrecedenceTask)?.title === "Direct source wins" &&
      find("task", earlierOccurrenceTask)?.title ===
        "Earlier occurrence wins" &&
      replays.every(({ body }) => {
        const replayItems = [
          ...Object.values(body.attention).flat(),
          ...body.upcoming,
        ];
        return replayItems.find((item) =>
          item.kind === "task" && item.id === stableSourceTask
        )?.title === "Smaller source UUID";
      }) &&
      !find("task", completedTask) && !find("task", deletedTask) &&
      find("important-date", personDateId)?.person?.id === personId &&
      find("life-event", lifeEventId)?.person?.id === personId &&
      find("reminder", direct.occurrenceId)?.person?.id === personId &&
      find("task", nullDueTask)?.id !== nullDueOccurrence.occurrenceId,
    `v6 target projection was incomplete: ${JSON.stringify(items)}`,
  );
});

Deno.test("TODAY-001 PostgreSQL keeps timezone and rows in one repeatable snapshot", async () => {
  const runInterleaving = async (inherited: boolean) => {
    const fixture = await register(
      `today-snapshot-${inherited}-${crypto.randomUUID()}@example.test`,
      `Today snapshot ${inherited}`,
    );
    const personId = await createPerson(fixture, "Snapshot person");
    const reminder = await createReminder(fixture, personId, "Snapshot row");
    const occurrenceId = reminder.nextOccurrence?.id;
    assert(occurrenceId, "snapshot occurrence exists");
    const oldDueAt = new Date(Date.now() + 60 * 60_000).toISOString();
    const newDueAt = new Date(Date.now() + 2 * 60 * 60_000).toISOString();
    await sql`
      update crm.workspace_settings set default_timezone = 'UTC'
      where workspace_id = ${fixture.workspaceId}::uuid
    `;
    await sql`
      insert into crm.member_preferences (member_id, timezone, workspace_id)
      values (${fixture.memberId}::uuid, ${inherited ? null : "UTC"},
        ${fixture.workspaceId}::uuid)
      on conflict (member_id) do update set timezone = excluded.timezone
    `;
    await sql`
      update crm.reminder_occurrences set deliver_at = ${oldDueAt}::timestamptz,
        occurs_on = ${oldDueAt.slice(0, 10)}::date, channel = 'in_app',
        status = 'pending'
      where id = ${occurrenceId}::uuid
    `;

    const locker = postgres(databaseUrl, { max: 1, onnotice: () => undefined });
    const observer = postgres(databaseUrl, {
      max: 1,
      onnotice: () => undefined,
    });
    let signalLocked!: (pid: number) => void;
    const locked = new Promise<number>((resolve) => signalLocked = resolve);
    let releaseLocker!: () => void;
    const release = new Promise<void>((resolve) => releaseLocker = resolve);
    const lockerWork = locker.begin(async (transaction) => {
      const [backend] = await transaction<{ readonly pid: number }[]>`
        select pg_backend_pid()::int as pid
      `;
      assert(backend, "locker backend PID exists");
      await transaction`
        select id from crm.reminder_occurrences
        where id = ${occurrenceId}::uuid for update
      `;
      await transaction`lock table crm.reminder_occurrences in access exclusive mode`;
      signalLocked(backend.pid);
      await release;
      if (inherited) {
        await transaction`
          update crm.workspace_settings set default_timezone = 'America/New_York'
          where workspace_id = ${fixture.workspaceId}::uuid
        `;
      } else {
        await transaction`
          update crm.member_preferences set timezone = 'America/New_York'
          where member_id = ${fixture.memberId}::uuid
        `;
      }
      await transaction`
        update crm.reminder_occurrences set deliver_at = ${newDueAt}::timestamptz,
          occurs_on = ${newDueAt.slice(0, 10)}::date
        where id = ${occurrenceId}::uuid
      `;
    });
    const lockerPid = await locked;
    const todayRequest = request(fixture, "/api/v1/today/attention");
    let blockedPid: number | undefined;
    for (let attempt = 0; attempt < 100 && !blockedPid; attempt += 1) {
      const [blocked] = await observer<{ readonly pid: number }[]>`
        select activity.pid::int
        from pg_stat_activity activity
        where ${lockerPid}::int = any(pg_blocking_pids(activity.pid))
          and activity.wait_event_type = 'Lock'
        order by activity.pid limit 1
      `;
      blockedPid = blocked?.pid;
      if (!blockedPid) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (blockedPid === undefined || blockedPid === lockerPid) {
      releaseLocker();
      await Promise.allSettled([lockerWork, todayRequest]);
      await Promise.all([locker.end(), observer.end()]);
      throw new Error(
        "Today backend did not reach the exact locker-owned relation barrier",
      );
    }
    releaseLocker();
    const response = await todayRequest;
    await lockerWork;
    const body = await response.json() as {
      readonly attention: Readonly<
        Record<
          string,
          readonly { readonly dueAt: string; readonly id: string }[]
        >
      >;
      readonly timezone: string;
      readonly upcoming: readonly {
        readonly dueAt: string;
        readonly id: string;
      }[];
    };
    const items = [...Object.values(body.attention).flat(), ...body.upcoming];
    const projected = items.find((item) => item.id === occurrenceId);
    assert(
      response.status === 200 && body.timezone === "UTC" &&
        projected?.dueAt.startsWith(oldDueAt.slice(0, 19)),
      `Today mixed timezone/row snapshots (${
        inherited ? "workspace" : "member"
      }): ${JSON.stringify(body)}`,
    );
    await Promise.all([locker.end(), observer.end()]);
  };
  await runInterleaving(false);
  await runInterleaving(true);
});

Deno.test("PLANNING-002 PostgreSQL validates an archived Today response at runtime", async () => {
  const fixture = await register(
    `today-runtime-${crypto.randomUUID()}@example.test`,
    "Today runtime contract",
  );
  const personId = await createPerson(fixture, "Archived Today person");
  const reminder = await createReminder(
    fixture,
    personId,
    "Archived Today reminder",
  );
  await sql`update crm.people set archived_at = now() where id = ${personId}::uuid`;
  const response = await request(fixture, "/api/v1/today/reminders");
  const body = await response.json();
  const parse = (generatedPlanningClient as unknown as {
    readonly parseTodayReminders?: (value: unknown) => unknown;
  }).parseTodayReminders;
  assert(
    response.status === 200,
    `archived Today HTTP response failed: ${JSON.stringify(body)}`,
  );
  assert(
    typeof parse === "function",
    "generated Today runtime validator missing",
  );
  const validated = parse(body) as {
    readonly reminders: readonly {
      readonly id: string;
      readonly person: { readonly archived: boolean; readonly id: string };
    }[];
  };
  const item = validated.reminders.find((entry) =>
    entry.id === reminder.nextOccurrence!.id
  );
  assert(
    item?.person.id === personId && item.person.archived === true,
    `archived Today response did not validate: ${JSON.stringify(body)}`,
  );
});

Deno.test("[PLANNING-003] REL-088 PostgreSQL clears an acknowledged undelivered reminder from Today for good", async () => {
  const fixture = await register(
    `today-acknowledge-${crypto.randomUUID()}@example.test`,
    "Today acknowledge",
  );
  const stranger = await register(
    `today-acknowledge-stranger-${crypto.randomUUID()}@example.test`,
    "Today acknowledge stranger",
  );
  // A second member of the same workspace, who may see the reminder's person
  // but never the reader's own deliveries.
  const colleagueEmail =
    `today-acknowledge-colleague-${crypto.randomUUID()}@example.test`;
  const colleagueOwner = await register(colleagueEmail, "Colleague's own");
  await addMembership(
    sql,
    colleagueOwner.userId,
    fixture.workspaceId,
    "member",
  );
  const colleague = await signInTo(colleagueEmail, fixture.workspaceId);
  const personId = await createPerson(fixture, "Undelivered person");
  const failed = await createReminder(fixture, personId, "Failed both ways");
  const unclear = await createReminder(fixture, personId, "Email unclear");
  const pending = await createReminder(fixture, personId, "Still pending");
  const failedId = failed.nextOccurrence!.id;
  const unclearId = unclear.nextOccurrence!.id;
  const pendingId = pending.nextOccurrence!.id;
  const yesterday = new Date(Date.now() - 86_400_000).toISOString();
  // `both`: the in-app and the email copy of one occurrence failed.
  await sql`
    update crm.reminder_occurrences set status = 'failed', attempt_count = 1,
      deliver_at = ${yesterday}::timestamptz
    where id = ${failedId}::uuid
  `;
  const [emailCopy] = await sql<{ readonly id: string }[]>`
    insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
      deliver_at, channel, status, attempt_count, title_snapshot, workspace_id)
    select reminder_id, member_id, occurs_on, deliver_at, 'email', 'failed',
      1, title_snapshot,
        (select scope.workspace_id from crm.reminders scope where scope.id = reminder_id)
    from crm.reminder_occurrences where id = ${failedId}::uuid
    returning id::text
  `;
  // Email alone, and the provider may have delivered it.
  await sql`
    update crm.reminder_occurrences set channel = 'email',
      status = 'manual_attention', attempt_count = 1,
      provider_result_state = 'ambiguous',
      deliver_at = ${yesterday}::timestamptz
    where id = ${unclearId}::uuid
  `;
  const acknowledge = (who: typeof fixture, id: string) =>
    request(who, `/api/v1/reminder-occurrences/${id}/acknowledgement`, "PUT");
  const listed = async () => {
    const response = await request(fixture, "/api/v1/today/attention");
    const body = await response.json() as {
      readonly attention: Readonly<
        Record<string, readonly { readonly id: string }[]>
      >;
      readonly upcoming: readonly { readonly id: string }[];
    };
    assert(response.status === 200, "Today attention was refused");
    return [...Object.values(body.attention).flat(), ...body.upcoming]
      .map((item) => item.id);
  };
  const before = await listed();
  assert(
    before.includes(failedId) && before.includes(unclearId) &&
      before.includes(pendingId),
    `the undelivered reminders were not listed: ${JSON.stringify(before)}`,
  );

  const foreign = await acknowledge(stranger, unclearId);
  const colleagues = await acknowledge(colleague, unclearId);
  const [untouched] = await sql<{ readonly status: string }[]>`
    select status from crm.reminder_occurrences where id = ${unclearId}::uuid
  `;
  const notUndelivered = await acknowledge(fixture, pendingId);
  const first = await acknowledge(fixture, failedId);
  const second = await acknowledge(fixture, unclearId);
  const replay = await acknowledge(fixture, unclearId);
  assert(
    foreign.status === 404 &&
      (await foreign.json() as { code?: string }).code ===
        "reminder_not_found",
    "another workspace's member acknowledged the reader's reminder",
  );
  assert(
    colleagues.status === 404 &&
      (await colleagues.json() as { code?: string }).code ===
        "reminder_not_found" &&
      untouched?.status === "manual_attention",
    `a colleague in the same workspace acknowledged the reader's reminder: ${colleagues.status} left ${untouched?.status}`,
  );
  assert(
    notUndelivered.status === 409 &&
      (await notUndelivered.json() as { code?: string }).code ===
        "reminder_occurrence_stale",
    "a pending reminder was acknowledged",
  );
  const bodies = await Promise.all(
    [first, second, replay].map((response) => response.json()),
  );
  assert(
    [first, second, replay].every((response) => response.status === 200) &&
      JSON.stringify(bodies) === JSON.stringify([
          { occurrenceId: failedId, status: "acknowledged" },
          { occurrenceId: unclearId, status: "acknowledged" },
          { occurrenceId: unclearId, status: "acknowledged" },
        ]),
    `acknowledgement answered ${JSON.stringify(bodies)}`,
  );

  // Pausing and resuming regenerates the window; skipped rows stay skipped.
  for (const active of [false, true]) {
    const toggled = await request(
      fixture,
      `/api/v1/reminders/${failed.id}/active`,
      "PUT",
      { active },
    );
    assert(toggled.status === 200, "the reminder could not be toggled");
  }
  const rows = await sql<{ readonly id: string; readonly status: string }[]>`
    select id::text, status from crm.reminder_occurrences
    where id in (${failedId}::uuid, ${emailCopy!.id}::uuid,
      ${unclearId}::uuid, ${pendingId}::uuid)
  `;
  const status = Object.fromEntries(rows.map((row) => [row.id, row.status]));
  assert(
    status[failedId] === "skipped" && status[emailCopy!.id] === "skipped" &&
      status[unclearId] === "skipped" && status[pendingId] === "pending",
    `acknowledgement left ${JSON.stringify(status)}`,
  );
  const after = await listed();
  assert(
    !after.includes(failedId) && !after.includes(emailCopy!.id) &&
      !after.includes(unclearId) && after.includes(pendingId),
    `Today still lists an acknowledged reminder: ${JSON.stringify(after)}`,
  );
  const audits = await sql<{
    readonly actor: string;
    readonly subject: string;
    readonly type: string;
  }[]>`
    select actor_member_id::text as actor, subject_id::text as subject,
      subject_type as type
    from crm.audit_events
    where workspace_id = ${fixture.workspaceId}::uuid
      and action = 'planning.reminder-acknowledged'
    order by occurred_at, subject_id
  `;
  assert(
    audits.length === 2 &&
      audits.every((audit) =>
        audit.actor === fixture.memberId &&
        audit.type === "reminder_occurrence"
      ) &&
      JSON.stringify(audits.map((audit) => audit.subject).sort()) ===
        JSON.stringify([failedId, unclearId].sort()),
    `acknowledgement audit: ${JSON.stringify(audits)}`,
  );
});

Deno.test({
  name: "PLANNING-001 PostgreSQL today resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
