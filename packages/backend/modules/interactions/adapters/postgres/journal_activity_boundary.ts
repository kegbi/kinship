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
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      join crm.activities activity on activity.workspace_id = workspace.id and activity.id = ${command.activityId}::uuid
      where account.id = ${command.userId}::uuid and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role} and member.status = 'active' and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid and workspace.status = 'active' and workspace.deleted_at is null
      for share of activity
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { occurredAt: result.rows[0].occurred_at, status: "ready" }
      : { status: "not-found" };
  }
}
