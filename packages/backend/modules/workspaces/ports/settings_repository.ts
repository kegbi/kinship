/**
 * How a workspace's own settings and its members are read and changed.
 *
 * Several methods answer with a bare string — `"forbidden"`, `"conflict"`,
 * `"invalid-currency"`, `"last-owner"` — rather than with a status object.
 * That is the repository saying what the database decided: whether the slug
 * was taken, whether the currency is one this deployment supports, and whether
 * a role change would leave the workspace without an owner are all questions
 * only a statement holding the right locks can answer, and the use case is not
 * allowed to guess at any of them beforehand.
 *
 * `SettingsPlanningPublisher` is the one outbound contract here. Changing a
 * timezone or the default reminder time moves when everybody's reminders are
 * due, and planning owns that; the change is published inside the transaction
 * that made it, so a rescheduled workspace and its reminders cannot come
 * apart.
 */

import type {
  ManagedMemberIdentity,
  MemberPreferencesUpdate,
  ResolvedMemberPreferences,
  WorkspaceConfiguration,
  WorkspaceMemberRecord,
} from "../domain/settings_rules.ts";
import type { WorkspaceRole } from "../domain/roles.ts";
import type { SettingsActor, SettingsTransaction } from "./context.ts";

export interface WorkspaceSettingsRepository {
  getPreferences(
    command: SettingsActor & {
      readonly transaction: SettingsTransaction;
    },
  ): Promise<ResolvedMemberPreferences | undefined>;
  updatePreferences(
    command: SettingsActor & MemberPreferencesUpdate & {
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
      readonly newRole: WorkspaceRole;
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

/** The names identity holds for the members this workspace lists. */
export interface SettingsIdentityDirectory {
  listIdentityDisplaySummaries(command: {
    readonly transaction: SettingsTransaction;
    readonly userIds: readonly string[];
  }): Promise<readonly ManagedMemberIdentity[]>;
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
