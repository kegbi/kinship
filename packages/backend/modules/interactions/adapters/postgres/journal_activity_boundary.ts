import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type { JournalActivityReference } from "../../application/journal_activity_reference.ts";

export class PostgresJournalActivityBoundary
  implements JournalActivityReference {
  async inspect(
    command: Parameters<JournalActivityReference["inspect"]>[0],
  ): Promise<Awaited<ReturnType<JournalActivityReference["inspect"]>>> {
    const result = await sql<{ occurred_at: string }>`
      select ${instantColumn("activity.happened_at")} as occurred_at
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
