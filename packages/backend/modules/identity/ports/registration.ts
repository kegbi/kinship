/**
 * How a registration becomes a pending identity.
 *
 * A registration writes a user who cannot sign in yet and the verification
 * token that will let them, in one statement, so a user can never exist
 * without a way to prove the address. `assertPendingUserPostconditions` is the
 * paranoid half of the same write: the registration flow re-reads what it
 * wrote inside the same transaction, so a silently partial insert unwinds
 * instead of leaving somebody stranded.
 *
 * The pending user also remembers the browser that registered (SECA-01): the
 * raw `registrantVerifier` lives only in that browser's cookie, and only its
 * digest is stored. A verification that cannot present it still proves the
 * address, but it does not keep the password the registrant chose.
 *
 * `claimRegistrationAddress` decides what a registration may do with an
 * address, under a lock held to the end of the transaction. An address whose
 * only account is a pending registration may be replaced — whoever registered
 * first does not get to keep it — and `discardPendingUser` removes that
 * account with its tokens and handoffs. An address that already belongs to
 * somebody is never touched; `createExistingAccountRecovery` gives its owner
 * a reset link instead, and the caller never learns which of the two
 * happened.
 *
 * `createRetryVerificationToken` is what a request for another link does. It
 * never says whether the address was already registered — that answer belongs
 * to the person holding the mailbox, not to the caller.
 *
 * A pending user can carry a `registrationIntent` (SECA-04, AUD-A2): the name
 * of the first workspace the registering module will provision once the
 * address is proved. It is kept verbatim in the user's `pending_workspace_name`
 * (schema v13: trimmed, 1 to 120 characters), handed back by the verification
 * that proves the address, and cleared by it, so it is provisioned at most
 * once. Identity never interprets it. An invitee, and a pending user from
 * before AUD-A2, carries none.
 * `listStalePendingUsers` names the pending registrations old enough to be
 * discarded, so the module that registered them can decide which may go.
 */

import type { IdentityTransaction } from "./context.ts";

export interface CreatePendingUserCommand {
  readonly email: string;
  readonly expiresAt: Date;
  readonly firstName: string;
  readonly lastName: string;
  readonly passwordHash: string;
  /** The raw secret in the registering browser's cookie; stored hashed. */
  readonly registrantVerifier: string;
  /** The first workspace's name, kept on the user until it is proved. */
  readonly registrationIntent?: string;
  readonly tokenHash: string;
  readonly transaction: IdentityTransaction;
  readonly userId: string;
  readonly verificationTokenId: string;
}

export interface PendingUser {
  readonly userId: string;
}

/** A pending registration old enough to be discarded. */
export interface StalePendingUser {
  readonly email: string;
  readonly userId: string;
}

/** What a registration may do with an address. */
export type RegistrationAddressClaim =
  | { readonly status: "available" }
  | { readonly status: "pending"; readonly userId: string }
  | { readonly status: "registered" };

export interface IdentityRegistrationFacade {
  claimRegistrationAddress(command: {
    readonly email: string;
    readonly transaction: IdentityTransaction;
  }): Promise<RegistrationAddressClaim>;
  discardPendingUser(command: {
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<void>;
  createExistingAccountRecovery(command: {
    readonly email: string;
    readonly id: string;
    readonly now: Date;
    readonly tokenHash: string;
    readonly transaction: IdentityTransaction;
  }): Promise<
    { readonly email: string; readonly expiresAt: Date } | undefined
  >;
  createPendingUser(command: CreatePendingUserCommand): Promise<PendingUser>;
  assertPendingUserPostconditions(command: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly firstName: string;
    readonly lastName: string;
    readonly passwordHash: string;
    readonly registrationIntent?: string;
    readonly tokenHash: string;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
    readonly verificationTokenId: string;
  }): Promise<void>;
  createRetryVerificationToken(command: {
    readonly createdAt: Date;
    readonly email: string;
    readonly expiresAt: Date;
    readonly tokenHash: string;
    readonly transaction: IdentityTransaction;
    readonly verificationTokenId: string;
  }): Promise<
    { readonly email: string; readonly created: boolean } | undefined
  >;
}

/**
 * How the pending registrations nobody verified are let go (SECA-04, AUD-A2).
 * Identity names them; the registering module decides which of them may go,
 * and identity discards those with their tokens.
 */
export interface PendingRegistrationRetentionFacade {
  /**
   * Deletes each named user that is still a pending registration, with every
   * token, handoff, and reset request it holds, and says how many went.
   */
  discardPendingUsers(command: {
    readonly transaction: IdentityTransaction;
    readonly userIds: readonly string[];
  }): Promise<number>;
  /**
   * Up to `limit` pending registrations made, and last sent a link, before
   * `createdBefore`, after `afterUserId` in id order, each locked for the
   * caller's transaction and skipped when somebody else holds it. Only a
   * registration — an unverified, active user holding a verification token —
   * is ever named, so an imported account that never registered here is not.
   */
  listStalePendingUsers(command: {
    readonly afterUserId?: string;
    readonly createdBefore: Date;
    readonly limit: number;
    readonly transaction: IdentityTransaction;
  }): Promise<readonly StalePendingUser[]>;
}
