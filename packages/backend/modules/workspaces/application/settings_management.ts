import type { Clock } from "../../../shared-kernel/clock.ts";
import type {
  IdentityAccountSettingsFacade,
  IdentityProfile,
  IdentitySessionSummary,
  IdentityTransaction,
  InvitationIdentityFacade,
} from "../../identity/public.ts";

export interface SettingsTransaction extends IdentityTransaction {
  readonly opaque: unknown;
}

export interface SettingsActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface MemberPreferences {
  readonly contactNameOrder: string;
  readonly contactSortOrder: string;
  readonly currencyCode?: string;
  readonly fluidLayout: boolean;
  readonly locale: string;
  readonly measurementSystem: "imperial" | "metric";
  readonly temperatureScale: "celsius" | "fahrenheit";
  readonly timezone?: string;
}

export interface ResolvedMemberPreferences extends MemberPreferences {
  readonly effectiveTimezone: string;
}

export interface WorkspaceConfiguration {
  readonly defaultCurrencyCode?: string;
  readonly defaultLocale: string;
  readonly defaultReminderTime: string;
  readonly defaultTimezone?: string;
  readonly name: string;
  readonly slug?: string;
}

export interface ManagedMember {
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly role: SettingsActor["role"];
  readonly status: "active" | "suspended";
}

export interface WorkspaceMemberRecord {
  readonly id: string;
  readonly role: SettingsActor["role"];
  readonly status: "active" | "suspended";
  readonly userId: string;
}

export interface WorkspaceSettingsRepository {
  getPreferences(
    command: SettingsActor & {
      readonly transaction: SettingsTransaction;
    },
  ): Promise<ResolvedMemberPreferences | undefined>;
  updatePreferences(
    command: SettingsActor & MemberPreferences & {
      readonly transaction: SettingsTransaction;
    },
  ): Promise<ResolvedMemberPreferences | "invalid-currency" | undefined>;
  getWorkspace(
    command: SettingsActor & {
      readonly transaction: SettingsTransaction;
    },
  ): Promise<WorkspaceConfiguration | "forbidden" | undefined>;
  updateWorkspace(
    command: SettingsActor & WorkspaceConfiguration & {
      readonly transaction: SettingsTransaction;
    },
  ): Promise<
    | WorkspaceConfiguration
    | "conflict"
    | "forbidden"
    | "invalid-currency"
    | undefined
  >;
  listMembers(
    command: SettingsActor & {
      readonly transaction: SettingsTransaction;
    },
  ): Promise<readonly WorkspaceMemberRecord[] | "forbidden">;
  updateMember(
    command: SettingsActor & {
      readonly newRole: SettingsActor["role"];
      readonly newStatus: "active" | "suspended";
      readonly targetMemberId: string;
      readonly transaction: SettingsTransaction;
    },
  ): Promise<
    | WorkspaceMemberRecord
    | "forbidden"
    | "last-owner"
    | "not-found"
  >;
}

export interface SettingsAudit {
  record(command: {
    readonly action: string;
    readonly actor: SettingsActor;
    readonly occurredAt: Date;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly subjectId: string;
    readonly subjectType: string;
    readonly transaction: SettingsTransaction;
  }): Promise<void>;
}

export interface SettingsPlanningPublisher {
  timezoneChanged(
    actor: SettingsActor,
    transaction: SettingsTransaction,
  ): Promise<void>;
  workspaceTimezoneChanged(
    actor: SettingsActor,
    timezone: string,
    transaction: SettingsTransaction,
  ): Promise<void>;
}

export interface SettingsManagementDependencies {
  readonly audit: SettingsAudit;
  readonly clock: Clock;
  readonly identity: IdentityAccountSettingsFacade;
  readonly identityDisplay: Pick<
    InvitationIdentityFacade,
    "listIdentityDisplaySummaries"
  >;
  readonly planningPublisher?: SettingsPlanningPublisher;
  readonly transaction: {
    run<T>(work: (transaction: SettingsTransaction) => Promise<T>): Promise<T>;
  };
  readonly workspace: WorkspaceSettingsRepository;
}

export function createSettingsManagement(
  dependencies: SettingsManagementDependencies,
) {
  const composeMembers = async (
    transaction: SettingsTransaction,
    memberships: readonly WorkspaceMemberRecord[],
  ): Promise<readonly ManagedMember[]> => {
    const summaries = await dependencies.identityDisplay
      .listIdentityDisplaySummaries({
        transaction,
        userIds: memberships.map((membership) => membership.userId),
      });
    const byUserId = new Map(
      summaries.map((summary) => [summary.userId, summary]),
    );
    const roleOrder = { owner: 0, admin: 1, member: 2 } as const;
    return memberships.map((membership) => {
      const summary = byUserId.get(membership.userId);
      if (!summary) throw new Error("Identity display summary is unavailable.");
      return {
        email: summary.email,
        id: membership.id,
        name: summary.name,
        role: membership.role,
        status: membership.status,
      };
    }).sort((left, right) =>
      roleOrder[left.role] - roleOrder[right.role] ||
      left.email.localeCompare(right.email, undefined, {
        sensitivity: "base",
      }) ||
      left.id.localeCompare(right.id)
    );
  };
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
        if (previous?.timezone !== preferences.timezone) {
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
          (previous?.defaultTimezone !== result.defaultTimezone ||
            previous?.defaultReminderTime !== result.defaultReminderTime)
        ) {
          await dependencies.planningPublisher?.workspaceTimezoneChanged(
            actor,
            result.defaultTimezone ?? "UTC",
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
        readonly role: SettingsActor["role"];
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
