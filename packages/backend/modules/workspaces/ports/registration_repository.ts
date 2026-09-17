/**
 * How the first workspace is written, and how it is proved to be there.
 *
 * Registration writes five things in one transaction — the workspace, the
 * owner's membership, their preferences, the workspace settings, and the
 * default relationship vocabulary — and then asserts all of it back.
 * `assertFirstWorkspacePostconditions` is not belt and braces: registration is
 * the one flow with no earlier state to fall back on, so a partially written
 * workspace has to unwind rather than leave somebody with an account they
 * cannot use.
 *
 * `VerificationMail` declares its two other methods optional because the same
 * SMTP adapter serves registration, password recovery, and invitations, and a
 * deployment that has not configured the others should not have to stub them.
 */

import type { DefaultRelationshipType } from "../domain/registration_rules.ts";
import type { RegistrationTransaction } from "./context.ts";

/** Single-use tokens, handed out raw and stored only as a digest. */
export interface VerificationTokens {
  create(): Promise<{ readonly hash: string; readonly raw: string }>;
}

export interface WorkspaceRegistrationWriter {
  createWorkspace(command: {
    readonly createdByUserId: string;
    readonly name: string;
    readonly transaction: RegistrationTransaction;
    readonly workspaceId: string;
  }): Promise<{ readonly workspaceId: string }>;
  createOwnerMembership(command: {
    readonly joinedAt: Date;
    readonly memberId: string;
    readonly transaction: RegistrationTransaction;
    readonly userId: string;
    readonly workspaceId: string;
  }): Promise<{ readonly memberId: string }>;
  createMemberPreferences(command: {
    readonly memberId: string;
    readonly transaction: RegistrationTransaction;
  }): Promise<void>;
  createWorkspaceSettings(command: {
    readonly transaction: RegistrationTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
  provisionDefaultRelationshipTypes(command: {
    readonly transaction: RegistrationTransaction;
    readonly types: readonly DefaultRelationshipType[];
    readonly version: number;
    readonly workspaceId: string;
  }): Promise<void>;
  assertFirstWorkspacePostconditions(command: {
    readonly joinedAt: Date;
    readonly memberId: string;
    readonly name: string;
    readonly transaction: RegistrationTransaction;
    readonly relationshipTypes: readonly DefaultRelationshipType[];
    readonly userId: string;
    readonly workspaceId: string;
  }): Promise<void>;
}

export interface RegistrationAudit {
  recordWorkspaceCreated(command: {
    readonly memberId: string;
    readonly occurredAt: Date;
    readonly transaction: RegistrationTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
  assertWorkspaceCreatedPostcondition(command: {
    readonly memberId: string;
    readonly occurredAt: Date;
    readonly transaction: RegistrationTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
}

export interface VerificationMail {
  sendVerification(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }): Promise<void>;
  sendPasswordReset?(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }): Promise<void>;
  sendInvitation?(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
    readonly workspaceName: string;
  }): Promise<void>;
}
