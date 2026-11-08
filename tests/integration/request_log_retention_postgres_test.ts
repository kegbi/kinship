/**
 * Request-log rows live as long as something reads them (SECA-04, BEQ-15,
 * AUD-A2).
 *
 * The sign-in throttle reads an attempt for at most fifteen minutes, so one
 * run of the configured worker deletes attempts older than an hour; a
 * mail-budget reservation (AUD-M3) counts for a rolling day, so it is kept for
 * two. Any other request-log row, such as API usage, is not read by either,
 * and is kept.
 */

import { createConfiguredReminderWorker } from "../../apps/worker/composition.ts";
import { assertEquals } from "../../packages/backend/testing/assert.ts";
import { recordingLogger } from "../../packages/backend/testing/fakes.ts";
import {
  openSql,
  requireDatabaseUrl,
  resetDatabase,
} from "../support/database.ts";

const databaseUrl = requireDatabaseUrl();
const sql = openSql(databaseUrl, { prepare: false });

Deno.test({
  name:
    "[AUD-A2] one purge run deletes throttle rows past an hour and mail-budget rows past two days, and keeps the rest, API usage included",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await resetDatabase(sql, ["crm.api_request_logs"]);
    const rows: readonly (readonly [string, string, string])[] = [
      ["/api/v1/sessions", "2 hours", "sign-in-2h"],
      ["/api/v1/mfa-challenges", "61 minutes", "mfa-61m"],
      ["/api/v1/sessions", "30 minutes", "sign-in-30m"],
      ["mail-budget/registration", "23 hours", "registration-23h"],
      ["mail-budget/invitation", "47 hours", "invitation-47h"],
      ["mail-budget/registration", "49 hours", "registration-49h"],
      ["mail-budget/invitation", "3 days", "invitation-3d"],
      // API usage the throttle never reads: not the retention's to delete.
      ["/api/v1/people", "2 hours", "usage-2h"],
      ["/api/v1/sessions-export", "3 days", "usage-near-path-3d"],
    ];
    for (const [path, ago, agent] of rows) {
      await sql`
        insert into crm.api_request_logs (
          method, path, user_agent, status_code, occurred_at, created_at
        ) values (
          'POST', ${path}, ${agent}, 401, now() - ${ago}::interval,
          now() - ${ago}::interval
        )
      `;
    }

    const worker = createConfiguredReminderWorker(
      databaseUrl,
      recordingLogger(),
      { get: (name) => name === "APP_ENV" ? "test" : undefined },
    );
    try {
      await worker.worker.tick({ owner: "request-log-retention-test" });
    } finally {
      await worker.close();
    }

    const kept = await sql<{ user_agent: string }[]>`
      select user_agent from crm.api_request_logs order by user_agent
    `;
    assertEquals(kept.map((row) => row.user_agent), [
      "invitation-47h",
      "registration-23h",
      "sign-in-30m",
      "usage-2h",
      "usage-near-path-3d",
    ]);
  },
});
