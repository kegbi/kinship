/**
 * What `integrations` says about itself in the audit history.
 *
 * `describeDavEvent` is a pure function from the DAV audit command to the row
 * governance will write, and `davAuditFrom` is the three lines that hand that
 * row to the shared-kernel recorder governance implements. This module
 * describes its own events and never depends on governance to do it.
 */

import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";
import { correlationOf } from "../../../shared-kernel/telemetry.ts";
import type { DavAudit, DavAuditCommand } from "../ports/audit.ts";

export function describeDavEvent(command: DavAuditCommand): AuditEvent {
  return {
    action: `integrations.dav-${command.event.action}`,
    actorMemberId: command.actor.memberId,
    occurredAt: command.event.occurredAt,
    payload: {
      ...(command.event.code === undefined ? {} : { code: command.event.code }),
      outcome: command.event.outcome,
    },
    subjectId: command.event.subscriptionId,
    subjectType: "dav_subscription",
    visibleOnDashboard: false,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function davAuditFrom(recorder: AuditEventRecorder): DavAudit {
  return {
    record: async (command) => {
      await recorder.record({
        event: describeDavEvent(command),
        transaction: command.transaction,
      });
    },
  };
}
