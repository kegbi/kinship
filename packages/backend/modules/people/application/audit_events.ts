/**
 * What `people` says about itself in the audit history.
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
import type { PersonLifecycleAction } from "../domain/lifecycle_rules.ts";
import type {
  ImportantDateAudit,
  PersonAvatarAudit,
  PersonCreatedAudit,
  PersonLifecycleAudit,
  ProfileFactAudit,
} from "../ports/audit.ts";

export function describePersonCreatedEvent(
  command: Parameters<PersonCreatedAudit["record"]>[0],
): AuditEvent {
  return {
    action: "people.person-created",
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: { isPartial: command.person.isPartial },
    personId: command.person.id,
    subjectId: command.person.id,
    subjectType: "person",
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function personCreatedAuditFrom(
  recorder: AuditEventRecorder,
): PersonCreatedAudit {
  return {
    record: async (command) => {
      await recorder.record({
        createdAt: "now",
        event: describePersonCreatedEvent(command),
        transaction: command.transaction,
      });
    },
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        createdAt: "now",
        event: describePersonCreatedEvent(command),
        failure: "Person-created audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}

function lifecycleAction(action: PersonLifecycleAction): string {
  return `people.person-${
    action === "archive"
      ? "archived"
      : action === "restore"
      ? "restored"
      : action === "delete"
      ? "deleted"
      : "updated"
  }`;
}

export function describePersonLifecycleEvent(
  command: Parameters<PersonLifecycleAudit["record"]>[0],
): AuditEvent {
  return {
    action: lifecycleAction(command.action),
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: {
      from: command.before.lifecycle,
      to: command.person.lifecycle,
    },
    personId: command.person.id,
    subjectId: command.person.id,
    subjectType: "person",
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function personLifecycleAuditFrom(
  recorder: AuditEventRecorder,
): PersonLifecycleAudit {
  return {
    record: (command) =>
      recorder.record({
        createdAt: "now",
        event: describePersonLifecycleEvent(command),
        missing: "Person lifecycle audit insert failed.",
        transaction: command.transaction,
      }),
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        auditId: command.auditId,
        createdAt: "now",
        event: describePersonLifecycleEvent(command),
        failure: `Person ${command.action} audit postcondition failed.`,
        transaction: command.transaction,
      }),
  };
}

export function describeImportantDateEvent(
  command: Parameters<ImportantDateAudit["record"]>[0],
): AuditEvent {
  const subjectId = command.after?.id ?? command.before?.id;
  const personId = command.after?.personId ?? command.before?.personId;
  if (!subjectId || !personId) {
    throw new Error("Important-date audit has no subject.");
  }
  return {
    action: "people.person-date-updated",
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: {
      action: command.action,
      from: command.before
        ? {
          isYearApproximate: command.before.isYearApproximate,
          precision: command.before.precision,
        }
        : null,
      to: command.after
        ? {
          isYearApproximate: command.after.isYearApproximate,
          precision: command.after.precision,
        }
        : null,
    },
    personId,
    subjectId,
    subjectType: "person_date",
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function importantDateAuditFrom(
  recorder: AuditEventRecorder,
): ImportantDateAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeImportantDateEvent(command),
        missing: "Important-date audit insert failed.",
        transaction: command.transaction,
      }),
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        auditId: command.auditId,
        event: describeImportantDateEvent(command),
        failure: "Important-date audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}

export function describeProfileFactEvent(
  command: Parameters<ProfileFactAudit["record"]>[0],
): AuditEvent {
  const fact = command.after ?? command.before;
  if (!fact) throw new Error("Profile-fact audit has no subject.");
  return {
    action: "people.person-profile-fact-updated",
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: { action: command.action, section: fact.section },
    personId: command.personId,
    subjectId: fact.id,
    subjectType: "person_profile_fact",
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function profileFactAuditFrom(
  recorder: AuditEventRecorder,
): ProfileFactAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeProfileFactEvent(command),
        missing: "Profile-fact audit insert failed.",
        transaction: command.transaction,
      }),
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        auditId: command.auditId,
        event: describeProfileFactEvent(command),
        failure: "Profile-fact audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}

/**
 * A person's avatar changed (GAP-045). The payload is empty: the image is the
 * files module's record, and `files.file-uploaded` already names it.
 */
export function describePersonAvatarEvent(
  command: Parameters<PersonAvatarAudit["record"]>[0],
): AuditEvent {
  return {
    action: `people.avatar-${command.action}`,
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: {},
    personId: command.personId,
    subjectId: command.personId,
    subjectType: "person",
    visibleOnDashboard: true,
    workspaceId: command.actor.workspaceId,
    ...correlationOf(command.actor),
  };
}

export function personAvatarAuditFrom(
  recorder: AuditEventRecorder,
): PersonAvatarAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describePersonAvatarEvent(command),
        missing: "Person avatar audit insert failed.",
        transaction: command.transaction,
      }),
  };
}
