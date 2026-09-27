/**
 * The Today planning projection (split from `planning_postgres_test.ts`,
 * GAP-035): ordering, tenancy, retry attention, reminder targets, and one
 * repeatable snapshot.
 *
 * Its final test closes the app and pools it loaded from
 * `planning.test-helper.ts`.
 */

import postgres from "postgres";
import * as generatedPlanningClient from "../../packages/contracts/generated/auth-client.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  createPerson,
  createReminder,
  createTask,
  databaseUrl,
  register,
  request,
  sql,
} from "./planning.test-helper.ts";
import { closeResources } from "./planning.test-helper.ts";

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
  await sql`
    insert into crm.tasks (id, workspace_id, person_id, title, due_at,
      created_by_member_id)
    values
      (${directTaskId}::uuid, ${fixture.workspaceId}::uuid,
        ${foreignPersonId}::uuid, 'Foreign-linked direct task',
        ${dueAt}::timestamptz, ${fixture.memberId}::uuid),
      (${targetTaskId}::uuid, ${fixture.workspaceId}::uuid,
        ${foreignPersonId}::uuid, 'Foreign-linked target task', null,
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
      occurs_on, deliver_at, channel, status, title_snapshot)
    values
      (${targetOccurrenceId}::uuid, ${targetReminderId}::uuid,
        ${fixture.memberId}::uuid, ${dueAt.slice(0, 10)}::date,
        ${dueAt}::timestamptz, 'in_app', 'pending',
        'Foreign-linked target occurrence'),
      (${deletedTargetOccurrenceId}::uuid, ${deletedTargetReminderId}::uuid,
        ${fixture.memberId}::uuid, ${earlierDueAt.slice(0, 10)}::date,
        ${earlierDueAt}::timestamptz, 'in_app', 'pending',
        'Deleted person target occurrence')
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
        occurs_on, deliver_at, channel, status, title_snapshot)
      values (${occurrenceId}::uuid, ${reminderId}::uuid,
        ${fixture.memberId}::uuid, ${anchorOn}::date, ${targetDeliverAt}::timestamptz,
        'in_app', 'pending', ${input.title})
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
    insert into crm.person_dates (id, person_id, kind, month, day, precision)
    values (${personDateId}::uuid, ${personId}::uuid, 'birthday', 8, 22,
      'month_day')
  `;
  const important = await insertTarget({
    kind: "person_date",
    personDateId,
    title: "Authoritative important date",
  });
  const lifeEventId = crypto.randomUUID();
  await sql`
    insert into crm.life_events (id, workspace_id, person_id, name, precision)
    values (${lifeEventId}::uuid, ${fixture.workspaceId}::uuid,
      ${personId}::uuid, 'Moved home', 'unknown')
  `;
  const lifeEvent = await insertTarget({
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
      find("important-date", important.occurrenceId)?.person?.id === personId &&
      find("life-event", lifeEvent.occurrenceId)?.person?.id === personId &&
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
      insert into crm.member_preferences (member_id, timezone)
      values (${fixture.memberId}::uuid, ${inherited ? null : "UTC"})
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

Deno.test({
  name: "PLANNING-001 PostgreSQL today resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
