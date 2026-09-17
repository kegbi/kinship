/**
 * What an invitation is, and what a member list looks like once it is joined.
 *
 * Two rules here are load-bearing. An invitation is addressed to a mailbox,
 * and the mailbox is compared without case, because nobody types their own
 * address the same way twice and an invitation that refused `Ada@Example.com`
 * for `ada@example.com` would be unusable rather than secure.
 *
 * `memberDirectory` is the other. A workspace's member list is a join between
 * rows this module owns and names the identity module owns, and a member whose
 * identity has gone is dropped rather than shown as a blank — a row with no
 * name is worse than no row. The ordering is by address and then identifier,
 * so the same workspace lists the same way for everybody and a page does not
 * reshuffle when two people share a name.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { InvitationRole, WorkspaceRole } from "./roles.ts";

/** How long an invitation link works for. */
export const INVITATION_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;

/** When an invitation issued now stops working. */
export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_WINDOW_MS);
}

/** One outstanding invitation, as an administrator sees it listed. */
export interface InvitationSummary {
  readonly createdAt: string;
  readonly email: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly role: InvitationRole;
  readonly status: "pending";
}

/** One member, as an administrator sees them listed. */
export interface WorkspaceMemberSummary {
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly role: WorkspaceRole;
  readonly status: "active";
}

/** One outstanding invitation, as the repository stores it. */
export interface WorkspaceInvitationRecord {
  readonly createdAt: Date;
  readonly email: string;
  readonly expiresAt: Date;
  readonly id: string;
  readonly role: InvitationRole;
  readonly status: "pending";
}

/** One membership, as the repository stores it. */
export interface WorkspaceMemberRecord {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly status: "active";
  readonly userId: string;
}

/** The name and address the identity module holds for a member. */
export interface MemberIdentitySummary {
  readonly email: string;
  readonly name: string;
  readonly userId: string;
}

/** What a presented invitation token turns out to be. */
export type InvitationInspection =
  | {
    readonly email: string;
    readonly role: InvitationRole;
    readonly status: "pending";
    readonly workspaceName: string;
  }
  | { readonly status: "expired" | "invalid" | "revoked" | "used" };

/** What accepting one does. */
export type InvitationAcceptance =
  | {
    readonly invitationId: string;
    readonly invitedByMemberId: string | null;
    readonly memberId: string;
    readonly role: InvitationRole;
    readonly status: "accepted";
    readonly workspaceId: string;
    readonly workspaceName: string;
  }
  | {
    readonly status:
      | "already-member"
      | "expired"
      | "invalid"
      | "revoked"
      | "used"
      | "wrong-user";
  };

/** Accepting while signed in with a just-verified identity also signs in. */
export type VerifiedEntryAcceptance = InvitationAcceptance | {
  readonly expiresAt: Date;
  readonly invitationId: string;
  readonly invitedByMemberId: string | null;
  readonly memberId: string;
  readonly role: InvitationRole;
  readonly sessionToken: string;
  readonly status: "accepted";
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
};

/** How registering from an invitation ends. */
export type InvitationRegistrationResult =
  | "delivery-failed"
  | "expired"
  | "identity-unavailable"
  | "invalid"
  | "revoked"
  | "used"
  | "verification-required"
  | "wrong-user";

/** How asking for another verification link ends. */
export type InvitationVerificationDeliveryResult =
  | "delivery-failed"
  | "expired"
  | "invalid"
  | "rate-limited"
  | "revoked"
  | "sent"
  | "used";

/** True when two addresses name the same mailbox. */
export function sameMailbox(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/** An invitation as it is listed, with its two instants as text. */
export function invitationSummary(
  record: WorkspaceInvitationRecord,
): InvitationSummary {
  return {
    ...record,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  };
}

/**
 * The member list: memberships joined to the names identity holds, in a stable
 * order, with anybody whose identity has gone left out.
 */
export function memberDirectory(
  memberships: readonly WorkspaceMemberRecord[],
  identities: readonly MemberIdentitySummary[],
): readonly WorkspaceMemberSummary[] {
  const identityById = new Map(
    identities.map((identity) => [identity.userId, identity]),
  );
  return memberships.flatMap((member) => {
    const identity = identityById.get(member.userId);
    return identity
      ? [{
        email: identity.email,
        id: member.id,
        name: identity.name,
        role: member.role,
        status: member.status,
      }]
      : [];
  }).sort((left, right) =>
    left.email.localeCompare(right.email, undefined, {
      sensitivity: "base",
    }) || left.id.localeCompare(right.id)
  );
}

/** What an administrator sees of a workspace's members and invitations. */
export type WorkspaceInvitationList =
  | Failure<"forbidden">
  | {
    readonly invitations: readonly InvitationSummary[];
    readonly members: readonly WorkspaceMemberSummary[];
    readonly status: "ready";
  };
