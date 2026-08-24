import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

interface ApiTokenAuditCommand {
  readonly action: "created" | "revoked";
  readonly actor: { readonly memberId: string; readonly workspaceId: string };
  readonly occurredAt: Date;
  readonly record: { readonly id: string; readonly scopes: readonly string[] };
  readonly transaction: { readonly opaque: unknown };
}

export class PostgresApiTokenAudit {
  async record(command: ApiTokenAuditCommand): Promise<void> {
    await sql`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        'api_token', ${command.record.id}::uuid,
        ${`api-token-${command.action}`},
        ${JSON.stringify({ scopes: command.record.scopes })}::jsonb,
        ${command.occurredAt}, false, ${command.occurredAt}
      )
    `.execute(databaseFromSession(command.transaction));
  }
}
