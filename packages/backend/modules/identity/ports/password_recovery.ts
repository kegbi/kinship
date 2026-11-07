/**
 * What a password reset needs of the world outside it.
 *
 * `createRequest` writes the request whether or not the address belongs to
 * anybody, and only then says whether there is an address to deliver to. That
 * shape is the security rule: the row is written either way, so the time the
 * endpoint takes does not depend on whether somebody has an account.
 *
 * `resetPassword` is one call rather than a read and a write, because the
 * token has to be spent and the password replaced in the same statement or a
 * link could be used twice. A reset also serves an account whose password was
 * discarded at verification (SECA-01): setting the first password is the same
 * step as replacing one. It answers the address it changed, because the
 * address is told every time its password is set (AUD-A1).
 *
 * The mail port never learns anything the caller did not already send, and the
 * token service hands out a raw token and its hash together so the raw one can
 * be posted and never stored.
 */

import type {
  IdentityTransaction,
  IdentityTransactionRunner,
} from "./context.ts";

export interface PasswordRecoveryRepository {
  createRequest(command: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly id: string;
    readonly ipAddress?: string;
    readonly now: Date;
    readonly tokenHash: string;
    readonly transaction: IdentityTransaction;
  }): Promise<{ readonly deliveryEmail?: string }>;
  resetPassword(command: {
    readonly newPasswordHash: string;
    readonly now: Date;
    readonly tokenHash: string;
    readonly transaction: IdentityTransaction;
  }): Promise<
    | "expired"
    | "invalid"
    | { readonly email: string; readonly status: "reset" }
  >;
}

export interface PasswordRecoveryMail {
  sendPasswordReset(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }): Promise<void>;
  /** Tells the address that its password was just set or replaced. */
  sendPasswordChanged(message: { readonly email: string }): Promise<void>;
}

/** Single-use tokens, handed out raw and stored only as a digest. */
export interface IdentityTokenService {
  create(): Promise<{ readonly hash: string; readonly raw: string }>;
  hash(raw: string): Promise<string>;
}

export interface PasswordRecoveryFacade {
  request(command: {
    readonly email: string;
    readonly ipAddress?: string;
  }): Promise<{
    readonly delivery: "delivered" | "failed" | "not-applicable" | "timed-out";
  }>;
  reset(command: {
    readonly password: string;
    readonly token: string;
  }): Promise<"expired" | "invalid" | "reset">;
}

/** The transaction a password reset runs in; identity has one runner. */
export type PasswordRecoveryTransactionRunner = IdentityTransactionRunner;
