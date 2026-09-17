/**
 * What `files` says about itself in the audit history.
 *
 * `describeFileEvent` is a pure function from the use case's own audit command
 * to the row governance will write, and `fileAuditFrom` is the three lines
 * that hand that row to the shared-kernel recorder governance implements. This
 * module describes its own events and never depends on governance to do it.
 */

import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";
import type { FileAudit } from "../ports/audit.ts";

export function describeFileEvent(
  command: Parameters<FileAudit["record"]>[0],
): AuditEvent {
  return {
    action: `files.file-${command.action}`,
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: { kind: command.file.kind, status: command.file.status },
    personId: command.file.personId,
    subjectId: command.file.fileId,
    subjectType: "file",
    visibleOnDashboard: command.action !== "read",
    workspaceId: command.actor.workspaceId,
  };
}

export function fileAuditFrom(recorder: AuditEventRecorder): FileAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeFileEvent(command),
        missing: "File audit insert failed.",
        transaction: command.transaction,
      }),
  };
}
