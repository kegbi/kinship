import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { InvitationAudit } from "../../../workspaces/public.ts";

export class PostgresInvitationAudit implements InvitationAudit {
  async recordMemberJoined(
    command: Parameters<InvitationAudit["recordMemberJoined"]>[0],
  ): Promise<void> {
    await sql`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.workspaceId}::uuid, ${command.actorMemberId}::uuid,
        'workspace_member', ${command.memberId}::uuid,
        'workspace.member-joined', '{}'::jsonb, ${command.occurredAt}, true, now()
      )
    `.execute(databaseFromSession(command.transaction));
  }

  async assertMemberJoinedPostcondition(
    command: Parameters<InvitationAudit["assertMemberJoinedPostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid from crm.audit_events
      where workspace_id = ${command.workspaceId}::uuid
        and actor_member_id = ${command.actorMemberId}::uuid
        and subject_type = 'workspace_member'
        and subject_id = ${command.memberId}::uuid
        and action = 'workspace.member-joined' and payload = '{}'::jsonb
        and occurred_at = ${command.occurredAt} and visible_on_dashboard = true
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Workspace member audit postcondition failed.");
    }
  }
}
