import { resolveDatabaseUrl } from "../../packages/backend/platform/postgres/config.ts";
import { jsonLogger } from "../../packages/backend/platform/telemetry/json_logger.ts";
import type { Logger } from "../../packages/backend/shared-kernel/telemetry.ts";
import {
  createConfiguredReminderWorker,
  runReminderWorkerLoop,
  type UncaughtErrorTarget,
  watchDriverFaults,
} from "./composition.ts";

type ShutdownSignal = "SIGINT" | "SIGTERM";

/**
 * What the worker process takes from its host. The entry point supplies Deno's
 * own; a test supplies recorded ones, so startup and shutdown run in-process.
 */
export interface WorkerRuntime {
  readonly configure?: (databaseUrl: string, logger: Logger) => {
    readonly close: () => Promise<void>;
    /** Replaces a connection the driver reported lost, when it can. */
    readonly reconnect?: () => Promise<void>;
    readonly worker: {
      tick(command: { readonly owner: string }): Promise<unknown>;
    };
  };
  readonly environment: { get(name: string): string | undefined };
  /**
   * Where uncaught errors are reported while the loop runs; `globalThis`
   * when absent. A driver crash reported there fails the tick in flight.
   */
  readonly faults?: UncaughtErrorTarget;
  readonly intervalMilliseconds?: number;
  /** Where job and failed-tick lines go; stdout JSON when absent. */
  readonly logger?: Logger;
  readonly randomOwner?: () => string;
  /**
   * How long a tick in flight at shutdown may take to finish before the
   * worker stops without it; five seconds, half the container's stop grace,
   * when absent.
   */
  readonly shutdownGraceMilliseconds?: number;
  readonly signals: {
    add(signal: ShutdownSignal, handler: () => void): void;
    remove(signal: ShutdownSignal, handler: () => void): void;
  };
}

const SHUTDOWN_SIGNALS: readonly ShutdownSignal[] = ["SIGTERM", "SIGINT"];

const SHUTDOWN_GRACE_MILLISECONDS = 5_000;

/**
 * Runs the worker until a shutdown signal arrives, then closes it. A tick in
 * flight at shutdown is given the grace period to finish, and closing the pool
 * whatever is left of it; a tick or a close stuck past it is left behind, so a
 * hung query never holds the process until the container is killed.
 */
export async function runWorker(runtime: WorkerRuntime): Promise<void> {
  const databaseUrl = resolveDatabaseUrl(runtime.environment);
  if (!databaseUrl) {
    throw new Error("Worker database configuration is required.");
  }
  const abort = new AbortController();
  const grace = runtime.shutdownGraceMilliseconds ??
    SHUTDOWN_GRACE_MILLISECONDS;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let endGrace = (): void => undefined;
  const graceOver = new Promise<void>((resolve) => endGrace = resolve);
  const shutdown = () => {
    if (abort.signal.aborted) return;
    abort.abort();
    graceTimer = setTimeout(endGrace, grace);
  };
  const withinGrace = (work: Promise<void>) => Promise.race([work, graceOver]);
  for (const signal of SHUTDOWN_SIGNALS) runtime.signals.add(signal, shutdown);
  const faults = watchDriverFaults(runtime.faults ?? globalThis);
  let configured:
    | ReturnType<NonNullable<WorkerRuntime["configure"]>>
    | undefined;
  const logger = runtime.logger ?? jsonLogger();
  try {
    configured = runtime.configure
      ? runtime.configure(databaseUrl, logger)
      : createConfiguredReminderWorker(
        databaseUrl,
        logger,
        runtime.environment,
      );
    await withinGrace(runReminderWorkerLoop(configured.worker, {
      faults,
      intervalMilliseconds: runtime.intervalMilliseconds ?? 5_000,
      logger,
      ...(configured.reconnect ? { reconnect: configured.reconnect } : {}),
      owner: runtime.environment.get("WORKER_INSTANCE_ID") ??
        (runtime.randomOwner ?? (() => crypto.randomUUID()))(),
      signal: abort.signal,
    }));
  } finally {
    for (const signal of SHUTDOWN_SIGNALS) {
      runtime.signals.remove(signal, shutdown);
    }
    try {
      if (configured) {
        const closing = configured.close();
        await (abort.signal.aborted ? withinGrace(closing) : closing);
      }
    } finally {
      clearTimeout(graceTimer);
      // Closing a pool the driver crashed in may still report it.
      faults.dispose();
    }
  }
}

/** The host the deployed worker runs on: Deno's environment and signals. */
export function denoWorkerRuntime(): WorkerRuntime {
  return {
    environment: Deno.env,
    signals: {
      add: (signal, handler) => Deno.addSignalListener(signal, handler),
      remove: (signal, handler) => Deno.removeSignalListener(signal, handler),
    },
  };
}

if (import.meta.main) {
  await runWorker(denoWorkerRuntime());
  // A tick or pool left behind at shutdown still holds a socket open.
  Deno.exit(0);
}
