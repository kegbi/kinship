import type { IdentityTransaction } from "./contracts.ts";

export interface AuthenticationClient {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

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
    readonly status: "mfa-required";
    readonly userId: string;
  }
  | {
    readonly credentialVersion: Date | null;
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
