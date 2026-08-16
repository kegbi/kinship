import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { ProfileFactAudit } from "../../../people/public.ts";

function target(command: Parameters<ProfileFactAudit["record"]>[0]) {
  return command.after ?? command.before;
}

function payload(command: Parameters<ProfileFactAudit["record"]>[0]) {
  const fact = target(command);
  return JSON.stringify({ action: command.action, section: fact?.section });
}

export class PostgresProfileFactAudit implements ProfileFactAudit {
  async record(
    command: Parameters<ProfileFactAudit["record"]>[0],
  ): Promise<string> {
    const fact = target(command);
    if (!fact) throw new Error("Profile-fact audit has no subject.");
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        ${command.personId}::uuid, 'person_profile_fact', ${fact.id}::uuid,
        'people.person-profile-fact-updated', ${payload(command)}::jsonb,
        ${command.occurredAt}, true, ${command.occurredAt}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Profile-fact audit insert failed.");
    return id;
  }

  async assertPostcondition(
    command: Parameters<ProfileFactAudit["assertPostcondition"]>[0],
  ): Promise<void> {
    const fact = target(command);
    if (!fact) {
      throw new Error("Profile-fact audit postcondition has no subject.");
    }
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid from crm.audit_events
      where id = ${command.auditId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and actor_member_id = ${command.actor.memberId}::uuid
        and person_id = ${command.personId}::uuid
        and subject_type = 'person_profile_fact'
        and subject_id = ${fact.id}::uuid
        and action = 'people.person-profile-fact-updated'
        and payload = ${payload(command)}::jsonb
        and occurred_at = ${command.occurredAt}
        and visible_on_dashboard = true
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Profile-fact audit postcondition failed.");
    }
  }
}
