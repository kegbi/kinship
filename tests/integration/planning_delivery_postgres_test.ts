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
