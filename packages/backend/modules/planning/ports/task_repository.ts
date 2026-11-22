/**
 * How the module stores and finds a task.
 *
 * `lockRequest` is the idempotency gate: it takes the advisory lock a derived
 * identifier names, so two retries of one creation queue behind each other
 * instead of racing. `find` takes a `lock` flag rather than offering two
 * methods, because a read and a write differ only in whether the row is held.
 * `assertPostcondition` is the other half of the write discipline — the row is
 * read back inside the transaction, so a save that silently did nothing fails
 * loudly instead of being audited as a success.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  StoredTask,
  TaskListAnchor,
  TaskStatus,
} from "../domain/task_rules.ts";
import type { PlanningActor, PlanningTransaction } from "./context.ts";

/** One page of tasks, or the fact that the cursor no longer fits. */
export type TaskPage =
  | { readonly status: "stale-cursor" }
  | {
    readonly items: readonly StoredTask[];
    readonly next?: TaskListAnchor;
    readonly status: "ready";
  };

/** The task that was found, if the actor may see it at all. */
export type TaskLookup =
  | Failure<"not-found">
  | { readonly status: "found"; readonly task: StoredTask };

export interface TaskRepository {
  lockRequest(command: {
    readonly id: string;
    readonly transaction: PlanningTransaction;
  }): Promise<void>;
  find(
    command: PlanningActor & {
      readonly id: string;
      readonly lock: boolean;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<TaskLookup>;
  list(
    command: PlanningActor & {
      readonly after?: TaskListAnchor;
      readonly dueBefore?: Date;
      readonly limit: number;
      readonly personId?: string;
      readonly status?: TaskStatus;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<TaskPage>;
  create(
    command: PlanningActor & {
      readonly description?: string;
      readonly dueAt?: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId?: string;
      readonly title: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<StoredTask | undefined>;
  save(
    command: PlanningActor & {
      readonly completedAt?: Date | null;
      readonly description?: string | null;
      readonly dueAt?: string | null;
      readonly expectedUpdatedAt?: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId?: string | null;
      readonly status?: TaskStatus;
      readonly title?: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<StoredTask | undefined>;
  /**
   * Soft-deletes the task while it still carries `expectedUpdatedAt`, and
   * answers the row as it was; undefined when it is gone or has changed.
   */
  delete(
    command: PlanningActor & {
      readonly expectedUpdatedAt: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<StoredTask | undefined>;
  /** Whether `id` names a task this workspace deleted. */
  isDeleted(
    command: PlanningActor & {
      readonly id: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<boolean>;
  /**
   * Proves the write is stored: the task as saved, or with `deleted`, the
   * task soft-deleted.
   */
  assertPostcondition(
    command: PlanningActor & {
      readonly deleted?: boolean;
      readonly task: StoredTask;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<void>;
}
