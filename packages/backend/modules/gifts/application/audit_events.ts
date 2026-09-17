/**
 * What `gifts` says about itself in the audit history.
 *
 * `describeGiftEvent` is a pure function from the use case's own audit command
 * to the row governance will write, and `giftAuditFrom` is the three lines
 * that hand that row to the shared-kernel recorder governance implements. This
 * module describes its own events and never depends on governance to do it.
 */

import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";
import type { GiftAudit } from "../ports/audit.ts";

export function describeGiftEvent(
  command: Parameters<GiftAudit["record"]>[0],
): AuditEvent {
  return {
    action: `gifts.${command.recordType}-created-or-state-changed`,
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: {
      action: command.action,
      personId: command.record.personId,
      status: command.record.status,
    },
    personId: command.record.personId,
    subjectId: command.record.id,
    subjectType: command.recordType,
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
  };
}

export function giftAuditFrom(recorder: AuditEventRecorder): GiftAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeGiftEvent(command),
        missing: "Gift audit insert failed.",
        transaction: command.transaction,
      }),
  };
}
