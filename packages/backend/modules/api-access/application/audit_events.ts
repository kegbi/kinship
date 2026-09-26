/**
 * What `api-access` says about itself in the audit history.
 *
 * `describeApiTokenEvent` is a pure function from the use case's own audit
 * command to the row governance will write, and `apiTokenAuditFrom` is the
 * three lines that hand that row to the shared-kernel recorder governance
 * implements. This module describes its own events and never depends on
 * governance to do it.
 */

import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";
import { correlationOf } from "../../../shared-kernel/telemetry.ts";
import type { ApiTokenAudit } from "../ports/audit.ts";

export function describeApiTokenEvent(
  command: Parameters<ApiTokenAudit["record"]>[0],
): AuditEvent {
  return {
    action: `api-token-${command.action}`,
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: { scopes: command.record.scopes },
    subjectId: command.record.id,
    subjectType: "api_token",
    visibleOnDashboard: false,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function apiTokenAuditFrom(
  recorder: AuditEventRecorder,
): ApiTokenAudit {
  return {
    record: async (command) => {
      await recorder.record({
        event: describeApiTokenEvent(command),
        transaction: command.transaction,
      });
    },
  };
}
