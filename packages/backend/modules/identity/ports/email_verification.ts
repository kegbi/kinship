/**
 * How an address is proved, and where the person lands afterwards.
 *
 * A verification can fail three ways and they are kept apart on purpose:
 * `invalid` is a token that was never issued, `expired` is one that was, and
 * `replayed` is one that already worked. Only the last two tell the holder
 * anything, and only the holder of the mailbox can see them.
 *
 * A verification proves the mailbox, not the browser. Only the browser that
 * registered holds the registrant verifier (SECA-01); a verification without
 * it still marks the address verified, but answers `password-required` with a
 * single-use reset token instead of an entry, because the password on the
 * account was chosen by whoever registered.
 *
 * The entry token is a single-use handoff, not a session: verifying issues one
 * and the application entry consumes it, both against the address that was
 * verified, so a token that leaked cannot be spent for somebody else.
 *
 * Identity proves the address inside a transaction the registering module
 * owns (`RegistrationVerificationFacade`), and hands back the registration
 * intent the pending user carried, so that module provisions what was asked
 * for in the same unit of work (SECA-04, AUD-A2): an address that is proved
 * always has its workspace, and a registration never proved never had one.
 */

import type { ExactCredentialVersion } from "./authentication.ts";
import type { IdentityTransaction } from "./context.ts";

export type VerificationFailure = "expired" | "invalid" | "replayed";

export type VerificationResult =
  | { readonly status: "verified"; readonly entryToken: string }
  | { readonly status: "password-required"; readonly resetToken: string }
  | { readonly status: VerificationFailure };

/**
 * A verification as the module that registered sees it: on success, also the
 * user who was verified and what their registration asked for, if anything.
 * The verification clears what was asked for in the same transaction, so a
 * later verification never hands it back again.
 */
export type RegistrationVerificationResult =
  | { readonly status: VerificationFailure }
  | (
    & Exclude<VerificationResult, { readonly status: VerificationFailure }>
    & {
      readonly registrationIntent?: string;
      readonly userId: string;
    }
  );

export interface RegistrationVerificationFacade {
  verifyInTransaction(command: {
    readonly rawToken: string;
    readonly registrantVerifier?: string;
    readonly transaction: IdentityTransaction;
  }): Promise<RegistrationVerificationResult>;
}

export interface ApplicationEntryContext {
  readonly firstName: string;
  readonly memberId: string;
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}

/**
 * Where a just-verified user lands. `workspaces` owns membership and
 * `identity` may not depend on it, so the composition root injects the
 * workspace side of the handoff and this module only consumes its own session.
 */
export interface ApplicationEntryWorkspaces {
  resolveActiveContext(command: {
    readonly transaction: IdentityTransaction;
    readonly userId: string;
  }): Promise<
    | {
      readonly memberId: string;
      readonly workspaceId: string;
      readonly workspaceName: string;
    }
    | undefined
  >;
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
  verify(
    rawToken: string,
    registrantVerifier?: string,
  ): Promise<VerificationResult>;
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
