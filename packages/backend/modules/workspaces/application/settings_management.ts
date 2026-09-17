/**
 * The settings use case.
 *
 * Ten reads and writes over three surfaces — the member's own profile, their
 * preferences, and the workspace's configuration and members — and every one
 * of them is the same three steps: open a transaction, ask the repository or
 * identity, and record what changed in the same transaction. What is left here
 * is the order and the audit vocabulary, because the rules moved to
 * `domain/settings_rules.ts` and the questions to the ports.
 *
 * The two publications are the only thing with any subtlety. Changing a
 * member's timezone, or the workspace's timezone or default reminder time,
 * moves when reminders are due; planning owns that, so it is told inside the
 * same transaction and only when the value actually changed — a save that
 * re-sends the same timezone must not reschedule everybody.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  FALLBACK_TIMEZONE,
  type ManagedMember,
  managedMembers,
  type MemberPreferences,
  memberTimezoneChanged,
  type WorkspaceConfiguration,
  type WorkspaceMemberRecord,
  workspaceScheduleChanged,
} from "../domain/settings_rules.ts";
import type { WorkspaceRole } from "../domain/roles.ts";
import type {
  SettingsActor,
  SettingsTransaction,
  SettingsTransactionRunner,
} from "../ports/context.ts";
import type {
  SettingsAudit,
  SettingsIdentityDirectory,
  SettingsPlanningPublisher,
  WorkspaceSettingsRepository,
} from "../ports/settings_repository.ts";
import type {
  IdentityAccountSettingsFacade,
  IdentityProfile,
  IdentitySessionSummary,
} from "../../identity/public.ts";

export interface SettingsManagementDependencies {
  readonly audit: SettingsAudit;
  readonly clock: Clock;
  readonly identity: IdentityAccountSettingsFacade;
  readonly identityDisplay: SettingsIdentityDirectory;
  readonly planningPublisher?: SettingsPlanningPublisher;
  readonly transaction: SettingsTransactionRunner;
  readonly workspace: WorkspaceSettingsRepository;
}

export function createSettingsManagement(
  dependencies: SettingsManagementDependencies,
) {
  const composeMembers = async (
    transaction: SettingsTransaction,
    memberships: readonly WorkspaceMemberRecord[],
  ): Promise<readonly ManagedMember[]> =>
    managedMembers(
      memberships,
      await dependencies.identityDisplay.listIdentityDisplaySummaries({
        transaction,
        userIds: memberships.map((membership) => membership.userId),
      }),
    );
  const audit = async (
    transaction: SettingsTransaction,
    actor: SettingsActor,
    action: string,
    subjectType: string,
    subjectId: string,
    payload: Readonly<Record<string, unknown>> = {},
  ): Promise<void> =>
    await dependencies.audit.record({
      action,
      actor,
      occurredAt: dependencies.clock.now(),
      payload,
      subjectId,
      subjectType,
      transaction,
    });
  return {
    getProfile: (actor: SettingsActor) =>
      dependencies.transaction.run((transaction) =>
        dependencies.identity.getProfile({ transaction, userId: actor.userId })
      ),
    updateProfile: (actor: SettingsActor, input: {
      readonly firstName: string;
      readonly lastName: string;
    }) =>
      dependencies.transaction.run(async (transaction) => {
        const profile = await dependencies.identity.updateProfile({
          ...input,
          transaction,
          userId: actor.userId,
        });
        if (!profile) return { status: "not-found" as const };
        await audit(
          transaction,
          actor,
          "member.profile-updated",
          "user",
          actor.userId,
        );
        return { profile, status: "ready" as const };
      }),
    getPreferences: (actor: SettingsActor) =>
      dependencies.transaction.run((transaction) =>
        dependencies.workspace.getPreferences({ ...actor, transaction })
      ),
    updatePreferences: (actor: SettingsActor, input: MemberPreferences) =>
      dependencies.transaction.run(async (transaction) => {
        const previous = await dependencies.workspace.getPreferences({
          ...actor,
          transaction,
        });
        const preferences = await dependencies.workspace.updatePreferences({
          ...actor,
          ...input,
          transaction,
        });
        if (preferences === "invalid-currency") {
          return { status: "invalid-currency" as const };
        }
        if (!preferences) return { status: "not-found" as const };
        await audit(
          transaction,
          actor,
          "member.preferences-updated",
          "workspace_member",
          actor.memberId,
        );
        if (memberTimezoneChanged(previous, preferences)) {
          await dependencies.planningPublisher?.timezoneChanged(
            actor,
            transaction,
          );
        }
        return { preferences, status: "ready" as const };
      }),
    listSessions: (
      actor: SettingsActor,
      currentToken: string,
    ): Promise<readonly IdentitySessionSummary[]> =>
      dependencies.transaction.run((transaction) =>
        dependencies.identity.listSessions({
          currentToken,
          now: dependencies.clock.now(),
          transaction,
          userId: actor.userId,
        })
      ),
    revokeSession: (
      actor: SettingsActor,
      currentToken: string,
      sessionId: string,
    ) =>
      dependencies.transaction.run(async (transaction) => {
        const result = await dependencies.identity.revokeOwnedSession({
          currentToken,
          now: dependencies.clock.now(),
          sessionId,
          transaction,
          userId: actor.userId,
        });
        if (result.status !== "revoked") return result;
        await audit(
          transaction,
          actor,
          "identity.session-revoked",
          "user_session",
          sessionId,
          { current: result.current },
        );
        return result;
      }),
    getWorkspace: (actor: SettingsActor) =>
      dependencies.transaction.run((transaction) =>
        dependencies.workspace.getWorkspace({ ...actor, transaction })
      ),
    updateWorkspace: (actor: SettingsActor, input: WorkspaceConfiguration) =>
      dependencies.transaction.run(async (transaction) => {
        const previous = await dependencies.workspace.getWorkspace({
          ...actor,
          transaction,
        });
        const result = await dependencies.workspace.updateWorkspace({
          ...actor,
          ...input,
          transaction,
        });
        if (typeof result === "string" || !result) return result;
        await audit(
          transaction,
          actor,
          "workspace.configuration-changed",
          "workspace",
          actor.workspaceId,
        );
        if (
          typeof previous !== "string" &&
          workspaceScheduleChanged(previous, result)
        ) {
          await dependencies.planningPublisher?.workspaceTimezoneChanged(
            actor,
            result.defaultTimezone ?? FALLBACK_TIMEZONE,
            transaction,
          );
        }
        return result;
      }),
    listMembers: (actor: SettingsActor) =>
      dependencies.transaction.run(async (transaction) => {
        const memberships = await dependencies.workspace.listMembers({
          ...actor,
          transaction,
        });
        if (typeof memberships === "string") return memberships;
        return await composeMembers(transaction, memberships);
      }),
    updateMember: (
      actor: SettingsActor,
      targetMemberId: string,
      input: {
        readonly role: WorkspaceRole;
        readonly status: "active" | "suspended";
      },
    ) =>
      dependencies.transaction.run(async (transaction) => {
        const result = await dependencies.workspace.updateMember({
          ...actor,
          newRole: input.role,
          newStatus: input.status,
          targetMemberId,
          transaction,
        });
        if (typeof result === "string") return result;
        const [member] = await composeMembers(transaction, [result]);
        if (!member) throw new Error("Updated member is unavailable.");
        await audit(
          transaction,
          actor,
          "workspace.member-updated",
          "workspace_member",
          targetMemberId,
          { role: input.role, status: input.status },
        );
        return member;
      }),
  };
}

export type SettingsManagement = ReturnType<typeof createSettingsManagement>;
export type { IdentityProfile, IdentitySessionSummary };
