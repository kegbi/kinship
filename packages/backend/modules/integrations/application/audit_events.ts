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
  AuditTransaction,
} from "../../../shared-kernel/audit_event.ts";
import type { DavActor, DavAuditEvent } from "./dav_sync.ts";

export interface DavAuditCommand {
  readonly actor: DavActor;
  readonly event: DavAuditEvent;
  readonly transaction: AuditTransaction;
}

/** The port the DAV repository writes its own outcomes through. */
export interface DavAudit {
  record(command: DavAuditCommand): Promise<void>;
}

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
