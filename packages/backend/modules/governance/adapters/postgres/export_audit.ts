import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { ExportAudit } from "../../application/export_audit.ts";

export class PostgresExportAudit implements ExportAudit {
  async record(command: Parameters<ExportAudit["record"]>[0]): Promise<void> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        'data_export', ${command.exportId}::uuid,
        ${`export.${command.action}`},
        ${JSON.stringify(command.payload)}::text::jsonb,
        ${command.occurredAt}, false, ${command.occurredAt}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Export audit insert failed.");
  }

  async recordPersonDownload(
    command: Parameters<ExportAudit["recordPersonDownload"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        ${command.personId}::uuid, 'person', ${command.personId}::uuid,
        'export.downloaded', '{"format":"vcard"}'::jsonb,
        ${command.occurredAt}, false, ${command.occurredAt}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("vCard export audit insert failed.");
  }
}
