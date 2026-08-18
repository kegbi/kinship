import {
  createReminderDeliveryWorker,
  InAppReminderDelivery,
  PostgresInAppReminderEffectStore,
  PostgresReminderDeliveryRepository,
  type ReminderDeliveryWorker,
} from "../../packages/backend/modules/planning/public.ts";
import { PostgresReminderAudit } from "../../packages/backend/modules/governance/public.ts";
import { PostgresPeopleTransaction } from "../../packages/backend/modules/people/public.ts";
import { connectDatabase } from "../../packages/backend/platform/postgres/database.ts";

export function createConfiguredReminderWorker(databaseUrl: string): {
  readonly close: () => Promise<void>;
  readonly worker: ReminderDeliveryWorker;
} {
  const connection = connectDatabase(databaseUrl);
  const clock = { now: () => new Date() };
  return {
    close: connection.destroy,
    worker: createReminderDeliveryWorker({
      audit: new PostgresReminderAudit(),
      clock,
      provider: new InAppReminderDelivery(
        new PostgresInAppReminderEffectStore(connection.db, clock),
      ),
      repository: new PostgresReminderDeliveryRepository(connection.db),
      transaction: new PostgresPeopleTransaction(connection.db),
    }),
  };
}

export async function runReminderWorkerLoop(
  worker: ReminderDeliveryWorker,
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
