import { resolveDatabaseUrl } from "../../packages/backend/platform/postgres/config.ts";
import {
  createConfiguredReminderWorker,
  runReminderWorkerLoop,
} from "./composition.ts";

type ShutdownSignal = "SIGINT" | "SIGTERM";

/**
 * What the worker process takes from its host. The entry point supplies Deno's
 * own; a test supplies recorded ones, so startup and shutdown run in-process.
 */
export interface WorkerRuntime {
  readonly configure?: (databaseUrl: string) => {
    readonly close: () => Promise<void>;
    readonly worker: {
      tick(command: { readonly owner: string }): Promise<unknown>;
    };
  };
  readonly environment: { get(name: string): string | undefined };
  readonly intervalMilliseconds?: number;
  readonly randomOwner?: () => string;
  readonly signals: {
    add(signal: ShutdownSignal, handler: () => void): void;
    remove(signal: ShutdownSignal, handler: () => void): void;
  };
}

const SHUTDOWN_SIGNALS: readonly ShutdownSignal[] = ["SIGTERM", "SIGINT"];

/** Runs the worker until a shutdown signal arrives, then closes it. */
export async function runWorker(runtime: WorkerRuntime): Promise<void> {
  const databaseUrl = resolveDatabaseUrl(runtime.environment);
  if (!databaseUrl) {
    throw new Error("Worker database configuration is required.");
  }
  const abort = new AbortController();
  const shutdown = () => abort.abort();
  for (const signal of SHUTDOWN_SIGNALS) runtime.signals.add(signal, shutdown);
  let configured:
    | ReturnType<NonNullable<WorkerRuntime["configure"]>>
    | undefined;
  try {
    configured = runtime.configure
      ? runtime.configure(databaseUrl)
      : createConfiguredReminderWorker(
        databaseUrl,
        undefined,
        runtime.environment,
      );
    await runReminderWorkerLoop(configured.worker, {
      intervalMilliseconds: runtime.intervalMilliseconds ?? 5_000,
      owner: runtime.environment.get("WORKER_INSTANCE_ID") ??
        (runtime.randomOwner ?? (() => crypto.randomUUID()))(),
      signal: abort.signal,
    });
  } finally {
    for (const signal of SHUTDOWN_SIGNALS) {
      runtime.signals.remove(signal, shutdown);
    }
    await configured?.close();
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

if (import.meta.main) await runWorker(denoWorkerRuntime());
