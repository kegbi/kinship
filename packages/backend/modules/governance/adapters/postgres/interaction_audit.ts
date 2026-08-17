import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { InteractionAudit } from "../../../interactions/public.ts";

function personId(command: Parameters<InteractionAudit["record"]>[0]): string {
  return command.record.kind === "note"
    ? command.record.person.id
    : command.record.participants[0]!.id;
}

function payload(command: Parameters<InteractionAudit["record"]>[0]): string {
  return JSON.stringify({
    kind: command.record.kind,
    participantIds: command.record.kind === "note"
      ? [command.record.person.id]
      : command.record.participants.map((participant) => participant.id),
  });
}

export class PostgresInteractionAudit implements InteractionAudit {
  async record(
    command: Parameters<InteractionAudit["record"]>[0],
  ): Promise<string> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        ${personId(command)}::uuid, ${command.record.kind},
        ${command.record.id}::uuid, 'interactions.interaction-or-note-created',
        ${payload(command)}::jsonb, ${command.occurredAt}, true,
        ${command.occurredAt}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Interaction audit insert failed.");
    return id;
  }

  async assertPostcondition(
    command: Parameters<InteractionAudit["assertPostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid from crm.audit_events
      where id = ${command.auditId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and actor_member_id = ${command.actor.memberId}::uuid
        and person_id = ${personId(command)}::uuid
        and subject_type = ${command.record.kind}
        and subject_id = ${command.record.id}::uuid
        and action = 'interactions.interaction-or-note-created'
        and payload = ${payload(command)}::jsonb
        and occurred_at = ${command.occurredAt}
        and visible_on_dashboard = true
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Interaction audit postcondition failed.");
    }
  }
}
