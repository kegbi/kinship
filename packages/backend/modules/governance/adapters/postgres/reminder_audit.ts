import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  ReminderAudit,
  ReminderDeliveryAudit,
} from "../../../planning/public.ts";

export class PostgresReminderAudit
  implements ReminderAudit, ReminderDeliveryAudit {
  async record(
    command:
      | Parameters<ReminderAudit["record"]>[0]
      | Parameters<ReminderDeliveryAudit["record"]>[0],
  ): Promise<void> {
    if ("occurrence" in command) {
      const result = await sql<{ readonly inserted: boolean }>`
        with source as (
          select reminder.person_id, reminder.workspace_id
          from crm.reminder_occurrences occurrence
          join crm.reminders reminder on reminder.id = occurrence.reminder_id
          where occurrence.id = ${command.occurrence.id}::uuid
        ), inserted as (
          insert into crm.audit_events (
            workspace_id, person_id, subject_type, subject_id, action,
            payload, occurred_at, visible_on_dashboard, created_at
          ) select source.workspace_id, source.person_id, 'reminder_occurrence',
            ${command.occurrence.id}::uuid,
            ${
        command.action === "delivered"
          ? "planning.reminder-delivered"
          : "planning.reminder-failed"
      },
            ${
        JSON.stringify({
          attemptCount: command.occurrence.attemptCount,
          status: command.action,
        })
      }::jsonb,
            ${command.occurredAt}, true, ${command.occurredAt}
          from source returning 1
        ) select exists(select 1 from inserted) as inserted
      `.execute(databaseFromSession(command.transaction));
      if (!result.rows[0]?.inserted) {
        throw new Error("Reminder delivery audit insert failed.");
      }
      return;
    }
    const result = await sql<{ readonly inserted: boolean }>`
      with inserted as (
        insert into crm.audit_events (
          workspace_id, actor_member_id, subject_type, subject_id, action,
          payload, occurred_at, visible_on_dashboard, created_at
        ) values (
          ${command.actor.workspaceId}::uuid, ${command.actor.memberId}::uuid,
          ${
      command.action === "cadence-created"
        ? "stay_in_touch_cadence"
        : "reminder"
    },
          ${command.subjectId}::uuid,
          ${`planning.reminder-${command.action}`},
          ${JSON.stringify({ action: command.action })}::jsonb,
          ${command.occurredAt}, true, ${command.occurredAt}
        ) returning 1
      ) select exists(select 1 from inserted) as inserted
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]?.inserted) {
      throw new Error("Reminder audit insert failed.");
    }
  }
}
