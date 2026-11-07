/**
 * The workspace invitation coordinator.
 *
 * Six paths, and the one thing they all do first is hash the token the caller
 * presented, because everything downstream is keyed by the digest and the raw
 * link never goes anywhere near the database. Everything else is ordering.
 *
 * `completeAcceptance` is the part worth reading. Joining a workspace is the
 * write that hands somebody else's data to a new person, so the audit event,
 * the membership, and the invitation are all asserted back inside the
 * transaction that created them: a half-written acceptance unwinds rather than
 * leaving a membership nobody invited.
 *
 * Two paths deal with somebody who does not have an account yet.
 * `registerInvitee` creates a pending identity against the invited address —
 * and only that address, so an invitation cannot be spent to register a
 * different mailbox — and `acceptVerifiedEntry` is the other end: somebody who
 * has just proved that address hands back the entry token, joins, and is
 * signed in, all in one transaction.
 *
 * Delivery is always outside the transaction. A workspace that committed an
 * invitation and then could not send the email reports `delivery-failed`; it
 * does not roll the invitation back, because the invitation is real and can be
 * re-sent.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import {
  type InvitationAcceptance,
  invitationExpiry,
  type InvitationInspection,
  type InvitationRegistrationResult,
  invitationSummary,
  type InvitationVerificationDeliveryResult,
  memberDirectory,
  sameMailbox,
  type VerifiedEntryAcceptance,
  type WorkspaceInvitationList,
} from "../domain/invitation_rules.ts";
import { privileged } from "../domain/roles.ts";
import type { InvitationRole } from "../domain/roles.ts";
import { verificationExpiry } from "../domain/registration_rules.ts";
import type {
  InvitationActor,
  RegistrationTransactionRunner,
} from "../ports/context.ts";
import type {
  InvitationAudit,
  InvitationMail,
  InvitationTokens,
  WorkspaceInvitationRepository,
} from "../ports/invitation_repository.ts";
import type {
  IdentityAuthenticationFacade,
  IdentityRegistrationFacade,
  InvitationIdentityFacade,
  VerifiedIdentityEntryFacade,
} from "../../identity/public.ts";
import { IdentityConflictError } from "../../identity/public.ts";
import { completeAcceptance } from "./invitation_acceptance.ts";

export interface WorkspaceInvitationDependencies {
  readonly audit: InvitationAudit;
  readonly clock: Clock;
  readonly ids: IdGenerator;
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
  return {
    async registerInvitee(command) {
      const tokenHash = await dependencies.tokens.hash(command.token);
      const verificationToken = await dependencies.tokens.create();
      const now = dependencies.clock.now();
      const expiresAt = verificationExpiry(now);
      try {
        const delivery = await dependencies.transaction.run(
          async (transaction) => {
            const invitation = await dependencies.repository.inspect({
              now,
              tokenHash,
              transaction,
            });
            if (invitation.status !== "pending") return invitation.status;
            if (!sameMailbox(invitation.email, command.email)) {
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
      const expiresAt = verificationExpiry(now);
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
        await completeAcceptance(dependencies, {
          now,
          result,
          tokenHash,
          transaction,
          userId: identity.userId,
        });
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
      if (!privileged(command.actor)) return "forbidden";
      const token = await dependencies.tokens.create();
      const expiresAt = invitationExpiry(dependencies.clock.now());
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
      // Decided before the first read (AUD-K5); the repository's membership
      // check stays as the race-safe backstop.
      if (!privileged(actor)) return { status: "forbidden" };
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
        return {
          invitations: listed.invitations.map(invitationSummary),
          members: memberDirectory(listed.members, identities),
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
        await completeAcceptance(dependencies, {
          now,
          result,
          tokenHash,
          transaction,
          userId: command.userId,
        });
        return result;
      });
    },
  };
}
