/**
 * Registering the first workspace, and re-sending the link that proves it.
 *
 * The whole of registration is one transaction: the pending identity, the
 * workspace, the owner's membership, their preferences, the workspace
 * settings, the default relationship vocabulary, and the audit event, followed
 * by three assertions that read all of it back. There is nothing to fall back
 * on here — the person has no account yet — so a partial write unwinds rather
 * than leaving somebody with something they cannot use.
 *
 * Nobody owns an address by registering it first (SECA-01). An address whose
 * only account is a pending registration is taken over: that registration's
 * workspaces and identity are discarded, with every link it was sent, and the
 * new one is written in their place. An address that already belongs to
 * somebody is never touched; its owner is mailed a note, with a reset link
 * when a reset request could be written. The caller cannot tell the two apart
 * (SECA-02): both answer the same `verification-required`, both wait on
 * exactly one email — even when the reset limit or an imported account leaves
 * no link to send — so a slow or failing provider shows the same on either
 * path, and both run inside the response equalizer.
 *
 * Only after the transaction commits is the email sent, and a failure there is
 * a different error from a failed registration: the account exists, so the
 * person has to be told to ask for another link, not to register again.
 *
 * Every registration, and every retry, first spends one of the address's
 * registration mails for the day (SECA-03). The budget counts requests, not
 * outcomes, so a fresh, a pending, and a registered address reach the ceiling
 * on the same request; past it nothing is written and nothing is sent, and the
 * caller gets the same `verification-required` inside the same equalizer —
 * the ceiling cannot become the account oracle SECA-02 closed.
 *
 * The retry is deliberately quiet. It never says whether the address is
 * registered, whether a link was actually issued, or whether the email went
 * out, because the answer to all three belongs to whoever holds the mailbox.
 * It answers inside the same equalizer and does not wait for the provider, so
 * its timing does not depend on whether there was anything to send.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import { MAIL_BUDGET_WINDOW_MS } from "../domain/invitation_rules.ts";
import {
  DEFAULT_RELATIONSHIP_TYPE_VOCABULARY,
  type FirstWorkspaceRegistrationCommand,
  type FirstWorkspaceRegistrationResult,
  REGISTRATION_MAIL_DAILY_CEILING,
  RegistrationError,
  VerificationDeliveryError,
  verificationExpiry,
} from "../domain/registration_rules.ts";
import type {
  RegistrationTransaction,
  RegistrationTransactionRunner,
} from "../ports/context.ts";
import type {
  RegistrationAudit,
  VerificationMail,
  VerificationTokens,
  WorkspaceRegistrationWriter,
} from "../ports/registration_repository.ts";
import type { OutboundMailBudget } from "../ports/mail_budget.ts";
import type { AuthenticationResponseEqualizer } from "../ports/session.ts";
import type { IdentityRegistrationFacade } from "../../identity/public.ts";

export interface RegistrationDependencies {
  readonly audit: RegistrationAudit;
  readonly clock: Clock;
  readonly identity: IdentityRegistrationFacade;
  readonly ids: IdGenerator;
  readonly mail: VerificationMail;
  /** The address's daily registration-mail ceiling (SECA-03). */
  readonly mailBudget: OutboundMailBudget;
  readonly responseEqualizer: AuthenticationResponseEqualizer;
  readonly tokens: VerificationTokens;
  readonly transaction: RegistrationTransactionRunner;
  readonly workspace: WorkspaceRegistrationWriter;
}

/** The one email a registration sends once its transaction has committed. */
type RegistrationDelivery =
  | {
    readonly kind: "verification";
    readonly email: string;
    readonly expiresAt: Date;
    readonly token: string;
  }
  | {
    readonly kind: "account-exists";
    readonly email: string;
    readonly reset?: { readonly expiresAt: Date; readonly token: string };
  };

/**
 * Makes an address free for a new pending identity, or says it belongs to
 * somebody (SECA-01). A pending registration's workspaces go first, because
 * they reference the identity identity is about to discard.
 */
export async function claimAddressForRegistration(
  dependencies: {
    readonly identity: Pick<
      IdentityRegistrationFacade,
      "claimRegistrationAddress" | "discardPendingUser"
    >;
    readonly workspace: Pick<
      WorkspaceRegistrationWriter,
      "deletePendingWorkspaces"
    >;
  },
  email: string,
  transaction: RegistrationTransaction,
): Promise<"available" | "registered"> {
  const claim = await dependencies.identity.claimRegistrationAddress({
    email,
    transaction,
  });
  if (claim.status === "registered") return "registered";
  if (claim.status === "pending") {
    await dependencies.workspace.deletePendingWorkspaces({
      transaction,
      userId: claim.userId,
    });
    await dependencies.identity.discardPendingUser({
      transaction,
      userId: claim.userId,
    });
  }
  return "available";
}

export function createFirstWorkspaceRegistration(
  dependencies: RegistrationDependencies,
): (
  command: FirstWorkspaceRegistrationCommand,
) => Promise<FirstWorkspaceRegistrationResult> {
  return (command) =>
    dependencies.responseEqualizer.run(async () => {
      if (
        await reserveRegistrationMail(dependencies, command.email) !==
          "admitted"
      ) {
        return { status: "verification-required" };
      }
      let delivery: RegistrationDelivery;
      try {
        delivery = await dependencies.transaction.run((transaction) =>
          registerInTransaction(dependencies, command, transaction)
        );
      } catch {
        throw new RegistrationError();
      }
      try {
        if (delivery.kind === "verification") {
          const { kind: _kind, ...message } = delivery;
          await dependencies.mail.sendVerification(message);
        } else {
          if (!dependencies.mail.sendAccountExists) {
            throw new Error("Account-exists mail unavailable.");
          }
          const { kind: _kind, ...message } = delivery;
          await dependencies.mail.sendAccountExists(message);
        }
      } catch {
        throw new VerificationDeliveryError();
      }
      return { status: "verification-required" };
    });
}

async function registerInTransaction(
  dependencies: RegistrationDependencies,
  command: FirstWorkspaceRegistrationCommand,
  transaction: RegistrationTransaction,
): Promise<RegistrationDelivery> {
  const now = dependencies.clock.now();
  const address = await claimAddressForRegistration(
    dependencies,
    command.email,
    transaction,
  );
  if (address === "registered") {
    const reset = await dependencies.tokens.create();
    const recovery = await dependencies.identity
      .createExistingAccountRecovery({
        email: command.email,
        id: dependencies.ids.create(),
        now,
        tokenHash: reset.hash,
        transaction,
      });
    // Mailed even without a link: the provider call is what a fresh
    // registration waits on, so skipping it would answer differently (SECA-02).
    return recovery
      ? {
        kind: "account-exists",
        email: recovery.email,
        reset: { expiresAt: recovery.expiresAt, token: reset.raw },
      }
      : { kind: "account-exists", email: command.email };
  }
  const expiresAt = verificationExpiry(now);
  const verificationToken = await dependencies.tokens.create();
  const userId = dependencies.ids.create();
  const verificationTokenId = dependencies.ids.create();
  const user = await dependencies.identity.createPendingUser({
    ...command,
    expiresAt,
    tokenHash: verificationToken.hash,
    transaction,
    userId,
    verificationTokenId,
  });
  const workspaceId = dependencies.ids.create();
  const workspace = await dependencies.workspace.createWorkspace({
    createdByUserId: user.userId,
    name: command.workspaceName,
    transaction,
    workspaceId,
  });
  const memberId = dependencies.ids.create();
  const membership = await dependencies.workspace.createOwnerMembership({
    joinedAt: now,
    memberId,
    transaction,
    userId: user.userId,
    workspaceId: workspace.workspaceId,
  });
  await dependencies.workspace.createMemberPreferences({
    memberId: membership.memberId,
    transaction,
  });
  await dependencies.workspace.createWorkspaceSettings({
    transaction,
    workspaceId: workspace.workspaceId,
  });
  await dependencies.workspace.provisionDefaultRelationshipTypes({
    transaction,
    types: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types,
    version: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.version,
    workspaceId: workspace.workspaceId,
  });
  await dependencies.audit.recordWorkspaceCreated({
    memberId: membership.memberId,
    occurredAt: now,
    transaction,
    workspaceId: workspace.workspaceId,
  });
  await dependencies.identity.assertPendingUserPostconditions({
    email: command.email,
    expiresAt,
    firstName: command.firstName,
    lastName: command.lastName,
    passwordHash: command.passwordHash,
    tokenHash: verificationToken.hash,
    transaction,
    userId: user.userId,
    verificationTokenId,
  });
  await dependencies.workspace.assertFirstWorkspacePostconditions({
    joinedAt: now,
    memberId: membership.memberId,
    name: command.workspaceName,
    relationshipTypes: DEFAULT_RELATIONSHIP_TYPE_VOCABULARY.types,
    transaction,
    userId: user.userId,
    workspaceId: workspace.workspaceId,
  });
  await dependencies.audit.assertWorkspaceCreatedPostcondition({
    memberId: membership.memberId,
    occurredAt: now,
    transaction,
    workspaceId: workspace.workspaceId,
  });
  return {
    kind: "verification",
    email: command.email,
    expiresAt,
    token: verificationToken.raw,
  };
}

export function createVerificationDeliveryRetry(
  dependencies: RegistrationDependencies,
): (email: string) => Promise<void> {
  return (email) =>
    dependencies.responseEqualizer.run(async () => {
      if (
        await reserveRegistrationMail(dependencies, email) !== "admitted"
      ) {
        return;
      }
      const now = dependencies.clock.now();
      const expiresAt = verificationExpiry(now);
      const token = await dependencies.tokens.create();
      const delivery = await dependencies.transaction.run((transaction) =>
        dependencies.identity.createRetryVerificationToken({
          createdAt: now,
          email,
          expiresAt,
          tokenHash: token.hash,
          transaction,
          verificationTokenId: dependencies.ids.create(),
        })
      );
      if (!delivery?.created) return;
      // Not awaited: the answer must not wait on the provider (SECA-02).
      void Promise.resolve().then(() =>
        dependencies.mail.sendVerification({
          email: delivery.email,
          expiresAt,
          token: token.raw,
        })
      ).catch(() => undefined);
    });
}

/**
 * Spends one of `email`'s registration mails for the day. A budget that cannot
 * be reached refuses the registration as any other failure would.
 */
export async function reserveRegistrationMail(
  dependencies: Pick<RegistrationDependencies, "clock" | "mailBudget">,
  email: string,
): Promise<"admitted" | "exhausted"> {
  try {
    return await dependencies.mailBudget.reserve({
      occurredAt: dependencies.clock.now(),
      recipient: email,
      recipientCeiling: REGISTRATION_MAIL_DAILY_CEILING,
      scope: "registration",
      windowMilliseconds: MAIL_BUDGET_WINDOW_MS,
    });
  } catch {
    throw new RegistrationError();
  }
}
