/**
 * Delivery claims across regeneration, disable, and reactivation (split from
 * `planning_postgres_test.ts`, GAP-035).
 *
 * Its final test closes the app and pools it loaded from
 * `planning.test-helper.ts`.
 */

import {
  createReminderDeliveryWorker,
  reminderDeliveryAuditFrom,
  type ReminderDeliveryProvider,
} from "../../packages/backend/modules/planning/public.ts";
import { InAppReminderDelivery } from "../../packages/backend/modules/planning/adapters/in_app/reminder_delivery.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/adapters/postgres/audit_event_recorder.ts";
import {
  PostgresInAppReminderEffectStore,
  PostgresReminderDeliveryRepository,
} from "../../packages/backend/modules/planning/adapters/postgres/reminder_repository.ts";
import { PostgresActorRevalidation } from "../../packages/backend/modules/workspaces/adapters/postgres/actor_revalidation.ts";
import { PostgresReminderDeliveryPreferences } from "../../packages/backend/modules/workspaces/adapters/postgres/reminder_delivery_preferences.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  describePlan,
  explainedPlan,
  planNodes,
  scansOf,
  withScratchCrm,
} from "../support/query_plan.ts";
import { requireWorkerDatabaseUrl } from "../support/database.ts";
import {
  configured,
  type CreatedReminder,
  createPerson,
  createReminder,
  deliveryConnection,
  deliveryRepository,
  deliveryTransaction,
  DurableFakeProvider,
  register,
  request,
  sql,
} from "./planning.test-helper.ts";

Deno.test("PLANNING-002 PostgreSQL regeneration cannot overwrite a concurrent claim", async () => {
  const suffix = crypto.randomUUID();
  const fixture = await register(
    `reminder-race-${suffix}@example.test`,
    "Race reminders",
  );
  const personId = await createPerson(fixture, "Race person");
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
    name: "Race reminders",
  });
  const waitForClaimBlock = async (
    signal: AbortSignal,
    claimBackendPid: number,
  ) => {
    for (let attempt = 0; attempt < 1_000; attempt += 1) {
      if (signal.aborted) return "cancelled" as const;
      const [row] = await sql<{ readonly waiting: boolean }[]>`
        select exists (
          select 1 from pg_stat_activity
          where pid <> pg_backend_pid() and state = 'active'
            and ${claimBackendPid}::int = any(pg_blocking_pids(pid))
        ) as waiting
      `;
      if (row?.waiting) return "lock" as const;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return "timeout" as const;
  };
  const race = async (
    occurrenceId: string,
    changeTimezone: () => Promise<Response>,
  ) => {
    await sql`
      update crm.reminder_occurrences set status = 'pending', attempt_count = 0,
        provider_result_state = 'unattempted', deliver_at = now() + interval '30 days',
        last_attempt_at = null, next_attempt_at = null, claim_token = null,
        claim_owner = null, lease_expires_at = null, error = null,
        updated_at = now()
      where id = ${occurrenceId}::uuid
    `;
    const [before] = await sql<{ readonly deliver_at: string }[]>`
      select deliver_at::text from crm.reminder_occurrences
      where id = ${occurrenceId}::uuid
    `;
    assert(before, "race occurrence missing");
    let locked!: () => void;
    const lockReady = new Promise<void>((resolve) => locked = resolve);
    let release!: () => void;
    const releaseLock = new Promise<void>((resolve) => release = resolve);
    let claimBackendPid = 0;
    const claim = sql.begin(async (transaction) => {
      const [backend] = await transaction<{ readonly pid: number }[]>`
        select pg_backend_pid()::int as pid
      `;
      assert(backend, "claim backend PID missing");
      claimBackendPid = backend.pid;
      await transaction`
        update crm.reminder_occurrences set status = 'claimed',
          attempt_count = 1, last_attempt_at = now(),
          claim_token = gen_random_uuid(), claim_owner = 'race-worker',
          lease_expires_at = now() + interval '1 minute', updated_at = now()
        where id = ${occurrenceId}::uuid
      `;
      locked();
      await releaseLock;
    });
    await lockReady;
    const changing = changeTimezone();
    const observationController = new AbortController();
    const first = await Promise.race([
      changing.then((response) => ({
        branch: "completed" as const,
        response,
      })),
      waitForClaimBlock(observationController.signal, claimBackendPid).then(
        (branch) => ({ branch }),
      ),
    ]);
    observationController.abort();
    try {
      if (first.branch === "timeout" || first.branch === "cancelled") {
        throw new Error(
          "regeneration stayed active without the exact claim backend blocker",
        );
      }
    } finally {
      release();
    }
    const [, response] = await Promise.all([
      claim,
      first.branch === "completed" ? Promise.resolve(first.response) : changing,
    ]);
    const [after] = await sql<{
      readonly attempt_count: number;
      readonly deliver_at: string;
      readonly status: string;
    }[]>`
      select attempt_count, deliver_at::text, status
      from crm.reminder_occurrences where id = ${occurrenceId}::uuid
    `;
    assert(
      response.status === 200 && after?.status === "claimed" &&
        after.attempt_count === 1 && after.deliver_at === before.deliver_at,
      `regeneration overwrote a concurrent claim: ${
        JSON.stringify({ after, before })
      }`,
    );
  };

  assert(
    (await request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload("Pacific/Kiritimati"),
    )).status === 200,
    "member race timezone prepared",
  );
  const memberReminder = await createReminder(fixture, personId, "Member race");
  await race(memberReminder.nextOccurrence!.id, () =>
    request(
      fixture,
      "/api/v1/settings/preferences",
      "PUT",
      preferencePayload("America/Adak"),
    ));

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
          workspacePayload("Pacific/Kiritimati"),
        )).status === 200,
    "workspace race timezone prepared",
  );
  const workspaceReminder = await createReminder(
    fixture,
    personId,
    "Workspace race",
  );
  await race(workspaceReminder.nextOccurrence!.id, () =>
    request(
      fixture,
      "/api/v1/settings/workspace",
      "PUT",
      workspacePayload("America/Adak"),
    ));
});

Deno.test("PLANNING-002 PostgreSQL reactivates future one-time and recurring reminders truthfully", async () => {
  const fixture = await register(
    `reminder-reactivation-${crypto.randomUUID()}@example.test`,
    "Reminder reactivation",
  );
  const personId = await createPerson(fixture, "Reactivation person");
  const futureAnchor = new Date(Date.now() + 2 * 86_400_000).toISOString()
    .slice(0, 10);
  const createDefinition = async (
    title: string,
    recurrenceUnit: "day" | "none",
    anchorOn = futureAnchor,
  ) => {
    const response = await request(fixture, "/api/v1/reminders", "POST", {
      anchorOn,
      personId,
      recurrenceInterval: 1,
      recurrenceUnit,
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title,
    });
    const body = await response.json() as CreatedReminder;
    assert(response.status === 201, `${title} creation failed`);
    return body.reminder;
  };
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: new DurableFakeProvider(),
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });

  for (
    const [title, recurrenceUnit] of [
      ["Reactivated one-time", "none"],
      ["Reactivated recurring", "day"],
    ] as const
  ) {
    const reminder = await createDefinition(title, recurrenceUnit);
    const originalOccurrence = reminder.nextOccurrence;
    assert(originalOccurrence, `${title} did not generate future work`);
    assert(
      (await request(
        fixture,
        `/api/v1/reminders/${reminder.id}/active`,
        "PUT",
        { active: false },
      )).status === 200,
      `${title} disable failed`,
    );
    const enabled = await request(
      fixture,
      `/api/v1/reminders/${reminder.id}/active`,
      "PUT",
      { active: true },
    );
    const enabledBody = await enabled.json() as {
      readonly reminder?: {
        readonly isActive: boolean;
        readonly nextOccurrence?: {
          readonly id: string;
          readonly status: string;
        };
      };
    };
    assert(
      enabled.status === 200 && enabledBody.reminder?.isActive === true &&
        enabledBody.reminder.nextOccurrence?.id === originalOccurrence.id &&
        enabledBody.reminder.nextOccurrence.status === "pending",
      `${title} public active:true response was not truthful: ${
        JSON.stringify(enabledBody)
      }`,
    );
    const [reactivated] = await sql<{
      readonly id: string;
      readonly status: string;
    }[]>`
      select id::text, status from crm.reminder_occurrences
      where reminder_id = ${reminder.id}::uuid
        and occurs_on = ${originalOccurrence.occursOn}::date
      order by id limit 1
    `;
    assert(
      reactivated?.id === originalOccurrence.id &&
        reactivated.status === "pending",
      `${title} did not reactivate its stable occurrence: ${
        JSON.stringify(reactivated)
      }`,
    );
    await sql`
      update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
      where id = ${originalOccurrence.id}::uuid
    `;
    const delivered = await worker.tick({
      owner: `reactivate-${recurrenceUnit}`,
    });
    const [final] = await sql<{ readonly status: string }[]>`
      select status from crm.reminder_occurrences
      where id = ${originalOccurrence.id}::uuid
    `;
    assert(
      delivered.results.some((result) =>
        result.id === originalOccurrence.id && result.status === "sent"
      ) && final?.status === "sent",
      `${title} active:true did not restore delivery`,
    );
  }

  const pastAnchor = new Date(Date.now() - 10 * 86_400_000).toISOString()
    .slice(0, 10);
  const past = await createDefinition("Past one-time", "none", pastAnchor);
  assert(!past.nextOccurrence, "past one-time reminder claimed ancient work");
  assert(
    (await request(
          fixture,
          `/api/v1/reminders/${past.id}/active`,
          "PUT",
          { active: false },
        )).status === 200 &&
      (await request(
          fixture,
          `/api/v1/reminders/${past.id}/active`,
          "PUT",
          { active: true },
        )).status === 200,
    "past one-time reminder state change failed",
  );
  const [pastCount] = await sql<{ readonly count: number }[]>`
    select count(*)::int as count from crm.reminder_occurrences
    where reminder_id = ${past.id}::uuid
  `;
  assert(
    pastCount?.count === 0,
    "reactivation silently scheduled an ancient one-time occurrence",
  );
});

Deno.test("PLANNING-002 PostgreSQL preserves an in-flight durable effect across disable", async () => {
  const fixture = await register(
    `reminder-disable-race-${crypto.randomUUID()}@example.test`,
    "Reminder disable race",
  );
  const personId = await createPerson(fixture, "Disable race person");
  const reminder = await createReminder(
    fixture,
    personId,
    "Disable after effect",
  );
  const occurrenceId = reminder.nextOccurrence!.id;
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${occurrenceId}::uuid
  `;
  const durable = new InAppReminderDelivery(
    new PostgresInAppReminderEffectStore(deliveryConnection.db, {
      now: () => new Date(),
    }),
  );
  let observedEffect!: () => void;
  const effectRecorded = new Promise<void>((resolve) => {
    observedEffect = resolve;
  });
  let resumeDelivery!: () => void;
  const deliveryReleased = new Promise<void>((resolve) => {
    resumeDelivery = resolve;
  });
  const barrierProvider: ReminderDeliveryProvider = {
    async deliver(command) {
      const result = await durable.deliver(command);
      observedEffect();
      await deliveryReleased;
      return result;
    },
    reconcile: (command) => durable.reconcile(command),
  };
  const worker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: barrierProvider,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const tick = worker.tick({ limit: 1, owner: "disable-effect-race" });
  await Promise.race([
    effectRecorded,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("provider effect barrier timed out")),
        5_000,
      )
    ),
  ]);
  const [beforeDisable] = await sql<{
    readonly claim_token: string | null;
    readonly provider_effect_at: string | null;
    readonly status: string;
  }[]>`
    select claim_token::text, provider_effect_at::text, status
    from crm.reminder_occurrences where id = ${occurrenceId}::uuid
  `;
  const disabled = await request(
    fixture,
    `/api/v1/reminders/${reminder.id}/active`,
    "PUT",
    { active: false },
  );
  resumeDelivery();
  const result = await tick;
  const [afterFinalize] = await sql<{
    readonly audits: number;
    readonly provider_effect_at: string | null;
    readonly status: string;
    readonly visible_at: string | null;
  }[]>`
    select occurrence.status, occurrence.provider_effect_at::text,
      occurrence.visible_at::text,
      (select count(*)::int from crm.audit_events audit
       where audit.subject_id = occurrence.id
         and audit.action = 'planning.reminder-delivered') as audits
    from crm.reminder_occurrences occurrence
    where occurrence.id = ${occurrenceId}::uuid
  `;
  const today = await request(fixture, "/api/v1/today/reminders");
  const todayBody = await today.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly status: string;
      readonly visibleAt?: string;
    }[];
  };
  assert(
    beforeDisable?.status === "claimed" && beforeDisable.claim_token !== null &&
      beforeDisable.provider_effect_at !== null,
    `durable effect was not observed in-flight: ${
      JSON.stringify(beforeDisable)
    }`,
  );
  assert(
    disabled.status === 200 && result.results[0]?.status === "sent" &&
      afterFinalize?.status === "sent" &&
      afterFinalize.provider_effect_at !== null &&
      afterFinalize.visible_at !== null && afterFinalize.audits === 1,
    `disable invalidated durable effect finalization: ${
      JSON.stringify({ afterFinalize, result })
    }`,
  );
  assert(
    today.status === 200 &&
      todayBody.reminders.some((item) =>
        item.id === occurrenceId && item.status === "sent" && item.visibleAt
      ),
    "disabled definition hid its single confirmed in-app effect",
  );
});

Deno.test("PLANNING-002 PostgreSQL recovers an expired confirmed claim after disable", async () => {
  const fixture = await register(
    `reminder-disabled-recovery-${crypto.randomUUID()}@example.test`,
    "Disabled reminder recovery",
  );
  const personId = await createPerson(fixture, "Disabled recovery person");
  const anchorOn = new Date(Date.now() + 86_400_000).toISOString().slice(
    0,
    10,
  );
  const created = await request(fixture, "/api/v1/reminders", "POST", {
    anchorOn,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "day",
    requestId: crypto.randomUUID(),
    sendTime: "09:00",
    title: "Recover after disable",
  });
  const createdBody = await created.json() as CreatedReminder;
  const reminder = createdBody.reminder;
  const occurrenceId = reminder.nextOccurrence?.id;
  assert(
    created.status === 201 && occurrenceId,
    "recurring recovery reminder missing",
  );
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${occurrenceId}::uuid
  `;
  const [claim] = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 1,
    now: new Date(),
    owner: "dies-before-finalize",
  });
  assert(claim?.id === occurrenceId, "recovery occurrence was not claimed");
  const durable = new InAppReminderDelivery(
    new PostgresInAppReminderEffectStore(deliveryConnection.db, {
      now: () => new Date(),
    }),
  );
  const delivered = await durable.deliver({
    idempotencyKey: claim.providerIdempotencyKey,
    occurrenceId: claim.id,
  });
  assert(delivered.status === "confirmed", "durable effect was not recorded");
  assert(
    (await request(
      fixture,
      `/api/v1/reminders/${reminder.id}/active`,
      "PUT",
      { active: false },
    )).status === 200,
    "claimed reminder disable failed",
  );
  await sql`
    update crm.reminder_occurrences set lease_expires_at = now() - interval '1 second'
    where id = ${occurrenceId}::uuid
  `;
  const recoveryWorker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: durable,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const recovered = await recoveryWorker.tick({
    limit: 20,
    owner: "disabled-reconciliation",
  });
  const [proof] = await sql<{
    readonly audits: number;
    readonly effects: number;
    readonly inactive_new_work: number;
    readonly sent: number;
  }[]>`
    select
      count(*) filter (where occurrence.status = 'sent')::int as sent,
      count(*) filter (where occurrence.provider_effect_at is not null)::int as effects,
      count(*) filter (where occurrence.status in ('pending','retry','claimed'))::int as inactive_new_work,
      (select count(*)::int from crm.audit_events audit
       where audit.subject_id = ${occurrenceId}::uuid
         and audit.action = 'planning.reminder-delivered') as audits
    from crm.reminder_occurrences occurrence
    where occurrence.reminder_id = ${reminder.id}::uuid
  `;
  const today = await request(fixture, "/api/v1/today/reminders");
  const todayBody = await today.json() as {
    readonly reminders: readonly {
      readonly id: string;
      readonly status: string;
      readonly visibleAt?: string;
    }[];
  };
  assert(
    recovered.claimed === 1 && recovered.results[0]?.id === occurrenceId &&
      recovered.results[0].status === "sent" && proof?.sent === 1 &&
      proof.effects === 1 && proof.audits === 1 &&
      proof.inactive_new_work === 0,
    `disabled confirmed claim did not reconcile exactly once: ${
      JSON.stringify({ proof, recovered })
    }`,
  );
  assert(
    today.status === 200 &&
      todayBody.reminders.some((item) =>
        item.id === occurrenceId && item.status === "sent" && item.visibleAt
      ),
    "recovered disabled effect was not visible on Today",
  );
});

Deno.test("PLANNING-002 PostgreSQL cancels an expired unattempted claim after disable", async () => {
  const fixture = await register(
    `reminder-disabled-unattempted-${crypto.randomUUID()}@example.test`,
    "Disabled unattempted reminder",
  );
  const personId = await createPerson(fixture, "Disabled unattempted person");
  const reminder = await createReminder(
    fixture,
    personId,
    "Cancel expired unattempted claim",
  );
  const occurrenceId = reminder.nextOccurrence!.id;
  await sql`
    update crm.reminder_occurrences set deliver_at = now() - interval '1 minute'
    where id = ${occurrenceId}::uuid
  `;
  const [claim] = await deliveryRepository.claimDue({
    leaseExpiresAt: new Date(Date.now() + 30_000),
    limit: 1,
    now: new Date(),
    owner: "dies-before-provider-effect",
  });
  assert(claim?.id === occurrenceId, "unattempted occurrence was not claimed");
  assert(
    (await request(
      fixture,
      `/api/v1/reminders/${reminder.id}/active`,
      "PUT",
      { active: false },
    )).status === 200,
    "unattempted claimed reminder disable failed",
  );
  await sql`
    update crm.reminder_occurrences set lease_expires_at = now() - interval '1 second'
    where id = ${occurrenceId}::uuid
  `;

  const durable = new InAppReminderDelivery(
    new PostgresInAppReminderEffectStore(deliveryConnection.db, {
      now: () => new Date(),
    }),
  );
  let releaseStaleEffect!: () => void;
  const staleEffectReleased = new Promise<void>((resolve) => {
    releaseStaleEffect = resolve;
  });
  let observeStaleProcess!: () => void;
  const staleProcessObserved = new Promise<void>((resolve) => {
    observeStaleProcess = resolve;
  });
  const staleEffect = (async () => {
    observeStaleProcess();
    await staleEffectReleased;
    return await durable.deliver({
      idempotencyKey: claim.providerIdempotencyKey,
      occurrenceId: claim.id,
    });
  })();
  await staleProcessObserved;

  const maintenanceWorker = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock: { now: () => new Date() },
    provider: durable,
    repository: deliveryRepository,
    transaction: deliveryTransaction,
  });
  const maintained = await maintenanceWorker.tick({
    limit: 20,
    owner: "disabled-unattempted-maintenance",
  });
  releaseStaleEffect();
  const staleEffectResult = await staleEffect;
  const staleFinalize = await deliveryTransaction.run(async (transaction) =>
    await deliveryRepository.finalize({
      claimToken: claim.claimToken,
      error: "stale-process-finalize",
      id: claim.id,
      now: new Date(),
      providerResultState: "rejected",
      status: "failed",
      transaction,
    })
  );
  const [proof] = await sql<{
    readonly audits: number;
    readonly claim_owner: string | null;
    readonly claim_token: string | null;
    readonly effects: number;
    readonly lease_expires_at: string | null;
    readonly status: string;
  }[]>`
    select occurrence.status, occurrence.claim_token::text,
      occurrence.claim_owner, occurrence.lease_expires_at::text,
      (occurrence.provider_effect_at is not null)::int as effects,
      (select count(*)::int from crm.audit_events audit
       where audit.subject_id = occurrence.id
         and audit.action = 'planning.reminder-delivered') as audits
    from crm.reminder_occurrences occurrence
    where occurrence.id = ${occurrenceId}::uuid
  `;
  assert(
    maintained.claimed === 0 && proof?.status === "cancelled" &&
      proof.claim_token === null && proof.claim_owner === null &&
      proof.lease_expires_at === null && proof.effects === 0 &&
      proof.audits === 0,
    `expired unattempted disabled claim was not cleaned safely: ${
      JSON.stringify({ maintained, proof })
    }`,
  );
  assert(
    staleEffectResult.status === "rejected" && staleFinalize === false,
    `stale process retained effect/finalize authority: ${
      JSON.stringify({ staleEffectResult, staleFinalize })
    }`,
  );
});

/** Creates `count` weekly reminders for `personId` through the API. */
async function addWeeklyReminders(
  fixture: Awaited<ReturnType<typeof register>>,
  personId: string,
  count: number,
): Promise<void> {
  for (let index = 0; index < count; index += 1) {
    const created = await request(fixture, "/api/v1/reminders", "POST", {
      anchorOn: new Date(Date.now() + 86_400_000).toISOString().slice(0, 10),
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "week",
      requestId: crypto.randomUUID(),
      sendTime: "09:00",
      title: `Weekly ${index}`,
    });
    assert(
      created.status === 201,
      `weekly reminder created: ${created.status}`,
    );
  }
}

Deno.test("[AUD-W1] a tick over topped-up recurring reminders costs the same whatever their number", async () => {
  const fixture = await register(
    `steady-tick-${crypto.randomUUID()}@example.test`,
    "Steady tick",
  );
  const personId = await createPerson(fixture, "Steady person");
  let statements = 0;
  const counted = deliveryConnection.db.withPlugin({
    transformQuery: (args) => {
      statements += 1;
      return args.node;
    },
    transformResult: (args) => Promise.resolve(args.result),
  });
  const repository = new PostgresReminderDeliveryRepository(
    counted,
    new PostgresActorRevalidation(),
    new PostgresReminderDeliveryPreferences(),
  );
  const now = new Date();
  // A fresh worker replenishes on its first tick, so this counts the
  // replenishment as well as the claim.
  const steadyTick = async () => {
    const worker = () =>
      createReminderDeliveryWorker({
        audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
        clock: { now: () => now },
        provider: new DurableFakeProvider(),
        repository,
        transaction: deliveryTransaction,
      });
    await worker().tick({ owner: "steady-warm" });
    statements = 0;
    await worker().tick({ owner: "steady-count" });
    return statements;
  };

  await addWeeklyReminders(fixture, personId, 2);
  const few = await steadyTick();
  await addWeeklyReminders(fixture, personId, 10);
  const many = await steadyTick();
  assertEquals(
    many,
    few,
    "ten more topped-up reminders changed how many statements a tick sends",
  );
});

Deno.test("[AUD-W1] a preference write is not held behind an open replenishment", async () => {
  const fixture = await register(
    `open-replenish-${crypto.randomUUID()}@example.test`,
    "Open replenish",
  );
  const personId = await createPerson(fixture, "Open replenish person");
  await addWeeklyReminders(fixture, personId, 1);
  // The replenishment is held open while it asks `workspaces` who may still
  // be delivered to.
  let asked!: () => void;
  const askedReady = new Promise<void>((resolve) => asked = resolve);
  let release!: () => void;
  const released = new Promise<void>((resolve) => release = resolve);
  const recipients = new PostgresActorRevalidation();
  const held = new PostgresReminderDeliveryRepository(
    deliveryConnection.db,
    {
      filterEligible: async (command) => {
        asked();
        await released;
        return await recipients.filterEligible(command);
      },
      listEligible: (command) => recipients.listEligible(command),
    },
    new PostgresReminderDeliveryPreferences(),
  );
  const replenishing = held.replenish({ now: new Date() });
  try {
    await askedReady;
    const started = performance.now();
    const written = await Promise.race([
      sql`
        update crm.member_preferences set updated_at = now()
        where member_id = ${fixture.memberId}::uuid
      `.then(() => performance.now() - started),
      new Promise<undefined>((resolve) =>
        setTimeout(() => resolve(undefined), 1_000)
      ),
    ]);
    assert(
      written !== undefined && written < 1_000,
      "a member_preferences update waited behind an open replenishment",
    );
  } finally {
    release();
    await replenishing;
  }
});

/**
 * A deployment-sized queue in a scratch database: many people with a window
 * of pending occurrences ahead, a few due, a few claims whose lease ran out,
 * and an archived person whose due occurrences sort before all of them.
 */
async function seedClaimQueue(
  scratch: typeof sql,
  now: Date,
): Promise<{
  readonly archivedDue: number;
  readonly due: number;
  readonly expired: number;
}> {
  const [userId, workspaceId, memberId] = [
    crypto.randomUUID(),
    crypto.randomUUID(),
    crypto.randomUUID(),
  ];
  const at = now.toISOString();
  await scratch`
    insert into crm.users (id, email, status)
    values (${userId}, 'claim-plan@example.test', 'active')
  `;
  await scratch`
    insert into crm.workspaces (id, name, created_by_user_id)
    values (${workspaceId}, 'Claim plan', ${userId})
  `;
  await scratch`
    insert into crm.workspace_members (id, workspace_id, user_id, role, status, joined_at)
    values (${memberId}, ${workspaceId}, ${userId}, 'owner', 'active', now())
  `;
  await scratch`
    insert into crm.people (workspace_id, given_name, archived_at)
    select ${workspaceId}::uuid, 'Person ' || n,
      case when n = 0 then ${at}::timestamptz end
    from generate_series(0, 400) n
  `;
  await scratch`
    insert into crm.reminders (workspace_id, person_id, target_kind, title,
      anchor_on, recurrence_unit, created_by_member_id)
    select ${workspaceId}::uuid, person.id, 'person',
      'Call ' || person.given_name, ${at}::date, 'day', ${memberId}::uuid
    from crm.people person
    cross join generate_series(1, 5)
  `;
  // Twenty dates ahead for every reminder: the queue's long, not-yet-due tail.
  await scratch`
    insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
      deliver_at, channel, title_snapshot, workspace_id)
    select reminder.id, ${memberId}::uuid, ${at}::date + day,
      ${at}::timestamptz + make_interval(days => day), 'in_app', reminder.title,
        (select scope.workspace_id from crm.reminders scope where scope.id = reminder.id)
    from crm.reminders reminder cross join generate_series(1, 20) day
  `;
  const due = 15;
  const expired = 3;
  const active = await scratch<{ readonly id: string }[]>`
    select reminder.id::text from crm.reminders reminder
    join crm.people person on person.id = reminder.person_id
    where person.archived_at is null
    order by reminder.id limit ${due + expired}
  `;
  for (const [index, reminder] of active.entries()) {
    const claimed = index >= due;
    await scratch`
      insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
        deliver_at, channel, title_snapshot, status, claim_token, claim_owner,
        lease_expires_at, attempt_count, workspace_id)
      values (${reminder.id}::uuid, ${memberId}::uuid, ${at}::date - 1,
        ${at}::timestamptz - make_interval(mins => ${60 - index}), 'in_app',
        'Due', ${claimed ? "claimed" : "pending"},
        ${claimed ? crypto.randomUUID() : null}::uuid,
        ${claimed ? "crashed-worker" : null},
        ${claimed ? at : null}::timestamptz - interval '1 minute',
        ${
      claimed ? 1 : 0
    }, (select scope.workspace_id from crm.reminders scope where scope.id = ${reminder.id}::uuid))
    `;
  }
  // The archived person's past dates are due before anything else and must
  // never be claimed, nor keep the rest of the queue waiting behind them.
  const [archived] = await scratch<{ readonly count: number }[]>`
    with inserted as (
      insert into crm.reminder_occurrences (reminder_id, member_id, occurs_on,
        deliver_at, channel, title_snapshot, workspace_id)
      select reminder.id, ${memberId}::uuid, ${at}::date - 100 + day,
        ${at}::timestamptz - make_interval(days => 100 - day), 'in_app',
        'Archived',
        (select scope.workspace_id from crm.reminders scope where scope.id = reminder.id)
      from crm.reminders reminder
      join crm.people person on person.id = reminder.person_id
      cross join generate_series(1, 8) day
      where person.archived_at is not null
      returning 1
    )
    select count(*)::int as count from inserted
  `;
  await scratch`analyze`;
  return { archivedDue: archived!.count, due, expired };
}

function scratchDeliveryRepository(
  database: ReturnType<typeof connectDatabase>["db"],
): PostgresReminderDeliveryRepository {
  return new PostgresReminderDeliveryRepository(
    database,
    new PostgresActorRevalidation(),
    new PostgresReminderDeliveryPreferences(),
  );
}

Deno.test("[AUD-W2] the claim reads due work through the due and lease indexes", async () => {
  await withScratchCrm(
    sql,
    requireWorkerDatabaseUrl(),
    async ({ sql: scratch, url }) => {
      const now = new Date();
      await seedClaimQueue(scratch, now);
      const explaining = connectDatabase(url);
      try {
        const plan = await explainedPlan(
          explaining.db,
          (text) => text.includes("update crm.reminder_occurrences"),
          (database) =>
            scratchDeliveryRepository(database).claimDue({
              channels: ["in_app"],
              leaseExpiresAt: new Date(now.getTime() + 60_000),
              limit: 10,
              now,
              owner: "plan-owner",
            }),
        );
        const scans = scansOf(plan, "reminder_occurrences");
        // A bitmap index scan names its index but not its table.
        const indexes = new Set(
          planNodes(plan).map((node) => node["Index Name"]),
        );
        assert(
          indexes.has("reminder_occurrences_due_idx"),
          `the claim does not read the due index: ${describePlan(plan)}`,
        );
        assert(
          indexes.has("reminder_occurrences_lease_idx"),
          `the claim does not read the lease index: ${describePlan(plan)}`,
        );
        assert(
          !scans.some((node) => node["Node Type"] === "Seq Scan"),
          `the claim scans every occurrence: ${describePlan(plan)}`,
        );
        // The members asked about first (BEQ-08) are read the same way.
        const candidates = await explainedPlan(
          explaining.db,
          (text) =>
            text.includes("select occurrence.member_id::text as member_id") &&
            text.includes("union"),
          (database) =>
            scratchDeliveryRepository(database).claimDue({
              channels: ["in_app"],
              leaseExpiresAt: new Date(now.getTime() + 60_000),
              limit: 10,
              now,
              owner: "plan-owner",
            }),
        );
        const candidateIndexes = new Set(
          planNodes(candidates).map((node) => node["Index Name"]),
        );
        assert(
          candidateIndexes.has("reminder_occurrences_due_idx"),
          `the candidate members do not read the due index: ${
            describePlan(candidates)
          }`,
        );
        assert(
          candidateIndexes.has("reminder_occurrences_lease_idx"),
          `the candidate members do not read the lease index: ${
            describePlan(candidates)
          }`,
        );
        assert(
          !scansOf(candidates, "reminder_occurrences").some((node) =>
            node["Node Type"] === "Seq Scan"
          ),
          `the candidate members scan every occurrence: ${
            describePlan(candidates)
          }`,
        );
      } finally {
        await explaining.destroy();
      }
    },
  );
});

Deno.test("[AUD-W2] concurrent claims take every eligible due row once and skip the archived", async () => {
  await withScratchCrm(
    sql,
    requireWorkerDatabaseUrl(),
    async ({ sql: scratch, url }) => {
      const now = new Date();
      const { archivedDue, due, expired } = await seedClaimQueue(scratch, now);
      const claiming = connectDatabase(url);
      try {
        const repository = scratchDeliveryRepository(claiming.db);
        const claim = (owner: string) =>
          repository.claimDue({
            channels: ["in_app"],
            leaseExpiresAt: new Date(now.getTime() + 60_000),
            limit: 10,
            now,
            owner,
          });
        const concurrent = await Promise.all([claim("first"), claim("second")]);
        const rest = await claim("third");
        const ids = [...concurrent.flat(), ...rest].map((row) => row.id);
        assertEquals(
          new Set(ids).size,
          ids.length,
          "an occurrence was claimed twice",
        );
        assertEquals(ids.length, due + expired, "an eligible due row was lost");
        assert(
          concurrent.every((batch) => batch.length <= 10),
          "a claim took more than its limit",
        );
        const [archived] = await scratch<
          { readonly claimed: number; readonly pending: number }[]
        >`
        select count(*) filter (where status = 'pending'
            and attempt_count = 0)::int as pending,
          count(*) filter (where status = 'claimed')::int as claimed
        from crm.reminder_occurrences
        where title_snapshot = 'Archived'
      `;
        assertEquals(
          { claimed: archived?.claimed, pending: archived?.pending },
          { claimed: 0, pending: archivedDue },
          "an archived person's due occurrence was claimed",
        );
      } finally {
        await claiming.destroy();
      }
    },
  );
});

Deno.test({
  name: "PLANNING-001 PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await sql.end();
    await configured.close();
    await deliveryConnection.destroy();
  },
});
