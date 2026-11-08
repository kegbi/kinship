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
 *
 * Both writes refuse an unschedulable timezone before they open a
 * transaction, because a name the calendar cannot resolve would otherwise be
 * stored and only discovered when a reminder came due. The route checked this
 * with its own copy of the rule until GAP-020.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  FALLBACK_TIMEZONE,
  isSchedulableTimezone,
  type ManagedMember,
  managedMembers,
  memberDeliveryChanged,
  type MemberPreferencesUpdate,
  memberTimezoneChanged,
  type WorkspaceConfiguration,
  type WorkspaceMemberRecord,
  workspaceScheduleChanged,
} from "../domain/settings_rules.ts";
import { privileged, type WorkspaceRole } from "../domain/roles.ts";
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
import type { WorkspaceCurrencyBoundary } from "../ports/currency_boundary.ts";
import type { MemberCredentialRevocation } from "../ports/member_credentials.ts";
import type {
  IdentityAccountSettingsFacade,
  IdentityProfile,
  IdentitySessionSummary,
} from "../../identity/public.ts";

/**
 * One signed-in browser, as the transport carries it.
 *
 * The identity facade hands back `Date`s because that is what a timestamp
 * column is to it; what a caller is owed is ISO 8601 in UTC. GAP-023 moved
 * that rendering here from `apps/api/settings/sessions.ts`, so a route passes
 * this through rather than formatting anything of its own.
 */
export interface MemberSessionSummary extends
  Omit<
    IdentitySessionSummary,
    "createdAt" | "expiresAt" | "lastSeenAt"
  > {
  readonly createdAt: string;
  readonly expiresAt: string;
  readonly lastSeenAt: string;
}

/** The same session with its three instants rendered, and nothing reordered. */
function memberSession(session: IdentitySessionSummary): MemberSessionSummary {
  return {
    ...session,
    createdAt: session.createdAt.toISOString(),
    expiresAt: session.expiresAt.toISOString(),
    lastSeenAt: session.lastSeenAt.toISOString(),
  };
}

export interface SettingsManagementDependencies {
  readonly audit: SettingsAudit;
  readonly clock: Clock;
  /** The currencies a preference or workspace default may name. */
  readonly currencies: Pick<WorkspaceCurrencyBoundary, "listSupported">;
  readonly identity: IdentityAccountSettingsFacade;
  readonly identityDisplay: SettingsIdentityDirectory;
  /** Ends a suspended member's API credentials in the workspace (SECT-07). */
  readonly memberCredentials: MemberCredentialRevocation;
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
      dependencies.transaction.run(
        (transaction) =>
          dependencies.identity.getProfile({
            transaction,
            userId: actor.userId,
          }),
        { workspaceId: actor.workspaceId },
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
      }, { workspaceId: actor.workspaceId }),
    getPreferences: (actor: SettingsActor) =>
      dependencies.transaction.run(
        (transaction) =>
          dependencies.workspace.getPreferences({ ...actor, transaction }),
        { workspaceId: actor.workspaceId },
      ),
    /**
     * The currency codes a preference or workspace default may name, which is
     * what the settings forms offer to choose from.
     */
    listCurrencies: (actor: SettingsActor) =>
      dependencies.transaction.run(
        (transaction) => dependencies.currencies.listSupported({ transaction }),
        { workspaceId: actor.workspaceId },
      ),
    updatePreferences: (
      actor: SettingsActor,
      input: MemberPreferencesUpdate,
    ) => {
      if (
        input.timezone !== undefined && !isSchedulableTimezone(input.timezone)
      ) {
        return Promise.resolve({ status: "invalid-timezone" as const });
      }
      return dependencies.transaction.run(async (transaction) => {
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
        if (memberDeliveryChanged(previous, preferences)) {
          await dependencies.planningPublisher?.deliveryChanged(
            actor,
            transaction,
          );
        }
        return { preferences, status: "ready" as const };
      }, { workspaceId: actor.workspaceId });
    },
    listSessions: async (
      actor: SettingsActor,
      currentToken: string,
    ): Promise<readonly MemberSessionSummary[]> => {
      const sessions = await dependencies.transaction.run(
        (transaction) =>
          dependencies.identity.listSessions({
            currentToken,
            now: dependencies.clock.now(),
            transaction,
            userId: actor.userId,
          }),
        { workspaceId: actor.workspaceId },
      );
      return sessions.map(memberSession);
    },
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
      }, { workspaceId: actor.workspaceId }),
    // The four administrative reads and writes decide the role before their
    // first read (AUD-K5); the repository's own membership check stays as the
    // race-safe backstop.
    getWorkspace: (actor: SettingsActor) =>
      privileged(actor)
        ? dependencies.transaction.run(
          (transaction) =>
            dependencies.workspace.getWorkspace({ ...actor, transaction }),
          { workspaceId: actor.workspaceId },
        )
        : Promise.resolve("forbidden" as const),
    updateWorkspace: (actor: SettingsActor, input: WorkspaceConfiguration) => {
      if (!privileged(actor)) return Promise.resolve("forbidden" as const);
      if (
        input.defaultTimezone !== undefined &&
        !isSchedulableTimezone(input.defaultTimezone)
      ) {
        return Promise.resolve("invalid-timezone" as const);
      }
      return dependencies.transaction.run(async (transaction) => {
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
      }, { workspaceId: actor.workspaceId });
    },
    listMembers: (actor: SettingsActor) =>
      privileged(actor)
        ? dependencies.transaction.run(async (transaction) => {
          const memberships = await dependencies.workspace.listMembers({
            ...actor,
            transaction,
          });
          if (typeof memberships === "string") return memberships;
          return await composeMembers(transaction, memberships);
        }, { workspaceId: actor.workspaceId })
        : Promise.resolve("forbidden" as const),
    updateMember: (
      actor: SettingsActor,
      targetMemberId: string,
      input: {
        readonly role: WorkspaceRole;
        readonly status: "active" | "suspended";
      },
    ) =>
      privileged(actor)
        ? dependencies.transaction.run(async (transaction) => {
          const result = await dependencies.workspace.updateMember({
            ...actor,
            newRole: input.role,
            newStatus: input.status,
            targetMemberId,
            transaction,
          });
          if (typeof result === "string") return result;
          if (result.status === "suspended") {
            await dependencies.memberCredentials.revokeMemberCredentials({
              actor,
              occurredAt: dependencies.clock.now(),
              subjectUserId: result.userId,
              transaction,
            });
          }
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
        }, { workspaceId: actor.workspaceId })
        : Promise.resolve("forbidden" as const),
  };
}

export type SettingsManagement = ReturnType<typeof createSettingsManagement>;
export type { IdentityProfile, IdentitySessionSummary };
