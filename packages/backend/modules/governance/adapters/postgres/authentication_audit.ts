import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { AuthenticationAudit } from "../../../workspaces/public.ts";

export class PostgresAuthenticationAudit implements AuthenticationAudit {
  async recordFailure(
    command: Parameters<AuthenticationAudit["recordFailure"]>[0],
  ): Promise<string | undefined> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        payload, occurred_at, visible_on_dashboard, created_at
      )
      select
        ${command.context?.workspaceId ?? null}::uuid,
        ${command.actorMemberId}::uuid, 'user',
        ${command.context?.userId ?? null}::uuid,
        'authentication.failed', '{}'::jsonb,
        ${command.occurredAt}, false, ${command.occurredAt}
      where ${command.context !== undefined}
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    const event = result.rows[0];
    if (command.context && !event) {
      throw new Error("Authentication failure audit was not stored.");
    }
    if (!command.context && event) {
      throw new Error("Anonymous authentication acquired an audit id.");
    }
    return event?.id;
  }

  async assertFailurePostcondition(
    command: Parameters<AuthenticationAudit["assertFailurePostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly count: number }>`
      select count(*)::int count
      from crm.audit_events
      where id = ${command.auditEventId ?? null}::uuid
        and workspace_id = ${command.context?.workspaceId ?? null}::uuid
        and actor_member_id is null
        and subject_type = 'user'
        and subject_id = ${command.context?.userId ?? null}::uuid
        and action = 'authentication.failed'
        and payload = '{}'::jsonb
        and occurred_at = ${command.occurredAt}
        and visible_on_dashboard = false
        and created_at = ${command.occurredAt}
    `.execute(databaseFromSession(command.transaction));
    const expectedCount = command.context ? 1 : 0;
    if (
      (command.context !== undefined) !==
        (command.auditEventId !== undefined) ||
      result.rows[0]?.count !== expectedCount
    ) {
      throw new Error("Authentication failure audit postcondition failed.");
    }
  }

  async record(
    command: Parameters<AuthenticationAudit["record"]>[0],
  ): Promise<string> {
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.context.workspaceId}::uuid,
        ${command.context.memberId}::uuid, 'user',
        ${command.context.userId}::uuid,
        ${`authentication.${command.outcome}`}, '{}'::jsonb,
        ${command.occurredAt}, false, ${command.occurredAt}
      )
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    const event = result.rows[0];
    if (!event) throw new Error("Authentication audit was not stored.");
    return event.id;
  }

  async assertPostcondition(
    command: Parameters<AuthenticationAudit["assertPostcondition"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly valid: boolean }>`
      select count(*) = 1 valid from crm.audit_events
      where id = ${command.auditEventId}::uuid
        and workspace_id = ${command.context.workspaceId}::uuid
        and actor_member_id = ${command.context.memberId}::uuid
        and subject_type = 'user'
        and subject_id = ${command.context.userId}::uuid
        and action = ${`authentication.${command.outcome}`}
        and payload = '{}'::jsonb
        and occurred_at = ${command.occurredAt}
        and visible_on_dashboard = false
        and created_at = ${command.occurredAt}
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.valid !== true) {
      throw new Error("Authentication audit postcondition failed.");
    }
  }
}
