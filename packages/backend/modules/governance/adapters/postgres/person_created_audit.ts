import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PersonCreatedAudit } from "../../../people/public.ts";

export class PostgresPersonCreatedAudit implements PersonCreatedAudit {
  async record(
    command: Parameters<PersonCreatedAudit["record"]>[0],
  ): Promise<void> {
    await sql`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid,
        ${command.person.id}::uuid,
        'person',
        ${command.person.id}::uuid,
        'people.person-created',
        ${JSON.stringify({ isPartial: command.person.isPartial })}::jsonb,
        ${command.occurredAt},
        true,
        now()
      )
    `.execute(databaseFromSession(command.transaction));
  }

  async assertPostcondition(
    command: Parameters<PersonCreatedAudit["assertPostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 as valid
      from crm.audit_events
      where workspace_id = ${command.actor.workspaceId}::uuid
        and actor_member_id = ${command.actor.memberId}::uuid
        and person_id = ${command.person.id}::uuid
        and subject_type = 'person'
        and subject_id = ${command.person.id}::uuid
        and action = 'people.person-created'
        and payload = ${
      JSON.stringify({ isPartial: command.person.isPartial })
    }::jsonb
        and occurred_at = ${command.occurredAt}
        and visible_on_dashboard = true
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Person-created audit postcondition failed.");
    }
  }
}
