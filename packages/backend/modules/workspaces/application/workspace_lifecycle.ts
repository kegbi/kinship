/**
 * Resetting and deleting a workspace.
 *
 * Both are the same sequence, and every step of it is a chance to refuse:
 * only an owner may ask, the throttle has to admit the attempt, the password
 * has to be re-entered, the confirmation phrase has to name the workspace, and
 * the impact token has to still match what the member was shown. Each refusal
 * is recorded against the actor before it is returned, so the audit history
 * shows the attempts as well as the one that worked.
 *
 * The order of the last two checks is deliberate: the confirmation is what the
 * member typed and the token is what the page held, so a mistyped phrase is
 * reported as a mistyped phrase even when the workspace has also moved on.
 *
 * Everything up to the commit is one transaction; the stored objects are not,
 * because they are not in the database. The rows commit first and the objects
 * are removed afterwards, so a failure in between leaves a cleanup to retry
 * rather than rows pointing at objects that are already gone.
 *
 * The `catch` is the careful part. A reservation that is never finalized would
 * hold a slot against the member, so it is finalized as 503; and an attempt
 * that authenticated but did not commit is recorded as a transactional failure
 * in a fresh transaction, because the one it was in has unwound. Both are
 * best-effort and neither is allowed to replace the original error.
 */

import {
  lifecycleConfirmation,
  type WorkspaceLifecycleOutcome,
} from "../domain/workspace_lifecycle_rules.ts";
import { owner } from "../domain/roles.ts";
import type {
  WorkspaceLifecycleActor,
  WorkspaceLifecycleTransaction,
} from "../ports/context.ts";
import {
  createWorkspaceCleanupReconciler,
  inspectImpact,
  type WorkspaceLifecycleDependencies,
} from "./workspace_lifecycle_context.ts";

export { createWorkspaceCleanupReconciler };

type LifecycleInput = {
  readonly confirmation: string;
  readonly impactToken: string;
  readonly password: string;
};

type WorkspaceLifecycleMutationResult =
  | {
    readonly cleanupStatus: "complete" | "pending";
    readonly status: "deleted" | "reset";
  }
  | { readonly retryAfterSeconds: number; readonly status: "rate-limited" }
  | {
    readonly status: Exclude<WorkspaceLifecycleOutcome, "rate-limited">;
  };

type WorkspaceLifecycleTransactionResult =
  | WorkspaceLifecycleMutationResult
  | {
    readonly objectKeys: readonly string[];
    readonly recordId: string;
    readonly status: "deleted" | "reset";
  };

export function createWorkspaceLifecycle(
  dependencies: WorkspaceLifecycleDependencies,
) {
  const reconciler = createWorkspaceCleanupReconciler(dependencies);
  const inspect = (
    actor: WorkspaceLifecycleActor,
    transaction: WorkspaceLifecycleTransaction,
    lock = false,
  ) => inspectImpact(dependencies, actor, transaction, lock);

  const mutate = async (
    action: "delete" | "reset",
    actor: WorkspaceLifecycleActor,
    input: LifecycleInput,
    request: { readonly clientAddress: string },
  ): Promise<WorkspaceLifecycleMutationResult> => {
    let reservationId: string | undefined;
    let authenticated = false;
    let primaryCommitted = false;
    const record = (
      outcome: WorkspaceLifecycleOutcome,
      occurredAt: Date,
      transaction: WorkspaceLifecycleTransaction,
    ) =>
      dependencies.audit.record({
        ...actor,
        action,
        occurredAt,
        outcome,
        transaction,
      });
    const recordAuthenticationFailure = async (
      occurredAt: Date,
      transaction: WorkspaceLifecycleTransaction,
    ) => {
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
    try {
      const result = await dependencies.transaction.run<
        WorkspaceLifecycleTransactionResult
      >(async (transaction) => {
        const occurredAt = dependencies.clock.now();
        if (!owner(actor)) {
          await record("forbidden", occurredAt, transaction);
          return { status: "forbidden" as const };
        }
        const admission = await dependencies.attemptBudget.reserve({
          clientAddress: request.clientAddress,
          occurredAt,
          scope: "password",
          subject: actor.userId,
        });
        reservationId = admission.reservationId;
        if (admission.status === "rate-limited") {
          await recordAuthenticationFailure(occurredAt, transaction);
          await record("rate-limited", occurredAt, transaction);
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
        if (
          !await dependencies.identity.verifyPassword({
            password: input.password,
            transaction,
            userId: actor.userId,
          })
        ) {
          await recordAuthenticationFailure(occurredAt, transaction);
          await record("reauthentication-required", occurredAt, transaction);
          await dependencies.attemptBudget.finalize({
            reservationId: admission.reservationId,
            statusCode: 401,
            transaction,
          });
          return { status: "reauthentication-required" as const };
        }
        authenticated = true;
        await dependencies.attemptBudget.finalize({
          reservationId: admission.reservationId,
          statusCode: 200,
          transaction,
          userId: actor.userId,
        });
        const current = await inspect(actor, transaction, true);
        if (!current) {
          await record("forbidden", occurredAt, transaction);
          return { status: "forbidden" as const };
        }
        if (
          input.confirmation !==
            lifecycleConfirmation(action, current.workspaceName)
        ) {
          await record("confirmation-invalid", occurredAt, transaction);
          return { status: "confirmation-invalid" as const };
        }
        if (input.impactToken !== current.impactToken) {
          await record("stale-impact", occurredAt, transaction);
          return { status: "stale-impact" as const };
        }
        const recordId = dependencies.ids.create();
        const command = {
          ...actor,
          counts: current.counts,
          objectKeys: current.objectKeys,
          occurredAt,
          recordId,
          transaction,
        };
        if (action === "reset") {
          await dependencies.repository.resetWorkspace(command);
          await dependencies.activityAudit.recordReset(command);
        } else await dependencies.repository.deleteWorkspace(command);
        return {
          objectKeys: current.objectKeys,
          recordId,
          status: action === "reset" ? "reset" as const : "deleted" as const,
        };
      });
      primaryCommitted = true;
      if (!("recordId" in result)) {
        return result;
      }
      return {
        cleanupStatus: await reconciler.cleanup(
          result.recordId,
          result.objectKeys,
        ),
        status: result.status,
      };
    } catch (error) {
      if (reservationId) {
        try {
          await dependencies.attemptBudget.finalize({
            reservationId,
            statusCode: 503,
          });
        } catch {
          // Preserve the primary database failure.
        }
      }
      if (authenticated && !primaryCommitted) {
        try {
          await dependencies.transaction.run((transaction) =>
            record(
              "transactional-failure",
              dependencies.clock.now(),
              transaction,
            )
          );
        } catch {
          // The redacted fallback is best-effort when the database is unavailable.
        }
      }
      throw error;
    }
  };

  return {
    preview: async (actor: WorkspaceLifecycleActor) => {
      if (!owner(actor)) return { status: "forbidden" as const };
      return await dependencies.transaction.run(async (transaction) => {
        const snapshot = await inspect(actor, transaction);
        return snapshot
          ? {
            ...snapshot,
            deleteConfirmation: lifecycleConfirmation(
              "delete",
              snapshot.workspaceName,
            ),
            resetConfirmation: lifecycleConfirmation(
              "reset",
              snapshot.workspaceName,
            ),
            status: "ready" as const,
          }
          : { status: "forbidden" as const };
      });
    },

    resetWorkspace: (
      actor: WorkspaceLifecycleActor,
      input: LifecycleInput,
      request = { clientAddress: "127.0.0.1" },
    ) => mutate("reset", actor, input, request),

    deleteWorkspace: (
      actor: WorkspaceLifecycleActor,
      input: LifecycleInput,
      request = { clientAddress: "127.0.0.1" },
    ) => mutate("delete", actor, input, request),

    reconcilePendingCleanup: reconciler.reconcilePendingCleanup,
  };
}

export type WorkspaceLifecycle = ReturnType<typeof createWorkspaceLifecycle>;
