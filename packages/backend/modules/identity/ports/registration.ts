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
 * `createRetryVerificationToken` is what a second registration attempt for the
 * same address does. It never says whether the address was already registered
 * — that answer belongs to the person holding the mailbox, not to the caller.
 */

import type { IdentityTransaction } from "./context.ts";

export interface CreatePendingUserCommand {
  readonly email: string;
  readonly expiresAt: Date;
  readonly firstName: string;
  readonly lastName: string;
  readonly passwordHash: string;
  readonly tokenHash: string;
  readonly transaction: IdentityTransaction;
  readonly userId: string;
  readonly verificationTokenId: string;
}

export interface PendingUser {
  readonly userId: string;
}

export interface IdentityRegistrationFacade {
  createPendingUser(command: CreatePendingUserCommand): Promise<PendingUser>;
  assertPendingUserPostconditions(command: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly firstName: string;
    readonly lastName: string;
    readonly passwordHash: string;
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
