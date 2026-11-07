/**
 * The worker composition root.
 *
 * The worker is the second deployable and composes the same modules the API
 * does, through the same per-module `compose*` functions: planning's delivery
 * loop, the workspace cleanup reconciler, and the recurring debts that have
 * fallen due (GIFTS-001), over one shared context. Each
 * delivery run is logged as one redacted `worker.job` JSON line on stdout.
 * Reminder email (PLANNING-003) goes through the workspaces SMTP transport,
 * configured from the same `SMTP_*` settings the API sends verification with.
 */

import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import type { EnvironmentReader } from "../../packages/backend/platform/postgres/config.ts";
import { jsonLogger } from "../../packages/backend/platform/telemetry/json_logger.ts";
import type { Logger } from "../../packages/backend/shared-kernel/telemetry.ts";
import type { SharedComposition } from "../../packages/backend/platform/composition.ts";
import { composeObjectStorage } from "../../packages/backend/modules/files/composition.ts";
import { composeRecurringDebtCharging } from "../../packages/backend/modules/gifts/composition.ts";
import { governanceAuditRecorder } from "../../packages/backend/modules/governance/composition.ts";
import { peopleTransactionRunner } from "../../packages/backend/modules/people/composition.ts";
import { composeReminderDelivery } from "../../packages/backend/modules/planning/composition.ts";
import {
  activeWorkspaceResolver,
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

/**
 * One worker tick: object cleanup, then the recurring debts that have fallen
 * due, then reminder delivery. Charging debts never throws; a rule that fails
 * is counted and retried on a later tick, so reminders are always delivered.
 */
export function createApplicationWorker(
  reminders: TickWorker,
  cleanup: { reconcilePendingCleanup(): Promise<unknown> },
  recurringDebts: { chargeDue(): Promise<unknown> } = {
    chargeDue: () => Promise.resolve(),
  },
): TickWorker {
  return {
    async tick(command) {
      await cleanup.reconcilePendingCleanup();
      await recurringDebts.chargeDue();
      return await reminders.tick(command);
    },
  };
}

/**
 * The worker over its configuration. `environment` is the process's own unless
 * a caller states one; an unset `APP_ENV` in it is production (AUD-K6).
 */
export function createConfiguredReminderWorker(
  databaseUrl: string,
  logger: Logger = jsonLogger(),
  environment: EnvironmentReader = Deno.env,
): {
  readonly close: () => Promise<void>;
  readonly worker: TickWorker;
} {
  const storage = composeObjectStorage(
    resolveObjectStorageConfiguration(environment),
  );
  const email = composeReminderMail(environment);
  const connection = connectDatabase(databaseUrl, {
    statementTimeoutMs: WORKER_STATEMENT_TIMEOUT_MS,
  });
  const shared: SharedComposition = {
    actors: workspaceActors(),
    audit: governanceAuditRecorder(),
    clock: { now: () => new Date() },
    database: connection.db,
    ids: { create: () => crypto.randomUUID() },
    peopleTransaction: peopleTransactionRunner(connection.db),
    transaction: workspaceTransactionRunner(connection.db),
    workspaceEntry: activeWorkspaceResolver(),
  };
  return {
    close: connection.destroy,
    worker: createApplicationWorker(
      composeReminderDelivery(shared, {
        deliveryPreferences: reminderDeliveryPreferences(),
        email,
        logger,
      }),
      composeWorkspaceCleanup(shared, { storage }),
      composeRecurringDebtCharging(shared, { calendar: workspaceCalendar() }),
    ),
  };
}

export async function runReminderWorkerLoop(
  worker: TickWorker,
  options: {
    readonly intervalMilliseconds: number;
    readonly owner: string;
    readonly signal: AbortSignal;
  },
): Promise<void> {
  while (!options.signal.aborted) {
    await worker.tick({ owner: options.owner });
    if (options.signal.aborted) break;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        options.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, options.intervalMilliseconds);
      options.signal.addEventListener("abort", finish, { once: true });
    });
  }
}
