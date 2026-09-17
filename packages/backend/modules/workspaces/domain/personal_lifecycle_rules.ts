/**
 * What stops somebody leaving a workspace or deleting their account.
 *
 * One rule, and it is the whole of this file: a workspace must never be left
 * without an owner. Somebody who is the last owner of a workspace cannot leave
 * it and cannot delete their account until they have handed it over or
 * destroyed the workspace, and `blockingWorkspaces` is what names the ones in
 * the way so they can be shown rather than merely counted.
 *
 * The two confirmation phrases are here for the same reason the workspace ones
 * are: typing `DELETE` is a reflex, typing `DELETE ada@example.com` is a
 * decision, and the thing being typed is the thing being destroyed.
 */

import type { WorkspaceRole } from "./roles.ts";

/** One of somebody's memberships, with whether they are its last owner. */
export interface PersonalLifecycleMembership {
  readonly finalOwner: boolean;
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly status: "active" | "suspended";
  readonly workspaceId: string;
  readonly workspaceName: string;
}

/** A workspace named in the way of leaving or of deletion. */
export interface BlockingWorkspace {
  readonly id: string;
  readonly name: string;
}

/** The workspaces this person is the last owner of. */
export function blockingWorkspaces(
  memberships: readonly PersonalLifecycleMembership[],
): readonly BlockingWorkspace[] {
  return memberships.filter((membership) => membership.finalOwner).map(
    (membership) => ({
      id: membership.workspaceId,
      name: membership.workspaceName,
    }),
  );
}

/** The phrase somebody has to type to delete their account. */
export function deleteIdentityConfirmation(email: string): string {
  return `DELETE ${email}`;
}

/** The phrase somebody has to type to leave a workspace. */
export function leaveWorkspaceConfirmation(workspaceName: string): string {
  return `LEAVE ${workspaceName}`;
}

/**
 * The membership a request claims, out of everything this person holds.
 *
 * Both the member and the workspace have to match: a session names one
 * membership, and acting on another one because the workspace happened to
 * agree would be acting as somebody else.
 */
export function claimedMembership(
  memberships: readonly PersonalLifecycleMembership[],
  actor: { readonly memberId: string; readonly workspaceId: string },
): PersonalLifecycleMembership | undefined {
  return memberships.find((membership) =>
    membership.memberId === actor.memberId &&
    membership.workspaceId === actor.workspaceId
  );
}

/** Where somebody lands after leaving, or nothing when they are signed out. */
export function nextMembership(
  memberships: readonly PersonalLifecycleMembership[],
  left: PersonalLifecycleMembership,
): PersonalLifecycleMembership | undefined {
  return memberships.find((membership) =>
    membership.memberId !== left.memberId && membership.status === "active"
  );
}
