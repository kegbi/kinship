/**
 * What resetting or deleting a workspace needs before it may proceed.
 *
 * `inspectImpact` is the read both the preview and the write share, and it has
 * to be the same read: what the member is shown and what the write checks the
 * impact token against are derived from the same eleven questions in the same
 * order. The only difference is the lock — the preview takes none, the write
 * takes one — so a workspace cannot change between being counted and being
 * destroyed.
 *
 * The cleanup reconciler is here rather than beside the use case because it
 * outlives it. Stored objects live outside the transaction, so a reset or a
 * delete commits the rows and leaves the keys behind; this is what removes
 * them, and what a later run calls to finish a job that was interrupted.
 * Nothing is marked complete until every object is gone, so a retry is always
 * safe and a half-finished cleanup stays pending rather than being forgotten.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import {
  mergeImpact,
  type WorkspaceLifecycleSnapshot,
} from "../domain/workspace_lifecycle_rules.ts";
import type {
  WorkspaceLifecycleActor,
  WorkspaceLifecycleTransaction,
  WorkspaceLifecycleTransactionRunner,
} from "../ports/context.ts";
import type {
  AuthenticationAttemptBudget,
  AuthenticationAudit,
} from "../ports/session.ts";
import type {
  WorkspaceLifecycleCascadeParticipants,
  WorkspaceLifecycleDependentErasures,
  WorkspaceLifecycleIdentity,
  WorkspaceLifecycleObjectStorage,
  WorkspaceLifecycleRepository,
  WorkspaceLifecycleSecurityAudit,
  WorkspaceResetActivityAudit,
} from "../ports/workspace_lifecycle_repository.ts";

export interface WorkspaceLifecycleDependencies {
  readonly attemptBudget: AuthenticationAttemptBudget;
  readonly activityAudit: WorkspaceResetActivityAudit;
  readonly audit: WorkspaceLifecycleSecurityAudit;
  readonly authenticationAudit: AuthenticationAudit;
  readonly clock: Clock;
  readonly erasure: WorkspaceLifecycleDependentErasures;
  readonly identity: WorkspaceLifecycleIdentity;
  readonly ids: IdGenerator;
  readonly impact: WorkspaceLifecycleCascadeParticipants;
  readonly repository: WorkspaceLifecycleRepository;
  readonly storage: WorkspaceLifecycleObjectStorage;
  readonly transaction: WorkspaceLifecycleTransactionRunner;
}

/** What the workspace holds, with every module's share folded in. */
export async function inspectImpact(
  dependencies: Pick<WorkspaceLifecycleDependencies, "impact" | "repository">,
  actor: WorkspaceLifecycleActor,
  transaction: WorkspaceLifecycleTransaction,
  lock = false,
): Promise<WorkspaceLifecycleSnapshot | undefined> {
  const snapshot = await dependencies.repository.inspect({
    ...actor,
    lock,
    transaction,
  });
  if (!snapshot) return undefined;
  const command = { transaction, workspaceId: actor.workspaceId };
  const contributions = [
    await dependencies.impact.people.inspectBeforeCascade(command),
    await dependencies.impact.relationships.inspectBeforeCascade(command),
    await dependencies.impact.interactions.inspectBeforeCascade(command),
    await dependencies.impact.journal.inspectBeforeCascade(command),
    await dependencies.impact.planning.inspectBeforeCascade(command),
    await dependencies.impact.files.inspectBeforeCascade(command),
    await dependencies.impact.gifts.inspectBeforeCascade(command),
    await dependencies.impact.integrations.inspectBeforeCascade(command),
    await dependencies.impact.importExport.inspectBeforeCascade(command),
    await dependencies.impact.governance.inspectBeforeCascade(command),
    await dependencies.impact.operations.inspectBeforeCascade(command),
  ];
  return await mergeImpact(snapshot, contributions);
}

/**
 * Removes, in dependency order, the rows the workspace cascade would reach
 * through an `ON DELETE RESTRICT` key: relationships first, then people with
 * everything a person owns. Only the vocabularies are left for the cascade.
 */
export async function eraseDependents(
  dependencies: Pick<WorkspaceLifecycleDependencies, "erasure">,
  transaction: WorkspaceLifecycleTransaction,
  workspaceId: string,
): Promise<void> {
  const command = { transaction, workspaceId };
  await dependencies.erasure.relationships.eraseBeforeCascade(command);
  await dependencies.erasure.people.eraseBeforeCascade(command);
}

export function createWorkspaceCleanupReconciler(
  dependencies: Pick<
    WorkspaceLifecycleDependencies,
    "clock" | "repository" | "storage"
  >,
) {
  const cleanup = async (
    recordId: string,
    workspaceId: string,
    objectKeys: readonly string[],
  ) => {
    let failed = false;
    for (const key of objectKeys) {
      try {
        await dependencies.storage.remove({ key });
      } catch {
        failed = true;
      }
    }
    if (!failed) {
      try {
        await dependencies.repository.completeCleanup({
          completedAt: dependencies.clock.now(),
          recordId,
          workspaceId,
        });
      } catch {
        failed = true;
      }
    }
    return failed ? "pending" as const : "complete" as const;
  };
  return {
    cleanup,
    reconcilePendingCleanup: async (limit = 20) => {
      const pending = await dependencies.repository.listPendingCleanups({
        limit,
      });
      let completed = 0;
      for (const item of pending) {
        const done = await cleanup(
          item.recordId,
          item.workspaceId,
          item.objectKeys,
        );
        if (done === "complete") {
          completed++;
        }
      }
      return { completed, inspected: pending.length };
    },
  };
}
