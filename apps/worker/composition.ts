import {
  createReminderDeliveryWorker,
  InAppReminderDelivery,
  PostgresInAppReminderEffectStore,
  PostgresReminderDeliveryRepository,
  reminderDeliveryAuditFrom,
} from "../../packages/backend/modules/planning/public.ts";
import { PostgresAuditEventRecorder } from "../../packages/backend/modules/governance/public.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";
import {
  createWorkspaceCleanupReconciler,
  PostgresActorRevalidation,
  PostgresWorkspaceLifecycleRepository,
} from "../../packages/backend/modules/workspaces/public.ts";
import {
  createObjectStorageRequestTransport,
  S3CompatibleObjectStorage,
} from "../../packages/backend/modules/files/public.ts";
import { Client as MinioClient } from "minio";
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

export function createConfiguredReminderWorker(databaseUrl: string): {
  readonly close: () => Promise<void>;
  readonly worker: TickWorker;
} {
  const connection = connectDatabase(databaseUrl);
  const clock = { now: () => new Date() };
  const storageConfiguration = resolveObjectStorageConfiguration(Deno.env);
  const storage = new S3CompatibleObjectStorage(
    new MinioClient({
      accessKey: storageConfiguration.accessKey,
      endPoint: storageConfiguration.host,
      port: storageConfiguration.port,
      secretKey: storageConfiguration.secretKey,
      transport: createObjectStorageRequestTransport(
        storageConfiguration.useSsl,
        storageConfiguration.requestTimeoutMs,
      ),
      useSSL: storageConfiguration.useSsl,
    }) as unknown as ConstructorParameters<typeof S3CompatibleObjectStorage>[0],
    storageConfiguration.bucket,
  );
  const reminders = createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(new PostgresAuditEventRecorder()),
    clock,
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(connection.db, clock),
    ),
    repository: new PostgresReminderDeliveryRepository(
      connection.db,
      new PostgresActorRevalidation(),
    ),
    transaction: new PostgresPeopleTransaction(connection.db),
  });
  const cleanup = createWorkspaceCleanupReconciler({
    clock,
    repository: new PostgresWorkspaceLifecycleRepository(connection.db),
    storage,
  });
  return {
    close: connection.destroy,
    worker: createApplicationWorker(reminders, cleanup),
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
