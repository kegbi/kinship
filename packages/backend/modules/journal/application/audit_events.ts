/**
 * What `journal` says about itself in the audit history.
 *
 * `describeJournalEvent` is a pure function from the use case's own audit
 * command to the row governance will write, and `journalAuditFrom` is the
 * three lines that hand that row to the shared-kernel recorder governance
 * implements. This module describes its own events and never depends on
 * governance to do it.
 */

import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";
import type { JournalAudit } from "../ports/audit.ts";

export function describeJournalEvent(
  command: Parameters<JournalAudit["record"]>[0],
): AuditEvent {
  return {
    action: `journal.item-${command.action}`,
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: { itemType: command.itemType },
    subjectId: command.itemId,
    subjectType: "journal_item",
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
  };
}

export function journalAuditFrom(
  recorder: AuditEventRecorder,
): JournalAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeJournalEvent(command),
        missing: "Journal audit insert failed.",
        transaction: command.transaction,
      }),
  };
}
