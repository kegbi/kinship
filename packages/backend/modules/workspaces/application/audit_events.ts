/**
 * What `workspaces` says about itself in the audit history.
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
import type { InvitationAudit } from "../ports/invitation_repository.ts";
import type { PersonalLifecycleAudit } from "../ports/personal_lifecycle.ts";
import type { AuthenticationAudit } from "../ports/session.ts";
import type { RegistrationAudit } from "../ports/registration_repository.ts";
import type { SettingsAudit } from "../ports/settings_repository.ts";
import type { WorkspaceResetActivityAudit } from "../ports/workspace_lifecycle_repository.ts";

export function describeWorkspaceCreatedEvent(
  command: Parameters<RegistrationAudit["recordWorkspaceCreated"]>[0],
): AuditEvent {
  return {
    action: "workspace.created",
    actorMemberId: command.memberId,
    occurredAt: command.occurredAt,
    payload: {},
    subjectId: command.workspaceId,
    subjectType: "workspace",
    visibleOnDashboard: true,
    workspaceId: command.workspaceId,
  };
}

export function registrationAuditFrom(
  recorder: AuditEventRecorder,
): RegistrationAudit {
  return {
    recordWorkspaceCreated: async (command) => {
      await recorder.record({
        createdAt: "now",
        event: describeWorkspaceCreatedEvent(command),
        transaction: command.transaction,
      });
    },
    assertWorkspaceCreatedPostcondition: (command) =>
      recorder.assertRecorded({
        createdAt: "now",
        event: describeWorkspaceCreatedEvent(command),
        failure: "Workspace audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}

export function describeMemberJoinedEvent(
  command: Parameters<InvitationAudit["recordMemberJoined"]>[0],
): AuditEvent {
  return {
    action: "workspace.member-joined",
    actorMemberId: command.actorMemberId,
    occurredAt: command.occurredAt,
    payload: {},
    subjectId: command.memberId,
    subjectType: "workspace_member",
    visibleOnDashboard: true,
    workspaceId: command.workspaceId,
  };
}

export function invitationAuditFrom(
  recorder: AuditEventRecorder,
): InvitationAudit {
  return {
    recordMemberJoined: async (command) => {
      await recorder.record({
        createdAt: "now",
        event: describeMemberJoinedEvent(command),
        transaction: command.transaction,
      });
    },
    assertMemberJoinedPostcondition: (command) =>
      recorder.assertRecorded({
        createdAt: "now",
        event: describeMemberJoinedEvent(command),
        failure: "Workspace member audit postcondition failed.",
        transaction: command.transaction,
      }),
  };
}

export function describeSettingsEvent(
  command: Parameters<SettingsAudit["record"]>[0],
): AuditEvent {
  return {
    action: command.action,
    actorMemberId: command.actor.memberId,
    occurredAt: command.occurredAt,
    payload: command.payload,
    subjectId: command.subjectId,
    subjectType: command.subjectType,
    visibleOnDashboard: false,
    workspaceId: command.actor.workspaceId,
  };
}

export function settingsAuditFrom(
  recorder: AuditEventRecorder,
): SettingsAudit {
  return {
    record: async (command) => {
      await recorder.record({
        createdAt: "now",
        event: describeSettingsEvent(command),
        transaction: command.transaction,
      });
    },
  };
}

export function describePersonalLifecycleEvent(
  command: Parameters<PersonalLifecycleAudit["record"]>[0],
): AuditEvent {
  return {
    action: command.action,
    actorMemberId: command.actorMemberId,
    occurredAt: command.occurredAt,
    payload: command.payload,
    subjectId: command.subjectId,
    subjectType: command.subjectType,
    visibleOnDashboard: false,
    workspaceId: command.workspaceId,
  };
}

export function personalLifecycleAuditFrom(
  recorder: AuditEventRecorder,
): PersonalLifecycleAudit {
  return {
    record: async (command) => {
      await recorder.record({
        createdAt: "now",
        event: describePersonalLifecycleEvent(command),
        transaction: command.transaction,
      });
    },
  };
}

export function describeWorkspaceResetEvent(
  command: Parameters<WorkspaceResetActivityAudit["recordReset"]>[0],
): AuditEvent {
  return {
    action: "workspace.reset",
    actorMemberId: command.memberId,
    occurredAt: command.occurredAt,
    payload: {},
    subjectId: command.workspaceId,
    subjectType: "workspace",
    visibleOnDashboard: false,
    workspaceId: command.workspaceId,
  };
}

export function workspaceResetActivityAuditFrom(
  recorder: AuditEventRecorder,
): WorkspaceResetActivityAudit {
  return {
    recordReset: async (command) => {
      await recorder.record({
        event: describeWorkspaceResetEvent(command),
        transaction: command.transaction,
      });
    },
  };
}

export function describeAuthenticationEvent(
  command: Parameters<AuthenticationAudit["record"]>[0],
): AuditEvent {
  return {
    action: `authentication.${command.outcome}`,
    actorMemberId: command.context.memberId,
    occurredAt: command.occurredAt,
    payload: {},
    subjectId: command.context.userId,
    subjectType: "user",
    visibleOnDashboard: false,
    workspaceId: command.context.workspaceId,
  };
}

/**
 * The failed-attempt event. An anonymous attempt has no workspace context, so
 * there is nothing to attribute and nothing to write: the describing function
 * still answers, and `recordFailure` keeps the guard that decides.
 */
export function describeAuthenticationFailureEvent(
  command: Parameters<AuthenticationAudit["recordFailure"]>[0],
): AuditEvent {
  return {
    action: "authentication.failed",
    actorMemberId: command.actorMemberId ?? undefined,
    occurredAt: command.occurredAt,
    payload: {},
    subjectId: command.context?.userId,
    subjectType: "user",
    visibleOnDashboard: false,
    workspaceId: command.context?.workspaceId,
  };
}

export function authenticationAuditFrom(
  recorder: AuditEventRecorder,
): AuthenticationAudit {
  return {
    record: (command) =>
      recorder.record({
        event: describeAuthenticationEvent(command),
        missing: "Authentication audit was not stored.",
        transaction: command.transaction,
      }),
    assertPostcondition: (command) =>
      recorder.assertRecorded({
        auditId: command.auditEventId,
        event: describeAuthenticationEvent(command),
        failure: "Authentication audit postcondition failed.",
        transaction: command.transaction,
      }),
    recordFailure: async (command) => {
      const auditEventId = await recorder.recordWhen({
        event: describeAuthenticationFailureEvent(command),
        transaction: command.transaction,
        when: command.context !== undefined,
      });
      if (command.context && !auditEventId) {
        throw new Error("Authentication failure audit was not stored.");
      }
      if (!command.context && auditEventId) {
        throw new Error("Anonymous authentication acquired an audit id.");
      }
      return auditEventId;
    },
    assertFailurePostcondition: async (command) => {
      if (
        (command.context !== undefined) !==
          (command.auditEventId !== undefined)
      ) {
        throw new Error("Authentication failure audit postcondition failed.");
      }
      await recorder.assertRecorded({
        auditId: command.auditEventId ?? null,
        event: describeAuthenticationFailureEvent(command),
        failure: "Authentication failure audit postcondition failed.",
        matches: command.context ? 1 : 0,
        transaction: command.transaction,
      });
    },
  };
}
