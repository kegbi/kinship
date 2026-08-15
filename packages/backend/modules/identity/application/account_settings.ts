import type { IdentityTransaction } from "./contracts.ts";

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
    | { readonly status: "forbidden" | "stale" }
  >;
}
