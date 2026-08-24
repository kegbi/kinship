import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

interface DavActor {
  readonly memberId: string;
  readonly workspaceId: string;
}
interface DavAuditEvent {
  readonly action: "configure" | "disable" | "sync";
  readonly code?: string;
  readonly occurredAt: Date;
  readonly outcome: "conflict" | "failure" | "partial" | "success";
  readonly subscriptionId: string;
}

export class PostgresDavAudit {
  async record(command: {
    readonly actor: DavActor;
    readonly event: DavAuditEvent;
    readonly transaction: { readonly opaque: unknown };
  }): Promise<void> {
    await sql`insert into crm.audit_events(
      workspace_id,actor_member_id,subject_type,subject_id,action,payload,
      occurred_at,visible_on_dashboard,created_at
    ) values (
      ${command.actor.workspaceId}::uuid,${command.actor.memberId}::uuid,
      'dav_subscription',${command.event.subscriptionId}::uuid,
      ${`integrations.dav-${command.event.action}`},
      jsonb_strip_nulls(jsonb_build_object(
        'outcome',${command.event.outcome}::text,
        'code',${command.event.code ?? null}::text)),
      ${command.event.occurredAt},false,${command.event.occurredAt}
    )`.execute(databaseFromSession(command.transaction));
  }
}
