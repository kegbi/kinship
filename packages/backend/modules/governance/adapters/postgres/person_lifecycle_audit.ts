import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  PersonLifecycleAction,
  PersonLifecycleAudit,
} from "../../../people/public.ts";

function auditAction(action: PersonLifecycleAction): string {
  return `people.person-${
    action === "archive"
      ? "archived"
      : action === "restore"
      ? "restored"
      : action === "delete"
      ? "deleted"
      : "updated"
  }`;
}

function payload(command: Parameters<PersonLifecycleAudit["record"]>[0]) {
  return JSON.stringify({
    from: command.before.lifecycle,
    to: command.person.lifecycle,
  });
}

export class PostgresPersonLifecycleAudit implements PersonLifecycleAudit {
  async record(
    command: Parameters<PersonLifecycleAudit["record"]>[0],
  ): Promise<string> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid,
        ${command.person.id}::uuid,
        'person',
        ${command.person.id}::uuid,
        ${auditAction(command.action)},
        ${payload(command)}::jsonb,
        ${command.occurredAt},
        true,
        now()
      )
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    const auditId = result.rows[0]?.id;
    if (!auditId) throw new Error("Person lifecycle audit insert failed.");
    return auditId;
  }

  async assertPostcondition(
    command: Parameters<PersonLifecycleAudit["assertPostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid
      from crm.audit_events
      where id = ${command.auditId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and actor_member_id = ${command.actor.memberId}::uuid
        and person_id = ${command.person.id}::uuid
        and subject_type = 'person'
        and subject_id = ${command.person.id}::uuid
        and action = ${auditAction(command.action)}
        and payload = ${payload(command)}::jsonb
        and occurred_at = ${command.occurredAt}
        and visible_on_dashboard = true
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error(`Person ${command.action} audit postcondition failed.`);
    }
  }
}
