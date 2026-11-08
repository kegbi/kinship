import {
  createApplicationWorker,
  createConfiguredReminderWorker,
  createRetentionSchedule,
  DriverFaultError,
  RETENTION_INTERVAL_MILLISECONDS,
  RETENTION_JOB,
  runReminderWorkerLoop,
  TICK_FAILURE_JOB,
  tickDelayMilliseconds,
  UNATTENDED_DRIVER_FAULT,
  watchDriverFaults,
  WORKER_STATEMENT_TIMEOUT_MS,
} from "./composition.ts";
import * as apiAccess from "../../packages/backend/modules/api-access/public.ts";
import * as planning from "../../packages/backend/modules/planning/public.ts";
import * as workspaces from "../../packages/backend/modules/workspaces/public.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { recordingLogger } from "../../packages/backend/testing/fakes.ts";
import type {
  ApplicationDatabase,
  DatabaseConnection,
  DatabaseOptions,
} from "../../packages/backend/platform/postgres/database.ts";
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";

class CountingAbortSignal {
  aborted = false;
  private readonly listeners = new Set<EventListenerOrEventListenerObject>();

  get listenerCount(): number {
    return this.listeners.size;
  }

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === "abort") this.listeners.add(listener);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    if (type === "abort") this.listeners.delete(listener);
  }

  abort(): void {
    if (this.aborted) return;
    this.aborted = true;
    const event = new Event("abort");
    for (const listener of this.listeners) {
      if (typeof listener === "function") listener(event);
      else listener.handleEvent(event);
    }
    this.listeners.clear();
  }

  asAbortSignal(): AbortSignal {
    return this as unknown as AbortSignal;
  }
}

function emptyTick() {
  return Promise.resolve({ claimed: 0, results: [] });
}

Deno.test("[GIFTS-001] worker charges due recurring debts between cleanup and reminders", async () => {
  const effects: string[] = [];
  const worker = createApplicationWorker({
    tick: ({ owner }) => {
      effects.push(`reminders:${owner}`);
      return emptyTick();
    },
  }, {
    reconcilePendingCleanup: () => {
      effects.push("cleanup");
      return Promise.resolve({ completed: 0, inspected: 0 });
    },
  }, {
    chargeDue: () => {
      effects.push("recurring-debts");
      return Promise.resolve({ charged: 2, failed: 0, rules: 1 });
    },
  });

  await worker.tick({ owner: "debt-owner" });
  assert(
    effects.join(",") === "cleanup,recurring-debts,reminders:debt-owner",
    `worker order was ${effects.join(",")}`,
  );
});

Deno.test("[WORKSPACE-002] worker reconciles pending object cleanup before reminders", async () => {
  const effects: string[] = [];
  const worker = createApplicationWorker({
    tick: ({ owner }) => {
      effects.push(`reminders:${owner}`);
      return emptyTick();
    },
  }, {
    reconcilePendingCleanup: () => {
      effects.push("cleanup");
      return Promise.resolve({ completed: 1, inspected: 1 });
    },
  });

  await worker.tick({ owner: "restart-owner" });
  assert(
    effects.join(",") === "cleanup,reminders:restart-owner",
    `worker order was ${effects.join(",")}`,
  );
});

Deno.test({
  name: "APP-006B worker composition closes without starting a connection",
  async fn() {
    const configured = createConfiguredReminderWorker(
      "postgresql://unused:unused@127.0.0.1:1/unused",
      undefined,
      { get: (name) => name === "APP_ENV" ? "test" : undefined },
    );
    assert(
      typeof configured.worker.tick === "function",
      "worker tick is missing",
    );
    let unavailable = false;
    try {
      await configured.worker.tick({ owner: "configuration-probe" });
    } catch {
      unavailable = true;
    } finally {
      await configured.close();
    }
    assert(unavailable, "worker unexpectedly reached an unavailable database");
  },
});

Deno.test("[AUD-K6] worker started without APP_ENV takes production's refusals", () => {
  let error: unknown;
  try {
    createConfiguredReminderWorker(
      "postgresql://unused:unused@127.0.0.1:1/unused",
      undefined,
      { get: () => undefined },
    );
  } catch (caught) {
    error = caught;
  }
  assert(
    error instanceof Error && error.message.includes("required in production"),
    "an unset APP_ENV never composes the local object-store defaults",
  );
});

/**
 * A pool that answers every statement with no rows and records, by its index,
 * which pool each statement went to, the options it was opened with, and
 * whether the pool was destroyed.
 */
function recordedPools() {
  const statements: number[] = [];
  const destroyed: number[] = [];
  const options: DatabaseOptions[] = [];
  let opened = 0;
  const connect = (
    _url: string,
    poolOptions: DatabaseOptions,
  ): DatabaseConnection => {
    const index = opened++;
    options.push(poolOptions);
    const db = new Kysely<ApplicationDatabase>({
      dialect: {
        createAdapter: () => new PostgresAdapter(),
        createDriver: () => new DummyDriver(),
        createIntrospector: (database) => new PostgresIntrospector(database),
        createQueryCompiler: () => new PostgresQueryCompiler(),
      },
      plugins: [{
        transformQuery: ({ node }) => {
          statements.push(index);
          return node;
        },
        transformResult: ({ result }) => Promise.resolve(result),
      }],
    });
    return {
      db,
      destroy: () => {
        destroyed.push(index);
        return db.destroy();
      },
    };
  };
  return {
    connect,
    destroyed,
    get opened() {
      return opened;
    },
    options,
    statements,
  };
}

Deno.test("[AUD-W2] the configured worker reconnects onto a fresh pool", async () => {
  const pools = recordedPools();
  const configured = createConfiguredReminderWorker(
    "postgresql://unused:unused@127.0.0.1:1/unused",
    recordingLogger(),
    { get: (name) => name === "APP_ENV" ? "test" : undefined },
    pools.connect,
  );
  const tick = () =>
    configured.worker.tick({ owner: "reconnect-probe" }).catch(() => undefined);
  await tick();
  assert(pools.statements.length > 0, "the first tick sent no statement");
  assertEquals(
    [...new Set(pools.statements)],
    [0],
    "the first tick ran off its pool",
  );
  await configured.reconnect();
  assertEquals(pools.opened, 2, "reconnect opened no fresh pool");
  assertEquals(pools.destroyed, [0], "reconnect kept the lost pool open");
  const before = pools.statements.length;
  await tick();
  const after = pools.statements.slice(before);
  assert(after.length > 0, "the reconnected tick sent no statement");
  assertEquals(
    [...new Set(after)],
    [1],
    "the reconnected tick still used the lost pool",
  );
  assertEquals(
    pools.options.map((options) => options.statementTimeoutMs),
    [WORKER_STATEMENT_TIMEOUT_MS, WORKER_STATEMENT_TIMEOUT_MS],
    "a worker pool was opened without the worker statement timeout",
  );
  await configured.close();
  assertEquals(pools.destroyed, [0, 1], "close left the fresh pool open");
});

Deno.test("APP-006B worker removes abort listeners after every timer win", async () => {
  const signal = new CountingAbortSignal();
  let ticks = 0;
  await runReminderWorkerLoop({
    tick() {
      ticks += 1;
      if (ticks === 2) {
        const leakedListeners = signal.listenerCount;
        signal.abort();
        assert(
          leakedListeners === 0,
          `timer win leaked ${leakedListeners} abort listener(s)`,
        );
      }
      return emptyTick();
    },
  }, {
    intervalMilliseconds: 1,
    owner: "listener-test",
    signal: signal.asAbortSignal(),
  });
  assert(
    ticks === 2 && signal.listenerCount === 0,
    "worker loop did not stop cleanly",
  );
});

Deno.test("APP-006B worker exits when shutdown arrives during a tick", async () => {
  const signal = new CountingAbortSignal();
  const loop = runReminderWorkerLoop({
    tick() {
      signal.abort();
      return emptyTick();
    },
  }, {
    intervalMilliseconds: 60_000,
    owner: "shutdown-test",
    signal: signal.asAbortSignal(),
  });
  await Promise.race([
    loop,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("worker waited after shutdown")), 50)
    ),
  ]);
  assert(signal.listenerCount === 0, "shutdown left an abort listener");
});

Deno.test("APP-006B worker is inert for an already-aborted signal", async () => {
  const signal = new CountingAbortSignal();
  signal.abort();
  let ticks = 0;
  await runReminderWorkerLoop({
    tick() {
      ticks += 1;
      return emptyTick();
    },
  }, {
    intervalMilliseconds: 1,
    owner: "already-aborted-test",
    signal: signal.asAbortSignal(),
  });
  assert(
    ticks === 0 && signal.listenerCount === 0,
    "aborted loop performed work",
  );
});

/** A delivery worker whose repository fails its first `failures` claims. */
function failingDeliveryWorker(failures: readonly unknown[]) {
  const pending = [...failures];
  const repository = {
    claimDue: () => {
      const failure = pending.shift();
      return failure === undefined
        ? Promise.resolve([])
        : Promise.reject(failure);
    },
    finalize: () => Promise.resolve(true),
    replenish: () => Promise.resolve(),
  } as unknown as planning.ReminderDeliveryRepository;
  return planning.createReminderDeliveryWorker({
    audit: { record: () => Promise.resolve() },
    clock: { now: () => new Date("2026-11-07T12:00:00Z") },
    provider: {
      deliver: () =>
        Promise.resolve({ receipt: "unused", status: "confirmed" }),
      reconcile: () =>
        Promise.resolve({ receipt: "unused", status: "confirmed" }),
    },
    repository,
    transaction: { run: (work) => work({ opaque: "tx" }) },
  });
}

Deno.test("[AUD-W2] a tick whose repository throws is logged and the loop continues", async () => {
  const signal = new CountingAbortSignal();
  const logger = recordingLogger();
  const delivery = failingDeliveryWorker([new Error("relation is gone")]);
  let ticks = 0;
  await runReminderWorkerLoop({
    async tick(command) {
      ticks += 1;
      try {
        return await delivery.tick(command);
      } finally {
        if (ticks === 2) signal.abort();
      }
    },
  }, {
    intervalMilliseconds: 1,
    logger,
    owner: "failing-repository",
    signal: signal.asAbortSignal(),
  });
  assertEquals(ticks, 2, "the loop stopped at the failed tick");
  assertEquals(logger.events.length, 1);
  const [line] = logger.events;
  assert(line?.event === "worker.job", "the failure was not a worker.job");
  assertEquals(
    { attempt: line.attempt, job: line.job, outcome: line.outcome },
    { attempt: 1, job: TICK_FAILURE_JOB, outcome: "processing-error" },
  );
  assert(
    /^[\w-]{1,128}$/.test(line.request_id),
    `the failure line carries no correlation: ${line.request_id}`,
  );
  assert(
    !JSON.stringify(line).includes("relation is gone"),
    "the failure line leaked the error message",
  );
});

Deno.test("[AUD-W2] consecutive failed ticks back off, and a success resets it", async () => {
  const signal = new CountingAbortSignal();
  const logger = recordingLogger();
  const outcomes = ["fail", "fail", "ok", "fail"];
  await runReminderWorkerLoop({
    tick() {
      const outcome = outcomes.shift();
      if (outcomes.length === 0) signal.abort();
      return outcome === "fail"
        ? Promise.reject(new Error("unavailable"))
        : emptyTick();
    },
  }, {
    intervalMilliseconds: 1,
    logger,
    owner: "backoff",
    signal: signal.asAbortSignal(),
  });
  assertEquals(
    logger.events.map((line) =>
      line.event === "worker.job" ? line.attempt : -1
    ),
    [1, 2, 1],
  );
  assertEquals(tickDelayMilliseconds(5_000, 0), 5_000);
  assertEquals(tickDelayMilliseconds(5_000, 1), 10_000);
  assertEquals(tickDelayMilliseconds(5_000, 2), 20_000);
  assertEquals(tickDelayMilliseconds(5_000, 30), 60_000);
});

Deno.test("[AUD-W2] a tick that loses its connection reconnects before the next", async () => {
  const signal = new CountingAbortSignal();
  const effects: string[] = [];
  const closed = Object.assign(new Error("write CONNECTION_CLOSED"), {
    code: "CONNECTION_CLOSED",
  });
  const terminated = Object.assign(new Error("terminating connection"), {
    code: "57P01",
  });
  const failures: unknown[] = [closed, new Error("constraint"), terminated];
  await runReminderWorkerLoop({
    tick() {
      effects.push("tick");
      const failure = failures.shift();
      if (failure === undefined) {
        signal.abort();
        return emptyTick();
      }
      return Promise.reject(failure);
    },
  }, {
    intervalMilliseconds: 1,
    logger: recordingLogger(),
    owner: "reconnect",
    reconnect: () => {
      effects.push("reconnect");
      return Promise.resolve();
    },
    signal: signal.asAbortSignal(),
  });
  assertEquals(effects, [
    "tick",
    "reconnect",
    "tick",
    "tick",
    "reconnect",
    "tick",
  ]);
});

Deno.test("[AUD-W2] a reconnect that fails is retried on the next failure", async () => {
  const signal = new CountingAbortSignal();
  const logger = recordingLogger();
  const closed = Object.assign(new Error("closed"), {
    code: "CONNECTION_ENDED",
  });
  let reconnects = 0;
  let ticks = 0;
  await runReminderWorkerLoop({
    tick() {
      ticks += 1;
      if (ticks === 3) {
        signal.abort();
        return emptyTick();
      }
      return Promise.reject(closed);
    },
  }, {
    intervalMilliseconds: 1,
    logger,
    owner: "reconnect-fails",
    reconnect: () => {
      reconnects += 1;
      return Promise.reject(new Error("still down"));
    },
    signal: signal.asAbortSignal(),
  });
  assertEquals({ reconnects, ticks }, { reconnects: 2, ticks: 3 });
  assertEquals(logger.events.length, 2);
});

/** An error raised inside Postgres.js, as the audit's crash was. */
function driverCrash(): Error {
  const error = new TypeError(
    "Cannot read properties of null (reading 'write')",
  );
  error.stack = [
    `TypeError: ${error.message}`,
    "    at Immediate.nextWrite (file:///deno/npm/registry.npmjs.org/postgres/3.4.9/src/connection.js:255:22)",
    "    at ext:deno_node/internal/timers.mjs:1:1",
  ].join("\n");
  return error;
}

Deno.test("[AUD-W2] a driver crash fails the tick in flight and is taken from the runtime", async () => {
  const target = new EventTarget();
  const watch = watchDriverFaults(target);
  try {
    const crash = new ErrorEvent("error", {
      cancelable: true,
      error: driverCrash(),
    });
    const stuck = watch.during(new Promise<never>(() => undefined));
    target.dispatchEvent(crash);
    let failure: unknown;
    await stuck.catch((error) => failure = error);
    assert(crash.defaultPrevented, "the crash still reached the runtime");
    assert(
      failure instanceof DriverFaultError &&
        failure.cause instanceof TypeError,
      "the stuck tick was not failed by the crash",
    );

    const closed = Object.assign(new Error("write CONNECTION_CLOSED"), {
      code: "CONNECTION_CLOSED",
    });
    const dangling = Promise.reject(closed);
    dangling.catch(() => undefined);
    const rejection = new PromiseRejectionEvent("unhandledrejection", {
      cancelable: true,
      promise: dangling,
      reason: closed,
    });
    // With no tick in flight there is nothing to fail, only a report to take;
    // the stuck tick the crash already failed is no longer in flight either.
    target.dispatchEvent(rejection);
    assert(rejection.defaultPrevented, "a dangling driver rejection escaped");
    assertEquals(watch.takeUnattended(), 1, "the unattended fault was lost");
    assertEquals(watch.takeUnattended(), 0, "taking the count resets it");

    assertEquals(await watch.during(Promise.resolve("ticked")), "ticked");
    let ordinary: unknown;
    await watch.during(Promise.reject(new Error("constraint"))).catch(
      (error) => ordinary = error,
    );
    assert(
      ordinary instanceof Error && ordinary.message === "constraint",
      "a tick's own failure was replaced",
    );
  } finally {
    watch.dispose();
  }
});

Deno.test("[AUD-W2] a program fault is left to end the process", async () => {
  const target = new EventTarget();
  const watch = watchDriverFaults(target);
  try {
    let settled = false;
    const tick = watch.during(
      new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 5)),
    ).then((value) => {
      settled = true;
      return value;
    });
    const fault = new ErrorEvent("error", {
      cancelable: true,
      error: new TypeError("undefined is not a function"),
    });
    target.dispatchEvent(fault);
    assert(!fault.defaultPrevented, "a program fault was swallowed");
    assert(!settled, "a program fault settled the tick");
    assertEquals(await tick, "ok");
  } finally {
    watch.dispose();
  }
  const late = new ErrorEvent("error", {
    cancelable: true,
    error: driverCrash(),
  });
  target.dispatchEvent(late);
  assert(!late.defaultPrevented, "the watch kept listening after dispose");
});

/**
 * A statement error as Postgres.js returns it, built inside the driver as the
 * server's error response arrives: a forgotten `await` leaves it unhandled.
 */
function statementFailure(code: string): Error {
  const driver =
    "file:///deno/npm/registry.npmjs.org/postgres/3.4.9/src/connection.js";
  const error = Object.assign(new Error("null value violates not-null"), {
    code,
    name: "PostgresError",
  });
  error.stack = [
    `PostgresError: ${error.message}`,
    `    at ErrorResponse (${driver}:815:30)`,
    `    at handle (${driver}:489:6)`,
    `    at Socket.data (${driver}:330:9)`,
    "    at ext:deno_node/internal/streams/readable.mjs:1:1",
  ].join("\n");
  return error;
}

Deno.test("[AUD-W2] an unhandled statement error is a program fault that ends the process", async () => {
  const target = new EventTarget();
  const watch = watchDriverFaults(target);
  const dispatch = (reason: Error): PromiseRejectionEvent => {
    const promise = Promise.reject(reason);
    promise.catch(() => undefined);
    const event = new PromiseRejectionEvent("unhandledrejection", {
      cancelable: true,
      promise,
      reason,
    });
    target.dispatchEvent(event);
    return event;
  };
  try {
    for (const code of ["23502", "22012", "42P01", "UNDEFINED_VALUE"]) {
      assert(
        !dispatch(statementFailure(code)).defaultPrevented,
        `an unhandled ${code} with no tick in flight was swallowed`,
      );
    }
    let settled = false;
    const tick = watch.during(
      new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 5)),
    ).then((value) => {
      settled = true;
      return value;
    });
    assert(
      !dispatch(statementFailure("22012")).defaultPrevented,
      "an unhandled statement error inside a tick was swallowed",
    );
    assert(!settled, "a statement error failed the tick in flight");
    assertEquals(await tick, "ok");
    assertEquals(watch.takeUnattended(), 0, "a program fault was counted");
  } finally {
    watch.dispose();
  }
});

Deno.test("[AUD-W2] a tick the driver crashed under is logged, reconnects, and the loop goes on", async () => {
  const signal = new CountingAbortSignal();
  const target = new EventTarget();
  const watch = watchDriverFaults(target);
  const logger = recordingLogger();
  const effects: string[] = [];
  let ticks = 0;
  try {
    await runReminderWorkerLoop({
      tick() {
        ticks += 1;
        effects.push(`tick:${ticks}`);
        if (ticks === 1) {
          // The driver crashes from its own timer; the tick never settles.
          setTimeout(() =>
            target.dispatchEvent(
              new ErrorEvent("error", {
                cancelable: true,
                error: driverCrash(),
              }),
            ), 1);
          return new Promise<never>(() => undefined);
        }
        signal.abort();
        return emptyTick();
      },
    }, {
      faults: watch,
      intervalMilliseconds: 1,
      logger,
      owner: "driver-crash",
      reconnect: () => {
        effects.push("reconnect");
        return Promise.resolve();
      },
      signal: signal.asAbortSignal(),
    });
  } finally {
    watch.dispose();
  }
  assertEquals(effects, ["tick:1", "reconnect", "tick:2"]);
  assertEquals(
    logger.events.map((line) =>
      line.event === "worker.job" ? [line.job, line.outcome] : []
    ),
    [[TICK_FAILURE_JOB, "processing-error"]],
  );
  assert(
    !JSON.stringify(logger.events).includes("reading 'write'"),
    "the failure line leaked the crash",
  );
});

Deno.test("[AUD-W2] driver faults no tick was in flight for are counted on one line", async () => {
  const signal = new CountingAbortSignal();
  const logger = recordingLogger();
  const counts = [0, 3, 0];
  let ticks = 0;
  await runReminderWorkerLoop({
    tick() {
      ticks += 1;
      if (ticks === 3) signal.abort();
      return emptyTick();
    },
  }, {
    faults: {
      during: (work) => work,
      takeUnattended: () => counts.shift() ?? 2,
    },
    intervalMilliseconds: 1,
    logger,
    owner: "unattended",
    signal: signal.asAbortSignal(),
  });
  assertEquals(
    logger.events.map((line) =>
      line.event === "worker.job" ? [line.job, line.outcome, line.attempt] : []
    ),
    [
      [TICK_FAILURE_JOB, UNATTENDED_DRIVER_FAULT, 3],
      [TICK_FAILURE_JOB, UNATTENDED_DRIVER_FAULT, 2],
    ],
  );
  assertEquals(
    Object.keys(logger.events[0] ?? {}).sort(),
    ["attempt", "duration_ms", "event", "job", "outcome", "request_id"],
  );
});

Deno.test("[AUD-A2] the retention job runs after reminder delivery, on the first tick and then hourly", async () => {
  const effects: string[] = [];
  let clock = 1_000;
  const logger = recordingLogger();
  const retention = createRetentionSchedule(
    () => [
      () => Promise.resolve(effects.push("registrations")),
      () => Promise.resolve(effects.push("authentication")),
    ],
    { logger, now: () => clock },
  );
  const worker = createApplicationWorker(
    {
      tick: () => Promise.resolve(effects.push("reminders")),
    },
    { reconcilePendingCleanup: () => Promise.resolve() },
    undefined,
    retention,
  );
  await worker.tick({ owner: "test" });
  clock += RETENTION_INTERVAL_MILLISECONDS - 1;
  await worker.tick({ owner: "test" });
  clock += 1;
  await worker.tick({ owner: "test" });
  assertEquals(effects, [
    "reminders",
    "registrations",
    "authentication",
    "reminders",
    "reminders",
    "registrations",
    "authentication",
  ]);
  assertEquals(
    logger.events.map((event) =>
      event.event === "worker.job" ? `${event.job}:${event.outcome}` : ""
    ),
    [`${RETENTION_JOB}:completed`, `${RETENTION_JOB}:completed`],
  );
});

Deno.test("[AUD-A2] a failed purge neither stops the others nor fails the tick, and waits an interval", async () => {
  const effects: string[] = [];
  let clock = 0;
  const logger = recordingLogger();
  const retention = createRetentionSchedule(
    () => [
      () => Promise.reject(new Error("database is gone")),
      () => Promise.resolve(effects.push("request-logs")),
    ],
    { intervalMilliseconds: 10, logger, now: () => clock },
  );
  await retention.runIfDue();
  await retention.runIfDue();
  clock = 10;
  await retention.runIfDue();
  assertEquals(effects, ["request-logs", "request-logs"]);
  const lines = logger.events.filter((event) => event.event === "worker.job");
  assertEquals(lines.length, 2);
  assert(
    lines.every((line) =>
      line.event === "worker.job" && line.job === RETENTION_JOB &&
      line.outcome === "processing-error" && line.attempt === 1 &&
      line.duration_ms === 0 && !JSON.stringify(line).includes("gone")
    ),
    "a failed run is one redacted line with a stable outcome",
  );
});

Deno.test("[AUD-A2] each request-log retention outlasts the window its reader counts", () => {
  const { mailBudgetMilliseconds, requestMilliseconds } =
    apiAccess.REQUEST_LOG_RETENTION;
  assert(
    mailBudgetMilliseconds >= workspaces.MAIL_BUDGET_WINDOW_MS,
    "a mail-budget reservation is deleted while its budget still counts it",
  );
  assert(
    requestMilliseconds >= apiAccess.LONGEST_THROTTLE_WINDOW_MILLISECONDS,
    "a throttle row is deleted while the throttle still reads it",
  );
  assertEquals(
    apiAccess.LONGEST_THROTTLE_WINDOW_MILLISECONDS,
    Math.max(
      apiAccess.ADDRESS_THROTTLE_WINDOW_MILLISECONDS,
      apiAccess.ACCOUNT_THROTTLE_WINDOW_MILLISECONDS,
    ),
  );
});
