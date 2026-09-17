/**
 * How invitations are stored, delivered, and proved to have been accepted.
 *
 * Every method takes the token's digest rather than the token, so the raw
 * invitation link exists only in the email and in the request that spends it.
 * `inspect` and `accept` both take `now` rather than reading a clock, so the
 * same instant decides whether an invitation has expired and what an
 * acceptance is timestamped with.
 *
 * `assertAcceptancePostcondition` re-reads the membership, the invitation, and
 * who issued it inside the transaction that created them, because joining a
 * workspace is the one write that hands somebody else's data to a new person:
 * a half-written acceptance unwinds rather than leaving a membership nobody
 * invited.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  InvitationAcceptance,
  InvitationInspection,
  WorkspaceInvitationRecord,
  WorkspaceMemberRecord,
} from "../domain/invitation_rules.ts";
import type { InvitationRole } from "../domain/roles.ts";
import type { InvitationActor, RegistrationTransaction } from "./context.ts";

export interface WorkspaceInvitationRepository {
  create(command: {
    readonly actor: InvitationActor;
    readonly email: string;
    readonly existingUserId?: string;
    readonly expiresAt: Date;
    readonly invitationId: string;
    readonly role: InvitationRole;
    readonly tokenHash: string;
    readonly transaction: RegistrationTransaction;
  }): Promise<"created" | "already-member" | "forbidden">;
  list(command: {
    readonly actor: InvitationActor;
    readonly now: Date;
    readonly transaction: RegistrationTransaction;
  }): Promise<
    | Failure<"forbidden">
    | {
      readonly invitations: readonly WorkspaceInvitationRecord[];
      readonly members: readonly WorkspaceMemberRecord[];
      readonly status: "ready";
    }
  >;
  inspect(command: {
    readonly now: Date;
    readonly tokenHash: string;
    readonly transaction: RegistrationTransaction;
  }): Promise<InvitationInspection>;
  accept(command: {
    readonly memberId: string;
    readonly now: Date;
    readonly tokenHash: string;
    readonly transaction: RegistrationTransaction;
    readonly userId: string;
  }): Promise<InvitationAcceptance>;
  assertAcceptancePostcondition(command: {
    readonly acceptedAt: Date;
    readonly invitationId: string;
    readonly invitedByMemberId: string | null;
    readonly memberId: string;
    readonly role: InvitationRole;
    readonly tokenHash: string;
    readonly transaction: RegistrationTransaction;
    readonly userId: string;
    readonly workspaceId: string;
  }): Promise<void>;
}

export interface InvitationAudit {
  recordMemberJoined(command: {
    readonly actorMemberId: string;
    readonly memberId: string;
    readonly occurredAt: Date;
    readonly transaction: RegistrationTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
  assertMemberJoinedPostcondition(command: {
    readonly actorMemberId: string;
    readonly memberId: string;
    readonly occurredAt: Date;
    readonly transaction: RegistrationTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
}

export interface InvitationMail {
  sendInvitation(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
    readonly workspaceName: string;
  }): Promise<void>;
  sendVerification(message: {
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }): Promise<void>;
}

/** Single-use tokens, handed out raw and stored only as a digest. */
export interface InvitationTokens {
  create(): Promise<{ readonly hash: string; readonly raw: string }>;
  hash(raw: string): Promise<string>;
}
