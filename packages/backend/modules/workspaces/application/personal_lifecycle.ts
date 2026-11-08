/**
 * Leaving a workspace, and deleting an account.
 *
 * Both are guarded by `withStepUp`, which is the same shape the workspace
 * lifecycle uses: reserve against the throttle, re-enter the password, and
 * only then do the work — all inside one transaction, so the membership read
 * under lock and the write that follows it cannot be separated. A stolen
 * session is not enough to delete somebody's account.
 *
 * The rule the work itself enforces is that a workspace is never left without
 * an owner. Somebody who is the last owner of one is blocked, the attempt is
 * recorded against every workspace in the way, and the blocking workspaces are
 * named so the page can say which ones and not merely how many.
 *
 * Leaving ends one of two ways: into the next workspace this person is still
 * an active member of, or, when there is none, signed out entirely — every
 * session revoked in the same transaction, because an account with no
 * memberships has nothing to be signed in to. Either way, and for every
 * workspace an account deletion leaves, the API tokens and calendar feed the
 * person held there are revoked in the same transaction (SECT-07).
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  blockingWorkspaces,
  claimedMembership,
  deleteIdentityConfirmation,
  leaveWorkspaceConfirmation,
  nextMembership,
  type PersonalLifecycleMembership,
} from "../domain/personal_lifecycle_rules.ts";
import type {
  PersonalLifecycleActor,
  PersonalLifecycleTransaction,
  PersonalLifecycleTransactionRunner,
} from "../ports/context.ts";
import type { MemberCredentialRevocation } from "../ports/member_credentials.ts";
import type {
  PersonalLifecycleAudit,
  PersonalLifecycleMemberships,
} from "../ports/personal_lifecycle.ts";
import type {
  AuthenticationAttemptBudget,
  AuthenticationAudit,
} from "../ports/session.ts";
import type { IdentityPersonalLifecycleFacade } from "../../identity/public.ts";

export interface PersonalLifecycleDependencies {
  readonly attemptBudget: AuthenticationAttemptBudget;
  readonly audit: PersonalLifecycleAudit;
  readonly authenticationAudit: Pick<
    AuthenticationAudit,
    "assertFailurePostcondition" | "recordFailure"
  >;
  readonly clock: Clock;
  readonly identity: IdentityPersonalLifecycleFacade;
  readonly memberCredentials: MemberCredentialRevocation;
  readonly memberships: PersonalLifecycleMemberships;
  readonly transaction: PersonalLifecycleTransactionRunner;
}

export function createPersonalLifecycle(
  dependencies: PersonalLifecycleDependencies,
) {
  /** Revokes what the person held in one workspace they no longer belong to. */
  const revokeCredentials = (
    userId: string,
    membership: Pick<
      PersonalLifecycleMembership,
      "memberId" | "role" | "workspaceId"
    >,
    occurredAt: Date,
    transaction: PersonalLifecycleTransaction,
  ) =>
    dependencies.memberCredentials.revokeMemberCredentials({
      actor: {
        memberId: membership.memberId,
        role: membership.role,
        userId,
        workspaceId: membership.workspaceId,
      },
      occurredAt,
      subjectUserId: userId,
      transaction,
    });

  /** Runs `work` inside one of the account's workspaces (ADR 0008). */
  const inMembership = <T>(
    transaction: PersonalLifecycleTransaction,
    membership: Pick<PersonalLifecycleMembership, "workspaceId">,
    work: () => Promise<T>,
  ) =>
    dependencies.memberships.inMembershipWorkspace(
      { transaction, workspaceId: membership.workspaceId },
      work,
    );

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
      }, { workspaceId: actor.workspaceId });
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
        const current = claimedMembership(snapshot.memberships, actor);
        if (!current) return { status: "not-found" as const };
        return {
          activeSessionCount: identity.activeSessionCount,
          blockingWorkspaces: blockingWorkspaces(snapshot.memberships),
          deleteConfirmation: deleteIdentityConfirmation(identity.email),
          leaveConfirmation: leaveWorkspaceConfirmation(current.workspaceName),
          memberships: snapshot.memberships,
          retainedLegalRecords: true,
          status: "ready" as const,
        };
      }, { workspaceId: actor.workspaceId }),
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
        const current = claimedMembership(snapshot.memberships, actor);
        if (!current) return { status: "not-found" as const };
        if (
          input.confirmation !==
            leaveWorkspaceConfirmation(current.workspaceName)
        ) {
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
        await revokeCredentials(actor.userId, current, occurredAt, transaction);
        const next = nextMembership(snapshot.memberships, current);
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
        if (input.confirmation !== deleteIdentityConfirmation(identity.email)) {
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
            await inMembership(transaction, membership, () =>
              dependencies.audit.record({
                action: "identity.deletion-attempted",
                actorMemberId: membership.memberId,
                occurredAt,
                payload: { outcome: "blocked-final-owner" },
                subjectId: actor.userId,
                subjectType: "user",
                transaction,
                workspaceId: membership.workspaceId,
              }));
          }
          return {
            blockingWorkspaces: blocking,
            status: "final-owner" as const,
          };
        }
        const occurredAt = dependencies.clock.now();
        for (const membership of snapshot.memberships) {
          await inMembership(transaction, membership, async () => {
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
            await revokeCredentials(
              actor.userId,
              membership,
              occurredAt,
              transaction,
            );
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
