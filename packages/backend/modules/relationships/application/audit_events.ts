/**
 * What `relationships` says about itself in the audit history.
 *
 * `describeRelationshipEvent` is a pure function from the use case's own audit
 * command to the row governance will write, and `relationshipAuditFrom` is the
 * few lines that hand that row to the shared-kernel recorder governance
 * implements. This module describes its own events and never depends on
 * governance to do it.
 */

import type {
  AuditEvent,
  AuditEventRecorder,
} from "../../../shared-kernel/audit_event.ts";
import { correlationOf } from "../../../shared-kernel/telemetry.ts";
import type {
  RelationshipAudit,
  RelationshipAuditCommand,
} from "../ports/audit.ts";

export function describeRelationshipEvent(
  command: RelationshipAuditCommand,
): AuditEvent {
  const edge = command.after ?? command.before;
  if (!edge) throw new Error("Relationship audit has no edge.");
  return {
    action: "relationships.relationship-changed",
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: {
      action: command.action,
      fromPersonId: edge.fromPersonId,
      relationshipTypeId: edge.relationshipTypeId,
      toPersonId: edge.toPersonId,
    },
    personId: edge.fromPersonId,
    subjectId: edge.id,
    subjectType: "relationship",
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function relationshipAuditFrom(
  recorder: AuditEventRecorder,
): RelationshipAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeRelationshipEvent(command),
        missing: "Relationship audit insert failed.",
        transaction: command.transaction,
      }),
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        auditId: command.auditId,
        event: describeRelationshipEvent(command),
        failure: "Relationship audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}
