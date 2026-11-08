/**
 * Reading one task, and one page of them.
 *
 * Both reads revalidate the actor under lock first, because a member whose
 * standing was revoked mid-session must not read a workspace's rows even
 * though nothing is being written. Beyond that the two differ: fetching one
 * task refuses a malformed identifier before it reaches storage, while the
 * listing turns the caller's filters into the scope a cursor is sealed
 * against, so a cursor replayed against a different question is reported as
 * stale rather than silently answered with the wrong rows.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import { uuid } from "../../../shared-kernel/validation.ts";
import { decodeTaskCursor, encodeTaskCursor } from "../domain/cursors.ts";
import type { TaskCursorScope } from "../domain/cursors.ts";
import {
  dueBeforeFilter,
  taskPageLimit,
  type TaskRecord,
  type TaskStatus,
} from "../domain/task_rules.ts";
import type { PlanningActor, PlanningTransaction } from "../ports/context.ts";
import {
  actorStands,
  hydrate,
  inTransaction,
  type TaskManagementDependencies,
} from "./task_context.ts";

export type GetTaskResult =
  // A malformed task identifier names no field, so this is the module's own
  // bare `validation-error`, not the kernel's payload-carrying one.
  | Failure<"forbidden" | "not-found", "validation-error">
  | { readonly status: "ready"; readonly task: TaskRecord };

export type ListTasksResult =
  | {
    readonly items: readonly TaskRecord[];
    readonly nextCursor?: string;
    readonly status: "ready";
  }
  | Failure<"forbidden", "stale-cursor">;

export interface ListTasksInput {
  readonly cursor?: string;
  readonly dueBefore?: string;
  readonly limit?: number;
  readonly personId?: string;
  readonly status?: TaskStatus;
}

export function createTaskListing(dependencies: TaskManagementDependencies) {
  return {
    get: (
      actor: PlanningActor,
      taskId: string,
      existingTransaction?: PlanningTransaction,
    ): Promise<GetTaskResult> => {
      const id = uuid(taskId);
      if (id === undefined) {
        return Promise.resolve({ status: "validation-error" });
      }
      return inTransaction(dependencies, actor, existingTransaction, async (
        transaction,
      ): Promise<GetTaskResult> => {
        if (!await actorStands(dependencies, actor, transaction)) {
          return { status: "forbidden" };
        }
        const current = await dependencies.repository.find({
          ...actor,
          id,
          lock: false,
          transaction,
        });
        if (current.status !== "found") return { status: "not-found" };
        const [task] = await hydrate(dependencies, actor, transaction, [
          current.task,
        ]);
        return { status: "ready", task: task! };
      });
    },
    list: (
      actor: PlanningActor,
      input: ListTasksInput = {},
    ): Promise<ListTasksResult> =>
      dependencies.transaction.run(async (transaction) => {
        if (!await actorStands(dependencies, actor, transaction)) {
          return { status: "forbidden" };
        }
        const dueBefore = dueBeforeFilter(input.dueBefore);
        const scope: TaskCursorScope = {
          dueBefore: dueBefore ?? null,
          personId: input.personId ? input.personId.toLowerCase() : null,
          statusFilter: input.status ?? null,
          workspaceId: actor.workspaceId,
        };
        const after = input.cursor
          ? await decodeTaskCursor(
            input.cursor,
            scope,
            dependencies.cursorKeyset,
          )
          : undefined;
        if (input.cursor && !after) return { status: "stale-cursor" };
        const result = await dependencies.repository.list({
          ...actor,
          ...(after ? { after } : {}),
          ...(dueBefore ? { dueBefore: new Date(dueBefore) } : {}),
          limit: taskPageLimit(input.limit),
          ...(input.personId ? { personId: input.personId.toLowerCase() } : {}),
          ...(input.status ? { status: input.status } : {}),
          transaction,
        });
        if (result.status !== "ready") return result;
        return {
          items: await hydrate(
            dependencies,
            actor,
            transaction,
            result.items,
          ),
          ...(result.next
            ? {
              nextCursor: await encodeTaskCursor(
                scope,
                result.next,
                dependencies.cursorKeyset,
              ),
            }
            : {}),
          status: "ready",
        };
      }, { workspaceId: actor.workspaceId }),
  };
}
