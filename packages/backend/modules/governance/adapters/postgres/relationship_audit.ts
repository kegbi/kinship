import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { RelationshipAudit } from "../../public.ts";

function edge(command: Parameters<RelationshipAudit["record"]>[0]) {
  return command.after ?? command.before;
}

function payload(command: Parameters<RelationshipAudit["record"]>[0]) {
  const relationship = edge(command);
  return JSON.stringify({
    action: command.action,
    fromPersonId: relationship?.fromPersonId,
    relationshipTypeId: relationship?.relationshipTypeId,
    toPersonId: relationship?.toPersonId,
  });
}

export class PostgresRelationshipAudit implements RelationshipAudit {
  async record(
    command: Parameters<RelationshipAudit["record"]>[0],
  ): Promise<string> {
    const relationship = edge(command);
    if (!relationship) throw new Error("Relationship audit has no edge.");
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        ${relationship.fromPersonId}::uuid, 'relationship',
        ${relationship.id}::uuid, 'relationships.relationship-changed',
        ${payload(command)}::jsonb, ${command.occurredAt}, true,
        ${command.occurredAt}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Relationship audit insert failed.");
    return id;
  }

  async assertPostcondition(
    command: Parameters<RelationshipAudit["assertPostcondition"]>[0],
  ): Promise<void> {
    const relationship = command.after ?? command.before;
    if (!relationship) {
      throw new Error("Relationship audit postcondition has no edge.");
    }
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid from crm.audit_events
      where id = ${command.auditId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and actor_member_id = ${command.actor.memberId}::uuid
        and person_id = ${relationship.fromPersonId}::uuid
        and subject_type = 'relationship'
        and subject_id = ${relationship.id}::uuid
        and action = 'relationships.relationship-changed'
        and payload = ${payload(command)}::jsonb
        and occurred_at = ${command.occurredAt}
        and visible_on_dashboard = true
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Relationship audit postcondition failed.");
    }
  }
}
