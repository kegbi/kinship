import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { WorkspaceResetActivityAudit } from "../../../workspaces/public.ts";

export class PostgresWorkspaceResetActivityAudit
  implements WorkspaceResetActivityAudit {
  async recordReset(
    command: Parameters<WorkspaceResetActivityAudit["recordReset"]>[0],
  ): Promise<void> {
    await sql`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.workspaceId}::uuid, ${command.memberId}::uuid, 'workspace',
        ${command.workspaceId}::uuid, 'workspace.reset', '{}'::jsonb,
        ${command.occurredAt}, false, ${command.occurredAt}
      )
    `.execute(databaseFromSession(command.transaction));
  }
}
