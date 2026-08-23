import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

interface GiftAuditCommand {
  readonly action: "changed" | "created";
  readonly actor: {
    readonly memberId: string;
    readonly workspaceId: string;
  };
  readonly occurredAt: Date;
  readonly record: {
    readonly id: string;
    readonly personId: string;
    readonly status: string;
  };
  readonly recordType: "debt" | "gift";
  readonly transaction: { readonly opaque: unknown };
}

export class PostgresGiftAudit {
  async record(command: GiftAuditCommand): Promise<string> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        ${command.record.personId}::uuid, ${command.recordType},
        ${command.record.id}::uuid,
        ${`gifts.${command.recordType}-created-or-state-changed`},
        ${
      JSON.stringify({
        action: command.action,
        personId: command.record.personId,
        status: command.record.status,
      })
    }::jsonb,
        ${command.occurredAt}, true, ${command.occurredAt}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Gift audit insert failed.");
    return id;
  }
}
