import { resolveDatabaseUrl } from "../../packages/backend/platform/postgres/config.ts";
import {
  createConfiguredReminderWorker,
  runReminderWorkerLoop,
} from "./composition.ts";

if (import.meta.main) {
  const databaseUrl = resolveDatabaseUrl(Deno.env);
  if (!databaseUrl) {
    throw new Error("Worker database configuration is required.");
  }
  const abort = new AbortController();
  Deno.addSignalListener("SIGTERM", () => abort.abort());
  Deno.addSignalListener("SIGINT", () => abort.abort());
  const configured = createConfiguredReminderWorker(databaseUrl);
  try {
    await runReminderWorkerLoop(configured.worker, {
      intervalMilliseconds: 5_000,
      owner: Deno.env.get("WORKER_INSTANCE_ID") ?? crypto.randomUUID(),
      signal: abort.signal,
    });
  } finally {
    await configured.close();
  }
}
