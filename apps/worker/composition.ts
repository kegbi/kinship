/**
 * The worker composition root.
 *
 * The worker is the second deployable and composes the same modules the API
 * does, through the same per-module `compose*` functions: planning's delivery
 * loop, the workspace cleanup reconciler, the recurring debts that have
 * fallen due (GIFTS-001), and the hourly retention job that deletes the
 * authentication rows nobody can use any more (SECA-04, BEQ-15, AUD-A2), over
 * one shared context. Each
 * delivery run, and each tick that fails (AUD-W2), is logged as one redacted
 * `worker.job` JSON line on stdout.
 * Reminder email (PLANNING-003) goes through the workspaces SMTP transport,
 * configured from the same `SMTP_*` settings the API sends verification with.
 */

import {
  connectDatabase,
  type DatabaseConnection,
  type DatabaseOptions,
} from "../../packages/backend/platform/postgres/database.ts";
import type { EnvironmentReader } from "../../packages/backend/platform/postgres/config.ts";
import {
  isConnectionLost,
  isDriverFault,
} from "../../packages/backend/platform/postgres/errors.ts";
import { jsonLogger } from "../../packages/backend/platform/telemetry/json_logger.ts";
import type { Logger } from "../../packages/backend/shared-kernel/telemetry.ts";
import type { SharedComposition } from "../../packages/backend/platform/composition.ts";
import { composeRequestLogRetention } from "../../packages/backend/modules/api-access/composition.ts";
import { composeObjectStorage } from "../../packages/backend/modules/files/composition.ts";
import { composeRecurringDebtCharging } from "../../packages/backend/modules/gifts/composition.ts";
import {
  governanceAuditRecorder,
  governanceRequestTombstones,
} from "../../packages/backend/modules/governance/composition.ts";
import { composeAuthenticationRetention } from "../../packages/backend/modules/identity/composition.ts";
import { peopleTransactionRunner } from "../../packages/backend/modules/people/composition.ts";
import { composeReminderDelivery } from "../../packages/backend/modules/planning/composition.ts";
import {
  activeWorkspaceResolver,
  composeRegistrationRetention,
  composeReminderMail,
  composeWorkspaceCleanup,
  reminderDeliveryPreferences,
  workspaceActors,
  workspaceCalendar,
  workspaceTransactionRunner,
} from "../../packages/backend/modules/workspaces/composition.ts";
import { resolveObjectStorageConfiguration } from "../api/file_storage_config.ts";

/**
 * How long one worker statement may run (SECA-15). The API's 10 s request
 * bound exists so a request answers before the gateway's 15 s; nothing waits
 * on the worker that way, and its statements are whole-workspace work — a
 * workspace erasure deletes every row of the workspace in dependency order,
 * and replenishment extends the rolling occurrence window of every reminder —
 * that may legitimately outlast a request. A stalled statement is still cancelled, so
 * a hung database frees the worker's connection and the next tick retries.
 */
export const WORKER_STATEMENT_TIMEOUT_MS = 5 * 60_000;

interface TickWorker {
  tick(command: { readonly owner: string }): Promise<unknown>;
}

/** The job name the retention run is logged under. */
export const RETENTION_JOB = "authentication-retention";

/** How often the retention job runs: its windows are hours and days long. */
export const RETENTION_INTERVAL_MILLISECONDS = 60 * 60_000;

/**
 * The retention job (SECA-04, BEQ-15, AUD-A2): each module's purge, one after
 * another, at most once an interval, the first on the worker's first tick.
 * `purges` is read at each run, so a reconnect's rebuilt modules are used.
 *
 * It never throws. A purge that fails does not stop the others, and the run
 * is logged as one `worker.job` line — `completed`, or `processing-error` when
 * any purge failed — and retried an interval later, so a retention fault never
 * holds up reminder delivery or backs the tick loop off.
 */
export function createRetentionSchedule(
  purges: () => readonly (() => Promise<unknown>)[],
  options: {
    readonly intervalMilliseconds?: number;
    readonly logger?: Logger;
    readonly now?: () => number;
  } = {},
): { runIfDue(): Promise<void> } {
  const interval = options.intervalMilliseconds ??
    RETENTION_INTERVAL_MILLISECONDS;
  const now = options.now ?? (() => performance.now());
  let lastStarted: number | undefined;
  return {
    async runIfDue() {
      const started = now();
      if (lastStarted !== undefined && started - lastStarted < interval) {
        return;
      }
      lastStarted = started;
      let failed = false;
      for (const purge of purges()) {
        try {
          await purge();
        } catch {
          failed = true;
        }
      }
      options.logger?.log({
        event: "worker.job",
        job: RETENTION_JOB,
        request_id: crypto.randomUUID(),
        attempt: 1,
        outcome: failed ? "processing-error" : "completed",
        duration_ms: Math.max(0, Math.round(now() - started)),
      });
    },
  };
}

/**
 * One worker tick: object cleanup, then the recurring debts that have fallen
 * due, then reminder delivery, then the retention job when it is due.
 * Charging debts never throws; a rule that fails is counted and retried on a
 * later tick, so reminders are always delivered. Neither does retention.
 */
export function createApplicationWorker(
  reminders: TickWorker,
  cleanup: { reconcilePendingCleanup(): Promise<unknown> },
  recurringDebts: { chargeDue(): Promise<unknown> } = {
    chargeDue: () => Promise.resolve(),
  },
  retention: { runIfDue(): Promise<void> } = {
    runIfDue: () => Promise.resolve(),
  },
): TickWorker {
  return {
    async tick(command) {
      await cleanup.reconcilePendingCleanup();
      await recurringDebts.chargeDue();
      const delivered = await reminders.tick(command);
      await retention.runIfDue();
      return delivered;
    },
  };
}

/**
 * The worker over its configuration. `environment` is the process's own unless
 * a caller states one; an unset `APP_ENV` in it is production (AUD-K6).
 *
 * The configured worker runs over one database pool. `reconnect` replaces that
 * pool, and the modules composed over it, with a fresh one: the loop calls it
 * when the driver reports its connection lost, so the next tick starts over
 * on new connections rather than on the pool that broke. `connect` opens each
 * pool with the worker's options; it is the platform's own unless a test
 * records them.
 */
export function createConfiguredReminderWorker(
  databaseUrl: string,
  logger: Logger = jsonLogger(),
  environment: EnvironmentReader = Deno.env,
  connect: (
    databaseUrl: string,
    options: DatabaseOptions,
  ) => DatabaseConnection = connectDatabase,
): {
  readonly close: () => Promise<void>;
  readonly reconnect: () => Promise<void>;
  readonly worker: TickWorker;
} {
  const storage = composeObjectStorage(
    resolveObjectStorageConfiguration(environment),
  );
  const email = composeReminderMail(environment);
  // One schedule for the worker's life: a reconnect rebuilds the modules over
  // the new pool, but does not run the retention job again early.
  let retentionPurges: readonly (() => Promise<unknown>)[] = [];
  const retention = createRetentionSchedule(() => retentionPurges, {
    logger,
  });
  const compose = (connection: DatabaseConnection): TickWorker => {
    const shared: SharedComposition = {
      actors: workspaceActors(),
      audit: governanceAuditRecorder(),
      clock: { now: () => new Date() },
      database: connection.db,
      ids: { create: () => crypto.randomUUID() },
      peopleTransaction: peopleTransactionRunner(connection.db),
      tombstones: governanceRequestTombstones(),
      transaction: workspaceTransactionRunner(connection.db),
      workspaceEntry: activeWorkspaceResolver(),
    };
    const authentication = composeAuthenticationRetention(shared);
    const registrations = composeRegistrationRetention(shared, {
      identity: authentication.pendingRegistrations,
    });
    const requestLogs = composeRequestLogRetention(shared);
    retentionPurges = [
      () => registrations.purge(),
      authentication.purge,
      () => requestLogs.purge(),
    ];
    return createApplicationWorker(
      composeReminderDelivery(shared, {
        deliveryPreferences: reminderDeliveryPreferences(),
        email,
        logger,
      }),
      composeWorkspaceCleanup(shared, { storage }),
      composeRecurringDebtCharging(shared, { calendar: workspaceCalendar() }),
      retention,
    );
  };
  // Every pool the worker opens, its first and each reconnect, takes the
  // worker's statement timeout.
  const open = (): DatabaseConnection =>
    connect(databaseUrl, { statementTimeoutMs: WORKER_STATEMENT_TIMEOUT_MS });
  let connection = open();
  let worker = compose(connection);
  return {
    close: () => connection.destroy(),
    reconnect: () => {
      const lost = connection;
      connection = open();
      worker = compose(connection);
      // The broken pool is let go without waiting: nothing of this worker
      // runs on it any more, and a teardown that hangs must not stop ticks.
      void lost.destroy().catch(() => undefined);
      return Promise.resolve();
    },
    worker: { tick: (command) => worker.tick(command) },
  };
}

/** The job name a failed tick is logged under, whatever part of it failed. */
export const TICK_FAILURE_JOB = "worker-tick";

/**
 * The outcome of the line that counts driver faults no tick was in flight to
 * take: they cost the worker nothing, but a storm of them is worth seeing.
 */
export const UNATTENDED_DRIVER_FAULT = "unattended-driver-fault";

/** The longest a worker waits between ticks while they keep failing. */
export const MAX_TICK_BACKOFF_MILLISECONDS = 60_000;

/**
 * How long to wait before the next tick: the interval after a tick that
 * worked, doubling with each consecutive failure up to a minute, so a
 * database that is down is not asked again every interval.
 */
export function tickDelayMilliseconds(
  intervalMilliseconds: number,
  consecutiveFailures: number,
): number {
  if (consecutiveFailures === 0) return intervalMilliseconds;
  return Math.min(
    intervalMilliseconds * 2 ** Math.min(consecutiveFailures, 16),
    Math.max(intervalMilliseconds, MAX_TICK_BACKOFF_MILLISECONDS),
  );
}

/**
 * The failure a tick is ended with when the database driver crashed under it
 * from outside any promise the tick awaits. The crash it stands for is its
 * `cause`, and it is never logged.
 */
export class DriverFaultError extends Error {
  constructor(cause: unknown) {
    super("The database driver failed outside the tick.", { cause });
    this.name = "DriverFaultError";
  }
}

/** Where the runtime reports errors no code caught: `globalThis` in Deno. */
export type UncaughtErrorTarget = Pick<
  EventTarget,
  "addEventListener" | "removeEventListener"
>;

/** The part of a {@link DriverFaultWatch} the loop runs each tick through. */
export interface TickFaults {
  /** `work`, failed early by a driver crash that happens while it runs. */
  during<T>(work: Promise<T>): Promise<T>;
  /**
   * How many driver faults arrived with no tick in flight to fail since this
   * was last asked, which resets the count.
   */
  takeUnattended(): number;
}

export interface DriverFaultWatch extends TickFaults {
  /** Stops listening; the runtime's own handling applies again. */
  dispose(): void;
}

/**
 * Listens on `target` for the errors nothing caught (`error`) and the
 * rejections nothing handled (`unhandledrejection`) while the worker runs
 * (BEQ-09). Postgres.js throws from its own timers when a connection dies with
 * a write still queued, out of reach of the query that queued it, and leaves
 * that query unsettled: the tick would never end. A driver fault (see
 * `isDriverFault`) is therefore taken from the runtime, so the process lives,
 * and fails the tick in flight with a {@link DriverFaultError}, so the loop
 * logs it, reconnects, and goes on. With no tick in flight there is nothing to
 * fail: it comes from a pool already given up, or an idle connection the
 * driver replaces itself, and is only counted for the loop to report.
 *
 * Any other uncaught error is left alone and still ends the process, as it
 * always has: it is a program fault, the state it left is unknown, and the
 * container's restart policy starts over from a clean one.
 */
export function watchDriverFaults(
  target: UncaughtErrorTarget,
): DriverFaultWatch {
  const failing = new Set<(fault: DriverFaultError) => void>();
  let unattended = 0;
  const listener = (event: Event): void => {
    const fault = "reason" in event
      ? (event as PromiseRejectionEvent).reason
      : (event as ErrorEvent).error;
    if (!isDriverFault(fault)) return;
    event.preventDefault();
    if (failing.size === 0) unattended += 1;
    for (const fail of [...failing]) fail(new DriverFaultError(fault));
  };
  target.addEventListener("error", listener);
  target.addEventListener("unhandledrejection", listener);
  return {
    during: (work) =>
      new Promise((resolve, reject) => {
        // A tick the driver failed is no longer in flight, even though the
        // work it left behind may never settle.
        const fail = (fault: DriverFaultError): void => {
          failing.delete(fail);
          reject(fault);
        };
        failing.add(fail);
        work.then(resolve, reject).finally(() => failing.delete(fail));
      }),
    takeUnattended: () => {
      const taken = unattended;
      unattended = 0;
      return taken;
    },
    dispose: () => {
      target.removeEventListener("error", listener);
      target.removeEventListener("unhandledrejection", listener);
      failing.clear();
    },
  };
}

/**
 * Runs ticks until `signal` aborts. A tick that throws is one failed tick,
 * not the end of the process (BEQ-09): it is logged as one `worker.job` line
 * carrying a stable outcome code and never the error, the next tick waits
 * longer with each consecutive failure, and when the driver reports that its
 * connection is gone, or crashed under the tick (`faults`), the pool is
 * rebuilt first. Driver faults that arrived between ticks are reported as at
 * most one counted line before each tick and once at the end.
 */
export async function runReminderWorkerLoop(
  worker: TickWorker,
  options: {
    /** Fails a tick the driver crashed under; see `watchDriverFaults`. */
    readonly faults?: TickFaults;
    readonly intervalMilliseconds: number;
    readonly logger?: Logger;
    readonly owner: string;
    /** Replaces a database connection the driver reported closed. */
    readonly reconnect?: () => Promise<void>;
    readonly signal: AbortSignal;
  },
): Promise<void> {
  let failures = 0;
  const reportUnattended = (): void => {
    const unattended = options.faults?.takeUnattended() ?? 0;
    if (unattended === 0) return;
    options.logger?.log({
      event: "worker.job",
      job: TICK_FAILURE_JOB,
      request_id: crypto.randomUUID(),
      attempt: unattended,
      outcome: UNATTENDED_DRIVER_FAULT,
      duration_ms: 0,
    });
  };
  while (!options.signal.aborted) {
    reportUnattended();
    const started = performance.now();
    try {
      const tick = worker.tick({ owner: options.owner });
      await (options.faults ? options.faults.during(tick) : tick);
      failures = 0;
    } catch (error) {
      failures += 1;
      options.logger?.log({
        event: "worker.job",
        job: TICK_FAILURE_JOB,
        request_id: crypto.randomUUID(),
        attempt: failures,
        outcome: "processing-error",
        duration_ms: Math.round(performance.now() - started),
      });
      if (
        options.reconnect &&
        (error instanceof DriverFaultError || isConnectionLost(error))
      ) {
        // A reconnect that fails leaves the next tick to fail and try again.
        await options.reconnect().catch(() => undefined);
      }
    }
    if (options.signal.aborted) break;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(
        finish,
        tickDelayMilliseconds(options.intervalMilliseconds, failures),
      );
      options.signal.addEventListener("abort", finish, { once: true });
    });
  }
  reportUnattended();
}
