import type {
  IdentityAuthenticationFacade,
  IdentityTransaction,
} from "../../identity/public.ts";

export interface ProtectedSessionTransaction extends IdentityTransaction {
  readonly opaque: unknown;
}

export interface ProtectedSessionTransactionRunner {
  run<T>(
    work: (transaction: ProtectedSessionTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface ActiveWorkspaceContext {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
  readonly workspaceName: string;
}

export interface ResolvedSessionContext extends ActiveWorkspaceContext {
  readonly accessibleWorkspaces: readonly ActiveWorkspaceContext[];
}

export interface ActiveWorkspaceResolver {
  listActiveContexts(command: {
    readonly transaction: ProtectedSessionTransaction;
    readonly userId: string;
  }): Promise<readonly ActiveWorkspaceContext[]>;
  resolveAuditContext(command: {
    readonly transaction: ProtectedSessionTransaction;
    readonly userId: string;
  }): Promise<ActiveWorkspaceContext | undefined>;
  resolveActiveContext(command: {
    readonly requestedWorkspaceId?: string;
    readonly transaction: ProtectedSessionTransaction;
    readonly userId: string;
  }): Promise<ActiveWorkspaceContext | undefined>;
  assertActiveContextPostcondition(
    command: ActiveWorkspaceContext & {
      readonly transaction: ProtectedSessionTransaction;
    },
  ): Promise<void>;
}

export interface AuthenticationAudit {
  record(command: {
    readonly context: ActiveWorkspaceContext;
    readonly occurredAt: Date;
    readonly outcome: "failed" | "succeeded";
    readonly transaction: ProtectedSessionTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly auditEventId: string;
    readonly context: ActiveWorkspaceContext;
    readonly occurredAt: Date;
    readonly outcome: "failed" | "succeeded";
    readonly transaction: ProtectedSessionTransaction;
  }): Promise<void>;
  recordFailure(command: {
    readonly actorMemberId: null;
    readonly context?: ActiveWorkspaceContext;
    readonly occurredAt: Date;
    readonly transaction: ProtectedSessionTransaction;
  }): Promise<string | undefined>;
  assertFailurePostcondition(command: {
    readonly actorMemberId: null;
    readonly auditEventId?: string;
    readonly context?: ActiveWorkspaceContext;
    readonly occurredAt: Date;
    readonly transaction: ProtectedSessionTransaction;
  }): Promise<void>;
}

export type AuthenticationAttemptBudgetResult =
  | {
    readonly reservationId: string;
    readonly retryAfterSeconds: number;
    readonly status: "rate-limited";
  }
  | { readonly reservationId: string; readonly status: "admitted" };

export type AuthenticationRequestStatusCode =
  | 200
  | 202
  | 401
  | 403
  | 410
  | 429
  | 503;

export interface AuthenticationAttemptBudget {
  reserve(
    command: {
      readonly clientAddress: string;
      readonly occurredAt: Date;
      readonly scope: "mfa" | "password";
      readonly subject: string;
    },
  ): Promise<AuthenticationAttemptBudgetResult>;
  finalize(command: {
    readonly reservationId: string;
    readonly statusCode: AuthenticationRequestStatusCode;
    readonly transaction?: ProtectedSessionTransaction;
    readonly userId?: string;
  }): Promise<void>;
}

export interface AuthenticationResponseEqualizer {
  run<T>(work: () => Promise<T>): Promise<T>;
}

export interface ProtectedSessionDependencies {
  readonly attemptBudget: AuthenticationAttemptBudget;
  readonly audit: AuthenticationAudit;
  readonly clock: { now(): Date };
  readonly identity: IdentityAuthenticationFacade;
  readonly responseEqualizer: AuthenticationResponseEqualizer;
  readonly transaction: ProtectedSessionTransactionRunner;
  readonly workspace: ActiveWorkspaceResolver;
}

export interface SignInCommand {
  readonly email: string;
  readonly ipAddress: string;
  readonly password: string;
  readonly previousSessionToken?: string;
  readonly requestedWorkspaceId?: string;
  readonly userAgent?: string;
}

export interface CompleteMfaCommand {
  readonly challengeToken: string;
  readonly factor: string;
  readonly ipAddress: string;
  readonly previousSessionToken?: string;
  readonly requestedWorkspaceId?: string;
  readonly userAgent?: string;
}

export type ProtectedSessionResult =
  | { readonly status: "invalid-credentials" | "invalid-mfa" }
  | { readonly status: "challenge-expired" | "membership-inactive" }
  | { readonly retryAfterSeconds: number; readonly status: "rate-limited" }
  | { readonly challengeToken: string; readonly status: "mfa-required" }
  | {
    readonly expiresAt: Date;
    readonly member: {
      readonly id: string;
      readonly role: ActiveWorkspaceContext["role"];
    };
    readonly sessionToken: string;
    readonly status: "authenticated";
    readonly userId: string;
    readonly workspace: { readonly id: string; readonly name: string };
  };

export function protectedSessionHttpStatus(
  result: ProtectedSessionResult,
): Exclude<AuthenticationRequestStatusCode, 503> {
  switch (result.status) {
    case "authenticated":
      return 200;
    case "mfa-required":
      return 202;
    case "invalid-credentials":
    case "invalid-mfa":
      return 401;
    case "membership-inactive":
      return 403;
    case "challenge-expired":
      return 410;
    case "rate-limited":
      return 429;
  }
}

function client(command: {
  readonly ipAddress?: string;
  readonly userAgent?: string;
}): { readonly ipAddress?: string; readonly userAgent?: string } {
  return {
    ...(command.ipAddress ? { ipAddress: command.ipAddress } : {}),
    ...(command.userAgent ? { userAgent: command.userAgent } : {}),
  };
}

function requested(command: {
  readonly requestedWorkspaceId?: string;
}): { readonly requestedWorkspaceId?: string } {
  return command.requestedWorkspaceId
    ? { requestedWorkspaceId: command.requestedWorkspaceId }
    : {};
}

export function createProtectedSessionCoordinator(
  dependencies: ProtectedSessionDependencies,
): {
  completeMfa(command: CompleteMfaCommand): Promise<ProtectedSessionResult>;
  establishVerifiedEntry(command: {
    readonly ipAddress?: string;
    readonly previousSessionToken?: string;
    readonly userAgent?: string;
    readonly userId: string;
  }): Promise<ProtectedSessionResult>;
  resolve(command: {
    readonly requestedWorkspaceId?: string;
    readonly sessionToken: string;
  }): Promise<ResolvedSessionContext | undefined>;
  signOut(sessionToken: string): Promise<void>;
  signIn(command: SignInCommand): Promise<ProtectedSessionResult>;
} {
  const unknownUserId = "00000000-0000-0000-0000-000000000000";
  const recordFailure = async (userId: string | undefined): Promise<void> => {
    await dependencies.transaction.run(async (transaction) => {
      const context = await dependencies.workspace.resolveAuditContext({
        transaction,
        userId: userId ?? unknownUserId,
      });
      const occurredAt = dependencies.clock.now();
      const auditEventId = await dependencies.audit.recordFailure({
        actorMemberId: null,
        ...(context ? { context } : {}),
        occurredAt,
        transaction,
      });
      await dependencies.audit.assertFailurePostcondition({
        actorMemberId: null,
        ...(auditEventId ? { auditEventId } : {}),
        ...(context ? { context } : {}),
        occurredAt,
        transaction,
      });
    });
  };
  const rejectedByBudget = async (
    scope: "mfa" | "password",
    subject: string,
    reservationId: string,
    retryAfterSeconds: number,
  ): Promise<ProtectedSessionResult> => {
    try {
      const auditUserId = await dependencies.identity
        .resolveAuthenticationAuditUser({ scope, subject });
      await recordFailure(auditUserId);
    } catch (error) {
      await dependencies.attemptBudget.finalize({
        reservationId,
        statusCode: 503,
      });
      throw error;
    }
    await dependencies.attemptBudget.finalize({
      reservationId,
      statusCode: 429,
    });
    return { retryAfterSeconds, status: "rate-limited" };
  };
  const admittedAttempt = async (
    reservationId: string,
    work: (reservationId: string) => Promise<ProtectedSessionResult>,
  ): Promise<ProtectedSessionResult> => {
    try {
      const result = await work(reservationId);
      if (result.status !== "authenticated") {
        await dependencies.attemptBudget.finalize({
          reservationId,
          statusCode: protectedSessionHttpStatus(result),
        });
      }
      return result;
    } catch (error) {
      await dependencies.attemptBudget.finalize({
        reservationId,
        statusCode: 503,
      });
      throw error;
    }
  };
  const establish = async (
    command: {
      readonly credentialVersion?: Date | null;
      readonly ipAddress?: string;
      readonly previousSessionToken?: string;
      readonly reservationId?: string;
      readonly requestedWorkspaceId?: string;
      readonly userAgent?: string;
      readonly userId: string;
    },
  ): Promise<ProtectedSessionResult> =>
    await dependencies.transaction.run(async (transaction) => {
      const context = await dependencies.workspace.resolveActiveContext({
        ...requested(command),
        transaction,
        userId: command.userId,
      });
      if (!context) return { status: "membership-inactive" };
      const session = await dependencies.identity.issueSession({
        ...client(command),
        ...(Object.hasOwn(command, "credentialVersion")
          ? { credentialVersion: command.credentialVersion ?? null }
          : {}),
        ...(command.previousSessionToken
          ? { previousToken: command.previousSessionToken }
          : {}),
        transaction,
        userId: command.userId,
      });
      const occurredAt = dependencies.clock.now();
      const auditEventId = await dependencies.audit.record({
        context,
        occurredAt,
        outcome: "succeeded",
        transaction,
      });
      await dependencies.identity.assertSessionPostcondition({
        expiresAt: session.expiresAt,
        token: session.token,
        transaction,
        userId: command.userId,
      });
      await dependencies.workspace.assertActiveContextPostcondition({
        ...context,
        transaction,
      });
      await dependencies.audit.assertPostcondition({
        auditEventId,
        context,
        occurredAt,
        outcome: "succeeded",
        transaction,
      });
      if (command.reservationId) {
        await dependencies.attemptBudget.finalize({
          reservationId: command.reservationId,
          statusCode: 200,
          transaction,
          userId: command.userId,
        });
      }
      return {
        expiresAt: session.expiresAt,
        member: { id: context.memberId, role: context.role },
        sessionToken: session.token,
        status: "authenticated",
        userId: command.userId,
        workspace: { id: context.workspaceId, name: context.workspaceName },
      };
    });

  return {
    async signIn(command) {
      return await dependencies.responseEqualizer.run(async () => {
        const admission = await dependencies.attemptBudget.reserve({
          clientAddress: command.ipAddress,
          occurredAt: dependencies.clock.now(),
          scope: "password",
          subject: command.email,
        });
        if (admission.status === "rate-limited") {
          return await rejectedByBudget(
            "password",
            command.email,
            admission.reservationId,
            admission.retryAfterSeconds,
          );
        }
        return await admittedAttempt(admission.reservationId, async (
          reservationId,
        ) => {
          const primary = await dependencies.identity.authenticatePassword({
            ...client(command),
            email: command.email,
            password: command.password,
          });
          if (primary.status === "invalid") {
            await recordFailure(primary.auditUserId);
            return { status: "invalid-credentials" };
          }
          if (primary.status === "rate-limited") {
            await recordFailure(primary.auditUserId);
            return {
              retryAfterSeconds: primary.retryAfterSeconds,
              status: "rate-limited",
            };
          }
          if (primary.status === "mfa-required") {
            const hasContext = await dependencies.transaction.run(
              (transaction) =>
                dependencies.workspace.resolveActiveContext({
                  ...requested(command),
                  transaction,
                  userId: primary.userId,
                }),
            );
            if (hasContext) {
              return {
                challengeToken: primary.challengeToken,
                status: "mfa-required",
              };
            }
            await recordFailure(primary.userId);
            return { status: "membership-inactive" };
          }
          const established = await establish({
            ...client(command),
            ...requested(command),
            ...(command.previousSessionToken
              ? { previousSessionToken: command.previousSessionToken }
              : {}),
            credentialVersion: primary.credentialVersion,
            reservationId,
            userId: primary.userId,
          });
          if (established.status === "membership-inactive") {
            await recordFailure(primary.userId);
          }
          return established;
        });
      });
    },
    async completeMfa(command) {
      return await dependencies.responseEqualizer.run(async () => {
        const subject = await dependencies.identity.authenticationSubjectForMfa(
          command.challengeToken,
        );
        const admission = await dependencies.attemptBudget.reserve({
          clientAddress: command.ipAddress,
          occurredAt: dependencies.clock.now(),
          scope: "mfa",
          subject,
        });
        if (admission.status === "rate-limited") {
          return await rejectedByBudget(
            "mfa",
            subject,
            admission.reservationId,
            admission.retryAfterSeconds,
          );
        }
        return await admittedAttempt(admission.reservationId, async (
          reservationId,
        ) => {
          const factor = await dependencies.transaction.run((transaction) =>
            dependencies.identity.completeMfa({
              challengeToken: command.challengeToken,
              factor: command.factor,
              transaction,
            })
          );
          if (factor.status === "invalid") {
            await recordFailure(factor.auditUserId);
            return { status: "invalid-mfa" };
          }
          if (factor.status === "expired") {
            await recordFailure(factor.auditUserId);
            return { status: "challenge-expired" };
          }
          if (factor.status === "rate-limited") {
            await recordFailure(factor.auditUserId);
            return {
              retryAfterSeconds: factor.retryAfterSeconds,
              status: "rate-limited",
            };
          }
          const established = await establish({
            ...client(command),
            ...requested(command),
            ...(command.previousSessionToken
              ? { previousSessionToken: command.previousSessionToken }
              : {}),
            credentialVersion: factor.credentialVersion,
            reservationId,
            userId: factor.userId,
          });
          if (established.status === "membership-inactive") {
            await recordFailure(factor.userId);
          }
          return established;
        });
      });
    },
    establishVerifiedEntry: establish,
    async resolve(command) {
      const principal = await dependencies.identity.resolveSession(
        command.sessionToken,
      );
      if (!principal) return undefined;
      return await dependencies.transaction.run(async (transaction) => {
        const active = await dependencies.workspace.resolveActiveContext({
          ...requested(command),
          transaction,
          userId: principal.userId,
        });
        if (!active) return undefined;
        const accessibleWorkspaces = await dependencies.workspace
          .listActiveContexts({ transaction, userId: principal.userId });
        return { ...active, accessibleWorkspaces };
      });
    },
    async signOut(sessionToken) {
      await dependencies.transaction.run((transaction) =>
        dependencies.identity.revokeSession({
          token: sessionToken,
          transaction,
        })
      );
    },
  };
}
