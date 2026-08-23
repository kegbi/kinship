import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

interface JournalAuditCommand {
  readonly action: "created" | "deleted" | "updated";
  readonly actor: {
    readonly memberId: string;
    readonly workspaceId: string;
  };
  readonly itemId: string;
  readonly itemType: "activity" | "day-rating" | "post";
  readonly occurredAt: Date;
  readonly transaction: { readonly opaque: unknown };
}

export class PostgresJournalAudit {
  async record(command: JournalAuditCommand): Promise<string> {
    const result = await sql<{ id: string }>`
      insert into crm.audit_events (workspace_id, actor_member_id, subject_type, subject_id, action, payload, occurred_at, visible_on_dashboard, created_at)
      values (${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid, 'journal_item', ${command.itemId}::uuid,
        ${`journal.item-${command.action}`}, jsonb_build_object('itemType', ${command.itemType}::text),
        ${command.occurredAt}, true, ${command.occurredAt}) returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Journal audit insert failed.");
    return result.rows[0].id;
  }
}
