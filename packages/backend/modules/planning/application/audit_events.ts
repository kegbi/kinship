/**
 * What `planning` says about itself in the audit history.
 *
 * Each `describe…Event` is a pure function from the use case's own audit
 * command to the row governance will write, and each `…From` adapter is the
 * few lines that hand that row to the shared-kernel recorder governance
 * implements. The module describes its own events and never depends on
 * governance to do it.
 */

import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";
import { correlationOf } from "../../../shared-kernel/telemetry.ts";
import type {
  ReminderAudit,
  ReminderDeliveryAudit,
  TaskAudit,
} from "../ports/audit.ts";

export function describeReminderEvent(
  command: Parameters<ReminderAudit["record"]>[0],
): AuditEvent {
  return {
    action: `planning.reminder-${command.action}`,
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: { action: command.action },
    subjectId: command.subjectId,
    subjectType: command.action === "cadence-created"
      ? "stay_in_touch_cadence"
      : command.action === "acknowledged"
      ? "reminder_occurrence"
      : "reminder",
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function reminderAuditFrom(
  recorder: AuditEventRecorder,
): ReminderAudit {
  return {
    record: async (command) => {
      await recorder.record({
        event: describeReminderEvent(command),
        missing: "Reminder audit insert failed.",
        transaction: command.transaction,
      });
    },
  };
}

/**
 * The delivery event belongs to the occurrence's reminder, so its workspace
 * and person travel with the claim the worker already holds rather than being
 * re-read from the reminder row by whoever writes the audit.
 */
export function describeReminderDeliveryEvent(
  command: Parameters<ReminderDeliveryAudit["record"]>[0],
): AuditEvent {
  return {
    action: command.action === "delivered"
      ? "planning.reminder-delivered"
      : "planning.reminder-failed",
    occurredAt: command.occurredAt,
    payload: {
      attemptCount: command.occurrence.attemptCount,
      ...(command.attemptKey === undefined
        ? {}
        : { attemptKey: command.attemptKey }),
      channel: command.occurrence.channel,
      ...(command.digestSize === undefined
        ? {}
        : { occurrenceCount: command.digestSize }),
      status: command.action,
    },
    personId: command.occurrence.personId,
    subjectId: command.occurrence.id,
    subjectType: "reminder_occurrence",
    visibleOnDashboard: true,
    workspaceId: command.occurrence.workspaceId,
    ...correlationOf(command),
  };
}

export function reminderDeliveryAuditFrom(
  recorder: AuditEventRecorder,
): ReminderDeliveryAudit {
  return {
    record: async (command) => {
      await recorder.record({
        event: describeReminderDeliveryEvent(command),
        missing: "Reminder delivery audit insert failed.",
        transaction: command.transaction,
      });
    },
  };
}

export function describeTaskEvent(
  command: Parameters<TaskAudit["record"]>[0],
): AuditEvent {
  return {
    action: "planning.task-created-or-state-changed",
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: { action: command.action, status: command.task.status },
    personId: command.task.personId,
    subjectId: command.task.id,
    subjectType: "task",
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function taskAuditFrom(
  recorder: AuditEventRecorder,
): TaskAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeTaskEvent(command),
        missing: "Task audit insert failed.",
        transaction: command.transaction,
      }),
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        auditId: command.auditId,
        event: describeTaskEvent(command),
        failure: "Task audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}
