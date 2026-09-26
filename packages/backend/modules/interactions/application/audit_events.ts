/**
 * What `interactions` says about itself in the audit history.
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
import type { CommunicationAudit, InteractionAudit } from "../ports/audit.ts";

export function describeInteractionEvent(
  command: Parameters<InteractionAudit["record"]>[0],
): AuditEvent {
  const record = command.record;
  return {
    action: "interactions.interaction-or-note-created",
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: {
      kind: record.kind,
      participantIds: record.kind === "note"
        ? [record.person.id]
        : record.participants.map((participant) => participant.id),
    },
    personId: record.kind === "note"
      ? record.person.id
      : record.participants[0]!.id,
    subjectId: record.id,
    subjectType: record.kind,
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function interactionAuditFrom(
  recorder: AuditEventRecorder,
): InteractionAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeInteractionEvent(command),
        missing: "Interaction audit insert failed.",
        transaction: command.transaction,
      }),
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        auditId: command.auditId,
        event: describeInteractionEvent(command),
        failure: "Interaction audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}

export function describeCommunicationEvent(
  command: Parameters<CommunicationAudit["record"]>[0],
): AuditEvent {
  return {
    action: "interactions.communication-created",
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: {
      kind: command.record.kind,
      personId: command.record.person.id,
    },
    personId: command.record.person.id,
    subjectId: command.record.id,
    subjectType: command.record.kind,
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function communicationAuditFrom(
  recorder: AuditEventRecorder,
): CommunicationAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeCommunicationEvent(command),
        missing: "Communication audit insert failed.",
        transaction: command.transaction,
      }),
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        auditId: command.auditId,
        event: describeCommunicationEvent(command),
        failure: "Communication audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}
