import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { ImportantDateAudit } from "../../../people/public.ts";

function dateId(command: Parameters<ImportantDateAudit["record"]>[0]) {
  return command.after?.id ?? command.before?.id;
}

function personId(command: Parameters<ImportantDateAudit["record"]>[0]) {
  return command.after?.personId ?? command.before?.personId;
}

function payload(command: Parameters<ImportantDateAudit["record"]>[0]) {
  return JSON.stringify({
    action: command.action,
    from: command.before
      ? {
        isYearApproximate: command.before.isYearApproximate,
        precision: command.before.precision,
      }
      : null,
    to: command.after
      ? {
        isYearApproximate: command.after.isYearApproximate,
        precision: command.after.precision,
      }
      : null,
  });
}

export class PostgresImportantDateAudit implements ImportantDateAudit {
  async record(
    command: Parameters<ImportantDateAudit["record"]>[0],
  ): Promise<string> {
    const subjectId = dateId(command);
    const targetPersonId = personId(command);
    if (!subjectId || !targetPersonId) {
      throw new Error("Important-date audit has no subject.");
    }
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid,
        ${targetPersonId}::uuid,
        'person_date',
        ${subjectId}::uuid,
        'people.person-date-updated',
        ${payload(command)}::jsonb,
        ${command.occurredAt}::timestamptz,
        true,
        ${command.occurredAt}::timestamptz
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Important-date audit insert failed.");
    return id;
  }

  async assertPostcondition(
    command: Parameters<ImportantDateAudit["assertPostcondition"]>[0],
  ): Promise<void> {
    const subjectId = dateId(command);
    const targetPersonId = personId(command);
    if (!subjectId || !targetPersonId) {
      throw new Error("Important-date audit postcondition has no subject.");
    }
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid
      from crm.audit_events
      where id = ${command.auditId}::uuid
        and workspace_id = ${command.actor.workspaceId}::uuid
        and actor_member_id = ${command.actor.memberId}::uuid
        and person_id = ${targetPersonId}::uuid
        and subject_type = 'person_date'
        and subject_id = ${subjectId}::uuid
        and action = 'people.person-date-updated'
        and payload = ${payload(command)}::jsonb
        and occurred_at = ${command.occurredAt}::timestamptz
        and visible_on_dashboard = true
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Important-date audit postcondition failed.");
    }
  }
}
