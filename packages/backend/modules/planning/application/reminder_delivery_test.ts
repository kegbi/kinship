import * as planning from "../public.ts";
import { assert, assertEquals } from "../../../testing/assert.ts";
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

/** A worker whose repository records the order of its calls. */
function recordingWorker(clock: { now(): Date }) {
  const calls: string[] = [];
  const repository = {
    claimDue: () => {
      calls.push("claimDue");
      return Promise.resolve([]);
    },
    finalize: () => Promise.resolve(true),
    replenish: () => {
      calls.push("replenish");
      return Promise.resolve();
    },
  } as unknown as planning.ReminderDeliveryRepository;
  const worker = planning.createReminderDeliveryWorker({
    audit: { record: () => Promise.resolve() },
    clock,
    provider: {
      deliver: () =>
        Promise.resolve({ receipt: "unused", status: "confirmed" }),
      reconcile: () =>
        Promise.resolve({ receipt: "unused", status: "confirmed" }),
    },
    repository,
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });
  return { calls, worker };
}

Deno.test("[AUD-W1] a tick claims due work before it replenishes the rolling window", async () => {
  const { calls, worker } = recordingWorker(
    fixedClock("2026-10-20T00:30:00Z"),
  );
  await worker.tick({ owner: "rolling-window" });
  assertEquals(calls, ["claimDue", "replenish"]);
});

Deno.test("[AUD-W1] the rolling window is replenished at most once each clock hour", async () => {
  let now = new Date("2026-10-20T00:30:00Z");
  const { calls, worker } = recordingWorker({ now: () => now });
  const replenishedAt = async (instant: string) => {
    now = new Date(instant);
    calls.length = 0;
    await worker.tick({ owner: "hourly" });
    return calls.includes("replenish");
  };
  // A worker that just started looks once: it cannot know what changed
  // while it was away.
  assertEquals(await replenishedAt("2026-10-20T00:30:00Z"), true);
  assertEquals(await replenishedAt("2026-10-20T00:30:05Z"), false);
  assertEquals(await replenishedAt("2026-10-20T00:59:59Z"), false);
  // A new hour is where every whole-hour zone's local date turns over.
  assertEquals(await replenishedAt("2026-10-20T01:00:00Z"), true);
  assertEquals(await replenishedAt("2026-10-20T01:30:00Z"), false);
  assertEquals(await replenishedAt("2026-10-20T03:10:00Z"), true);
  // A clock set back is a different hour too, and is looked at once.
  assertEquals(await replenishedAt("2026-10-20T02:10:00Z"), true);
  assertEquals(await replenishedAt("2026-10-20T02:20:00Z"), false);
});

Deno.test("[AUD-W1] a replenishment that fails is tried again on the next tick", async () => {
  let failures = 1;
  let replenishments = 0;
  const repository = {
    claimDue: () => Promise.resolve([]),
    finalize: () => Promise.resolve(true),
    replenish: () => {
      replenishments += 1;
      return failures-- > 0
        ? Promise.reject(new Error("replenish failed"))
        : Promise.resolve();
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
  let failed = false;
  await worker.tick({ owner: "retry" }).catch(() => failed = true);
  await worker.tick({ owner: "retry" });
  await worker.tick({ owner: "retry" });
  assert(failed, "a failed replenishment is reported");
  assertEquals(replenishments, 2, "retried once, then left for the hour");
});

Deno.test("PLANNING-002 reconciles an external effect before commit without duplicating it", async () => {
  const occurrence = {
    attemptCount: 1,
    body: "Call Ada",
    claimToken: crypto.randomUUID(),
    id: crypto.randomUUID(),
    memberId: crypto.randomUUID(),
    providerIdempotencyKey: "stable-key",
    channel: "in_app" as const,
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
    channel: "in_app" as const,
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
          channel: "in_app" as const,
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
    channel: "in_app" as const,
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
    channel: "in_app" as const,
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
          channel: "in_app" as const,
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

interface EmailHarness {
  /** Claims whose lease the ledger finds already lost. */
  readonly lost: Set<string>;
  readonly marks: Array<
    Parameters<planning.ReminderAttemptLedger["markAttempted"]>[0]
  >;
  readonly audits: Array<
    Parameters<planning.ReminderDeliveryAudit["record"]>[0]
  >;
  readonly claimedChannels: Array<readonly string[] | undefined>;
  readonly events: string[];
  readonly finalized: Array<
    Parameters<planning.ReminderDeliveryRepository["finalize"]>[0]
  >;
  readonly sent: Array<
    Parameters<planning.ReminderDeliveryChannel["send"]>[0]
  >;
  claims: planning.ClaimedReminderOccurrence[];
  send: planning.ReminderDeliveryChannel["send"];
}

function emailWorker(harness: EmailHarness, withEmail = true) {
  return planning.createReminderDeliveryWorker({
    audit: {
      record: (command) => {
        harness.audits.push(command);
        return Promise.resolve();
      },
    },
    clock: fixedClock("2026-10-20T08:00:00Z"),
    ...(withEmail
      ? {
        email: {
          channel: {
            reconcile: ({ idempotencyKey }) => {
              harness.events.push(`reconcile:${idempotencyKey}`);
              return Promise.resolve({
                code: "smtp-unreconcilable",
                status: "ambiguous" as const,
              });
            },
            send: (message) => {
              harness.events.push(`send:${message.items.length}`);
              harness.sent.push(message);
              return harness.send(message);
            },
          },
          ledger: {
            renewLeases: (command) => {
              harness.events.push(
                `renew:${command.claims.map((claim) => claim.id).join("+")}`,
              );
              return Promise.resolve(
                command.claims.map((claim) => claim.id).filter((id) =>
                  !harness.lost.has(id)
                ),
              );
            },
            markAttempted: async (command) => {
              harness.events.push(
                `mark:${command.claims.map((claim) => claim.id).join("+")}`,
              );
              harness.marks.push(command);
              const recordedIds = command.claims.map((claim) => claim.id)
                .filter((id) => !harness.lost.has(id));
              return {
                recordedIds,
                ...(command.digest && recordedIds.length > 0
                  ? {
                    attemptKey: await planning.digestIdempotencyKey({
                      ...command.digest,
                      occurrenceIds: recordedIds,
                    }),
                  }
                  : {}),
              };
            },
          },
        },
      }
      : {}),
    provider: {
      deliver: ({ occurrenceId }) => {
        harness.events.push(`in_app:${occurrenceId}`);
        return Promise.resolve({
          receipt: `in_app:${occurrenceId}`,
          status: "confirmed" as const,
        });
      },
      reconcile: () =>
        Promise.resolve({ code: "unused", status: "transient" as const }),
    },
    repository: {
      replenish: () => Promise.resolve(),
      claimDue: ({ channels }) => {
        harness.claimedChannels.push(channels);
        return Promise.resolve(harness.claims);
      },
      finalize: (command) => {
        harness.finalized.push(command);
        return Promise.resolve(true);
      },
    },
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });
}

function emailHarness(
  claims: planning.ClaimedReminderOccurrence[],
): EmailHarness {
  return {
    audits: [],
    claimedChannels: [],
    claims,
    events: [],
    finalized: [],
    lost: new Set(),
    marks: [],
    send: ({ idempotencyKey }) =>
      Promise.resolve({
        receipt: `smtp:${idempotencyKey}`,
        status: "confirmed" as const,
      }),
    sent: [],
  };
}

function emailClaim(
  id: string,
  overrides: Partial<planning.ClaimedReminderOccurrence> = {},
): planning.ClaimedReminderOccurrence {
  return {
    attemptCount: 1,
    body: `Reminder for ${id}`,
    channel: "email",
    claimToken: `token-${id}`,
    id,
    memberId: "member-a",
    personId: `person-${id}`,
    providerIdempotencyKey: `key-${id}`,
    providerResultState: "unattempted",
    recipientEmail: "owner@example.test",
    title: `Call ${id}`,
    workspaceId: "workspace-a",
    ...overrides,
  };
}

Deno.test("[PLANNING-003] a worker without an email channel claims in-app occurrences only", async () => {
  const withEmail = emailHarness([]);
  await emailWorker(withEmail).tick({ owner: "email" });
  const withoutEmail = emailHarness([]);
  await emailWorker(withoutEmail, false).tick({ owner: "in-app" });
  assertEquals(withEmail.claimedChannels, [["in_app", "email"]]);
  assertEquals(withoutEmail.claimedChannels, [["in_app"]]);
});

Deno.test("[PLANNING-003] an immediate email is recorded as attempted, sent once, and audited with its channel", async () => {
  const harness = emailHarness([emailClaim("ada")]);
  const result = await emailWorker(harness).tick({ owner: "email" });
  assertEquals(harness.events, ["mark:ada", "send:1"]);
  assertEquals(harness.sent, [{
    idempotencyKey: "key-ada",
    items: [{
      body: "Reminder for ada",
      personId: "person-ada",
      title: "Call ada",
    }],
    to: "owner@example.test",
  }]);
  assertEquals(result.results, [{ id: "ada", status: "sent" }]);
  assertEquals(harness.finalized[0]?.receipt, "smtp:key-ada");
  assertEquals(
    harness.audits.map((audit) => [audit.action, audit.digestSize]),
    [
      ["delivered", undefined],
    ],
  );
});

Deno.test("[PLANNING-003] an email names its person, the date its reminder is for, and how far ahead it was sent", async () => {
  const harness = emailHarness([
    emailClaim("ada", {
      leadTimeDays: 30,
      occursOn: "2026-12-02",
      personName: "Ada Lovelace",
    }),
  ]);
  await emailWorker(harness).tick({ owner: "email" });
  assertEquals(harness.sent[0]?.items, [{
    body: "Reminder for ada",
    leadDays: 30,
    occursOn: "2026-12-02",
    personId: "person-ada",
    personName: "Ada Lovelace",
    title: "Call ada",
  }]);
});

Deno.test("[PLANNING-003] a member's due digest goes out as one email and finalizes every occurrence with its receipt", async () => {
  const first = emailClaim("ada", { digestDate: "2026-10-20" });
  const second = emailClaim("grace", { digestDate: "2026-10-20" });
  const harness = emailHarness([second, first]);
  const result = await emailWorker(harness).tick({ owner: "digest" });
  assertEquals(harness.events, ["mark:grace+ada", "send:2"]);
  const key = harness.sent[0]?.idempotencyKey ?? "";
  assert(/^digest:[0-9a-f]{64}$/.test(key), `digest key was ${key}`);
  assertEquals(harness.sent[0]?.digestDate, "2026-10-20");
  assertEquals(result.results, [
    { id: "grace", status: "sent" },
    { id: "ada", status: "sent" },
  ]);
  assertEquals(
    harness.finalized.map((command) => command.receipt),
    [`smtp:${key}`, `smtp:${key}`],
  );
  assertEquals(harness.audits.map((audit) => audit.digestSize), [2, 2]);

  // The key is the member, the local digest date, and the included
  // occurrences, whatever order they were claimed in.
  const replay = emailHarness([first, second]);
  await emailWorker(replay).tick({ owner: "digest" });
  assertEquals(replay.sent[0]?.idempotencyKey, key);
  const other = emailHarness([first]);
  await emailWorker(other).tick({ owner: "digest" });
  assert(other.sent[0]?.idempotencyKey !== key, "a different set shares a key");
});

Deno.test("[PLANNING-003] an ambiguous digest is reconciled on the next claim and never sent again", async () => {
  const claims = [
    emailClaim("ada", { digestDate: "2026-10-20" }),
    emailClaim("grace", { digestDate: "2026-10-20" }),
  ];
  const harness = emailHarness(claims);
  harness.send = () => Promise.reject(new Error("connection lost after DATA"));
  const first = await emailWorker(harness).tick({ owner: "digest" });
  assertEquals(first.results.map((item) => item.status), ["retry", "retry"]);
  assertEquals(
    harness.finalized.map((command) => command.providerResultState),
    ["ambiguous", "ambiguous"],
  );

  harness.claims = claims.map((claim) => ({
    ...claim,
    attemptCount: 2,
    providerResultState: "ambiguous" as const,
  }));
  harness.events.length = 0;
  await emailWorker(harness).tick({ owner: "digest" });
  assertEquals(harness.events, ["reconcile:key-ada", "reconcile:key-grace"]);
  assertEquals(harness.sent.length, 1, "the digest was sent a second time");
});

Deno.test("[PLANNING-003] an email claim without a verified address fails without sending", async () => {
  const { recipientEmail: _, ...unverified } = emailClaim("ada");
  const harness = emailHarness([unverified]);
  const result = await emailWorker(harness).tick({ owner: "email" });
  assertEquals(harness.events, []);
  assertEquals(result.results, [{ id: "ada", status: "failed" }]);
  assertEquals(harness.finalized[0]?.error, "recipient-unverified");
});

Deno.test("[PLANNING-003] a provider refusal before any effect retries the email as unattempted", async () => {
  const harness = emailHarness([emailClaim("ada")]);
  harness.send = () =>
    Promise.resolve({ code: "smtp-unavailable", status: "transient" as const });
  const result = await emailWorker(harness).tick({ owner: "email" });
  assertEquals(result.results, [{ id: "ada", status: "retry" }]);
  assertEquals(harness.finalized[0]?.providerResultState, "unattempted");
});

Deno.test("[PLANNING-003] an email claim reaching a worker without email is retried, not lost", async () => {
  const harness = emailHarness([
    emailClaim("ada"),
    emailClaim("grace", { digestDate: "2026-10-20" }),
  ]);
  const result = await emailWorker(harness, false).tick({ owner: "in-app" });
  assertEquals(result.results, [
    { id: "ada", status: "retry" },
    { id: "grace", status: "retry" },
  ]);
  assertEquals(
    harness.finalized.map((command) => command.error),
    ["email-channel-unavailable", "email-channel-unavailable"],
  );
});

Deno.test("[PLANNING-003] an attempt that cannot be recorded is never sent", async () => {
  const harness = emailHarness([emailClaim("ada")]);
  const worker = planning.createReminderDeliveryWorker({
    audit: { record: () => Promise.resolve() },
    clock: fixedClock("2026-10-20T08:00:00Z"),
    email: {
      channel: {
        reconcile: () =>
          Promise.resolve({ code: "unused", status: "ambiguous" as const }),
        send: (message) => {
          harness.sent.push(message);
          return Promise.resolve({
            receipt: "unexpected",
            status: "confirmed",
          });
        },
      },
      ledger: {
        markAttempted: () => Promise.reject(new Error("down")),
        renewLeases: () => Promise.resolve([]),
      },
    },
    provider: {
      deliver: () => Promise.resolve({ code: "unused", status: "transient" }),
      reconcile: () => Promise.resolve({ code: "unused", status: "transient" }),
    },
    repository: {
      replenish: () => Promise.resolve(),
      claimDue: () => Promise.resolve(harness.claims),
      finalize: () => Promise.resolve(true),
    },
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });
  const result = await worker.tick({ owner: "ledger-down" });
  assertEquals(result.results, [{ id: "ada", status: "processing-error" }]);
  assertEquals(harness.sent.length, 0);
});

Deno.test("[PLANNING-003] an email whose claim was lost before it was recorded is never sent", async () => {
  const harness = emailHarness([emailClaim("ada")]);
  harness.lost.add("ada");
  const result = await emailWorker(harness).tick({ owner: "late" });
  assertEquals(harness.events, ["mark:ada"]);
  assertEquals(harness.sent.length, 0);
  assertEquals(harness.finalized.length, 0, "a lost claim is not finalized");
  assertEquals(result.results, [{ id: "ada", status: "stale-claim" }]);
});

Deno.test("[PLANNING-003] a digest sends only the occurrences whose claims were recorded", async () => {
  const claims = [
    emailClaim("ada", { digestDate: "2026-10-20" }),
    emailClaim("grace", { digestDate: "2026-10-20" }),
  ];
  const harness = emailHarness(claims);
  harness.lost.add("grace");
  const result = await emailWorker(harness).tick({ owner: "partial" });
  assertEquals(harness.sent.length, 1);
  assertEquals(harness.sent[0]?.items.map((item) => item.title), ["Call ada"]);
  assertEquals(
    harness.sent[0]?.idempotencyKey,
    await planning.digestIdempotencyKey({
      localDate: "2026-10-20",
      memberId: "member-a",
      occurrenceIds: ["ada"],
    }),
    "the key covers exactly what was sent",
  );
  assertEquals(result.results, [
    { id: "ada", status: "sent" },
    { id: "grace", status: "stale-claim" },
  ]);
  assertEquals(harness.finalized.map((command) => command.id), ["ada"]);

  const none = emailHarness(claims.map((claim) => ({ ...claim })));
  none.lost.add("ada");
  none.lost.add("grace");
  await emailWorker(none).tick({ owner: "all-lost" });
  assertEquals(none.sent.length, 0, "an empty digest is never sent");
});

Deno.test("[PLANNING-003] an email attempt renews its lease for the whole send", async () => {
  const harness = emailHarness([emailClaim("ada")]);
  await emailWorker(harness).tick({ owner: "lease" });
  const lease = harness.marks[0]?.leaseExpiresAt.getTime() ?? 0;
  assert(
    lease - new Date("2026-10-20T08:00:00Z").getTime() >=
      planning.EMAIL_ATTEMPT_LEASE_MILLISECONDS,
    `the email lease was ${lease}`,
  );
});

Deno.test("[PLANNING-003] a digest is reconciled under the key it was sent with", async () => {
  const harness = emailHarness([
    emailClaim("ada", {
      attemptCount: 2,
      attemptKey: "digest:sent-key",
      digestDate: "2026-10-20",
      providerResultState: "ambiguous",
    }),
    emailClaim("grace", { attemptCount: 2, providerResultState: "ambiguous" }),
  ]);
  await emailWorker(harness).tick({ owner: "reconcile" });
  assertEquals(harness.events, [
    "reconcile:digest:sent-key",
    "reconcile:key-grace",
  ]);
});

Deno.test("[REL-072] a digest that ends needing attention audits the key it was sent under", async () => {
  // Sent fresh on its last attempt, the provider's answer is ambiguous.
  const sent = emailHarness([
    emailClaim("ada", { attemptCount: 4, digestDate: "2026-10-20" }),
    emailClaim("grace", { attemptCount: 4, digestDate: "2026-10-20" }),
  ]);
  sent.send = () => Promise.reject(new Error("connection lost after DATA"));
  const fresh = await emailWorker(sent).tick({ owner: "digest" });
  assertEquals(fresh.results.map((item) => item.status), [
    "manual_attention",
    "manual_attention",
  ]);
  const key = sent.sent[0]?.idempotencyKey ?? "";
  assert(/^digest:[0-9a-f]{64}$/.test(key), `digest key was ${key}`);
  assertEquals(
    sent.audits.map((audit) => [audit.action, audit.attemptKey]),
    [["failed", key], ["failed", key]],
  );

  // Reconciled on its last attempt, the provider still cannot say.
  const reconciled = emailHarness([
    emailClaim("ada", {
      attemptCount: 4,
      attemptKey: "digest:sent-key",
      digestDate: "2026-10-20",
      providerResultState: "ambiguous",
    }),
  ]);
  await emailWorker(reconciled).tick({ owner: "reconcile" });
  assertEquals(reconciled.events, ["reconcile:digest:sent-key"]);
  assertEquals(
    reconciled.audits.map((audit) => [audit.action, audit.attemptKey]),
    [["failed", "digest:sent-key"]],
  );

  // A digest the provider refused, or confirmed, owes no reconciliation.
  const refused = emailHarness([
    emailClaim("ada", { digestDate: "2026-10-20" }),
  ]);
  refused.send = () =>
    Promise.resolve({ code: "smtp-550", status: "rejected" as const });
  await emailWorker(refused).tick({ owner: "digest" });
  const delivered = emailHarness([
    emailClaim("ada", { digestDate: "2026-10-20" }),
  ]);
  await emailWorker(delivered).tick({ owner: "digest" });
  assertEquals(
    [...refused.audits, ...delivered.audits].map((audit) => [
      audit.action,
      Object.hasOwn(audit, "attemptKey"),
    ]),
    [["failed", false], ["delivered", false]],
  );
});

Deno.test("[PLANNING-003] after each email the rest of the batch keeps its leases", async () => {
  const harness = emailHarness([
    emailClaim("ada"),
    emailClaim("grace"),
    { ...emailClaim("in-app"), channel: "in_app" },
  ]);
  harness.send = (message) => {
    // Grace's claim is lost while Ada's slow send is in flight.
    if (message.items[0]?.title === "Call ada") harness.lost.add("grace");
    return Promise.resolve({
      receipt: `smtp:${message.idempotencyKey}`,
      status: "confirmed" as const,
    });
  };
  const result = await emailWorker(harness).tick({ owner: "slow-batch" });
  assertEquals(harness.events, [
    "mark:ada",
    "send:1",
    "renew:grace+in-app",
    "in_app:in-app",
  ]);
  assertEquals(result.results, [
    { id: "ada", status: "sent" },
    { id: "grace", status: "stale-claim" },
    { id: "in-app", status: "sent" },
  ]);
});
