import * as planning from "../public.ts";
import {
  fixedClock,
  recordingLogger,
  sequentialIds,
} from "../../../testing/fakes.ts";

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
    clock: fixedClock("2026-10-20T00:30:00Z"),
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
    clock: fixedClock("2026-08-18T10:00:00Z"),
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
    clock: fixedClock("2026-08-18T10:00:00Z"),
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
    clock: fixedClock("2026-08-23T10:00:00Z"),
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

Deno.test("[GAP-039] each delivery run is logged with its attempt and outcome and correlated to its audit", async () => {
  const base = {
    body: "Call Ada",
    memberId: "00000000-0000-4000-8000-000000000702",
    personId: "00000000-0000-4000-8000-000000000703",
    providerResultState: "unattempted" as const,
    title: "Reminder",
    workspaceId: "00000000-0000-4000-8000-000000000704",
  };
  const claims = [
    {
      ...base,
      attemptCount: 1,
      claimToken: "claim-1",
      id: "confirmed",
      providerIdempotencyKey: "confirmed",
    },
    {
      ...base,
      attemptCount: 2,
      claimToken: "claim-2",
      id: "retry",
      providerIdempotencyKey: "retry",
    },
    {
      ...base,
      attemptCount: 3,
      claimToken: "claim-3",
      id: "poisoned",
      providerIdempotencyKey: "poisoned",
    },
  ];
  const logger = recordingLogger();
  const runs = sequentialIds({ prefix: "0b000000-0000-4000-8000-" });
  const audited: Array<
    { readonly action: string; readonly requestId?: string }
  > = [];
  const worker = planning.createReminderDeliveryWorker({
    audit: {
      record(command) {
        audited.push({
          action: command.action,
          ...(command.requestId ? { requestId: command.requestId } : {}),
        });
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-08-18T10:00:00Z"),
    provider: {
      deliver: ({ occurrenceId }) =>
        Promise.resolve(
          occurrenceId === "retry"
            ? { code: "temporary", status: "transient" as const }
            : {
              receipt: `receipt:${occurrenceId}`,
              status: "confirmed" as const,
            },
        ),
      reconcile: () =>
        Promise.resolve({ code: "unused", status: "transient" as const }),
    },
    repository: {
      replenish: () => Promise.resolve(),
      claimDue: () => Promise.resolve(claims),
      finalize: (command) =>
        command.id === "poisoned"
          ? Promise.reject(new Error("deadlock detected for Ada Lovelace"))
          : Promise.resolve(true),
    },
    telemetry: { correlation: runs, logger },
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });

  await worker.tick({ owner: "telemetry" });

  const [first, second, third] = runs.issued;
  const events = logger.events.map((event) => {
    const { duration_ms: duration, ...rest } = event as typeof event & {
      readonly duration_ms: number;
    };
    if (!Number.isInteger(duration) || duration < 0) {
      throw new Error(`a job run had no duration: ${JSON.stringify(event)}`);
    }
    return rest;
  });
  const expected = [
    [first, 1, "sent"],
    [second, 2, "retry"],
    [third, 3, "processing-error"],
  ].map(([requestId, attempt, outcome]) => ({
    event: "worker.job",
    job: "reminder-delivery",
    request_id: requestId,
    attempt,
    outcome,
  }));
  if (JSON.stringify(events) !== JSON.stringify(expected)) {
    throw new Error(
      `job runs were not logged as declared: ${JSON.stringify(events)}`,
    );
  }
  if (
    JSON.stringify(audited) !==
      JSON.stringify([{ action: "delivered", requestId: first }])
  ) {
    throw new Error(
      `the delivery audit lost its run's identifier: ${
        JSON.stringify(audited)
      }`,
    );
  }
  const written = JSON.stringify(logger.events);
  for (const secret of ["Ada Lovelace", "deadlock", base.workspaceId, "Call"]) {
    if (written.includes(secret)) throw new Error(`the log exposed ${secret}`);
  }
});

Deno.test("[GAP-039] a delivery worker without telemetry logs nothing and correlates nothing", async () => {
  const audited: Array<Record<string, unknown>> = [];
  const worker = planning.createReminderDeliveryWorker({
    audit: {
      record(command) {
        audited.push({ ...command });
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-08-18T10:00:00Z"),
    provider: {
      deliver: () => Promise.resolve({ receipt: "r", status: "confirmed" }),
      reconcile: () => Promise.resolve({ receipt: "r", status: "confirmed" }),
    },
    repository: {
      replenish: () => Promise.resolve(),
      claimDue: () =>
        Promise.resolve([{
          attemptCount: 1,
          body: "Call Ada",
          claimToken: "claim",
          id: "plain",
          memberId: "member",
          providerIdempotencyKey: "plain",
          providerResultState: "unattempted" as const,
          title: "Reminder",
          workspaceId: "workspace",
        }]),
      finalize: () => Promise.resolve(true),
    },
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });

  await worker.tick({ owner: "no-telemetry" });

  if (audited.length !== 1 || Object.hasOwn(audited[0]!, "requestId")) {
    throw new Error(`an uncorrelated run grew a member: ${audited.length}`);
  }
});
