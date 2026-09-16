import type { Clock } from "../../../shared-kernel/clock.ts";
import type {
  IdentityPersonalLifecycleFacade,
  IdentityTransaction,
} from "../../identity/public.ts";
import type {
  ActiveWorkspaceContext,
  AuthenticationAttemptBudget,
  AuthenticationAudit,
} from "./protected_session.ts";

export interface PersonalLifecycleTransaction extends IdentityTransaction {
  readonly opaque: unknown;
}

export interface PersonalLifecycleActor extends ActiveWorkspaceContext {}

export interface PersonalLifecycleMembership {
  readonly finalOwner: boolean;
  readonly memberId: string;
  readonly role: PersonalLifecycleActor["role"];
  readonly status: "active" | "suspended";
  readonly workspaceId: string;
  readonly workspaceName: string;
}

export interface PersonalLifecycleMemberships {
  inspect(command: {
    readonly lock?: boolean;
    readonly transaction: PersonalLifecycleTransaction;
    readonly userId: string;
  }): Promise<{
    readonly memberships: readonly PersonalLifecycleMembership[];
  }>;
  leaveCurrent(
    command: PersonalLifecycleActor & {
      readonly leftAt: Date;
      readonly transaction: PersonalLifecycleTransaction;
    },
  ): Promise<void>;
  leaveAll(command: {
    readonly leftAt: Date;
    readonly transaction: PersonalLifecycleTransaction;
    readonly userId: string;
  }): Promise<void>;
}

export interface PersonalLifecycleAudit {
  record(command: {
    readonly action: string;
    readonly actorMemberId: string;
    readonly occurredAt: Date;
    readonly payload: Readonly<Record<string, unknown>>;
    readonly subjectId: string;
    readonly subjectType: string;
    readonly transaction: PersonalLifecycleTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
}

export interface PersonalLifecycleDependencies {
  readonly attemptBudget: AuthenticationAttemptBudget;
  readonly audit: PersonalLifecycleAudit;
  readonly authenticationAudit: Pick<
    AuthenticationAudit,
    "assertFailurePostcondition" | "recordFailure"
  >;
  readonly clock: Clock;
  readonly identity: IdentityPersonalLifecycleFacade;
  readonly memberships: PersonalLifecycleMemberships;
  readonly transaction: {
    run<T>(
      work: (transaction: PersonalLifecycleTransaction) => Promise<T>,
    ): Promise<T>;
  };
}

const blockingWorkspaces = (
  memberships: readonly PersonalLifecycleMembership[],
) =>
  memberships.filter((membership) => membership.finalOwner).map(
    (membership) => ({
      id: membership.workspaceId,
      name: membership.workspaceName,
    }),
  );

export function createPersonalLifecycle(
  dependencies: PersonalLifecycleDependencies,
) {
  const withStepUp = async <T>(
    actor: PersonalLifecycleActor,
    password: string,
    request: { readonly clientAddress: string },
    work: (transaction: PersonalLifecycleTransaction) => Promise<T>,
  ): Promise<
    | T
    | { readonly status: "reauthentication-required" }
    | {
      readonly retryAfterSeconds: number;
      readonly status: "rate-limited";
    }
  > => {
    let reservationId: string | undefined;
    try {
      return await dependencies.transaction.run(async (transaction) => {
        const occurredAt = dependencies.clock.now();
        const admission = await dependencies.attemptBudget.reserve({
          clientAddress: request.clientAddress,
          occurredAt,
          scope: "password",
          subject: actor.userId,
        });
        reservationId = admission.reservationId;
        const recordFailure = async () => {
          const auditEventId = await dependencies.authenticationAudit
            .recordFailure({
              actorMemberId: null,
              context: actor,
              occurredAt,
              transaction,
            });
          await dependencies.authenticationAudit.assertFailurePostcondition({
            actorMemberId: null,
            ...(auditEventId ? { auditEventId } : {}),
            context: actor,
            occurredAt,
            transaction,
          });
        };
        if (admission.status === "rate-limited") {
          await recordFailure();
          await dependencies.attemptBudget.finalize({
            reservationId: admission.reservationId,
            statusCode: 429,
            transaction,
          });
          return {
            retryAfterSeconds: admission.retryAfterSeconds,
            status: "rate-limited" as const,
          };
        }
        const verified = await dependencies.identity.verifyPassword({
          password,
          transaction,
          userId: actor.userId,
        });
        if (!verified) {
          await recordFailure();
          await dependencies.attemptBudget.finalize({
            reservationId: admission.reservationId,
            statusCode: 401,
            transaction,
          });
          return { status: "reauthentication-required" as const };
        }
        await dependencies.attemptBudget.finalize({
          reservationId: admission.reservationId,
          statusCode: 200,
          transaction,
          userId: actor.userId,
        });
        return await work(transaction);
      });
    } catch (error) {
      if (reservationId) {
        await dependencies.attemptBudget.finalize({
          reservationId,
          statusCode: 503,
        });
      }
      throw error;
    }
  };
  return {
    preview: (actor: PersonalLifecycleActor) =>
      dependencies.transaction.run(async (transaction) => {
        const identity = await dependencies.identity.inspectIdentity({
          now: dependencies.clock.now(),
          transaction,
          userId: actor.userId,
        });
        const snapshot = await dependencies.memberships.inspect({
          transaction,
          userId: actor.userId,
        });
        if (!identity) return { status: "not-found" as const };
        const current = snapshot.memberships.find((membership) =>
          membership.memberId === actor.memberId &&
          membership.workspaceId === actor.workspaceId
        );
        if (!current) return { status: "not-found" as const };
        return {
          activeSessionCount: identity.activeSessionCount,
          blockingWorkspaces: blockingWorkspaces(snapshot.memberships),
          deleteConfirmation: `DELETE ${identity.email}`,
          leaveConfirmation: `LEAVE ${current.workspaceName}`,
          memberships: snapshot.memberships,
          retainedLegalRecords: true,
          status: "ready" as const,
        };
      }),
    leaveWorkspace: (
      actor: PersonalLifecycleActor,
      input: { readonly confirmation: string; readonly password: string },
      request: { readonly clientAddress: string },
    ) =>
      withStepUp(actor, input.password, request, async (transaction) => {
        const snapshot = await dependencies.memberships.inspect({
          lock: true,
          transaction,
          userId: actor.userId,
        });
        const current = snapshot.memberships.find((membership) =>
          membership.memberId === actor.memberId &&
          membership.workspaceId === actor.workspaceId
        );
        if (!current) return { status: "not-found" as const };
        if (input.confirmation !== `LEAVE ${current.workspaceName}`) {
          return { status: "confirmation-invalid" as const };
        }
        if (current.finalOwner) {
          await dependencies.audit.record({
            action: "workspace.member-leave-attempted",
            actorMemberId: current.memberId,
            occurredAt: dependencies.clock.now(),
            payload: { outcome: "blocked-final-owner" },
            subjectId: current.memberId,
            subjectType: "workspace_member",
            transaction,
            workspaceId: current.workspaceId,
          });
          return {
            blockingWorkspaces: [{
              id: current.workspaceId,
              name: current.workspaceName,
            }],
            status: "final-owner" as const,
          };
        }
        const occurredAt = dependencies.clock.now();
        await dependencies.memberships.leaveCurrent({
          ...actor,
          leftAt: occurredAt,
          transaction,
        });
        await dependencies.audit.record({
          action: "workspace.member-left",
          actorMemberId: current.memberId,
          occurredAt,
          payload: {},
          subjectId: current.memberId,
          subjectType: "workspace_member",
          transaction,
          workspaceId: current.workspaceId,
        });
        const next = snapshot.memberships.find((membership) =>
          membership.memberId !== current.memberId &&
          membership.status === "active"
        );
        if (!next) {
          await dependencies.identity.revokeSessions({
            revokedAt: occurredAt,
            transaction,
            userId: actor.userId,
          });
        }
        return {
          ...(next ? { nextWorkspaceId: next.workspaceId } : {}),
          signedOut: !next,
          status: "left" as const,
        };
      }),
    deleteIdentity: (
      actor: PersonalLifecycleActor,
      input: { readonly confirmation: string; readonly password: string },
      request: { readonly clientAddress: string },
    ) =>
      withStepUp(actor, input.password, request, async (transaction) => {
        const identity = await dependencies.identity.inspectIdentity({
          now: dependencies.clock.now(),
          transaction,
          userId: actor.userId,
        });
        if (!identity) return { status: "not-found" as const };
        if (input.confirmation !== `DELETE ${identity.email}`) {
          return { status: "confirmation-invalid" as const };
        }
        const snapshot = await dependencies.memberships.inspect({
          lock: true,
          transaction,
          userId: actor.userId,
        });
        const blocking = blockingWorkspaces(snapshot.memberships);
        if (blocking.length > 0) {
          const occurredAt = dependencies.clock.now();
          for (
            const membership of snapshot.memberships.filter((item) =>
              item.finalOwner
            )
          ) {
            await dependencies.audit.record({
              action: "identity.deletion-attempted",
              actorMemberId: membership.memberId,
              occurredAt,
              payload: { outcome: "blocked-final-owner" },
              subjectId: actor.userId,
              subjectType: "user",
              transaction,
              workspaceId: membership.workspaceId,
            });
          }
          return {
            blockingWorkspaces: blocking,
            status: "final-owner" as const,
          };
        }
        const occurredAt = dependencies.clock.now();
        for (const membership of snapshot.memberships) {
          await dependencies.audit.record({
            action: "identity.deletion-attempted",
            actorMemberId: membership.memberId,
            occurredAt,
            payload: { outcome: "completed" },
            subjectId: actor.userId,
            subjectType: "user",
            transaction,
            workspaceId: membership.workspaceId,
          });
        }
        await dependencies.memberships.leaveAll({
          leftAt: occurredAt,
          transaction,
          userId: actor.userId,
        });
        await dependencies.identity.deleteIdentity({
          deletedAt: occurredAt,
          transaction,
          userId: actor.userId,
        });
        return { status: "deleted" as const };
      }),
  };
}

export type PersonalLifecycle = ReturnType<typeof createPersonalLifecycle>;
