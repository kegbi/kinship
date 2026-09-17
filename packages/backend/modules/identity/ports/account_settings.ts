/**
 * What somebody may change about their own account, and see of their sessions.
 *
 * `listSessions` marks which row is the caller's own, and `revokeOwnedSession`
 * says whether the session it just ended was that one, because signing
 * yourself out of the browser you are holding has to be handled differently
 * from signing out a laptop you left somewhere. Both take the current token
 * rather than an identifier, so neither can be pointed at somebody else's.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { IdentityTransaction } from "./context.ts";

export interface IdentityProfile {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
}

export interface IdentitySessionSummary {
  readonly createdAt: Date;
  readonly current: boolean;
  readonly expiresAt: Date;
  readonly id: string;
  readonly ipAddress?: string;
  readonly lastSeenAt: Date;
  readonly userAgent?: string;
}

export interface IdentityAccountSettingsFacade {
  getProfile(command: {
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<IdentityProfile | undefined>;
  updateProfile(command: {
    readonly firstName: string;
    readonly lastName: string;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<IdentityProfile | undefined>;
  listSessions(command: {
    readonly currentToken: string;
    readonly now: Date;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<readonly IdentitySessionSummary[]>;
  revokeOwnedSession(command: {
    readonly currentToken: string;
    readonly now: Date;
    readonly sessionId: string;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<
    | { readonly current: boolean; readonly status: "revoked" }
    | Failure<"forbidden", "stale">
  >;
}
