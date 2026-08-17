import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { CommunicationAudit } from "../../../interactions/public.ts";

const payload = (command: Parameters<CommunicationAudit["record"]>[0]) =>
  JSON.stringify({
    kind: command.record.kind,
    personId: command.record.person.id,
  });

export class PostgresCommunicationAudit implements CommunicationAudit {
  async record(
    command: Parameters<CommunicationAudit["record"]>[0],
  ): Promise<string> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (workspace_id, actor_member_id, person_id,
        subject_type, subject_id, action, payload, occurred_at,
        visible_on_dashboard, created_at) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        ${command.record.person.id}::uuid, ${command.record.kind},
        ${command.record.id}::uuid, 'interactions.communication-created',
        ${
      payload(command)
    }::jsonb, ${command.occurredAt}, true, ${command.occurredAt})
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Communication audit insert failed.");
    return id;
  }

  async assertPostcondition(
    command: Parameters<CommunicationAudit["assertPostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<
      { readonly valid: boolean }
    >`select count(*) = 1 as valid
      from crm.audit_events where id = ${command.auditId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and actor_member_id = ${command.actor.memberId}::uuid
        and person_id = ${command.record.person.id}::uuid
        and subject_type = ${command.record.kind} and subject_id = ${command.record.id}::uuid
        and action = 'interactions.communication-created'
        and payload = ${
      payload(command)
    }::jsonb and occurred_at = ${command.occurredAt}
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Communication audit postcondition failed.");
    }
  }
}
