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

/**
 * The mail an invitation may send (SECA-03, AUD-M3). Every limit counts over
 * a rolling day, so there is no midnight to wait for and no time zone to ask
 * about.
 */
export const MAIL_BUDGET_WINDOW_MS = 24 * 60 * 60 * 1_000;
/** Invitations one workspace may send in a rolling day. */
export const INVITATION_WORKSPACE_DAILY_QUOTA = 20;
/** Invitations one address may receive in a rolling day, from every workspace. */
export const INVITATION_RECIPIENT_DAILY_CAP = 3;
/** How long an inviter's address must have been verified before they invite. */
export const INVITER_MINIMUM_VERIFIED_AGE_MS = 24 * 60 * 60 * 1_000;

/** The instant an inviter acting now must have verified their address by. */
export function inviterVerifiedBy(now: Date): Date {
  return new Date(now.getTime() - INVITER_MINIMUM_VERIFIED_AGE_MS);
}

/** When an invitation issued now stops working. */
export function invitationExpiry(now: Date): Date {
  return new Date(now.getTime() + INVITATION_WINDOW_MS);
}

/**
 * One outstanding invitation, as an administrator sees it listed: who it is
 * for, the role it grants, and who sent it (SECT-04).
 */
export interface InvitationSummary {
  readonly createdAt: string;
  readonly email: string;
  readonly expiresAt: string;
  readonly id: string;
  /** The sending member, or null when their identity is no longer available. */
  readonly invitedBy: { readonly id: string; readonly name: string } | null;
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
  /** The sending membership and its identity; null once the row has gone. */
  readonly invitedByMemberId: string | null;
  readonly invitedByUserId: string | null;
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

/**
 * How sending an invitation ends. `limit-reached` is either daily limit — the
 * workspace's or the recipient's — and never says which, nor anything about
 * the recipient's account (SECA-03).
 */
export type InvitationCreationResult =
  | "already-member"
  | "created"
  | "delivery-failed"
  | "forbidden"
  | "inviter-not-established"
  | "limit-reached";

/** How registering from an invitation ends. */
export type InvitationRegistrationResult =
  | "delivery-failed"
  | "expired"
  | "identity-unavailable"
  | "invalid"
  | "mail-limit-reached"
  | "revoked"
  | "used"
  | "verification-required"
  | "wrong-user";

/** How asking for another verification link ends. */
export type InvitationVerificationDeliveryResult =
  | "delivery-failed"
  | "expired"
  | "invalid"
  | "mail-limit-reached"
  | "rate-limited"
  | "revoked"
  | "sent"
  | "used";

/** True when two addresses name the same mailbox. */
export function sameMailbox(left: string, right: string): boolean {
  return left.toLowerCase() === right.toLowerCase();
}

/**
 * An invitation as it is listed: its two instants as text, and its sender
 * named from the identities given, or null when theirs is not among them.
 */
export function invitationSummary(
  record: WorkspaceInvitationRecord,
  identities: readonly MemberIdentitySummary[] = [],
): InvitationSummary {
  const sender = identities.find((identity) =>
    identity.userId === record.invitedByUserId
  );
  return {
    createdAt: record.createdAt.toISOString(),
    email: record.email,
    expiresAt: record.expiresAt.toISOString(),
    id: record.id,
    invitedBy: record.invitedByMemberId && sender
      ? { id: record.invitedByMemberId, name: sender.name || sender.email }
      : null,
    role: record.role,
    status: record.status,
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
