import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { TaskAudit } from "../../../planning/public.ts";

function payload(command: Parameters<TaskAudit["record"]>[0]): string {
  return JSON.stringify({
    action: command.action,
    status: command.task.status,
  });
}

export class PostgresTaskAudit implements TaskAudit {
  async record(command: Parameters<TaskAudit["record"]>[0]): Promise<string> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
        ${command.task.personId ?? null}::uuid, 'task',
        ${command.task.id}::uuid, 'planning.task-created-or-state-changed',
        ${payload(command)}::jsonb, ${command.occurredAt}, true,
        ${command.occurredAt}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Task audit insert failed.");
    return id;
  }

  async assertPostcondition(
    command: Parameters<TaskAudit["assertPostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid
      from crm.audit_events event
      where event.id = ${command.auditId}::uuid
        and event.workspace_id = ${command.actor.workspaceId}::uuid
        and event.actor_member_id = ${command.actor.memberId}::uuid
        and event.person_id is not distinct from ${
      command.task.personId ?? null
    }::uuid
        and event.subject_type = 'task'
        and event.subject_id = ${command.task.id}::uuid
        and event.action = 'planning.task-created-or-state-changed'
        and event.payload = ${payload(command)}::jsonb
        and event.occurred_at = ${command.occurredAt}
        and event.visible_on_dashboard = true
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Task audit postcondition failed.");
    }
  }
}
