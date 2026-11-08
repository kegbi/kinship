/**
 * Cadences and regeneration (split from `planning_postgres_test.ts`, GAP-035):
 * stay-in-touch request history, timezone and send-time regeneration, and
 * horizon generation.
 *
 * Its final test closes the app and pools it loaded from
 * `planning.test-helper.ts`.
 */

import { PostgresReminderDeliveryPreferences } from "../../packages/backend/modules/workspaces/adapters/postgres/reminder_delivery_preferences.ts";
import {
  createReminderDeliveryWorker,
  reminderDeliveryAuditFrom,
} from "../../packages/backend/modules/planning/public.ts";
import { InAppReminderDelivery } from "../../packages/backend/modules/planning/adapters/in_app/reminder_delivery.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import {
  mergeStayInTouchCadences,
  PostgresInAppReminderEffectStore,
  PostgresReminderRepository,
} from "../../packages/backend/modules/planning/adapters/postgres/reminder_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  type CreatedReminder,
  createPerson,
  createReminder,
  deliveryConnection,
  deliveryRepository,
  deliveryTransaction,
  inApiWorkspace,
  register,
  request,
  sql,
} from "./planning.test-helper.ts";
import { closeResources } from "./planning.test-helper.ts";

Deno.test("PLANNING-002 PostgreSQL scopes and retains cadence request history", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-history-${suffix}@example.test`,
    "Reminder history",
  );
  const foreign = await register(
    `reminder-history-foreign-${suffix}@example.test`,
    "Foreign reminder history",
  );
  const personId = await createPerson(fixture, "History person");
  const foreignPersonId = await createPerson(foreign, "Foreign history person");
  const requestA = crypto.randomUUID();
  const requestB = crypto.randomUUID();
  const payloadA = {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: requestA,
  };
  assert(
    (await request(
      fixture,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      payloadA,
    )).status === 201,
    "first cadence request accepted",
  );
  assert(
    (await request(foreign, "/api/v1/stay-in-touch-cadences", "POST", {
      ...payloadA,
      personId: foreignPersonId,
    })).status === 201,
    "same cadence request UUID was not workspace scoped",
  );
  assert(
    (await request(fixture, "/api/v1/stay-in-touch-cadences", "POST", {
      ...payloadA,
      intervalCount: 2,
      requestId: requestB,
    })).status === 201,
    "second cadence request accepted",
  );
  const replayA = await request(
    fixture,
    "/api/v1/stay-in-touch-cadences",
    "POST",
    payloadA,
  );
  const [cadenceState] = await sql<{ readonly interval_count: number }[]>`
    select interval_count from crm.stay_in_touch_cadences
    where person_id = ${personId}::uuid
  `;
  assert(
    replayA.status === 201 && cadenceState?.interval_count === 2,
    `A-B-replay-A mutated cadence: ${JSON.stringify(cadenceState)}`,
  );
});

Deno.test("PLANNING-002 PostgreSQL timezone regeneration preserves actionability and attempts", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-timezone-${suffix}@example.test`,
    "Timezone reminders",
  );
  const personId = await createPerson(fixture, "Timezone person");
  const pastZone = "Pacific/Kiritimati";
  const futureZone = "America/Adak";
  const futureLocal = Temporal.Now.instant().add({ hours: 10 })
    .toZonedDateTimeISO(futureZone).toPlainDateTime();
  const occursOn = futureLocal.toPlainDate().toString();
  const sendTime = `${String(futureLocal.hour).padStart(2, "0")}:${
    String(futureLocal.minute).padStart(2, "0")
  }`;
  const preferencePayload = (timezone?: string) => ({
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    temperatureScale: "celsius",
    ...(timezone ? { timezone } : {}),
  });
  const workspacePayload = (timezone: string) => ({
    defaultLocale: "en",
    defaultReminderTime: "09:00",
    defaultTimezone: timezone,
    name: "Timezone reminders",
  });
  const state = async (occurrenceId: string) => {
    const [row] = await sql<{
      readonly attempt_count: number;
      readonly deliver_at: string;
      readonly error: string | null;
      readonly last_attempt_at: string | null;
      readonly next_attempt_at: string | null;
      readonly provider_result_state: string;
      readonly status: string;
    }[]>`
      select attempt_count, deliver_at::text, error,
        last_attempt_at::text, next_attempt_at::text,
        provider_result_state, status
      from crm.reminder_occurrences where id = ${occurrenceId}::uuid
    `;
    assert(row, `occurrence ${occurrenceId} missing`);
    return row;
  };
  const preparePending = async (
    reminderId: string,
    occurrenceId: string,
    timezone: string,
  ) => {
    await sql`
      update crm.reminders set send_time = ${sendTime}::time, updated_at = now()
      where id = ${reminderId}::uuid
    `;
    await sql`
      update crm.reminder_occurrences set
        occurs_on = ${occursOn}::date,
        deliver_at = (${occursOn}::date + ${sendTime}::time)
          at time zone ${timezone},
        status = 'pending', attempt_count = 0, last_attempt_at = null,
        next_attempt_at = null, claim_token = null, claim_owner = null,
        lease_expires_at = null, provider_result_state = 'unattempted',
        provider_receipt = null, provider_effect_at = null, visible_at = null,
        sent_at = null, error = null, updated_at = now()
      where id = ${occurrenceId}::uuid
    `;
  };
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(deliveryConnection.db, {
        now: () => new Date(),
      }),
    ),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(pastZone),
    )).status === 200,
    "initial member timezone saved",
  );
  const memberReminder = await createReminder(
    fixture,
    personId,
    "Member timezone direction",
  );
  const attemptedReminder = await createReminder(
    fixture,
    personId,
    "Attempted timezone state",
  );
  await preparePending(
    memberReminder.id,
    memberReminder.nextOccurrence!.id,
    pastZone,
  );
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      last_attempt_at = now(), next_attempt_at = now() + interval '2 days',
      deliver_at = now() + interval '1 day', error = 'keep-retry',
      provider_result_state = 'ambiguous', updated_at = now()
    where id = ${attemptedReminder.nextOccurrence!.id}::uuid
  `;
  const attemptedBefore = await state(attemptedReminder.nextOccurrence!.id);

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(futureZone),
    )).status === 200,
    "member timezone moved toward future",
  );
  const memberFuture = await state(memberReminder.nextOccurrence!.id);
  assert(
    memberFuture.status === "pending" &&
      Date.parse(memberFuture.deliver_at) > Date.now(),
    `past member occurrence was not moved into the future: ${
      JSON.stringify(memberFuture)
    }`,
  );
  assert(
    JSON.stringify(await state(attemptedReminder.nextOccurrence!.id)) ===
      JSON.stringify(attemptedBefore),
    "member timezone change reset attempted retry/ambiguous state",
  );
  assert(
    (await worker.tick({ owner: "member-future" })).claimed === 0,
    "future-regenerated member occurrence was claimed early",
  );

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(pastZone),
    )).status === 200,
    "member timezone moved toward past",
  );
  const memberPast = await state(memberReminder.nextOccurrence!.id);
  assert(
    memberPast.status === "pending" &&
      Date.parse(memberPast.deliver_at) <= Date.now(),
    `future member occurrence lost past-due actionability: ${
      JSON.stringify(memberPast)
    }`,
  );
  const memberDelivery = await worker.tick({ owner: "member-past" });
  assert(
    memberDelivery.claimed === 1 &&
      memberDelivery.results[0]?.id === memberReminder.nextOccurrence!.id,
    "past-regenerated member occurrence was not actionable",
  );

  assert(
    (await request(
          fixture,
          "/api/v1/settings/preferences",
          "PUT",
          preferencePayload(),
        )).status === 200 &&
      (await request(
          fixture,
          "/api/v1/settings/workspace",
          "PUT",
          workspacePayload(pastZone),
        )).status === 200,
    "inherited workspace timezone prepared",
  );
  const workspaceReminder = await createReminder(
    fixture,
    personId,
    "Workspace timezone direction",
  );
  await preparePending(
    workspaceReminder.id,
    workspaceReminder.nextOccurrence!.id,
    pastZone,
  );
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspacePayload(futureZone),
    )).status === 200,
    "workspace timezone moved toward future",
  );
  const workspaceFuture = await state(workspaceReminder.nextOccurrence!.id);
  assert(
    workspaceFuture.status === "pending" &&
      Date.parse(workspaceFuture.deliver_at) > Date.now() &&
      (await worker.tick({ owner: "workspace-future" })).claimed === 0,
    `past inherited occurrence was claimable after moving future: ${
      JSON.stringify(workspaceFuture)
    }`,
  );
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspacePayload(pastZone),
    )).status === 200,
    "workspace timezone moved toward past",
  );
  const workspacePast = await state(workspaceReminder.nextOccurrence!.id);
  const workspaceDelivery = await worker.tick({ owner: "workspace-past" });
  assert(
    workspacePast.status === "pending" &&
      Date.parse(workspacePast.deliver_at) <= Date.now() &&
      workspaceDelivery.claimed === 1 &&
      workspaceDelivery.results[0]?.id === workspaceReminder.nextOccurrence!.id,
    `future inherited occurrence lost actionability: ${
      JSON.stringify({ workspacePast, workspaceDelivery })
    }`,
  );
  assert(
    JSON.stringify(await state(attemptedReminder.nextOccurrence!.id)) ===
      JSON.stringify(attemptedBefore),
    "workspace timezone change reset attempted retry/ambiguous state",
  );
});

Deno.test("PLANNING-002 PostgreSQL keeps one stable calendar identity across timezone replenishment", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-identity-${suffix}@example.test`,
    "Identity reminders",
  );
  const personId = await createPerson(fixture, "Identity person");
  const pastZone = "Pacific/Kiritimati";
  const futureZone = "America/Adak";
  const preferencePayload = (timezone?: string) => ({
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    temperatureScale: "celsius",
    ...(timezone ? { timezone } : {}),
  });
  const workspacePayload = (timezone: string) => ({
    defaultLocale: "en",
    defaultReminderTime: "09:00",
    defaultTimezone: timezone,
    name: "Identity reminders",
  });
  const createDaily = async (title: string) => {
    const response = await request(fixture, "/api/v1/reminders", "POST", {
      anchorOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "day",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title,
    });
    const body = await response.json() as CreatedReminder;
    assert(response.status === 201 && body.reminder.nextOccurrence, title);
    return body.reminder;
  };
  const markRetry = (occurrenceId: string) =>
    sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      last_attempt_at = now(), next_attempt_at = now() + interval '1 day',
      provider_result_state = 'ambiguous', error = 'preserve-attempt',
      updated_at = now()
    where id = ${occurrenceId}::uuid
  `;
  const identityCount = async (reminderId: string, occursOn: string) => {
    const [row] = await sql<{ readonly count: number }[]>`
      select count(*)::int as count from crm.reminder_occurrences
      where reminder_id = ${reminderId}::uuid
        and member_id = ${fixture.memberId}::uuid
        and occurs_on = ${occursOn}::date and channel = 'in_app'
    `;
    return row?.count ?? 0;
  };
  const managementRepository = new PostgresReminderRepository(
    new PostgresActorRevalidation(),
    new PostgresReminderDeliveryPreferences(),
  );
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(deliveryConnection.db, {
        now: () => new Date(),
      }),
    ),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(pastZone),
    )).status === 200,
    "member identity timezone prepared",
  );
  const memberReminder = await createDaily("Member stable identity");
  const memberOccurrence = memberReminder.nextOccurrence!;
  await markRetry(memberOccurrence.id);
  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload(futureZone),
    )).status === 200,
    "member identity timezone changed",
  );
  await Promise.all([
    deliveryTransaction.run(
      (transaction) =>
        managementRepository.regenerateForTimezone({
          memberId: fixture.memberId,
          now: new Date(),
          role: fixture.role,
          timezone: futureZone,
          transaction,
          userId: fixture.userId,
          workspaceId: fixture.workspaceId,
        }),
      { workspaceId: fixture.workspaceId },
    ),
    deliveryRepository.replenish({ now: new Date() }),
  ]);
  assert(
    await identityCount(memberReminder.id, memberOccurrence.occursOn) === 1,
    "member timezone replenishment duplicated one calendar occurrence",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute',
      next_attempt_at = now() - interval '1 second'
    where reminder_id = ${memberReminder.id}::uuid
      and occurs_on = ${memberOccurrence.occursOn}::date
  `;
  assert(
    (await worker.tick({ maxAttempts: 1, owner: "member-identity" }))
      .claimed ===
      1,
    "member calendar identity was claimed more than once",
  );

  assert(
    (await request(
          fixture,
          "/api/v1/settings/preferences",
          "PUT",
          preferencePayload(),
        )).status === 200 &&
      (await request(
          fixture,
          "/api/v1/settings/workspace",
          "PUT",
          workspacePayload(pastZone),
        )).status === 200,
    "workspace identity timezone prepared",
  );
  const workspaceReminder = await createDaily("Workspace stable identity");
  const workspaceOccurrence = workspaceReminder.nextOccurrence!;
  await markRetry(workspaceOccurrence.id);
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspacePayload(futureZone),
    )).status === 200,
    "workspace identity timezone changed",
  );
  await Promise.all([
    deliveryTransaction.run(
      (transaction) =>
        managementRepository.regenerateForWorkspaceTimezone({
          now: new Date(),
          timezone: futureZone,
          transaction,
          workspaceId: fixture.workspaceId,
        }),
      { workspaceId: fixture.workspaceId },
    ),
    deliveryRepository.replenish({ now: new Date() }),
  ]);
  assert(
    await identityCount(workspaceReminder.id, workspaceOccurrence.occursOn) ===
      1,
    "workspace timezone replenishment duplicated one calendar occurrence",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute',
      next_attempt_at = now() - interval '1 second'
    where reminder_id = ${workspaceReminder.id}::uuid
      and occurs_on = ${workspaceOccurrence.occursOn}::date
  `;
  assert(
    (await worker.tick({ maxAttempts: 1, owner: "workspace-identity" }))
      .claimed === 1,
    "workspace calendar identity was claimed more than once",
  );
});

Deno.test("PLANNING-002 PostgreSQL uses workspace send time for null overrides", async () => {
  const fixture = await register(
    `default-send-time-${crypto.randomUUID()}@example.test`,
    "Default reminder time",
  );
  const personId = await createPerson(fixture, "Default-time person");
  const workspaceSettings = (timezone: string) => ({
    defaultLocale: "en",
    defaultReminderTime: "15:45",
    defaultTimezone: timezone,
    name: "Default reminder time",
  });
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspaceSettings("UTC"),
    )).status === 200,
    "default reminder time saved",
  );
  const anchorOn = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "day",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Inherited send time",
  });
  const body = await created.json() as CreatedReminder;
  assert(created.status === 201, "default-time reminder created");
  await sql`
    update crm.reminders set send_time = null
    where id = ${body.reminder.id}::uuid
  `;
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspaceSettings("Europe/Belgrade"),
    )).status === 200,
    "workspace timezone regenerated null-override reminder",
  );
  const [workspaceProof] = await sql<{ readonly local_time: string }[]>`
    select to_char(deliver_at at time zone 'Europe/Belgrade', 'HH24:MI') local_time
    from crm.reminder_occurrences
    where reminder_id = ${body.reminder.id}::uuid
    order by occurs_on limit 1
  `;
  assert(
    workspaceProof?.local_time === "15:45",
    `workspace regeneration ignored default send time: ${
      JSON.stringify(workspaceProof)
    }`,
  );
  assert(
    (await request(fixture, "/api/v1/settings/preferences", "PUT", {
      contactNameOrder: "given_family_nickname",
      contactSortOrder: "given_name_asc",
      fluidLayout: false,
      locale: "en",
      measurementSystem: "metric",
      temperatureScale: "celsius",
      timezone: "America/New_York",
    })).status === 200,
    "member timezone regenerated null-override reminder",
  );
  const [memberProof] = await sql<{
    readonly last_occurs_on: string;
    readonly local_time: string;
  }[]>`
    select max(occurs_on)::text last_occurs_on,
      min(to_char(deliver_at at time zone 'America/New_York', 'HH24:MI')) local_time
    from crm.reminder_occurrences
    where reminder_id = ${body.reminder.id}::uuid
  `;
  assert(
    memberProof?.local_time === "15:45",
    `member regeneration ignored default send time: ${
      JSON.stringify(memberProof)
    }`,
  );
  const replenishFrom = new Date(`${memberProof.last_occurs_on}T23:59:59Z`);
  await deliveryRepository.replenish({ now: replenishFrom });
  const [rollingProof] = await sql<{ readonly valid: boolean }[]>`
    select bool_and(
      to_char(deliver_at at time zone 'America/New_York', 'HH24:MI') = '15:45'
    ) as valid
    from crm.reminder_occurrences
    where reminder_id = ${body.reminder.id}::uuid
      and occurs_on > ${memberProof.last_occurs_on}::date
  `;
  assert(
    rollingProof?.valid === true,
    `rolling replenishment ignored default send time: ${
      JSON.stringify(rollingProof)
    }`,
  );
});

Deno.test("PLANNING-002 PostgreSQL serializes horizon generation with effective timezone changes", async () => {
  const fixture = await register(
    `horizon-timezone-${crypto.randomUUID()}@example.test`,
    "Horizon timezone",
  );
  const personId = await createPerson(fixture, "Horizon person");
  const preferences = (timezone?: string) => ({
    contactNameOrder: "given_family_nickname",
    contactSortOrder: "given_name_asc",
    fluidLayout: false,
    locale: "en",
    measurementSystem: "metric",
    temperatureScale: "celsius",
    ...(timezone ? { timezone } : {}),
  });
  const workspace = (timezone: string) => ({
    defaultLocale: "en",
    defaultReminderTime: "09:00",
    defaultTimezone: timezone,
    name: "Horizon timezone",
  });
  const createDaily = async (title: string) => {
    const response = await request(fixture, "/api/v1/reminders", "POST", {
      anchorOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "day",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title,
    });
    const body = await response.json() as CreatedReminder;
    assert(response.status === 201, `${title} created`);
    return body.reminder.id;
  };
  const lastOccursOn = async (reminderId: string) => {
    const [row] = await sql<{ readonly occurs_on: string }[]>`
      select max(occurs_on)::text as occurs_on from crm.reminder_occurrences
      where reminder_id = ${reminderId}::uuid
    `;
    assert(row?.occurs_on, "horizon fixture occurrence missing");
    return row.occurs_on;
  };
  const proveSerialized = async (
    reminderId: string,
    newTimezone: string,
    holdChange: (release: Promise<void>, changed: () => void) => Promise<void>,
  ) => {
    const previousLast = await lastOccursOn(reminderId);
    let changed!: () => void;
    const changedReady = new Promise<void>((resolve) => changed = resolve);
    let release!: () => void;
    const released = new Promise<void>((resolve) => release = resolve);
    const changing = holdChange(released, changed);
    await changedReady;
    const replenishing = deliveryRepository.replenish({
      now: new Date(`${previousLast}T23:59:59Z`),
    });
    const completedWhileUncommitted = await Promise.race([
      replenishing.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 250)),
    ]);
    release();
    await Promise.all([changing, replenishing]);
    assert(
      !completedWhileUncommitted,
      "horizon generation persisted an uncommitted old timezone",
    );
    const [proof] = await sql<{ readonly valid: boolean }[]>`
      select bool_and(
        to_char(deliver_at at time zone ${newTimezone}, 'HH24:MI') = '09:00'
      ) as valid
      from crm.reminder_occurrences
      where reminder_id = ${reminderId}::uuid
        and occurs_on > ${previousLast}::date
    `;
    assert(
      proof?.valid === true,
      `new horizon used stale timezone: ${JSON.stringify(proof)}`,
    );
  };

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferences("Pacific/Kiritimati"),
    )).status === 200,
    "member horizon timezone prepared",
  );
  const memberReminder = await createDaily("Member horizon lock");
  await proveSerialized(
    memberReminder,
    "America/Adak",
    (release, changed) =>
      sql.begin(async (transaction) => {
        await transaction`
          update crm.member_preferences set timezone = 'America/Adak'
          where member_id = ${fixture.memberId}::uuid
        `;
        changed();
        await release;
      }),
  );

  assert(
    (await request(
          fixture,
          "/api/v1/settings/preferences",
          "PUT",
          preferences(),
        )).status === 200 &&
      (await request(
          fixture,
          "/api/v1/settings/workspace",
          "PUT",
          workspace("Pacific/Kiritimati"),
        )).status === 200,
    "inherited horizon timezone prepared",
  );
  const workspaceReminder = await createDaily("Workspace horizon lock");
  await proveSerialized(
    workspaceReminder,
    "America/Adak",
    (release, changed) =>
      sql.begin(async (transaction) => {
        await transaction`
          update crm.workspace_settings set default_timezone = 'America/Adak'
          where workspace_id = ${fixture.workspaceId}::uuid
        `;
        changed();
        await release;
      }),
  );
});

Deno.test("PLANNING-002 PostgreSQL regenerates inherited send time without resetting attempts", async () => {
  const fixture = await register(
    `default-time-change-${crypto.randomUUID()}@example.test`,
    "Default time change",
  );
  const personId = await createPerson(fixture, "Default-time regeneration");
  const workspace = (defaultReminderTime: string) => ({
    defaultLocale: "en",
    defaultReminderTime,
    defaultTimezone: "UTC",
    name: "Default time change",
  });
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspace("09:00"),
    )).status === 200,
    "initial default reminder time saved",
  );
  const pending = await createReminder(
    fixture,
    personId,
    "Pending inherited time",
  );
  const attempted = await createReminder(
    fixture,
    personId,
    "Attempted inherited time",
  );
  await sql`
    update crm.reminders set send_time = null
    where id in (${pending.id}::uuid, ${attempted.id}::uuid)
  `;
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      provider_result_state = 'ambiguous', last_attempt_at = now(),
      next_attempt_at = now() + interval '1 day', error = 'preserve-attempt'
    where id = ${attempted.nextOccurrence!.id}::uuid
  `;
  const [attemptedBefore] = await sql<{
    readonly attempt_count: number;
    readonly deliver_at: string;
    readonly status: string;
  }[]>`
    select attempt_count, deliver_at::text, status
    from crm.reminder_occurrences where id = ${
    attempted.nextOccurrence!.id
  }::uuid
  `;
  assert(
    (await request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspace("15:45"),
    )).status === 200,
    "default reminder time changed",
  );
  const [pendingAfter] = await sql<{ readonly local_time: string }[]>`
    select to_char(deliver_at at time zone 'UTC', 'HH24:MI') as local_time
    from crm.reminder_occurrences where id = ${pending.nextOccurrence!.id}::uuid
  `;
  const [attemptedAfter] = await sql<{
    readonly attempt_count: number;
    readonly deliver_at: string;
    readonly status: string;
  }[]>`
    select attempt_count, deliver_at::text, status
    from crm.reminder_occurrences where id = ${
    attempted.nextOccurrence!.id
  }::uuid
  `;
  assert(
    pendingAfter?.local_time === "15:45",
    `default-time-only change did not regenerate pending work: ${
      JSON.stringify(pendingAfter)
    }`,
  );
  assert(
    JSON.stringify(attemptedAfter) === JSON.stringify(attemptedBefore),
    "default-time-only change reset attempted work",
  );
});

Deno.test("[AUD-W3] a person merge takes a duplicate's last contact only from its own workspace", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `cadence-merge-${suffix}@example.test`,
    "Cadence merge",
  );
  const foreign = await register(
    `cadence-merge-foreign-${suffix}@example.test`,
    "Foreign cadence merge",
  );
  const primaryId = await createPerson(fixture, "Merge primary");
  const duplicateId = await createPerson(fixture, "Merge duplicate");
  const foreignId = await createPerson(foreign, "Foreign duplicate");
  for (
    const [caller, personId] of [
      [fixture, primaryId],
      [fixture, duplicateId],
      [foreign, foreignId],
    ] as const
  ) {
    assert(
      (await request(caller, "/api/v1/stay-in-touch-cadences", "POST", {
        intervalCount: 1,
        intervalUnit: "month",
        personId,
        requestId: crypto.randomUUID(),
      })).status === 201,
      "merge cadence fixture created",
    );
  }
  await sql`
    update crm.stay_in_touch_cadences set last_contacted_at = case person_id
      when ${primaryId}::uuid then '2026-01-01T00:00:00Z'::timestamptz
      when ${duplicateId}::uuid then '2026-03-01T00:00:00Z'::timestamptz
      else '2026-06-01T00:00:00Z'::timestamptz end
    where person_id = any(${[primaryId, duplicateId, foreignId]}::uuid[])
  `;
  const lastContact = async () => {
    const [row] = await sql<{ readonly contacted: string }[]>`
      select to_char(last_contacted_at at time zone 'UTC', 'YYYY-MM-DD')
        as contacted
      from crm.stay_in_touch_cadences where person_id = ${primaryId}::uuid
    `;
    return row?.contacted;
  };
  const merge = (duplicate: string) =>
    inApiWorkspace(
      fixture.workspaceId,
      (transaction) =>
        mergeStayInTouchCadences({
          duplicateId: duplicate,
          memberId: fixture.memberId,
          occurredAt: new Date("2026-07-01T00:00:00Z"),
          primaryId,
          transaction,
          workspaceId: fixture.workspaceId,
        }),
    );
  await merge(foreignId);
  const afterForeign = await lastContact();
  await merge(duplicateId);
  const afterOwn = await lastContact();
  assert(
    afterForeign === "2026-01-01" && afterOwn === "2026-03-01",
    `the merge read another workspace's cadence: ${afterForeign}, ${afterOwn}`,
  );
});

Deno.test({
  name: "PLANNING-001 PostgreSQL cadences resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
