import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { RegistrationAudit } from "../../../workspaces/public.ts";

export class PostgresRegistrationAudit implements RegistrationAudit {
  async recordWorkspaceCreated(
    command: Parameters<RegistrationAudit["recordWorkspaceCreated"]>[0],
  ): Promise<void> {
    await sql`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.workspaceId}::uuid, ${command.memberId}::uuid, 'workspace',
        ${command.workspaceId}::uuid, 'workspace.created', '{}'::jsonb,
        ${command.occurredAt}, true, now()
      )
    `.execute(databaseFromSession(command.transaction));
  }

  async assertWorkspaceCreatedPostcondition(
    command: Parameters<
      RegistrationAudit["assertWorkspaceCreatedPostcondition"]
    >[0],
  ): Promise<void> {
    const result = await sql<{ valid: boolean }>`
      select count(*) = 1 as valid
      from crm.audit_events
      where workspace_id = ${command.workspaceId}::uuid
        and actor_member_id = ${command.memberId}::uuid
        and subject_type = 'workspace'
        and subject_id = ${command.workspaceId}::uuid
        and action = 'workspace.created'
        and payload = '{}'::jsonb
        and occurred_at = ${command.occurredAt}
        and visible_on_dashboard = true
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Workspace audit postcondition failed.");
    }
  }
}
