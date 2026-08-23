import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PersonalLifecycleAudit } from "../../../workspaces/public.ts";

export class PostgresPersonalLifecycleAudit implements PersonalLifecycleAudit {
  async record(
    command: Parameters<PersonalLifecycleAudit["record"]>[0],
  ): Promise<void> {
    await sql`
      insert into crm.audit_events (
        workspace_id, actor_member_id, subject_type, subject_id, action,
        payload, occurred_at, visible_on_dashboard, created_at
      ) values (
        ${command.workspaceId}::uuid, ${command.actorMemberId}::uuid,
        ${command.subjectType}, ${command.subjectId}::uuid, ${command.action},
        ${
      JSON.stringify(command.payload)
    }::text::jsonb, ${command.occurredAt}, false,
        now()
      )
    `.execute(databaseFromSession(command.transaction));
  }
}
