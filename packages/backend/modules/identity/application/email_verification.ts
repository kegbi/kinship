export type VerificationFailure = "expired" | "invalid" | "replayed";

export type VerificationResult =
  | { readonly status: "verified"; readonly entryToken: string }
  | { readonly status: VerificationFailure };

export interface ApplicationEntryContext {
  readonly firstName: string;
  readonly memberId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}

export interface VerifiedIdentityEntry {
  readonly firstName: string;
  readonly userId: string;
}

export interface VerifiedIdentityEntryAuthority {
  readonly expiresAt: Date;
  readonly token: string;
}

export interface EmailVerificationFacade {
  verify(rawToken: string): Promise<VerificationResult>;
  consumeApplicationEntry(
    rawToken: string,
  ): Promise<ApplicationEntryContext | undefined>;
}

export interface VerifiedIdentityEntryFacade {
  issueVerifiedIdentityEntry(command: {
    readonly credentialVersion: ExactCredentialVersion;
    readonly expectedEmail: string;
    readonly ipAddress?: string;
    readonly transaction: IdentityTransaction;
    readonly userAgent?: string;
    readonly userId: string;
  }): Promise<VerifiedIdentityEntryAuthority>;
  consumeVerifiedIdentityEntry(command: {
    readonly expectedEmail: string;
    readonly rawToken: string;
    readonly transaction: IdentityTransaction;
  }): Promise<VerifiedIdentityEntry | undefined>;
}
import type { IdentityTransaction } from "./contracts.ts";
import type { ExactCredentialVersion } from "./authentication.ts";
