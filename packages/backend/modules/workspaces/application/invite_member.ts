/**
 * The workspace invitation coordinator.
 *
 * The token paths all start the same way: hash the token the caller
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
 * different mailbox. An address held only by somebody else's pending
 * registration is taken over rather than refused (SECA-01), so a squatter
 * cannot keep an invitee out or let them in on the squatter's password.
 * `acceptVerifiedEntry` is the other end: somebody who has just proved that
 * address hands back the entry token, joins, and is signed in, all in one
 * transaction.
 *
 * Delivery is always outside the transaction. A workspace that committed an
 * invitation and then could not send the email reports `delivery-failed`; it
 * does not roll the invitation back, because the invitation is real and can be
 * re-sent.
 *
 * Nothing here relays mail for whoever asks (SECA-03). An invitation is sent
 * only by an inviter whose address was verified at least a day ago, and only
 * within the workspace's daily quota and the recipient's daily cap, both
 * reserved before anything is written. Registering through an invitation, and
 * asking for its verification link again, spend the invited address's
 * registration-mail ceiling, the one public registration spends.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import {
  INVITATION_RECIPIENT_DAILY_CAP,
  INVITATION_WORKSPACE_DAILY_QUOTA,
  type InvitationAcceptance,
  type InvitationCreationResult,
  invitationExpiry,
  type InvitationInspection,
  type InvitationRegistrationResult,
  invitationSummary,
  type InvitationVerificationDeliveryResult,
  inviterVerifiedBy,
  MAIL_BUDGET_WINDOW_MS,
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
import type { OutboundMailBudget } from "../ports/mail_budget.ts";
import type { WorkspaceRegistrationWriter } from "../ports/registration_repository.ts";
import type {
  IdentityAuthenticationFacade,
  IdentityRegistrationFacade,
  InvitationIdentityFacade,
  VerifiedIdentityEntryFacade,
} from "../../identity/public.ts";
import { IdentityConflictError } from "../../identity/public.ts";
import { completeAcceptance } from "./invitation_acceptance.ts";
import {
  claimAddressForRegistration,
  reserveRegistrationMail,
} from "./register_first_workspace.ts";

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
  /** The durable daily budgets every invitation mail spends (SECA-03). */
  readonly mailBudget: OutboundMailBudget;
  /** Where a replaced pending registration's workspaces are removed. */
  readonly pendingWorkspaces: Pick<
    WorkspaceRegistrationWriter,
    "deletePendingWorkspaces"
  >;
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
  }): Promise<InvitationCreationResult>;
  inspect(token: string): Promise<InvitationInspection>;
  list(
    actor: InvitationActor,
  ): Promise<WorkspaceInvitationList>;
  revoke(
    actor: InvitationActor,
    invitationId: string,
  ): Promise<"forbidden" | "not-found" | "revoked">;
  registerInvitee(command: {
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly passwordHash: string;
    readonly registrantVerifier: string;
    readonly token: string;
  }): Promise<InvitationRegistrationResult>;
  retryInviteeVerification(
    invitationToken: string,
  ): Promise<InvitationVerificationDeliveryResult>;
} {
  return {
    async registerInvitee(command) {
      const tokenHash = await dependencies.tokens.hash(command.token);
      // Only a pending invitation for this very address may spend the
      // address's registration mail, so a made-up token measures nothing.
      const invited = await pendingInvitation(dependencies, tokenHash);
      if (invited.status !== "pending") return invited.status;
      if (!sameMailbox(invited.email, command.email)) return "wrong-user";
      if (
        await reserveRegistrationMail(dependencies, command.email) !==
          "admitted"
      ) {
        return "mail-limit-reached";
      }
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
            const address = await claimAddressForRegistration(
              {
                identity: dependencies.identity,
                workspace: dependencies.pendingWorkspaces,
              },
              command.email,
              transaction,
            );
            if (address === "registered") {
              return "identity-unavailable" as const;
            }
            const userId = dependencies.ids.create();
            const verificationTokenId = dependencies.ids.create();
            await dependencies.identity.createPendingUser({
              email: command.email,
              expiresAt,
              firstName: command.firstName,
              lastName: command.lastName,
              passwordHash: command.passwordHash,
              registrantVerifier: command.registrantVerifier,
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
      // As above: reserve only for a pending invitation, and before a
      // verification token exists, so a refusal leaves nothing behind.
      const invited = await pendingInvitation(
        dependencies,
        invitationTokenHash,
      );
      if (invited.status !== "pending") return invited.status;
      if (
        await reserveRegistrationMail(dependencies, invited.email) !==
          "admitted"
      ) {
        return "mail-limit-reached";
      }
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
      const now = dependencies.clock.now();
      const established = await dependencies.transaction.run(
        (transaction) =>
          dependencies.identity.isAddressVerifiedBy({
            transaction,
            userId: command.actor.userId,
            verifiedBy: inviterVerifiedBy(now),
          }),
        { workspaceId: command.actor.workspaceId },
      );
      if (!established) return "inviter-not-established";
      const budget = await dependencies.mailBudget.reserve({
        occurredAt: now,
        recipient: command.email,
        recipientCeiling: INVITATION_RECIPIENT_DAILY_CAP,
        scope: "invitation",
        sender: {
          ceiling: INVITATION_WORKSPACE_DAILY_QUOTA,
          memberId: command.actor.memberId,
          userId: command.actor.userId,
          workspaceId: command.actor.workspaceId,
        },
        windowMilliseconds: MAIL_BUDGET_WINDOW_MS,
      });
      if (budget !== "admitted") return "limit-reached";
      const token = await dependencies.tokens.create();
      const expiresAt = invitationExpiry(now);
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
      }, { workspaceId: command.actor.workspaceId });
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
            userIds: [
              ...new Set([
                ...listed.members.map((member) => member.userId),
                ...listed.invitations.flatMap((invitation) =>
                  invitation.invitedByUserId ? [invitation.invitedByUserId] : []
                ),
              ]),
            ],
          });
        return {
          invitations: listed.invitations.map((invitation) =>
            invitationSummary(invitation, identities)
          ),
          members: memberDirectory(listed.members, identities),
          status: "ready",
        };
      }, { workspaceId: actor.workspaceId });
    },
    async revoke(actor, invitationId) {
      // Decided before the first read, like `list`; the repository re-checks
      // the actor's membership under lock.
      if (!privileged(actor)) return "forbidden";
      return await dependencies.transaction.run(
        (transaction) =>
          dependencies.repository.revoke({ actor, invitationId, transaction }),
        { workspaceId: actor.workspaceId },
      );
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

/**
 * What a token names, read on its own before any mail budget is spent
 * (SECA-03). The transaction that then writes reads it again, so this only
 * decides whether the request may spend at all.
 */
function pendingInvitation(
  dependencies: WorkspaceInvitationDependencies,
  tokenHash: string,
): Promise<InvitationInspection> {
  const now = dependencies.clock.now();
  return dependencies.transaction.run((transaction) =>
    dependencies.repository.inspect({ now, tokenHash, transaction })
  );
}
