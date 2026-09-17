/**
 * How somebody proves who they are, and how a session is kept.
 *
 * Every result here carries an optional `auditUserId` beside its status. That
 * is not the caller's business and never reaches a response: it is how a
 * refusal that must tell the caller nothing can still be written into the
 * audit history against the right person.
 *
 * `entryCredentialVersion` is the other subtlety. A session is bound to the
 * exact credential state it was issued against, so changing a password or a
 * factor invalidates what was issued before it, and the exact text is compared
 * rather than a re-rendered timestamp — a version that was re-formatted on the
 * way through would compare unequal to itself.
 */

import type { IdentityTransaction } from "./context.ts";

/** What the request itself said about where it came from. */
export interface AuthenticationClient {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

/** The credential state a session was issued against, exactly as issued. */
export type ExactCredentialVersion = string;

export type PasswordAuthenticationResult =
  | { readonly auditUserId?: string; readonly status: "invalid" }
  | {
    readonly auditUserId?: string;
    readonly retryAfterSeconds: number;
    readonly status: "rate-limited";
  }
  | {
    readonly challengeToken: string;
    readonly credentialVersion: Date | null;
    readonly entryCredentialVersion: ExactCredentialVersion;
    readonly status: "mfa-required";
    readonly userId: string;
  }
  | {
    readonly credentialVersion: Date | null;
    readonly entryCredentialVersion: ExactCredentialVersion;
    readonly status: "verified";
    readonly userId: string;
  };

export type MfaAuthenticationResult =
  | { readonly auditUserId?: string; readonly status: "expired" }
  | { readonly auditUserId?: string; readonly status: "invalid" }
  | {
    readonly auditUserId?: string;
    readonly retryAfterSeconds: number;
    readonly status: "rate-limited";
  }
  | {
    readonly credentialVersion: Date | null;
    readonly entryCredentialVersion: ExactCredentialVersion;
    readonly status: "verified";
    readonly userId: string;
  };

export interface AuthenticatedSession {
  readonly expiresAt: Date;
  readonly token: string;
}

export interface SessionPrincipal {
  readonly userId: string;
}

export interface IdentityAuthenticationFacade {
  authenticationSubjectForMfa(challengeToken: string): Promise<string>;
  resolveAuthenticationAuditUser(command: {
    readonly scope: "mfa" | "password";
    readonly subject: string;
  }): Promise<string | undefined>;
  authenticatePassword(
    command: AuthenticationClient & {
      readonly email: string;
      readonly password: string;
    },
  ): Promise<PasswordAuthenticationResult>;
  completeMfa(command: {
    readonly challengeToken: string;
    readonly factor: string;
    readonly transaction: IdentityTransaction;
  }): Promise<MfaAuthenticationResult>;
  issueSession(
    command: AuthenticationClient & {
      readonly credentialVersion?: Date | null;
      readonly previousToken?: string;
      readonly transaction: IdentityTransaction;
      readonly userId: string;
    },
  ): Promise<AuthenticatedSession>;
  assertSessionPostcondition(command: {
    readonly expiresAt: Date;
    readonly token: string;
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<void>;
  resolveSession(token: string): Promise<SessionPrincipal | undefined>;
  revokeSession(command: {
    readonly token: string;
    readonly transaction: IdentityTransaction;
  }): Promise<void>;
}
