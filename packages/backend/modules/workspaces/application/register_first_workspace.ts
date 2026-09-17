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
 * Only after that commits is the email sent, and a failure there is a
 * different error from a failed registration: the account exists, so the
 * person has to be told to ask for another link, not to register again.
 *
 * The retry is deliberately quiet. It never says whether the address is
 * registered, whether a link was actually issued, or whether the email went
 * out, because the answer to all three belongs to whoever holds the mailbox.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import {
  DEFAULT_RELATIONSHIP_TYPE_VOCABULARY,
  type FirstWorkspaceRegistrationCommand,
  type FirstWorkspaceRegistrationResult,
  RegistrationError,
  VerificationDeliveryError,
  verificationExpiry,
} from "../domain/registration_rules.ts";
import type { RegistrationTransactionRunner } from "../ports/context.ts";
import type {
  RegistrationAudit,
  VerificationMail,
  VerificationTokens,
  WorkspaceRegistrationWriter,
} from "../ports/registration_repository.ts";
import type { IdentityRegistrationFacade } from "../../identity/public.ts";
import { IdentityConflictError } from "../../identity/public.ts";

export interface RegistrationDependencies {
  readonly audit: RegistrationAudit;
  readonly clock: Clock;
  readonly identity: IdentityRegistrationFacade;
  readonly ids: IdGenerator;
  readonly mail: VerificationMail;
  readonly tokens: VerificationTokens;
  readonly transaction: RegistrationTransactionRunner;
  readonly workspace: WorkspaceRegistrationWriter;
}

export function createFirstWorkspaceRegistration(
  dependencies: RegistrationDependencies,
): (
  command: FirstWorkspaceRegistrationCommand,
) => Promise<FirstWorkspaceRegistrationResult> {
  return async (command) => {
    let delivery: {
      readonly email: string;
      readonly expiresAt: Date;
      readonly token: string;
    };
    try {
      delivery = await dependencies.transaction.run(async (transaction) => {
        const now = dependencies.clock.now();
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
          email: command.email,
          expiresAt,
          token: verificationToken.raw,
        };
      });
    } catch (error) {
      if (error instanceof IdentityConflictError) {
        throw new RegistrationError("duplicate_email");
      }
      throw new RegistrationError();
    }
    try {
      await dependencies.mail.sendVerification(delivery);
    } catch {
      throw new VerificationDeliveryError();
    }
    return { status: "verification-required" };
  };
}

export function createVerificationDeliveryRetry(
  dependencies: RegistrationDependencies,
): (email: string) => Promise<void> {
  return async (email) => {
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
    await Promise.resolve().then(() =>
      dependencies.mail.sendVerification({
        email: delivery.email,
        expiresAt,
        token: token.raw,
      })
    ).catch(() => undefined);
  };
}
