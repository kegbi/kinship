import * as planning from "./public.ts";

Deno.test("PLANNING-002 exposes calendar reminder management", () => {
  const publicPlanning = planning as unknown as Record<string, unknown>;
  if (typeof publicPlanning.createReminderManagement !== "function") {
    throw new Error("calendar reminder management is not public");
  }
});

Deno.test("PLANNING-002 calendar recurrence is deterministic across DST gaps, folds, and month edges", () => {
  const gap = planning.generateCalendarOccurrences({
    anchorOn: "2026-03-29",
    count: 1,
    from: "2026-03-01T00:00:00Z",
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    sendTime: "02:30:00",
    timezone: "Europe/Belgrade",
  });
  const fold = planning.generateCalendarOccurrences({
    anchorOn: "2026-10-25",
    count: 1,
    from: "2026-10-01T00:00:00Z",
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    sendTime: "02:30:00",
    timezone: "Europe/Belgrade",
  });
  const monthly = planning.generateCalendarOccurrences({
    anchorOn: "2026-01-31",
    count: 3,
    from: "2026-01-01T00:00:00Z",
    recurrenceInterval: 1,
    recurrenceUnit: "month",
    sendTime: "00:00:00",
    timezone: "UTC",
  });
  if (
    gap[0]?.deliverAt !== "2026-03-29T01:30:00Z" ||
    fold[0]?.deliverAt !== "2026-10-25T00:30:00Z" ||
    monthly.map((item) => item.occursOn).join(",") !==
      "2026-01-31,2026-02-28,2026-03-31"
  ) {
    throw new Error(JSON.stringify({ fold, gap, monthly }));
  }
});

Deno.test("PLANNING-002 recurrence jumps to old daily, monthly, and yearly anchors", () => {
  const cases = [
    planning.generateCalendarOccurrences({
      anchorOn: "2000-01-01",
      count: 2,
      from: "2026-08-18T00:00:00Z",
      recurrenceInterval: 1,
      recurrenceUnit: "day",
      sendTime: "09:00:00",
      timezone: "UTC",
    }),
    planning.generateCalendarOccurrences({
      anchorOn: "1600-01-31",
      count: 2,
      from: "2026-08-18T00:00:00Z",
      recurrenceInterval: 1,
      recurrenceUnit: "month",
      sendTime: "09:00:00",
      timezone: "UTC",
    }),
    planning.generateCalendarOccurrences({
      anchorOn: "1600-02-29",
      count: 2,
      from: "2026-08-18T00:00:00Z",
      recurrenceInterval: 1,
      recurrenceUnit: "year",
      sendTime: "09:00:00",
      timezone: "UTC",
    }),
  ];
  if (
    cases.some((items) => items.length !== 2) ||
    cases[0]?.[0]?.occursOn !== "2026-08-18" ||
    cases[1]?.[0]?.occursOn !== "2026-08-31" ||
    cases[2]?.[0]?.occursOn !== "2027-02-28"
  ) {
    throw new Error(JSON.stringify(cases));
  }
});

Deno.test("PLANNING-002 exposes duplicate-safe reminder delivery", () => {
  const publicPlanning = planning as unknown as Record<string, unknown>;
  if (typeof publicPlanning.createReminderDeliveryWorker !== "function") {
    throw new Error("duplicate-safe reminder delivery is not public");
  }
});

Deno.test("PLANNING-002 worker replenishes a bounded rolling occurrence window before claiming", async () => {
  let replenishments = 0;
  const repository = {
    claimDue: () => Promise.resolve([]),
    finalize: () => Promise.resolve(true),
    replenish: () => {
      replenishments += 1;
      return Promise.resolve();
    },
  } as unknown as planning.ReminderDeliveryRepository;
  const worker = planning.createReminderDeliveryWorker({
    audit: { record: () => Promise.resolve() },
    clock: { now: () => new Date("2026-10-20T00:30:00Z") },
    provider: {
      deliver: () =>
        Promise.resolve({ receipt: "unused", status: "confirmed" }),
      reconcile: () =>
        Promise.resolve({ receipt: "unused", status: "confirmed" }),
    },
    repository,
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });
  await worker.tick({ owner: "rolling-window" });
  if (replenishments !== 1) {
    throw new Error(
      `expected one rolling replenishment, got ${replenishments}`,
    );
  }
});

Deno.test("PLANNING-002 in-app provider delegates delivery and reconciliation to durable effect storage", async () => {
  const calls: string[] = [];
  const provider = new planning.InAppReminderDelivery({
    record: (command) => {
      calls.push(`record:${command.occurrenceId}:${command.idempotencyKey}`);
      return Promise.resolve({
        receipt: "durable-receipt",
        status: "confirmed",
      });
    },
    reconcile: (command) => {
      calls.push(`reconcile:${command.occurrenceId}:${command.idempotencyKey}`);
      return Promise.resolve({
        receipt: "durable-receipt",
        status: "confirmed",
      });
    },
  });
  const command = {
    body: "Call Ada",
    idempotencyKey: "stable-key",
    occurrenceId: crypto.randomUUID(),
    recipientMemberId: crypto.randomUUID(),
    title: "Reminder",
  };
  const delivered = await provider.deliver(command);
  const reconciled = await provider.reconcile(command);
  if (
    delivered.status !== "confirmed" || reconciled.status !== "confirmed" ||
    calls.join(",") !==
      `record:${command.occurrenceId}:stable-key,reconcile:${command.occurrenceId}:stable-key`
  ) {
    throw new Error(JSON.stringify({ calls, delivered, reconciled }));
  }
});

Deno.test("PLANNING-002 reconciles an external effect before commit without duplicating it", async () => {
  const occurrence = {
    attemptCount: 1,
    body: "Call Ada",
    claimToken: crypto.randomUUID(),
    id: crypto.randomUUID(),
    memberId: crypto.randomUUID(),
    providerIdempotencyKey: "stable-key",
    providerResultState: "unattempted" as const,
    title: "Reminder",
    workspaceId: crypto.randomUUID(),
  };
  let activeOccurrence: planning.ClaimedReminderOccurrence = occurrence;
  const effects = new Map<string, string>();
  const finalizations: Array<Record<string, unknown>> = [];
  let first = true;
  let now = new Date("2026-08-18T10:00:00Z");
  const worker = planning.createReminderDeliveryWorker({
    audit: { record: () => Promise.resolve() },
    clock: { now: () => now },
    provider: {
      deliver: ({ idempotencyKey, occurrenceId }) => {
        effects.set(idempotencyKey, `receipt:${occurrenceId}`);
        if (first) {
          first = false;
          return Promise.reject(new Error("timeout after external effect"));
        }
        return Promise.resolve({
          receipt: effects.get(idempotencyKey)!,
          status: "confirmed" as const,
        });
      },
      reconcile: ({ idempotencyKey }) =>
        Promise.resolve({
          receipt: effects.get(idempotencyKey)!,
          status: "confirmed" as const,
        }),
    },
    repository: {
      replenish: () => Promise.resolve(),
      claimDue: () => Promise.resolve([activeOccurrence]),
      finalize: (command) => {
        finalizations.push(command as unknown as Record<string, unknown>);
        return Promise.resolve(true);
      },
    },
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });
  const firstTick = await worker.tick({ owner: "worker-a" });
  activeOccurrence = {
    ...occurrence,
    attemptCount: 2,
    providerResultState: "ambiguous",
  };
  now = new Date("2026-08-18T10:01:00Z");
  const secondTick = await worker.tick({ owner: "worker-b" });
  if (
    effects.size !== 1 || firstTick.results[0]?.status !== "retry" ||
    secondTick.results[0]?.status !== "sent" ||
    finalizations[1]?.receipt !== `receipt:${occurrence.id}`
  ) {
    throw new Error(
      JSON.stringify({
        effects: [...effects],
        finalizations,
        firstTick,
        secondTick,
      }),
    );
  }
});

Deno.test("PLANNING-002 delivery exhausts bounded failures and ignores stale claims", async () => {
  const base = {
    body: "body",
    memberId: crypto.randomUUID(),
    providerResultState: "unattempted" as const,
    title: "title",
    workspaceId: crypto.randomUUID(),
  };
  const claims: planning.ClaimedReminderOccurrence[] = [
    {
      ...base,
      attemptCount: 1,
      claimToken: crypto.randomUUID(),
      id: "confirmed",
      providerIdempotencyKey: "confirmed",
    },
    {
      ...base,
      attemptCount: 1,
      claimToken: crypto.randomUUID(),
      id: "rejected",
      providerIdempotencyKey: "rejected",
    },
    {
      ...base,
      attemptCount: 4,
      claimToken: crypto.randomUUID(),
      id: "exhausted",
      providerIdempotencyKey: "exhausted",
    },
    {
      ...base,
      attemptCount: 4,
      claimToken: crypto.randomUUID(),
      id: "ambiguous",
      providerIdempotencyKey: "ambiguous",
    },
    {
      ...base,
      attemptCount: 1,
      claimToken: crypto.randomUUID(),
      id: "retry",
      providerIdempotencyKey: "retry",
    },
    {
      ...base,
      attemptCount: 1,
      claimToken: crypto.randomUUID(),
      id: "stale",
      providerIdempotencyKey: "stale",
    },
  ];
  const finalized: Array<{ readonly id: string; readonly status: string }> = [];
  const audited: string[] = [];
  const worker = planning.createReminderDeliveryWorker({
    audit: {
      record(command) {
        audited.push(`${command.action}:${command.occurrence.id}`);
        return Promise.resolve();
      },
    },
    clock: { now: () => new Date("2026-08-18T10:00:00Z") },
    provider: {
      deliver({ occurrenceId }) {
        return Promise.resolve(
          occurrenceId === "confirmed" || occurrenceId === "stale"
            ? {
              receipt: `receipt:${occurrenceId}`,
              status: "confirmed" as const,
            }
            : occurrenceId === "rejected"
            ? { code: "permanent failure!", status: "rejected" as const }
            : occurrenceId === "ambiguous"
            ? { code: "unknown", status: "ambiguous" as const }
            : { code: "temporary", status: "transient" as const },
        );
      },
      reconcile: () =>
        Promise.resolve({ code: "unused", status: "transient" as const }),
    },
    repository: {
      replenish: () => Promise.resolve(),
      claimDue: () => Promise.resolve(claims),
      finalize(command) {
        finalized.push({ id: command.id, status: command.status });
        return Promise.resolve(command.id !== "stale");
      },
    },
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });
  const result = await worker.tick({
    leaseMilliseconds: 999_999,
    limit: 999,
    maxAttempts: 4,
    owner: "x".repeat(200),
    retryBaseMilliseconds: 999_999_999,
  });
  const states = Object.fromEntries(
    result.results.map((item) => [item.id, item.status]),
  );
  if (
    states.confirmed !== "sent" || states.rejected !== "failed" ||
    states.exhausted !== "failed" || states.ambiguous !== "manual_attention" ||
    states.retry !== "retry" || states.stale !== "stale-claim" ||
    audited.length !== 4 ||
    finalized.find((item) => item.id === "retry")?.status !== "retry"
  ) {
    throw new Error(JSON.stringify({ audited, finalized, states }));
  }
});

Deno.test("PLANNING-002 ambiguous reconciliation never redelivers and exhausts to manual attention", async () => {
  const finalized: Array<Record<string, unknown>> = [];
  let delivered = 0;
  const worker = planning.createReminderDeliveryWorker({
    audit: { record: () => Promise.resolve() },
    clock: { now: () => new Date("2026-08-18T10:00:00Z") },
    provider: {
      deliver: () => {
        delivered += 1;
        return Promise.resolve({ receipt: "unexpected", status: "confirmed" });
      },
      reconcile: () =>
        Promise.resolve({ code: "still-unknown", status: "transient" }),
    },
    repository: {
      replenish: () => Promise.resolve(),
      claimDue: () =>
        Promise.resolve([{
          attemptCount: 4,
          body: "Call Ada",
          claimToken: crypto.randomUUID(),
          id: crypto.randomUUID(),
          memberId: crypto.randomUUID(),
          providerIdempotencyKey: "stable-key",
          providerResultState: "ambiguous" as const,
          title: "Reminder",
          workspaceId: crypto.randomUUID(),
        }]),
      finalize: (command) => {
        finalized.push(command as unknown as Record<string, unknown>);
        return Promise.resolve(true);
      },
    },
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });
  const result = await worker.tick({ maxAttempts: 4, owner: "worker-a" });
  if (
    delivered !== 0 || result.results[0]?.status !== "manual_attention" ||
    finalized[0]?.providerResultState !== "ambiguous"
  ) {
    throw new Error(JSON.stringify({ delivered, finalized, result }));
  }
});

Deno.test("APP-006D worker isolates a failed claimed item from the rest of its batch", async () => {
  const base = {
    attemptCount: 1,
    body: "body",
    memberId: crypto.randomUUID(),
    providerResultState: "unattempted" as const,
    title: "title",
    workspaceId: crypto.randomUUID(),
  };
  const claims: planning.ClaimedReminderOccurrence[] = [
    {
      ...base,
      claimToken: crypto.randomUUID(),
      id: "failed-finalization",
      providerIdempotencyKey: "failed-finalization",
    },
    {
      ...base,
      claimToken: crypto.randomUUID(),
      id: "independent-item",
      providerIdempotencyKey: "independent-item",
    },
  ];
  const finalized: string[] = [];
  const worker = planning.createReminderDeliveryWorker({
    audit: { record: () => Promise.resolve() },
    clock: { now: () => new Date("2026-08-23T10:00:00Z") },
    provider: {
      deliver: ({ occurrenceId }) =>
        Promise.resolve({
          receipt: `receipt:${occurrenceId}`,
          status: "confirmed" as const,
        }),
      reconcile: () =>
        Promise.resolve({ code: "unused", status: "transient" as const }),
    },
    repository: {
      replenish: () => Promise.resolve(),
      claimDue: () => Promise.resolve(claims),
      finalize: ({ id }) => {
        if (id === "failed-finalization") {
          throw new Error("secondary item storage unavailable");
        }
        finalized.push(id);
        return Promise.resolve(true);
      },
    },
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });

  const result = await worker.tick({ owner: "isolation-test" });

  if (
    result.claimed !== 2 ||
    result.results[0]?.status !== "processing-error" ||
    result.results[1]?.status !== "sent" ||
    finalized.join(",") !== "independent-item"
  ) {
    throw new Error(JSON.stringify({ finalized, result }));
  }
});

Deno.test("PLANNING-002 management preserves validation, authorization, replay, and disable boundaries", async () => {
  const actor = {
    memberId: crypto.randomUUID(),
    role: "member" as const,
    userId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  const personId = crypto.randomUUID();
  const requestId = crypto.randomUUID();
  const reminder: planning.ReminderDefinitionRecord = {
    anchorOn: "2026-08-20",
    createdAt: "2026-08-18T10:00:00.000Z",
    id: crypto.randomUUID(),
    isActive: true,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "month",
    sendTime: "09:00:00",
    title: "Call Ada",
    updatedAt: "2026-08-18T10:00:00.000Z",
  };
  const cadence: planning.StayInTouchCadenceRecord = {
    id: crypto.randomUUID(),
    intervalCount: 1,
    intervalUnit: "month",
    isActive: true,
    nextDueAt: "2026-09-18T10:00:00.000Z",
    personId,
    updatedAt: "2026-08-18T10:00:00.000Z",
  };
  let authorized = true;
  let timezoneReady = true;
  let personStatus: "archived" | "not-found" | "ready" = "ready";
  let replay: planning.ReminderDefinitionRecord | undefined;
  let created: planning.ReminderDefinitionRecord | undefined = reminder;
  let saved: planning.ReminderDefinitionRecord | undefined = reminder;
  let savedCadence: planning.StayInTouchCadenceRecord | undefined = cadence;
  let cadenceReplay:
    | { cadence: planning.StayInTouchCadenceRecord; requestFingerprint: string }
    | undefined;
  let cadenceFingerprint = "";
  let generated = true;
  const audits: string[] = [];
  const interactions: string[][] = [];
  let cancellations = 0;
  let regenerations = 0;
  const management = planning.createReminderManagement({
    actors: {
      revalidate: () =>
        Promise.resolve(authorized ? "active" as const : "revoked" as const),
    },
    audit: {
      record(command) {
        audits.push(command.action);
        return Promise.resolve();
      },
    },
    clock: { now: () => new Date("2026-08-18T10:00:00.000Z") },
    people: {
      inspect: () => Promise.resolve({ status: personStatus }),
      summarize: () => Promise.resolve([]),
    },
    repository: {
      cancelFutureOccurrences: () => {
        cancellations += 1;
        return Promise.resolve();
      },
      createReminder: () => Promise.resolve(created),
      findCadenceRequest: () => Promise.resolve(cadenceReplay),
      findReminder: () => Promise.resolve(replay),
      listPerson: () =>
        Promise.resolve({ cadences: [cadence], reminders: [reminder] }),
      lockRequest: () => Promise.resolve(),
      regenerateForTimezone: () => {
        regenerations += 1;
        return Promise.resolve();
      },
      regenerateForWorkspaceTimezone: () => Promise.resolve(),
      setReminderActive: (command) =>
        Promise.resolve(
          saved ? { reminder: saved, wasActive: !command.active } : undefined,
        ),
      updateCadenceFromInteraction(command) {
        interactions.push([...command.personIds]);
        return Promise.resolve();
      },
      upsertCadence: (command) => {
        cadenceFingerprint = command.requestFingerprint;
        return Promise.resolve(savedCadence);
      },
      upsertOccurrences: (_command) =>
        Promise.resolve(
          generated
            ? [{
              attemptCount: 0,
              deliverAt: "2026-08-20T07:00:00Z",
              id: crypto.randomUUID(),
              occursOn: "2026-08-20",
              status: "pending" as const,
            }]
            : [],
        ),
    },
    transaction: { run: (work) => work({ opaque: "tx" }) },
    workspace: {
      effectiveTimezone: () =>
        Promise.resolve(
          timezoneReady
            ? { status: "ready" as const, timezone: "Europe/Belgrade" }
            : { status: "forbidden" as const },
        ),
    },
  });
  const input = {
    anchorOn: reminder.anchorOn,
    personId,
    recurrenceInterval: 1,
    recurrenceUnit: "month" as const,
    requestId,
    sendTime: "09:00",
    title: reminder.title,
  };
  const invalid = await management.createReminder(actor, {
    ...input,
    anchorOn: "2026-02-30",
    personId: "bad",
    recurrenceInterval: 0,
    requestId: "bad",
    sendTime: "25:00",
    title: " ",
  });
  const invalidCadence = await management.createCadence(actor, {
    intervalCount: 101,
    intervalUnit: "week",
    personId: "bad",
    requestId: "bad",
  });
  timezoneReady = false;
  const forbidden = await management.createReminder(actor, input);
  timezoneReady = true;
  personStatus = "archived";
  const archived = await management.createReminder(actor, input);
  personStatus = "ready";
  replay = reminder;
  const replayed = await management.createReminder(actor, input);
  replay = { ...reminder, title: "Different" };
  const conflict = await management.createReminder(actor, input);
  replay = undefined;
  created = undefined;
  const missing = await management.createReminder(actor, input);
  created = reminder;
  generated = false;
  const withoutOccurrence = await management.createReminder(actor, {
    ...input,
    requestId: crypto.randomUUID(),
  });
  savedCadence = undefined;
  const missingCadence = await management.createCadence(actor, {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: crypto.randomUUID(),
  });
  savedCadence = cadence;
  const cadenceRequestId = crypto.randomUUID();
  const createdCadence = await management.createCadence(actor, {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: cadenceRequestId,
  });
  cadenceReplay = { cadence, requestFingerprint: cadenceFingerprint };
  const replayedCadence = await management.createCadence(actor, {
    intervalCount: 1,
    intervalUnit: "month",
    personId,
    requestId: cadenceRequestId,
  });
  const changedCadenceReplay = await management.createCadence(actor, {
    intervalCount: 2,
    intervalUnit: "month",
    personId,
    requestId: cadenceRequestId,
  });
  const crossPersonCadenceReplay = await management.createCadence(actor, {
    intervalCount: 1,
    intervalUnit: "month",
    personId: crypto.randomUUID(),
    requestId: cadenceRequestId,
  });
  cadenceReplay = undefined;
  authorized = false;
  const forbiddenSave = await management.setActive(actor, reminder.id, false);
  const forbiddenList = await management.listPerson(actor, personId);
  authorized = true;
  saved = undefined;
  const missingSave = await management.setActive(actor, reminder.id, false);
  saved = reminder;
  const active = await management.setActive(actor, reminder.id, true);
  const disabled = await management.setActive(actor, reminder.id, false);
  const listed = await management.listPerson(actor, personId);
  await management.interactionRecorded({
    happenedAt: "invalid",
    memberId: actor.memberId,
    personIds: [personId],
    transaction: { opaque: "tx" },
    workspaceId: actor.workspaceId,
  });
  timezoneReady = false;
  await management.timezoneChanged(actor, { opaque: "tx" });
  timezoneReady = true;
  await management.timezoneChanged(actor, { opaque: "tx" });
  await management.interactionRecorded({
    happenedAt: "2026-08-18T12:00:00Z",
    memberId: actor.memberId,
    personIds: [personId, personId, reminder.id],
    transaction: { opaque: "tx" },
    workspaceId: actor.workspaceId,
  });
  if (
    invalid.status !== "validation-error" ||
    invalidCadence.status !== "validation-error" ||
    forbidden.status !== "forbidden" ||
    archived.status !== "archived-write-rejected" ||
    replayed.status !== "created" ||
    conflict.status !== "idempotency-conflict" ||
    missing.status !== "not-found" || withoutOccurrence.status !== "created" ||
    missingCadence.status !== "not-found" ||
    createdCadence.status !== "created" ||
    replayedCadence.status !== "created" ||
    changedCadenceReplay.status !== "idempotency-conflict" ||
    crossPersonCadenceReplay.status !== "idempotency-conflict" ||
    forbiddenSave.status !== "forbidden" ||
    forbiddenList.status !== "forbidden" ||
    missingSave.status !== "not-found" || active.status !== "saved" ||
    disabled.status !== "saved" ||
    listed.status !== "ready" || cancellations !== 1 ||
    interactions.length !== 1 ||
    interactions[0]?.join(",") !== [personId, reminder.id].sort().join(",") ||
    regenerations !== 1 ||
    !audits.includes("cadence-created") || !audits.includes("disabled")
  ) {
    throw new Error(JSON.stringify({
      active,
      archived,
      audits,
      cancellations,
      conflict,
      changedCadenceReplay,
      createdCadence,
      crossPersonCadenceReplay,
      disabled,
      forbidden,
      forbiddenList,
      forbiddenSave,
      interactions,
      invalid,
      invalidCadence,
      listed,
      missing,
      missingCadence,
      missingSave,
      replayed,
      replayedCadence,
      withoutOccurrence,
    }));
  }
});
