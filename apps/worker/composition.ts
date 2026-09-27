/**
 * The worker composition root.
 *
 * The worker is the second deployable and composes the same modules the API
 * does, through the same per-module `compose*` functions: planning's delivery
 * loop and the workspace cleanup reconciler, over one shared context. Each
 * delivery run is logged as one redacted `worker.job` JSON line on stdout.
 * Reminder email (PLANNING-003) goes through the workspaces SMTP transport,
 * configured from the same `SMTP_*` settings the API sends verification with.
 */

import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import { jsonLogger } from "../../packages/backend/platform/telemetry/json_logger.ts";
import type { Logger } from "../../packages/backend/shared-kernel/telemetry.ts";
import type { SharedComposition } from "../../packages/backend/platform/composition.ts";
import { composeObjectStorage } from "../../packages/backend/modules/files/composition.ts";
import { governanceAuditRecorder } from "../../packages/backend/modules/governance/composition.ts";
import { peopleTransactionRunner } from "../../packages/backend/modules/people/composition.ts";
import { composeReminderDelivery } from "../../packages/backend/modules/planning/composition.ts";
import {
  activeWorkspaceResolver,
  composeReminderMail,
  composeWorkspaceCleanup,
  reminderDeliveryPreferences,
  workspaceActors,
  workspaceTransactionRunner,
} from "../../packages/backend/modules/workspaces/composition.ts";
import { resolveObjectStorageConfiguration } from "../api/file_storage_config.ts";

interface TickWorker {
  tick(command: { readonly owner: string }): Promise<unknown>;
}

export function createApplicationWorker(
  reminders: TickWorker,
  cleanup: { reconcilePendingCleanup(): Promise<unknown> },
): TickWorker {
  return {
    async tick(command) {
      await cleanup.reconcilePendingCleanup();
      return await reminders.tick(command);
    },
  };
}

export function createConfiguredReminderWorker(
  databaseUrl: string,
  logger: Logger = jsonLogger(),
): {
  readonly close: () => Promise<void>;
  readonly worker: TickWorker;
} {
  const storage = composeObjectStorage(
    resolveObjectStorageConfiguration(Deno.env),
  );
  const email = composeReminderMail(Deno.env);
  const connection = connectDatabase(databaseUrl);
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
