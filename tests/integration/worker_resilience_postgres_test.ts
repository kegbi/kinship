/**
 * The worker survives its database connections being cut mid-pipeline
 * (BEQ-09, AUD-W2).
 *
 * When PostgreSQL terminates a backend while Postgres.js still has a write
 * queued for it, the driver throws from its own `setImmediate` callback, out of
 * reach of the tick that sent the query. This suite runs the configured worker
 * loop, entry point included, against a scratch database, cuts its backends
 * while one tick pipelines statements in a transaction beside parallel pool
 * queries, and proves the process keeps going: one failed-tick line, a fresh
 * pool, a later tick that works, and a prompt shutdown.
 */

import { type Kysely, sql as kyselySql } from "kysely";
import { runWorker } from "../../apps/worker/main.ts";
import {
  createConfiguredReminderWorker,
  type DriverFaultWatch,
  RETENTION_JOB,
  TICK_FAILURE_JOB,
  UNATTENDED_DRIVER_FAULT,
  watchDriverFaults,
} from "../../apps/worker/composition.ts";
import {
  type ApplicationDatabase,
  connectDatabase,
  type DatabaseConnection,
} from "../../packages/backend/platform/postgres/database.ts";
import { isDriverFault } from "../../packages/backend/platform/postgres/errors.ts";
import { assert, assertEquals } from "../../packages/backend/testing/assert.ts";
import { recordingLogger } from "../../packages/backend/testing/fakes.ts";
import { openSql, requireDatabaseUrl, type Sql } from "../support/database.ts";
import { withScratchCrm } from "../support/query_plan.ts";

const databaseUrl = requireDatabaseUrl();
const admin = openSql(databaseUrl, { max: 1 });

type Signal = "SIGINT" | "SIGTERM";

/** Signal registration the test fires itself. */
class RecordedSignals {
  private readonly handlers = new Map<Signal, Set<() => void>>();

  add(signal: Signal, handler: () => void): void {
    const handlers = this.handlers.get(signal) ?? new Set();
    handlers.add(handler);
    this.handlers.set(signal, handlers);
  }

  remove(signal: Signal, handler: () => void): void {
    this.handlers.get(signal)?.delete(handler);
  }

  fire(signal: Signal): void {
    for (const handler of [...(this.handlers.get(signal) ?? [])]) handler();
  }
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

/**
 * Pipelines statements inside a few transactions, beside more parallel pool
 * queries than the pool has connections, while `terminator` cuts every other
 * backend of the database until `stop` says so. Settles once every one of
 * them has, failing if any did, as a tick waits on its own work: a transaction
 * the driver crashed under writes its rollback to a connection already closed
 * and never settles.
 */
function pipelineWhileTerminated(
  database: Kysely<ApplicationDatabase>,
  terminator: Sql,
  stop: () => boolean,
): Promise<void> {
  const transactions = Array.from(
    { length: 4 },
    () =>
      database.transaction().execute(async (trx) => {
        for (let round = 0; round < 400; round += 1) {
          await Promise.all(
            Array.from(
              { length: 8 },
              (_, index) =>
                kyselySql`select ${round * 8 + index}::int as n`.execute(trx),
            ),
          );
        }
      }),
  );
  const parallel = Array.from({ length: 12 }, async () => {
    for (let round = 0; round < 100; round += 1) {
      await kyselySql`select pg_sleep(0.001)`.execute(database);
    }
  });
  const work = Promise.allSettled([...transactions, ...parallel]).then(
    (outcomes) => {
      const failed = outcomes.find((outcome) => outcome.status === "rejected");
      if (failed) throw failed.reason;
    },
  );
  let settled = false;
  work.then(() => settled = true, () => settled = true);
  void (async () => {
    // Cut for at most a second: long enough to land between a queued write
    // and its flush, short enough that the next tick's fresh pool is spared.
    const until = performance.now() + 1_000;
    await delay(20);
    while (!settled && !stop() && performance.now() < until) {
      await terminator`
        select pg_terminate_backend(pid) from pg_stat_activity
        where datname = current_database() and pid <> pg_backend_pid()
      `;
      await delay(2);
    }
  })();
  return work;
}

Deno.test("[AUD-W2] a worker whose backends are cut mid-pipeline logs one failed tick, reconnects, and keeps ticking", async () => {
  // Once `runWorker` returns, the entry point exits. Here the process goes on
  // to drop the scratch database, which cuts whatever the cut pool left
  // behind, so from then on the suite takes the driver's reports itself.
  let afterStop: DriverFaultWatch | undefined;
  try {
    await withScratchCrm(admin, databaseUrl, async ({ sql: scratch, url }) => {
      const logger = recordingLogger();
      const signals = new RecordedSignals();
      const pools: DatabaseConnection[] = [];
      const effects: string[] = [];
      let cutting = true;
      let ticks = 0;
      let stopRequestedAt = 0;
      const run = runWorker({
        configure: (configuredUrl, configuredLogger) => {
          const configured = createConfiguredReminderWorker(
            configuredUrl,
            configuredLogger,
            { get: (name) => name === "APP_ENV" ? "test" : undefined },
            (poolUrl, poolOptions) => {
              const pool = connectDatabase(poolUrl, poolOptions);
              pools.push(pool);
              return pool;
            },
          );
          return {
            close: configured.close,
            reconnect: () => {
              cutting = false;
              effects.push("reconnect");
              return configured.reconnect();
            },
            worker: {
              async tick(command) {
                ticks += 1;
                const tick = ticks;
                if (tick === 1) {
                  await pipelineWhileTerminated(
                    pools.at(-1)!.db,
                    scratch,
                    () => !cutting,
                  );
                }
                await configured.worker.tick(command);
                effects.push(`tick:${tick}`);
                if (tick === 3) {
                  stopRequestedAt = performance.now();
                  signals.fire("SIGTERM");
                }
              },
            },
          };
        },
        environment: {
          get: (name) => name === "DATABASE_URL" ? url : undefined,
        },
        intervalMilliseconds: 50,
        logger,
        randomOwner: () => "resilience",
        signals,
      });
      const stopped = await Promise.race([
        run.then(() => "stopped"),
        delay(15_000).then(() => "stuck"),
      ]);
      afterStop = watchDriverFaults(globalThis);
      assertEquals(stopped, "stopped", "the worker never came back to stop");
      assert(
        performance.now() - stopRequestedAt < 2_000,
        "the worker did not stop promptly",
      );
      assertEquals(effects, ["reconnect", "tick:2", "tick:3"]);
      assertEquals(pools.length, 2, "the cut pool was not replaced");
      // The cut pool, given up, may still report faults between ticks; those
      // are only counted, on their own line.
      const lines = logger.events.flatMap((event) =>
        event.event === "worker.job" ? [event] : []
      );
      assertEquals(lines.length, logger.events.length, "a line is not a job");
      // A tick's lines are the failed tick and the unattended faults; the
      // only other job is the retention run (AUD-A2), which the first tick
      // that gets past delivery — the one after the reconnect — starts once.
      const tickLines = lines.filter((event) => event.job === TICK_FAILURE_JOB);
      const retention = lines.filter((event) => event.job === RETENTION_JOB);
      assertEquals(
        tickLines.length + retention.length,
        lines.length,
        `a line belongs to no known job: ${JSON.stringify(logger.events)}`,
      );
      const unattended = tickLines.filter((event) =>
        event.outcome === UNATTENDED_DRIVER_FAULT
      );
      const failed = tickLines.filter((event) => !unattended.includes(event));
      assertEquals(failed.length, 1, JSON.stringify(logger.events));
      assertEquals(retention.length, 1, JSON.stringify(logger.events));
      const [retained] = retention;
      assert(retained !== undefined, "the retention run was not logged");
      assertEquals(
        { attempt: retained.attempt, outcome: retained.outcome },
        { attempt: 1, outcome: "completed" },
        JSON.stringify(logger.events),
      );
      assert(
        logger.events.indexOf(retained) > logger.events.indexOf(failed[0]!),
        "the retention run was logged before the reconnect",
      );
      const [line] = failed;
      assert(line !== undefined, "the failed tick was not logged");
      assertEquals(
        { attempt: line.attempt, job: line.job, outcome: line.outcome },
        { attempt: 1, job: TICK_FAILURE_JOB, outcome: "processing-error" },
        JSON.stringify(logger.events),
      );
      for (const reported of unattended) {
        assert(
          reported.job === TICK_FAILURE_JOB && reported.attempt > 0,
          `an unattended-fault line is malformed: ${JSON.stringify(reported)}`,
        );
      }
      for (const reported of [line, ...unattended, retained]) {
        assertEquals(
          Object.keys(reported).sort(),
          ["attempt", "duration_ms", "event", "job", "outcome", "request_id"],
          "a worker line carries more than its stable fields",
        );
      }
    });
  } finally {
    afterStop?.dispose();
  }
});

Deno.test("[AUD-W2] a statement the server rejects is not a driver fault", async () => {
  for (
    const [code, statement] of [
      ["22012", () => admin`select 1 / 0`],
      ["42P01", () => admin`select * from aud_w2_missing_relation`],
      ["22P02", () => admin`select 'not a number'::int`],
    ] as const
  ) {
    let failure: unknown;
    await statement().catch((error: unknown) => failure = error);
    assertEquals((failure as { code?: unknown }).code, code);
    assert(
      !isDriverFault(failure),
      `a ${code} the driver returned was taken for a driver fault`,
    );
  }
});

Deno.test({
  name: "[AUD-W2] worker resilience PostgreSQL resources close",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await admin.end();
  },
});
