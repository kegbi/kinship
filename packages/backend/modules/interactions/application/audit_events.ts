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
import type {
  CommunicationAudit,
  InteractionAudit,
  InteractionChangeAudit,
} from "../ports/audit.ts";

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

/**
 * An edit or a removal (MCP-D1). One action covers the four kinds and both
 * operations, the way `people.person-date-updated` covers a date's changes:
 * the payload says which (`action`, `kind`), which fields an edit supplied,
 * and whom the record names. It carries no note body, summary, call content,
 * or message text.
 */
export function describeInteractionChangeEvent(
  command: Parameters<InteractionChangeAudit["record"]>[0],
): AuditEvent {
  return {
    action: "interactions.interaction-changed",
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: {
      action: command.action,
      fields: [...command.fields],
      kind: command.kind,
      participantIds: [...command.participantIds],
    },
    personId: command.participantIds[0]!,
    subjectId: command.subjectId,
    subjectType: command.kind,
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function interactionChangeAuditFrom(
  recorder: AuditEventRecorder,
): InteractionChangeAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeInteractionChangeEvent(command),
        missing: "Interaction change audit insert failed.",
        transaction: command.transaction,
      }),
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        auditId: command.auditId,
        event: describeInteractionChangeEvent(command),
        failure: "Interaction change audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}
