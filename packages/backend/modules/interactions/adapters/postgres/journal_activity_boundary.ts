import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { JournalActivityReference } from "../../application/journal_activity_reference.ts";

export class PostgresJournalActivityBoundary
  implements JournalActivityReference {
  async inspect(
    command: Parameters<JournalActivityReference["inspect"]>[0],
  ): Promise<Awaited<ReturnType<JournalActivityReference["inspect"]>>> {
    const result = await sql<{ occurred_at: string }>`
      select to_char(activity.happened_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as occurred_at
      from crm.activities activity
      where activity.id = ${command.activityId}::uuid
        and activity.workspace_id = ${command.workspaceId}::uuid
      for share of activity
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { occurredAt: result.rows[0].occurred_at, status: "ready" }
      : { status: "not-found" };
  }
}
