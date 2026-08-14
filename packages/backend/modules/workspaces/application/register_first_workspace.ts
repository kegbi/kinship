import type {
  IdentityRegistrationFacade,
  IdentityTransaction,
} from "../../identity/public.ts";
import { IdentityConflictError } from "../../identity/public.ts";

export interface RegistrationTransaction extends IdentityTransaction {
  readonly opaque: unknown;
}

export interface RegistrationClock {
  now(): Date;
}

export interface RegistrationIds {
  create(): string;
}

export interface VerificationTokens {
  create(): Promise<{ readonly hash: string; readonly raw: string }>;
}

export interface RegistrationTransactionRunner {
  run<T>(
    work: (transaction: RegistrationTransaction) => Promise<T>,
  ): Promise<T>;
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
  assertFirstWorkspacePostconditions(command: {
    readonly joinedAt: Date;
    readonly memberId: string;
    readonly name: string;
    readonly transaction: RegistrationTransaction;
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

export interface RegistrationDependencies {
  readonly audit: RegistrationAudit;
  readonly clock: RegistrationClock;
  readonly identity: IdentityRegistrationFacade;
  readonly ids: RegistrationIds;
  readonly mail: VerificationMail;
  readonly tokens: VerificationTokens;
  readonly transaction: RegistrationTransactionRunner;
  readonly workspace: WorkspaceRegistrationWriter;
}

export interface FirstWorkspaceRegistrationCommand {
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly passwordHash: string;
  readonly workspaceName: string;
}

export interface FirstWorkspaceRegistrationResult {
  readonly status: "verification-required";
}

export class RegistrationError extends Error {
  readonly code: "duplicate_email" | "registration_failed";

  constructor(
    code: "duplicate_email" | "registration_failed" = "registration_failed",
  ) {
    super(
      code === "duplicate_email"
        ? "Email is already registered."
        : "Registration could not be completed.",
    );
    this.name = "RegistrationError";
    this.code = code;
  }
}

export class VerificationDeliveryError extends Error {
  readonly code = "verification_delivery_failed";

  constructor() {
    super("Verification delivery failed after registration committed.");
    this.name = "VerificationDeliveryError";
  }
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
        const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
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
    const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1_000);
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
