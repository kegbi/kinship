/**
 * Reminders (split from `planning_postgres_test.ts`, GAP-035): replay-safe
 * delivery and tenancy, occurrence replenishment and projection, important
 * dates, member scope, and cursor paging.
 *
 * Its final test closes the app and pools it loaded from
 * `planning.test-helper.ts`.
 */

import {
  createReminderDeliveryWorker,
  reminderDeliveryAuditFrom,
} from "../../packages/backend/modules/planning/public.ts";
import { InAppReminderDelivery } from "../../packages/backend/modules/planning/adapters/in_app/reminder_delivery.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import { PostgresInAppReminderEffectStore } from "../../packages/backend/modules/planning/adapters/postgres/reminder_repository.ts";
import { assert } from "../../packages/backend/testing/assert.ts";
import {
  type CreatedReminder,
  createPerson,
  createReminder,
  deliveryConnection,
  deliveryRepository,
  deliveryTransaction,
  DurableFakeProvider,
  futureReminderAnchor,
  register,
  request,
  sql,
} from "./planning.test-helper.ts";
import { closeResources } from "./planning.test-helper.ts";

Deno.test("PLANNING-002 reminder fixture remains future at the UTC date boundary", () => {
  const now = Temporal.Instant.from("2026-08-22T23:02:00Z");
  const anchor = futureReminderAnchor(now);
  const deliverAt = Temporal.ZonedDateTime.from(
    `${anchor}T09:00[Pacific/Kiritimati]`,
  ).toInstant();
  assert(
    Temporal.Instant.compare(deliverAt, now) > 0,
    `${deliverAt} must remain future from ${now}`,
  );
});

Deno.test("PLANNING-002 PostgreSQL keeps reminder delivery, tenancy, cadence, and audit replay-safe", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-${suffix}@example.test`,
    "Reminder planning",
  );
  const foreign = await register(
    `reminder-foreign-${suffix}@example.test`,
    "Foreign reminders",
  );
  const personId = await createPerson(fixture, "Reminder person");
  const otherPersonId = await createPerson(fixture, "Other reminder person");
  const foreignPersonId = await createPerson(foreign, "Foreign person");
  const forbidden = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
    personId: foreignPersonId,
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Cross tenant",
  });
  assert(
    forbidden.status === 404,
    "cross-workspace reminder person was accepted",
  );

  const cadenceRequestId = crypto.randomUUID();
  const cadencePayload = {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: cadenceRequestId,
  };
  const cadence = await request(
    fixture,
    "/api/v1/stay-in-touch-cadences",
    "POST",
    cadencePayload,
  );
  assert(cadence.status === 201, "stay-in-touch cadence created");
  assert(
    (await request(
      fixture,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      cadencePayload,
    )).status === 201,
    "same cadence request did not replay",
  );
  assert(
    (await request(
      fixture,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      { ...cadencePayload, intervalCount: 2 },
    )).status === 409,
    "changed cadence request replay was accepted",
  );
  assert(
    (await request(
      fixture,
      "/api/v1/stay-in-touch-cadences",
      "POST",
      { ...cadencePayload, personId: otherPersonId },
    )).status === 409,
    "cross-person cadence request reuse was accepted",
  );
  await sql`
    update crm.stay_in_touch_cadences set next_due_at = now() - interval '1 day'
    where person_id = ${personId}::uuid
  `;
  const attention = await request(fixture, "/api/v1/today/attention");
  const attentionBody = await attention.json() as {
    readonly attention: {
      readonly overdue: readonly {
        readonly id: string;
        readonly kind: string;
      }[];
    };
  };
  assert(
    attention.status === 200 &&
      attentionBody.attention.overdue.some((item) => item.kind === "cadence"),
    "due cadence was absent from unified Today attention",
  );
  const [cadenceAudit] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.audit_events
    where workspace_id = ${fixture.workspaceId}::uuid
      and action = 'planning.reminder-cadence-created'
  `;
  assert(cadenceAudit?.count === 1, "cadence replay duplicated audit evidence");
  const [cadenceBefore] = await sql<{
    last_contacted_at: string | null;
    next_due_at: string;
    updated_at: string;
  }[]>`
    select last_contacted_at::text, next_due_at::text, updated_at::text
    from crm.stay_in_touch_cadences where person_id = ${personId}::uuid
  `;
  assert(cadenceBefore, "cadence persistence missing");
  const oldActivity = {
    happenedAt: new Date(Date.now() - 86_400_000).toISOString(),
    kind: "activity",
    participantIds: [personId],
    requestId: crypto.randomUUID(),
    summary: "Older imported contact",
  };
  assert(
    (await request(fixture, "/api/v1/interactions", "POST", oldActivity))
      .status === 201,
    "older activity recorded",
  );
  const [afterOld] = await sql<{
    last_contacted_at: string | null;
    next_due_at: string;
    updated_at: string;
  }[]>`
    select last_contacted_at::text, next_due_at::text, updated_at::text
    from crm.stay_in_touch_cadences where person_id = ${personId}::uuid
  `;
  assert(
    afterOld?.last_contacted_at === cadenceBefore.last_contacted_at &&
      afterOld?.next_due_at === cadenceBefore.next_due_at &&
      afterOld?.updated_at === cadenceBefore.updated_at,
    "older interaction regressed cadence",
  );
  const newerHappenedAt = new Date(Date.now() + 3_600_000).toISOString();
  const newerActivity = {
    happenedAt: newerHappenedAt,
    kind: "activity",
    participantIds: [personId],
    requestId: crypto.randomUUID(),
    summary: "Current contact",
  };
  assert(
    (await request(fixture, "/api/v1/interactions", "POST", newerActivity))
      .status === 201,
    "newer activity recorded",
  );
  const [afterNew] = await sql<{
    last_contacted_at: string | null;
    next_due_at: string;
    updated_at: string;
  }[]>`
    select last_contacted_at::text, next_due_at::text, updated_at::text
    from crm.stay_in_touch_cadences where person_id = ${personId}::uuid
  `;
  const replayActivity = {
    ...newerActivity,
    requestId: crypto.randomUUID(),
  };
  assert(
    (await request(fixture, "/api/v1/interactions", "POST", replayActivity))
      .status === 201,
    "equivalent contact replay recorded",
  );
  const [afterReplay] = await sql<{
    last_contacted_at: string | null;
    next_due_at: string;
    updated_at: string;
  }[]>`
    select last_contacted_at::text, next_due_at::text, updated_at::text
    from crm.stay_in_touch_cadences where person_id = ${personId}::uuid
  `;
  assert(
    afterNew !== undefined && afterReplay !== undefined &&
      afterNew.last_contacted_at !== null &&
      Date.parse(afterNew.last_contacted_at) === Date.parse(newerHappenedAt) &&
      afterReplay?.next_due_at === afterNew.next_due_at &&
      afterReplay.updated_at === afterNew.updated_at,
    `new/replayed interaction did not advance cadence monotonically: ${
      JSON.stringify({ afterNew, afterReplay, newerHappenedAt })
    }`,
  );

  const provider = new DurableFakeProvider();
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const ambiguous = await createReminder(fixture, personId, "Ambiguous effect");
  const ambiguousOccurrence = ambiguous.nextOccurrence!.id;
  const inheritedTimezone = await request(
    fixture,
    "/api/v1/settings/workspace",
    "PUT",
    {
      defaultLocale: "en",
      defaultReminderTime: "09:00",
      defaultTimezone: "Europe/Belgrade",
      name: "Reminder workspace",
    },
  );
  const [inheritedRegenerated] = await sql<{ readonly deliver_at: string }[]>`
    select deliver_at::text from crm.reminder_occurrences
    where id = ${ambiguousOccurrence}::uuid
  `;
  assert(
    inheritedTimezone.status === 200 && inheritedRegenerated &&
      Date.parse(inheritedRegenerated.deliver_at) !==
        Date.parse(ambiguous.nextOccurrence!.deliverAt),
    "workspace default timezone did not regenerate inherited occurrence",
  );
  const changedTimezone = await request(
    fixture,
    "/api/v1/settings/preferences",
    "PUT",
    {
      contactNameOrder: "given_family_nickname",
      contactSortOrder: "given_name_asc",
      fluidLayout: false,
      locale: "en",
      measurementSystem: "metric",
      temperatureScale: "celsius",
      timezone: "America/New_York",
    },
  );
  const [regenerated] = await sql<{ readonly deliver_at: string }[]>`
    select deliver_at::text from crm.reminder_occurrences
    where id = ${ambiguousOccurrence}::uuid
  `;
  assert(
    changedTimezone.status === 200 && regenerated &&
      Date.parse(regenerated.deliver_at) !==
        Date.parse(ambiguous.nextOccurrence!.deliverAt),
    "effective timezone change did not regenerate the future occurrence",
  );
  const explicitDeliverAt = regenerated.deliver_at;
  const changedDefaultWithOverride = await request(
    fixture,
    "/api/v1/settings/workspace",
    "PUT",
    {
      defaultLocale: "en",
      defaultReminderTime: "09:00",
      defaultTimezone: "Asia/Tokyo",
      name: "Reminder workspace",
    },
  );
  const [afterDefaultWithOverride] = await sql<
    { readonly deliver_at: string }[]
  >`
    select deliver_at::text from crm.reminder_occurrences
    where id = ${ambiguousOccurrence}::uuid
  `;
  assert(
    changedDefaultWithOverride.status === 200 &&
      afterDefaultWithOverride?.deliver_at === explicitDeliverAt,
    "workspace default changed an explicit member timezone occurrence",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${ambiguousOccurrence}::uuid
  `;
  provider.throwAfterNextEffect = true;
  const first = await worker.tick({
    maxAttempts: 3,
    owner: "integration-a",
    retryBaseMilliseconds: 1_000,
  });
  assert(
    first.claimed === 1 && first.results[0]?.status === "retry",
    "ambiguous effect did not enter retry",
  );
  await sql`
    update crm.reminder_occurrences set next_attempt_at = now() - interval '1 second'
    where id = ${ambiguousOccurrence}::uuid
  `;
  const reconciled = await worker.tick({
    maxAttempts: 3,
    owner: "integration-b",
  });
  assert(
    reconciled.claimed === 1 && reconciled.results[0]?.status === "sent",
    "ambiguous effect did not reconcile",
  );

  const duplicate = await createReminder(
    fixture,
    personId,
    "Duplicate workers",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${duplicate.nextOccurrence!.id}::uuid
  `;
  const concurrent = await Promise.all([
    worker.tick({ owner: "integration-c" }),
    worker.tick({ owner: "integration-d" }),
  ]);
  assert(
    concurrent.reduce((sum, result) => sum + result.claimed, 0) === 1,
    "duplicate workers claimed one occurrence twice",
  );

  const unsupported = await createReminder(fixture, personId, "Legacy email");
  await sql`
    update crm.reminder_occurrences set channel = 'email',
      deliver_at = now() - interval '1 minute'
    where id = ${unsupported.nextOccurrence!.id}::uuid
  `;
  const unsupportedClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 10,
    now: new Date(),
    owner: "unsupported-channel-check",
  });
  assert(
    unsupportedClaims.every((claim) =>
      claim.id !== unsupported.nextOccurrence!.id
    ),
    "unsupported email occurrence was claimed",
  );

  const crash = await createReminder(fixture, personId, "Process death");
  const crashOccurrence = crash.nextOccurrence!.id;
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${crashOccurrence}::uuid
  `;
  const [crashedClaim] = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 1,
    now: new Date(),
    owner: "crashed-worker",
  });
  assert(
    crashedClaim?.id === crashOccurrence,
    "crashed process did not claim expected occurrence",
  );
  const durableEffects = new PostgresInAppReminderEffectStore(
    deliveryConnection.db,
    { now: () => new Date() },
  );
  const durableProvider = new InAppReminderDelivery(durableEffects);
  await durableProvider.deliver({
    idempotencyKey: crashedClaim.providerIdempotencyKey,
    occurrenceId: crashedClaim.id,
  });
  const [effectBeforeFinalize] = await sql<{
    readonly provider_effect_at: string | null;
    readonly provider_receipt: string | null;
    readonly provider_result_state: string;
    readonly status: string;
    readonly visible_at: string | null;
  }[]>`
    select status, provider_result_state, provider_receipt,
      provider_effect_at::text, visible_at::text
    from crm.reminder_occurrences where id = ${crashOccurrence}::uuid
  `;
  assert(
    effectBeforeFinalize?.status === "claimed" &&
      effectBeforeFinalize.provider_result_state === "confirmed" &&
      effectBeforeFinalize.provider_receipt !== null &&
      effectBeforeFinalize.provider_effect_at !== null &&
      effectBeforeFinalize.visible_at !== null,
    "in-app effect was not durable and visible before worker finalization",
  );
  const visiblePerson = await request(
    fixture,
    `/api/v1/people/${personId}/reminders`,
  );
  const visiblePersonBody = await visiblePerson.json() as {
    readonly reminders: readonly {
      readonly nextOccurrence?: {
        readonly id: string;
        readonly status: string;
        readonly visibleAt?: string;
      };
    }[];
  };
  const visibleToday = await request(fixture, "/api/v1/today/reminders");
  const visibleTodayBody = await visibleToday.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly status: string;
      readonly visibleAt?: string;
    }[];
  };
  assert(
    visiblePerson.status === 200 &&
      visiblePersonBody.reminders.some((item) =>
        item.nextOccurrence?.id === crashOccurrence &&
        item.nextOccurrence.status === "claimed" &&
        item.nextOccurrence.visibleAt
      ) && visibleToday.status === 200 &&
      visibleTodayBody.reminders.some((item) =>
        item.id === crashOccurrence && item.status === "claimed" &&
        item.visibleAt
      ),
    `confirmed visible effect was hidden before worker finalization: ${
      JSON.stringify({ visiblePersonBody, visibleTodayBody })
    }`,
  );
  await sql`
    update crm.reminder_occurrences set lease_expires_at = now() - interval '1 second'
    where id = ${crashOccurrence}::uuid
  `;
  const durableWorker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: durableProvider,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const recovered = await durableWorker.tick({ owner: "integration-recovery" });
  assert(
    recovered.claimed === 1 && recovered.results[0]?.status === "sent",
    "expired lease did not recover after process death",
  );

  const deliveryProof = await sql<{
    audits: number;
    attempts: number;
    status: string;
    visible_effects: number;
  }[]>`
    select occurrence.attempt_count as attempts, occurrence.status,
      case when occurrence.provider_effect_at is not null and occurrence.visible_at is not null then 1 else 0 end as visible_effects,
      (select count(*)::int from crm.audit_events audit
       where audit.subject_id = occurrence.id
         and audit.action = 'planning.reminder-delivered') as audits
    from crm.reminder_occurrences occurrence
    where occurrence.id = ${crashOccurrence}::uuid
  `;
  assert(
    deliveryProof[0]?.status === "sent" && deliveryProof[0].attempts === 2 &&
      deliveryProof[0].audits === 1 && deliveryProof[0].visible_effects === 1 &&
      provider.effects.size === 2,
    `delivery replay proof failed: ${
      JSON.stringify(deliveryProof[0])
    }, effects=${provider.effects.size}`,
  );
  const today = await request(fixture, "/api/v1/today/reminders");
  const todayBody = await today.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly status: string;
      readonly visibleAt?: string;
    }[];
  };
  assert(
    today.status === 200 &&
      todayBody.reminders.some((item) =>
        item.id === crashOccurrence && item.status === "sent" && item.visibleAt
      ),
    "Today did not expose delivered in-app state",
  );
});

Deno.test("PLANNING-002 PostgreSQL replenishes ninth occurrence and enforces delivery lifecycle", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-rolling-${suffix}@example.test`,
    "Rolling reminders",
  );
  const personId = await createPerson(fixture, "Rolling person");
  assert(
    (await request(fixture, "/api/v1/settings/workspace", "PUT", {
      defaultLocale: "en",
      defaultReminderTime: "02:30",
      defaultTimezone: "Europe/Belgrade",
      name: "Rolling reminders",
    })).status === 200,
    "rolling fixture timezone saved",
  );
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn: "2026-10-20",
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "day",
    requestId: crypto.randomUUID(),
    sendTime: "02:30",
    title: "DST rolling reminder",
  });
  const createdBody = await created.json() as CreatedReminder;
  const reminderId = createdBody.reminder.id;
  assert(created.status === 201, "rolling reminder created");
  await sql`
    update crm.reminder_occurrences set status = 'sent', sent_at = deliver_at,
      provider_receipt = 'seed-receipt', provider_result_state = 'confirmed',
      provider_effect_at = deliver_at, visible_at = deliver_at
    where reminder_id = ${reminderId}::uuid and occurs_on = '2026-10-20'::date
  `;
  const rollingWorker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date("2026-10-20T03:00:00Z") },
    provider: new DurableFakeProvider(),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  await Promise.all([
    rollingWorker.tick({ owner: "rolling-a" }),
    rollingWorker.tick({ owner: "rolling-b" }),
  ]);
  await rollingWorker.tick({ owner: "rolling-replay" });
  const [rolling] = await sql<{
    readonly count: number;
    readonly distinct_count: number;
    readonly ninth_at: string | null;
  }[]>`
    select count(*)::int as count,
      count(distinct (deliver_at, channel))::int as distinct_count,
      max(deliver_at)::text as ninth_at
    from crm.reminder_occurrences where reminder_id = ${reminderId}::uuid
  `;
  assert(
    rolling?.count === 9 && rolling.distinct_count === 9 &&
      rolling.ninth_at !== null &&
      Date.parse(rolling.ninth_at) === Date.parse("2026-10-28T01:30:00Z"),
    `rolling generation stopped or duplicated: ${JSON.stringify(rolling)}`,
  );
});

Deno.test("PLANNING-002 PostgreSQL excludes inactive delivery lifecycles", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-lifecycle-${suffix}@example.test`,
    "Reminder lifecycle",
  );
  const personId = await createPerson(fixture, "Lifecycle person");
  const archiveReminder = await createReminder(
    fixture,
    personId,
    "Archived lifecycle",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${archiveReminder.nextOccurrence!.id}::uuid
  `;
  await sql`update crm.people set archived_at = now() where id = ${personId}::uuid`;
  const archivedClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 100,
    now: new Date(),
    owner: "archived-lifecycle",
  });
  assert(
    archivedClaims.every((item) =>
      item.id !== archiveReminder.nextOccurrence!.id
    ),
    "archived person reminder was claimable",
  );
  await sql`
    update crm.people set archived_at = null, deleted_at = now()
    where id = ${personId}::uuid
  `;
  const deletedClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 100,
    now: new Date(),
    owner: "deleted-lifecycle",
  });
  assert(
    deletedClaims.every((item) =>
      item.id !== archiveReminder.nextOccurrence!.id
    ),
    "deleted person reminder was claimable",
  );
  await sql`update crm.people set deleted_at = null where id = ${personId}::uuid`;
  await sql`
    update crm.workspace_members set status = 'left', left_at = now()
    where id = ${fixture.memberId}::uuid
  `;
  const departedClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 100,
    now: new Date(),
    owner: "departed-lifecycle",
  });
  assert(
    departedClaims.every((item) =>
      item.id !== archiveReminder.nextOccurrence!.id
    ),
    "departed member reminder was claimable",
  );
  await sql`
    update crm.workspace_members set status = 'active', left_at = null
    where id = ${fixture.memberId}::uuid
  `;
  await sql`
    update crm.workspaces set status = 'suspended'
    where id = ${fixture.workspaceId}::uuid
  `;
  const inactiveWorkspaceClaims = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 100,
    now: new Date(),
    owner: "workspace-lifecycle",
  });
  assert(
    inactiveWorkspaceClaims.every((item) =>
      item.id !== archiveReminder.nextOccurrence!.id
    ),
    "inactive workspace reminder was claimable",
  );
});

Deno.test("PLANNING-002 PostgreSQL projects one relevant occurrence from bounded history", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-projection-${suffix}@example.test`,
    "Reminder projection",
  );
  const personId = await createPerson(fixture, "Projection person");
  const reminder = await createReminder(
    fixture,
    personId,
    "Relevant occurrence",
  );
  const occurrenceId = reminder.nextOccurrence!.id;
  await sql`
    update crm.reminder_occurrences set deliver_at = now() + interval '1 day'
    where id = ${occurrenceId}::uuid
  `;
  await sql`
    insert into crm.reminder_occurrences (
      reminder_id, member_id, occurs_on, deliver_at, channel, status,
      sent_at, title_snapshot, body_snapshot, provider_receipt,
      provider_result_state, provider_effect_at, visible_at
    )
    select reminder_id, member_id, (current_date - generated)::date,
      now() - generated * interval '1 day', channel, 'sent',
      now() - generated * interval '1 day', title_snapshot, body_snapshot,
      'history-' || generated::text, 'confirmed',
      now() - generated * interval '1 day',
      now() - generated * interval '1 day'
    from crm.reminder_occurrences cross join generate_series(1, 150) generated
    where id = ${occurrenceId}::uuid
  `;
  const personResponse = await request(
    fixture,
    `/api/v1/people/${personId}/reminders`,
  );
  const personBody = await personResponse.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly nextOccurrence?: { readonly id: string };
    }[];
  };
  const todayResponse = await request(fixture, "/api/v1/today/reminders");
  const todayBody = await todayResponse.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly title: string;
    }[];
  };
  assert(
    personResponse.status === 200 &&
      personBody.reminders.find((item) => item.id === reminder.id)
          ?.nextOccurrence?.id === occurrenceId &&
      todayResponse.status === 200 &&
      todayBody.reminders.filter((item) => item.title === "Relevant occurrence")
          .length === 1 &&
      todayBody.reminders.length < 100,
    `stale sent history dominated or expanded reminder projections: ${
      JSON.stringify({
        personBody,
        relevantToday: todayBody.reminders.filter((item) =>
          item.title === "Relevant occurrence"
        ),
        todayCount: todayBody.reminders.length,
      })
    }`,
  );
});

Deno.test("PLANNING-002 PostgreSQL projects retry authority separately from original delivery", async () => {
  const fixture = await register(
    `reminder-retry-projection-${crypto.randomUUID()}@example.test`,
    "Reminder retry projection",
  );
  const personId = await createPerson(fixture, "Retry projection person");
  const retry = await createReminder(fixture, personId, "Retry authority");
  const pending = await createReminder(fixture, personId, "Pending authority");
  await sql`
    update crm.reminder_occurrences set status = 'retry', attempt_count = 1,
      deliver_at = now() + interval '1 hour',
      next_attempt_at = now() + interval '2 days'
    where id = ${retry.nextOccurrence!.id}::uuid
  `;
  await sql`
    update crm.reminder_occurrences set status = 'pending',
      deliver_at = now() + interval '3 hours', next_attempt_at = null
    where id = ${pending.nextOccurrence!.id}::uuid
  `;
  const response = await request(fixture, "/api/v1/today/reminders");
  const body = await response.json() as {
    readonly reminders: readonly {
      readonly deliverAt: string;
      readonly id: string;
      readonly nextAttemptAt?: string;
      readonly status: string;
    }[];
  };
  const retryItem = body.reminders.find((item) =>
    item.id === retry.nextOccurrence!.id
  );
  const pendingItem = body.reminders.find((item) =>
    item.id === pending.nextOccurrence!.id
  );
  assert(
    response.status === 200 && retryItem?.status === "retry" &&
      retryItem.nextAttemptAt !== undefined &&
      retryItem.nextAttemptAt !== retryItem.deliverAt &&
      pendingItem?.status === "pending" &&
      !("nextAttemptAt" in pendingItem),
    `retry/pending schedule authority leaked: ${JSON.stringify(body)}`,
  );
});

Deno.test("PLANNING-002 PostgreSQL important dates publish one deliverable in-app occurrence", async () => {
  const fixture = await register(
    `important-date-reminder-${crypto.randomUUID()}@example.test`,
    "Important-date reminders",
  );
  const personId = await createPerson(fixture, "Important date person");
  assert(
    (await request(fixture, "/api/v1/settings/workspace", "PUT", {
      defaultLocale: "en",
      defaultReminderTime: "12:00",
      defaultTimezone: "UTC",
      name: "Important-date reminders",
    })).status === 200,
    "important-date reminder settings saved",
  );
  const date = new Date(Date.now() + 7 * 86_400_000);
  const created = await request(
    fixture,
    `/api/v1/people/${personId}/dates`,
    "POST",
    {
      day: date.getUTCDate(),
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Deliverable anniversary",
      month: date.getUTCMonth() + 1,
      precision: "month_day",
    },
  );
  assert(created.status === 201, "important date created");
  const [occurrence] = await sql<{
    readonly channel: string;
    readonly id: string;
  }[]>`
    select occurrence.id::text, occurrence.channel
    from crm.reminder_occurrences occurrence
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
    where reminder.person_id = ${personId}::uuid
      and reminder.target_kind = 'person_date'
      and occurrence.member_id = ${fixture.memberId}::uuid
  `;
  assert(
    occurrence?.channel === "in_app",
    `important-date publisher created unsupported channel: ${occurrence?.channel}`,
  );
  const directReminder = await createReminder(
    fixture,
    personId,
    "Direct reminder",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 day'
    where id in (${occurrence.id}::uuid, ${
    directReminder.nextOccurrence!.id
  }::uuid)
  `;
  await sql`
    insert into crm.reminder_occurrences (
      reminder_id, member_id, occurs_on, deliver_at, channel, status,
      title_snapshot, created_at, updated_at
    )
    select reminder_id, member_id, occurs_on,
      now() - interval '1 minute', 'email', 'pending',
      title_snapshot, now(), now()
    from crm.reminder_occurrences where id = ${occurrence.id}::uuid
  `;
  const attention = await request(fixture, "/api/v1/today/attention");
  const attentionBody = await attention.json() as {
    readonly attention: {
      readonly overdue: readonly {
        readonly id: string;
        readonly kind: string;
      }[];
    };
  };
  assert(
    attention.status === 200 &&
      attentionBody.attention.overdue.filter((item) =>
          item.kind === "important-date" && item.id === occurrence.id
        ).length === 1 &&
      attentionBody.attention.overdue.filter((item) =>
          item.kind === "reminder" &&
          item.id === directReminder.nextOccurrence!.id
        ).length === 1,
    "direct and important-date reminders were conflated, missing, or duplicated",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() + interval '1 day'
    where id = ${directReminder.nextOccurrence!.id}::uuid
  `;
  const provider = new InAppReminderDelivery(
    new PostgresInAppReminderEffectStore(
      deliveryConnection.db,
      { now: () => new Date() },
    ),
  );
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const delivered = await worker.tick({ owner: "important-date-worker" });
  const rows = await sql<
    { readonly channel: string; readonly status: string }[]
  >`
    select channel, status from crm.reminder_occurrences
    where reminder_id = (
      select reminder_id from crm.reminder_occurrences
      where id = ${occurrence.id}::uuid
    ) order by channel
  `;
  assert(
    delivered.claimed === 1 &&
      rows.some((row) => row.channel === "in_app" && row.status === "sent") &&
      rows.some((row) => row.channel === "email" && row.status === "pending"),
    `important-date delivery or legacy-channel safety failed: ${
      JSON.stringify({ delivered, rows })
    }`,
  );
});

Deno.test("PLANNING-002 PostgreSQL person reminder projection is member-scoped", async () => {
  const fixture = await register(
    `member-scope-${crypto.randomUUID()}@example.test`,
    "Member-scoped reminders",
  );
  const other = await register(
    `member-scope-other-${crypto.randomUUID()}@example.test`,
    "Other member workspace",
  );
  const personId = await createPerson(fixture, "Scoped reminder person");
  const reminder = await createReminder(fixture, personId, "Scoped reminder");
  const [membership] = await sql<{ readonly id: string }[]>`
    insert into crm.workspace_members (
      workspace_id, user_id, role, status, joined_at, created_at, updated_at
    ) values (
      ${fixture.workspaceId}::uuid, ${other.userId}::uuid, 'member', 'active',
      now(), now(), now()
    ) returning id::text
  `;
  assert(membership, "secondary membership created");
  const [foreignOccurrence] = await sql<{ readonly id: string }[]>`
    insert into crm.reminder_occurrences (
      reminder_id, member_id, occurs_on, deliver_at, channel, status,
      attempt_count, provider_result_state, error, title_snapshot,
      created_at, updated_at
    )
    select reminder_id, ${membership.id}::uuid, occurs_on,
      deliver_at - interval '1 day', channel, 'manual_attention', 1,
      'rejected', 'other member failure', title_snapshot, now(), now()
    from crm.reminder_occurrences where id = ${
    reminder.nextOccurrence!.id
  }::uuid
    returning id::text
  `;
  assert(foreignOccurrence, "secondary member occurrence created");
  const listed = await request(
    fixture,
    `/api/v1/people/${personId}/reminders`,
  );
  const listedBody = await listed.json() as {
    readonly reminders: readonly {
      readonly nextOccurrence?: {
        readonly id: string;
        readonly status: string;
      };
    }[];
  };
  assert(
    listed.status === 200 &&
      listedBody.reminders[0]?.nextOccurrence?.id ===
        reminder.nextOccurrence!.id &&
      listedBody.reminders[0]?.nextOccurrence?.status === "pending",
    `person reminder leaked another member state: ${
      JSON.stringify(listedBody)
    }`,
  );
});

Deno.test("PLANNING-002 PostgreSQL preserves every important-date lead rule through rolling delivery", async () => {
  const fixture = await register(
    `important-date-leads-${crypto.randomUUID()}@example.test`,
    "Important-date lead rules",
  );
  const personId = await createPerson(fixture, "Multiple lead person");
  await sql`
    insert into crm.reminder_rules (workspace_id, days_before)
    values (${fixture.workspaceId}::uuid, 0), (${fixture.workspaceId}::uuid, 7)
  `;
  const event = new Date(Date.now() + 30 * 86_400_000);
  const created = await request(
    fixture,
    `/api/v1/people/${personId}/dates`,
    "POST",
    {
      day: event.getUTCDate(),
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Two lead anniversary",
      month: event.getUTCMonth() + 1,
      precision: "month_day",
    },
  );
  assert(created.status === 201, "important date with two rules created");
  const initial = await sql<{
    readonly deliver_on: string;
    readonly id: string;
    readonly lead_time_days: number;
    readonly occurs_on: string;
    readonly reminder_id: string;
  }[]>`
    select occurrence.id::text, occurrence.reminder_id::text,
      occurrence.occurs_on::text, occurrence.lead_time_days,
      (occurrence.deliver_at at time zone 'UTC')::date::text as deliver_on
    from crm.reminder_occurrences occurrence
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
    where reminder.person_id = ${personId}::uuid
      and reminder.target_kind = 'person_date'
      and occurrence.member_id = ${fixture.memberId}::uuid
    order by occurrence.lead_time_days
  `;
  assert(
    initial.length === 2 && initial[0]?.lead_time_days === 0 &&
      initial[1]?.lead_time_days === 7 &&
      initial[0].occurs_on === initial[1].occurs_on &&
      Temporal.PlainDate.from(initial[1].deliver_on).until(
          Temporal.PlainDate.from(initial[0].deliver_on),
        ).days === 7,
    `important-date lead identities collapsed: ${JSON.stringify(initial)}`,
  );
  const reminderId = initial[0].reminder_id;
  const firstOccursOn = initial[0].occurs_on;
  const replenishAt = new Date(`${firstOccursOn}T23:59:59Z`);
  await Promise.all([
    deliveryRepository.replenish({ now: replenishAt }),
    deliveryRepository.replenish({ now: replenishAt }),
  ]);
  const rolling = await sql<{
    readonly count: number;
    readonly lead_time_days: number;
  }[]>`
    select lead_time_days, count(*)::int as count
    from crm.reminder_occurrences
    where reminder_id = ${reminderId}::uuid
      and member_id = ${fixture.memberId}::uuid
      and occurs_on > ${firstOccursOn}::date
    group by lead_time_days order by lead_time_days
  `;
  assert(
    rolling.length === 2 && rolling[0]?.lead_time_days === 0 &&
      rolling[1]?.lead_time_days === 7 &&
      rolling[0].count === rolling[1].count && rolling[0].count > 0,
    `rolling generation lost or duplicated a lead rule: ${
      JSON.stringify(rolling)
    }`,
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id in (${initial[0].id}::uuid, ${initial[1].id}::uuid)
  `;
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
  await worker.tick({ limit: 100, owner: "important-date-leads" });
  const [delivered] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.reminder_occurrences
    where id in (${initial[0].id}::uuid, ${initial[1].id}::uuid)
      and status = 'sent' and provider_effect_at is not null
  `;
  assert(
    delivered?.count === 2,
    "both important-date lead rules were not delivered once",
  );
});

Deno.test("PLANNING-002 PostgreSQL always notifies an important date on the day and follows current lead rules", async () => {
  const fixture = await register(
    `important-date-day-of-${crypto.randomUUID()}@example.test`,
    "Important-date day of",
  );
  const foreign = await register(
    `important-date-day-of-foreign-${crypto.randomUUID()}@example.test`,
    "Important-date day of foreign",
  );
  const personId = await createPerson(fixture, "Day-of person");
  const nearPersonId = await createPerson(fixture, "Near day-of person");
  const foreignPersonId = await createPerson(foreign, "Foreign day-of person");
  // Monica's default advance notice; it must add to the day itself.
  const [weekRule] = await sql<{ readonly id: string }[]>`
    insert into crm.reminder_rules (workspace_id, days_before)
    values (${fixture.workspaceId}::uuid, 7), (${foreign.workspaceId}::uuid, 7)
    returning id::text
  `;
  const createBirthday = async (
    caller: typeof fixture,
    subject: string,
    daysAhead: number,
  ) => {
    const event = new Date(Date.now() + daysAhead * 86_400_000);
    const created = await request(
      caller,
      `/api/v1/people/${subject}/dates`,
      "POST",
      {
        day: event.getUTCDate(),
        isAgeBased: false,
        isYearApproximate: false,
        kind: "birthday",
        month: event.getUTCMonth() + 1,
        precision: "month_day",
      },
    );
    assert(created.status === 201, "birthday with an advance rule created");
  };
  await createBirthday(fixture, personId, 60);
  await createBirthday(fixture, nearPersonId, 10);
  await createBirthday(foreign, foreignPersonId, 60);
  const pendingLeads = (subject = personId) =>
    sql<{ readonly lead_time_days: number; readonly occurs_on: string }[]>`
      select distinct occurrence.lead_time_days,
        occurrence.occurs_on::text as occurs_on
      from crm.reminder_occurrences occurrence
      join crm.reminders reminder on reminder.id = occurrence.reminder_id
      where reminder.person_id = ${subject}::uuid
        and occurrence.status = 'pending'
      order by occurs_on, occurrence.lead_time_days
    `;
  const initial = await pendingLeads();
  assert(
    JSON.stringify(initial.map((row) => row.lead_time_days)) === "[0,7]" &&
      initial[0]?.occurs_on === initial[1]?.occurs_on,
    `an advance rule replaced the day-of notification: ${
      JSON.stringify(initial)
    }`,
  );

  // A date scheduled before this rule existed holds only its advance notice;
  // changing the rules afterwards must reach it without re-saving the date.
  await sql`
    delete from crm.reminder_occurrences occurrence
    using crm.reminders reminder
    where reminder.id = occurrence.reminder_id
      and reminder.person_id = ${personId}::uuid
      and occurrence.lead_time_days = 0
  `;
  await sql`
    update crm.reminder_rules set is_active = false
    where workspace_id = ${fixture.workspaceId}::uuid
      and id = ${weekRule!.id}::uuid
  `;
  await sql`
    insert into crm.reminder_rules (workspace_id, days_before)
    values (${fixture.workspaceId}::uuid, 30)
  `;
  await deliveryRepository.replenish({ now: new Date() });
  const refreshed = await pendingLeads();
  const leads = [...new Set(refreshed.map((row) => row.lead_time_days))];
  assert(
    JSON.stringify(leads.sort((left, right) => left - right)) === "[0,30]" &&
      refreshed.some((row) =>
        row.occurs_on === initial[0]?.occurs_on && row.lead_time_days === 0
      ),
    `rolling delivery kept stale lead rules or missed the day itself: ${
      JSON.stringify(refreshed)
    }`,
  );
  // Ten days out, this year's thirty-day window has already passed.
  const near = await pendingLeads(nearPersonId);
  const nearFirst = near[0]?.occurs_on;
  assert(
    near.some((row) =>
      row.occurs_on === nearFirst && row.lead_time_days === 0
    ) &&
      !near.some((row) =>
        row.occurs_on === nearFirst && row.lead_time_days === 30
      ) &&
      near.some((row) =>
        row.occurs_on > nearFirst! && row.lead_time_days === 30
      ),
    `a passed lead window was announced late: ${JSON.stringify(near)}`,
  );
  const foreignLeads = await pendingLeads(foreignPersonId);
  assert(
    foreignLeads.some((row) => row.lead_time_days === 7) &&
      !foreignLeads.some((row) => row.lead_time_days === 30),
    `another workspace's lead rules changed its notices: ${
      JSON.stringify(foreignLeads)
    }`,
  );
});

Deno.test("[GAP-023] PostgreSQL pages a person's reminders behind a bound cursor", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-page-${suffix}@example.test`,
    "Reminder pages",
  );
  const foreign = await register(
    `reminder-page-foreign-${suffix}@example.test`,
    "Reminder pages foreign",
  );
  const personId = await createPerson(fixture, "Paged reminder person");
  const otherPersonId = await createPerson(fixture, "Other paged person");
  const foreignPersonId = await createPerson(foreign, "Foreign paged person");
  const created = [
    await createReminder(fixture, personId, "Paged one"),
    await createReminder(fixture, personId, "Paged two"),
    await createReminder(fixture, personId, "Paged three"),
  ];
  const disabled = created[0]!;
  assert(
    (await request(
      fixture,
      `/api/v1/reminders/${disabled.id}/active`,
      "PUT",
      { active: false },
    )).status === 200,
    "a paged reminder was disabled",
  );
  // Every definition shares one instant, so the page boundary is decided by
  // the active state first and then by the identifier.
  await sql`
    update crm.reminders set updated_at = '2026-08-18T10:00:00Z'
    where person_id = ${personId}::uuid
  `;
  const active = created.slice(1).map((reminder) => reminder.id).sort();
  interface Page {
    readonly reminders: readonly {
      readonly id: string;
      readonly isActive: boolean;
    }[];
    readonly nextCursor?: string;
  }
  const path = `/api/v1/people/${personId}/reminders`;
  const first = await request(fixture, `${path}?limit=2`);
  const firstBody = await first.json() as Page;
  assert(
    first.status === 200 &&
      JSON.stringify(firstBody.reminders.map((item) => item.id)) ===
        JSON.stringify(active) &&
      firstBody.nextCursor,
    "the first reminder page did not lead with the active reminders",
  );
  const cursor = encodeURIComponent(firstBody.nextCursor!);
  const second = await request(fixture, `${path}?limit=2&cursor=${cursor}`);
  const secondBody = await second.json() as Page;
  assert(
    second.status === 200 && secondBody.reminders.length === 1 &&
      secondBody.reminders[0]?.id === disabled.id &&
      secondBody.reminders[0].isActive === false && !secondBody.nextCursor,
    "the reminder continuation dropped, repeated, or reordered a reminder",
  );
  for (
    const [caller, subject, query] of [
      [fixture, otherPersonId, `cursor=${cursor}`],
      [foreign, foreignPersonId, `cursor=${cursor}`],
      [fixture, personId, "cursor=not-a-cursor"],
      [fixture, personId, "limit=51"],
    ] as const
  ) {
    const refused = await request(
      caller,
      `/api/v1/people/${subject}/reminders?${query}`,
    );
    const problem = await refused.json() as { readonly code?: string };
    assert(
      refused.status === 400 && problem.code === "reminder_query_invalid",
      `${query} against another reminder listing was answered: ${refused.status}`,
    );
  }
});

Deno.test({
  name: "PLANNING-001 PostgreSQL reminders resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await closeResources();
  },
});
