/**
 * What `gifts` says about itself in the audit history.
 *
 * `describeGiftEvent` is a pure function from the use case's own audit command
 * to the row governance will write, and `giftAuditFrom` is the lines that hand
 * that row to the shared-kernel recorder governance implements. This module
 * describes its own events and never depends on governance to do it.
 */

import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";
import { correlationOf } from "../../../shared-kernel/telemetry.ts";
import type { GiftAudit } from "../ports/audit.ts";

/** The three kinds of record this module audits. */
type GiftRecordType = Parameters<GiftAudit["record"]>[0]["recordType"];

/** The action every event about a record of this type is stored under. */
export function giftAuditAction(recordType: GiftRecordType): string {
  return `gifts.${recordType}-created-or-state-changed`;
}

/** The subject type an event about a record of this type names. */
function giftSubjectType(recordType: GiftRecordType): string {
  return recordType.replace("-", "_");
}

/** A record's status, or a recurring rule's paused state in its place. */
function statusOf(
  record: Parameters<GiftAudit["record"]>[0]["record"],
): string {
  return "status" in record
    ? record.status
    : record.active
    ? "active"
    : "paused";
}

export function describeGiftEvent(
  command: Parameters<GiftAudit["record"]>[0],
): AuditEvent {
  return {
    action: giftAuditAction(command.recordType),
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: {
      action: command.action,
      personId: command.record.personId,
      status: statusOf(command.record),
    },
    personId: command.record.personId,
    subjectId: command.record.id,
    subjectType: giftSubjectType(command.recordType),
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

/** A debt a recurring rule charged with nobody acting. */
export function describeChargedDebtEvent(
  command: Parameters<GiftAudit["recordCharged"]>[0],
): AuditEvent {
  return {
    action: giftAuditAction("debt"),
    occurredAt: command.occurredAt,
    payload: {
      action: "charged",
      personId: command.debt.personId,
      ...(command.debt.recurringDebtId
        ? { recurringDebtId: command.debt.recurringDebtId }
        : {}),
      status: command.debt.status,
    },
    personId: command.debt.personId,
    ...(command.requestId ? { requestId: command.requestId } : {}),
    subjectId: command.debt.id,
    subjectType: giftSubjectType("debt"),
    visibleOnDashboard: true,
    workspaceId: command.workspaceId,
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
    recordCharged: (command) =>
      recorder.record({
        event: describeChargedDebtEvent(command),
        missing: "Recurring debt audit insert failed.",
        transaction: command.transaction,
      }),
  };
}
