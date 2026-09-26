import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import {
  type AuditEvent,
  type AuditEventAssertion,
  type AuditEventRecorder,
  type AuditEventWrite,
  auditPayload,
  type ConditionalAuditEventWrite,
} from "../../../../shared-kernel/audit_event.ts";

/**
 * The single writer for `crm.audit_events`. It replaced twenty-two adapter
 * classes that each carried its own copy of this insert and of the
 * postcondition that re-reads it. Every statement stores and compares the
 * payload `auditPayload` builds, so an event's request correlation lands in
 * `payload.requestId` the same way on every path.
 */
export class PostgresAuditEventRecorder implements AuditEventRecorder {
  async record(command: AuditEventWrite): Promise<string> {
    const event: AuditEvent = command.event;
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${event.workspaceId ?? null}::uuid,
        ${event.actorMemberId ?? null}::uuid,
        ${event.personId ?? null}::uuid,
        ${event.subjectType},
        ${event.subjectId ?? null}::uuid,
        ${event.action},
        ${JSON.stringify(auditPayload(event))}::text::jsonb,
        ${event.occurredAt},
        ${event.visibleOnDashboard},
        ${command.createdAt === "now" ? sql`now()` : sql`${event.occurredAt}`}
      ) returning id::text
    `.execute(databaseFromSession(command.transaction));
    const id = result.rows[0]?.id;
    if (!id) throw new Error(command.missing ?? "Audit event was not stored.");
    return id;
  }

  async recordWhen(
    command: ConditionalAuditEventWrite,
  ): Promise<string | undefined> {
    const event: AuditEvent = command.event;
    const result = await sql<{ readonly id: string }>`
      insert into crm.audit_events (
        workspace_id, actor_member_id, person_id, subject_type, subject_id,
        action, payload, occurred_at, visible_on_dashboard, created_at
      )
      select
        ${event.workspaceId ?? null}::uuid,
        ${event.actorMemberId ?? null}::uuid,
        ${event.personId ?? null}::uuid,
        ${event.subjectType}::text,
        ${event.subjectId ?? null}::uuid,
        ${event.action}::text,
        ${JSON.stringify(auditPayload(event))}::text::jsonb,
        ${event.occurredAt}::timestamptz,
        ${event.visibleOnDashboard}::boolean,
        ${
      command.createdAt === "now"
        ? sql`now()`
        : sql`${event.occurredAt}::timestamptz`
    }
      where ${command.when}
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.id;
  }

  async assertRecorded(command: AuditEventAssertion): Promise<void> {
    const event: AuditEvent = command.event;
    const result = await sql<{ readonly count: number }>`
      select count(*)::int as count
      from crm.audit_events event
      where ${
      command.auditId === undefined
        ? sql`true`
        : sql`event.id = ${command.auditId}::uuid`
    }
        and event.workspace_id is not distinct from ${
      event.workspaceId ?? null
    }::uuid
        and event.actor_member_id is not distinct from ${
      event.actorMemberId ?? null
    }::uuid
        and event.person_id is not distinct from ${event.personId ?? null}::uuid
        and event.subject_type = ${event.subjectType}
        and event.subject_id is not distinct from ${
      event.subjectId ?? null
    }::uuid
        and event.action = ${event.action}
        and event.payload = ${JSON.stringify(auditPayload(event))}::text::jsonb
        and event.occurred_at = ${event.occurredAt}
        and event.visible_on_dashboard = ${event.visibleOnDashboard}
        and ${
      command.createdAt === "now"
        ? sql`true`
        : sql`event.created_at = ${event.occurredAt}`
    }
    `.execute(databaseFromSession(command.transaction));
    if (result.rows[0]?.count !== (command.matches ?? 1)) {
      throw new Error(command.failure ?? "Audit event postcondition failed.");
    }
  }
}
