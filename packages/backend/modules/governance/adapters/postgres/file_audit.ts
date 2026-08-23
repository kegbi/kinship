import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

interface FileAuditCommand {
  readonly action: "read" | "removed" | "uploaded";
  readonly actor: {
    readonly memberId: string;
    readonly workspaceId: string;
  };
  readonly file: {
    readonly fileId: string;
    readonly kind: string;
    readonly personId: string;
    readonly status: string;
  };
  readonly occurredAt: Date;
  readonly transaction: { readonly opaque: unknown };
}

export class PostgresFileAudit {
  async record(command: FileAuditCommand): Promise<string> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        ${command.file.personId}::uuid, 'file', ${command.file.fileId}::uuid,
        ${`files.file-${command.action}`},
        ${
      JSON.stringify({ kind: command.file.kind, status: command.file.status })
    }::jsonb,
        ${command.occurredAt}, ${
      command.action !== "read"
    }, ${command.occurredAt}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    const id = result.rows[0]?.id;
    if (!id) throw new Error("File audit insert failed.");
    return id;
  }
}
