import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { ImportAudit } from "../../application/import_audit.ts";

export class PostgresImportAudit implements ImportAudit {
  async record(
    command: Parameters<ImportAudit["record"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        'data_import', ${command.importId}::uuid,
        ${`import.${command.action}`},
        ${JSON.stringify(command.payload)}::text::jsonb,
        ${command.occurredAt}, false, ${command.occurredAt}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Import audit insert failed.");
  }
}
