import type {
  IdentityAuthenticationFacade,
  IdentityRegistrationFacade,
  InvitationIdentityFacade,
  VerifiedIdentityEntryFacade,
} from "../../identity/public.ts";
import { IdentityConflictError } from "../../identity/public.ts";
import type {
  RegistrationTransaction,
  RegistrationTransactionRunner,
} from "./register_first_workspace.ts";

export type WorkspaceRole = "admin" | "member" | "owner";
export type InvitationRole = Exclude<WorkspaceRole, "owner">;

export interface InvitationActor {
  readonly memberId: string;
  readonly role: WorkspaceRole;
  readonly userId: string;
  readonly workspaceId: string;
}

export interface InvitationSummary {
  readonly createdAt: string;
  readonly email: string;
  readonly expiresAt: string;
  readonly id: string;
  readonly role: InvitationRole;
  readonly status: "pending";
}

export interface WorkspaceMemberSummary {
  readonly email: string;
  readonly id: string;
  readonly name: string;
  readonly role: WorkspaceRole;
  readonly status: "active";
}

export interface WorkspaceInvitationRecord {
  readonly createdAt: Date;
  readonly email: string;
  readonly expiresAt: Date;
  readonly id: string;
  readonly role: InvitationRole;
  readonly status: "pending";
}

export interface WorkspaceMemberRecord {
  readonly id: string;
  readonly role: WorkspaceRole;
  readonly status: "active";
  readonly userId: string;
}

export type WorkspaceInvitationList =
  | { readonly status: "forbidden" }
  | {
    readonly invitations: readonly InvitationSummary[];
    readonly members: readonly WorkspaceMemberSummary[];
    readonly status: "ready";
  };

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
    | { readonly status: "forbidden" }
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

export interface InvitationTokens {
  create(): Promise<{ readonly hash: string; readonly raw: string }>;
  hash(raw: string): Promise<string>;
}

export type InvitationInspection =
  | {
    readonly email: string;
    readonly role: InvitationRole;
    readonly status: "pending";
    readonly workspaceName: string;
  }
  | { readonly status: "expired" | "invalid" | "revoked" | "used" };

export type InvitationAcceptance =
  | {
    readonly invitationId: string;
    readonly invitedByMemberId: string | null;
    readonly memberId: string;
    readonly role: InvitationRole;
    readonly status: "accepted";
    readonly workspaceId: string;
    readonly workspaceName: string;
  }
  | {
    readonly status:
      | "already-member"
      | "expired"
      | "invalid"
      | "revoked"
      | "used"
      | "wrong-user";
  };

export interface WorkspaceInvitationDependencies {
  readonly audit: InvitationAudit;
  readonly clock: { now(): Date };
  readonly ids: { create(): string };
  readonly identity:
    & IdentityRegistrationFacade
    & Pick<VerifiedIdentityEntryFacade, "consumeVerifiedIdentityEntry">
    & Pick<
      IdentityAuthenticationFacade,
      "assertSessionPostcondition" | "issueSession"
    >
    & InvitationIdentityFacade;
  readonly mail: InvitationMail;
  readonly repository: WorkspaceInvitationRepository;
  readonly tokens: InvitationTokens;
  readonly transaction: RegistrationTransactionRunner;
}

export type InvitationRegistrationResult =
  | "delivery-failed"
  | "expired"
  | "identity-unavailable"
  | "invalid"
  | "revoked"
  | "used"
  | "verification-required"
  | "wrong-user";

export type InvitationVerificationDeliveryResult =
  | "delivery-failed"
  | "expired"
  | "invalid"
  | "rate-limited"
  | "revoked"
  | "sent"
  | "used";

export type VerifiedEntryAcceptance = InvitationAcceptance | {
  readonly expiresAt: Date;
  readonly invitationId: string;
  readonly invitedByMemberId: string | null;
  readonly memberId: string;
  readonly role: InvitationRole;
  readonly sessionToken: string;
  readonly status: "accepted";
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
};

export function createWorkspaceInvitationCoordinator(
  dependencies: WorkspaceInvitationDependencies,
): {
  acceptVerifiedEntry(command: {
    readonly entryToken: string;
    readonly invitationToken: string;
    readonly ipAddress?: string;
    readonly userAgent?: string;
  }): Promise<VerifiedEntryAcceptance>;
  accept(command: {
    readonly token: string;
    readonly userId: string;
  }): Promise<InvitationAcceptance>;
  create(command: {
    readonly actor: InvitationActor;
    readonly email: string;
    readonly role: InvitationRole;
    readonly workspaceName: string;
  }): Promise<"already-member" | "created" | "delivery-failed" | "forbidden">;
  inspect(token: string): Promise<InvitationInspection>;
  list(
    actor: InvitationActor,
  ): Promise<WorkspaceInvitationList>;
  registerInvitee(command: {
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly passwordHash: string;
    readonly token: string;
  }): Promise<InvitationRegistrationResult>;
  retryInviteeVerification(
    invitationToken: string,
  ): Promise<InvitationVerificationDeliveryResult>;
} {
  const completeAcceptance = async (
    transaction: RegistrationTransaction,
    result: Extract<InvitationAcceptance, { readonly status: "accepted" }>,
    userId: string,
    now: Date,
    tokenHash: string,
  ): Promise<void> => {
    await dependencies.audit.recordMemberJoined({
      actorMemberId: result.memberId,
      memberId: result.memberId,
      occurredAt: now,
      transaction,
      workspaceId: result.workspaceId,
    });
    await dependencies.repository.assertAcceptancePostcondition({
      acceptedAt: now,
      invitationId: result.invitationId,
      invitedByMemberId: result.invitedByMemberId,
      memberId: result.memberId,
      role: result.role,
      tokenHash,
      transaction,
      userId,
      workspaceId: result.workspaceId,
    });
    await dependencies.audit.assertMemberJoinedPostcondition({
      actorMemberId: result.memberId,
      memberId: result.memberId,
      occurredAt: now,
      transaction,
      workspaceId: result.workspaceId,
    });
  };
  return {
    async registerInvitee(command) {
      const tokenHash = await dependencies.tokens.hash(command.token);
      const verificationToken = await dependencies.tokens.create();
      const now = dependencies.clock.now();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
      try {
        const delivery = await dependencies.transaction.run(
          async (transaction) => {
            const invitation = await dependencies.repository.inspect({
              now,
              tokenHash,
              transaction,
            });
            if (invitation.status !== "pending") return invitation.status;
            if (
              invitation.email.toLowerCase() !== command.email.toLowerCase()
            ) {
              return "wrong-user" as const;
            }
            const userId = dependencies.ids.create();
            const verificationTokenId = dependencies.ids.create();
            await dependencies.identity.createPendingUser({
              email: command.email,
              expiresAt,
              firstName: command.firstName,
              lastName: command.lastName,
              passwordHash: command.passwordHash,
              tokenHash: verificationToken.hash,
              transaction,
              userId,
              verificationTokenId,
            });
            await dependencies.identity.assertPendingUserPostconditions({
              email: command.email,
              expiresAt,
              firstName: command.firstName,
              lastName: command.lastName,
              passwordHash: command.passwordHash,
              tokenHash: verificationToken.hash,
              transaction,
              userId,
              verificationTokenId,
            });
            return "verification-required" as const;
          },
        );
        if (delivery !== "verification-required") return delivery;
      } catch (error) {
        if (error instanceof IdentityConflictError) {
          return "identity-unavailable";
        }
        throw error;
      }
      try {
        await dependencies.mail.sendVerification({
          email: command.email,
          expiresAt,
          token: verificationToken.raw,
        });
      } catch {
        return "delivery-failed";
      }
      return "verification-required";
    },
    async retryInviteeVerification(invitationToken) {
      const invitationTokenHash = await dependencies.tokens.hash(
        invitationToken,
      );
      const verificationToken = await dependencies.tokens.create();
      const now = dependencies.clock.now();
      const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
      const delivery = await dependencies.transaction.run(
        async (transaction) => {
          const invitation = await dependencies.repository.inspect({
            now,
            tokenHash: invitationTokenHash,
            transaction,
          });
          if (invitation.status !== "pending") return invitation.status;
          const retry = await dependencies.identity
            .createRetryVerificationToken({
              createdAt: now,
              email: invitation.email,
              expiresAt,
              tokenHash: verificationToken.hash,
              transaction,
              verificationTokenId: dependencies.ids.create(),
            });
          if (!retry) return "invalid" as const;
          return retry.created
            ? { email: retry.email, status: "ready" as const }
            : { status: "rate-limited" as const };
        },
      );
      if (typeof delivery === "string") return delivery;
      if (delivery.status === "rate-limited") return "rate-limited";
      try {
        await dependencies.mail.sendVerification({
          email: delivery.email,
          expiresAt,
          token: verificationToken.raw,
        });
      } catch {
        return "delivery-failed";
      }
      return "sent";
    },
    async acceptVerifiedEntry(command) {
      const tokenHash = await dependencies.tokens.hash(
        command.invitationToken,
      );
      return await dependencies.transaction.run(async (transaction) => {
        const now = dependencies.clock.now();
        const invitation = await dependencies.repository.inspect({
          now,
          tokenHash,
          transaction,
        });
        if (invitation.status !== "pending") return invitation;
        const identity = await dependencies.identity
          .consumeVerifiedIdentityEntry({
            expectedEmail: invitation.email,
            rawToken: command.entryToken,
            transaction,
          });
        if (!identity) return { status: "wrong-user" };
        const result = await dependencies.repository.accept({
          memberId: dependencies.ids.create(),
          now,
          tokenHash,
          transaction,
          userId: identity.userId,
        });
        if (result.status !== "accepted") return result;
        await completeAcceptance(
          transaction,
          result,
          identity.userId,
          now,
          tokenHash,
        );
        const session = await dependencies.identity.issueSession({
          ...(command.ipAddress ? { ipAddress: command.ipAddress } : {}),
          transaction,
          ...(command.userAgent ? { userAgent: command.userAgent } : {}),
          userId: identity.userId,
        });
        await dependencies.identity.assertSessionPostcondition({
          expiresAt: session.expiresAt,
          token: session.token,
          transaction,
          userId: identity.userId,
        });
        return {
          ...result,
          expiresAt: session.expiresAt,
          sessionToken: session.token,
          userId: identity.userId,
        };
      });
    },
    async create(command) {
      if (command.actor.role !== "owner" && command.actor.role !== "admin") {
        return "forbidden";
      }
      const token = await dependencies.tokens.create();
      const expiresAt = new Date(
        dependencies.clock.now().getTime() + 7 * 24 * 60 * 60 * 1_000,
      );
      const result = await dependencies.transaction.run(async (transaction) => {
        const existingUserId = await dependencies.identity
          .findIdentityIdByEmail({ email: command.email, transaction });
        return await dependencies.repository.create({
          actor: command.actor,
          email: command.email,
          ...(existingUserId ? { existingUserId } : {}),
          expiresAt,
          invitationId: dependencies.ids.create(),
          role: command.role,
          tokenHash: token.hash,
          transaction,
        });
      });
      if (result !== "created") return result;
      try {
        await dependencies.mail.sendInvitation({
          email: command.email,
          expiresAt,
          token: token.raw,
          workspaceName: command.workspaceName,
        });
      } catch {
        return "delivery-failed";
      }
      return "created";
    },
    async list(actor) {
      return await dependencies.transaction.run(async (transaction) => {
        const listed = await dependencies.repository.list({
          actor,
          now: dependencies.clock.now(),
          transaction,
        });
        if (listed.status === "forbidden") return listed;
        const identities = await dependencies.identity
          .listIdentityDisplaySummaries({
            transaction,
            userIds: listed.members.map((member) => member.userId),
          });
        const identityById = new Map(
          identities.map((identity) => [identity.userId, identity]),
        );
        const members = listed.members.flatMap((member) => {
          const identity = identityById.get(member.userId);
          return identity
            ? [{
              email: identity.email,
              id: member.id,
              name: identity.name,
              role: member.role,
              status: member.status,
            }]
            : [];
        }).sort((left, right) =>
          left.email.localeCompare(right.email, undefined, {
            sensitivity: "base",
          }) || left.id.localeCompare(right.id)
        );
        return {
          invitations: listed.invitations.map((invitation) => ({
            ...invitation,
            createdAt: invitation.createdAt.toISOString(),
            expiresAt: invitation.expiresAt.toISOString(),
          })),
          members,
          status: "ready",
        };
      });
    },
    async inspect(token) {
      const tokenHash = await dependencies.tokens.hash(token);
      return await dependencies.transaction.run((transaction) =>
        dependencies.repository.inspect({
          now: dependencies.clock.now(),
          tokenHash,
          transaction,
        })
      );
    },
    async accept(command) {
      const tokenHash = await dependencies.tokens.hash(command.token);
      return await dependencies.transaction.run(async (transaction) => {
        const now = dependencies.clock.now();
        const invitation = await dependencies.repository.inspect({
          now,
          tokenHash,
          transaction,
        });
        if (invitation.status !== "pending") return invitation;
        const eligible = await dependencies.identity
          .isVerifiedInvitationIdentity({
            expectedEmail: invitation.email,
            transaction,
            userId: command.userId,
          });
        if (!eligible) return { status: "wrong-user" };
        const result = await dependencies.repository.accept({
          memberId: dependencies.ids.create(),
          now,
          tokenHash,
          transaction,
          userId: command.userId,
        });
        if (result.status !== "accepted") return result;
        await completeAcceptance(
          transaction,
          result,
          command.userId,
          now,
          tokenHash,
        );
        return result;
      });
    },
  };
}
