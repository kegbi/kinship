/**
 * The context every workspaces port is invoked in.
 *
 * This module is the one that establishes who anybody is, so it has more of
 * these shapes than any other: a dozen surfaces each name their own actor and
 * their own unit of work. They are all the same two shapes, and they are all
 * declared here rather than collapsed into one pair, because each name is part
 * of a published contract that an adapter, an app route, or another module
 * already reads. Collapsing them would make a settings repository look like it
 * could be handed an invitation's transaction.
 *
 * The transaction handle is opaque on purpose: the application layer passes it
 * from the runner to the port and never looks inside, so no use case learns
 * what database session an adapter hides in there. Several of these are also
 * handed to `identity`, whose own transaction shape is the same one — they are
 * declared structurally rather than by importing it, so a port file in this
 * directory depends on nothing outside workspaces.
 */

import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
import type { WorkspaceRole } from "../domain/roles.ts";
import type { Correlation } from "../../../shared-kernel/telemetry.ts";

/** The workspace context a signed-in request is acting in. */
export interface ActiveWorkspaceContext {
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}

/** That context, with every other workspace the same user may switch to. */
export interface ResolvedSessionContext extends ActiveWorkspaceContext {
  readonly accessibleWorkspaces: readonly ActiveWorkspaceContext[];
}

/** The unit of work the registration flow runs in. */
export interface RegistrationTransaction {
  readonly opaque: unknown;
}

export interface RegistrationTransactionRunner {
  run<T>(
    work: (transaction: RegistrationTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}

/** The unit of work a sign-in runs in. */
export interface ProtectedSessionTransaction {
  readonly opaque: unknown;
}

export interface ProtectedSessionTransactionRunner {
  run<T>(
    work: (transaction: ProtectedSessionTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}

/** Who is inviting, or listing invitations. */
export interface InvitationActor {
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  readonly workspaceId: string;
}

/** Who is reading or changing settings. */
export interface SettingsActor extends Correlation {
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  readonly workspaceId: string;
}

/** The unit of work a settings change runs in. */
export interface SettingsTransaction {
  readonly opaque: unknown;
}

export interface SettingsTransactionRunner {
  run<T>(
    work: (transaction: SettingsTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}

/** The unit of work a personalization change runs in. */
export interface PersonalizationTransaction {
  readonly opaque: unknown;
}

export interface PersonalizationTransactionRunner {
  run<T>(
    work: (transaction: PersonalizationTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}

/** Who is leaving a workspace or deleting their account. */
export interface PersonalLifecycleActor extends ActiveWorkspaceContext {}

/** The unit of work that runs in. */
export interface PersonalLifecycleTransaction {
  readonly opaque: unknown;
}

export interface PersonalLifecycleTransactionRunner {
  run<T>(
    work: (transaction: PersonalLifecycleTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}

/** Who is resetting or deleting the workspace itself. */
export interface WorkspaceLifecycleActor extends ActiveWorkspaceContext {}

/** The unit of work that runs in. */
export interface WorkspaceLifecycleTransaction {
  readonly opaque: unknown;
}

export interface WorkspaceLifecycleTransactionRunner {
  run<T>(
    work: (transaction: WorkspaceLifecycleTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}

/** Who is recording that they looked at somebody. */
export interface RecentPeopleActor {
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface RecentPeopleTransaction {
  readonly opaque: unknown;
}

export interface RecentPeopleTransactionRunner {
  run<T>(
    work: (transaction: RecentPeopleTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}

/** Who is reading or saving their own interface state. */
export interface MemberUiStateActor {
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface MemberUiStateTransaction {
  readonly opaque: unknown;
}

export interface MemberUiStateTransactionRunner {
  run<T>(
    work: (transaction: MemberUiStateTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}
