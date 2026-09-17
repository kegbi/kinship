/**
 * Creating a task, changing one, and toggling its completion.
 *
 * All three writes follow the same discipline: check the proposal, revalidate
 * the actor under lock, prove the people involved may be written to, write,
 * and only then audit — with the repository and the recorder each reading
 * their own row back before the transaction may commit.
 *
 * Creation is idempotent by derivation rather than by a uniqueness error: the
 * request identifier derives the task identifier, an advisory lock serializes
 * retries of the same request, and a task already stored under that identifier
 * is returned when it is the same proposal and refused as a conflict when it
 * is not.
 */

import { deterministicId } from "../../../shared-kernel/ids.ts";
import { uuid } from "../../../shared-kernel/validation.ts";
import {
  type ChangeTaskInput,
  completionTarget,
  type CreateTaskInput,
  type StoredTask,
  targetPersonId,
  TASK_ID_NAMESPACE,
  taskChangeIsUnchanged,
  taskMatchesCreate,
  type TaskRecord,
  validateChangeTask,
  validateCreateTask,
} from "../domain/task_rules.ts";
import type { PlanningActor, PlanningTransaction } from "../ports/context.ts";
import {
  actorStands,
  auditTask,
  hydrate,
  inspectWritablePeople,
  inTransaction,
  type TaskFailure,
  type TaskManagementDependencies,
} from "./task_context.ts";

export type CreateTaskResult =
  | { readonly status: "created"; readonly task: TaskRecord }
  | { readonly status: "idempotency-conflict" }
  | TaskFailure;

export type ChangeTaskResult =
  | { readonly status: "saved" | "unchanged"; readonly task: TaskRecord }
  | TaskFailure;

export function createTaskWrites(dependencies: TaskManagementDependencies) {
  const hydrateOne = async (
    actor: PlanningActor,
    transaction: PlanningTransaction,
    task: StoredTask,
  ): Promise<TaskRecord> => {
    const [record] = await hydrate(dependencies, actor, transaction, [task]);
    return record!;
  };
  return {
    create: (
      actor: PlanningActor,
      input: CreateTaskInput,
      existingTransaction?: PlanningTransaction,
    ): Promise<CreateTaskResult> => {
      const checked = validateCreateTask(input);
      if (Object.keys(checked.errors).length > 0) {
        return Promise.resolve({
          errors: checked.errors,
          status: "validation-error",
        });
      }
      return inTransaction(dependencies, existingTransaction, async (
        transaction,
      ): Promise<CreateTaskResult> => {
        if (!await actorStands(dependencies, actor, transaction)) {
          return { status: "forbidden" };
        }
        const id = await deterministicId(TASK_ID_NAMESPACE, [
          actor.workspaceId,
          // The validation above proved the request identifier canonical.
          checked.requestId!,
        ]);
        await dependencies.repository.lockRequest({ id, transaction });
        const replay = await dependencies.repository.find({
          ...actor,
          id,
          lock: true,
          transaction,
        });
        if (replay.status === "found") {
          return taskMatchesCreate(replay.task, checked, actor.memberId)
            ? {
              status: "created",
              task: await hydrateOne(actor, transaction, replay.task),
            }
            : { status: "idempotency-conflict" };
        }
        const personStatus = await inspectWritablePeople(
          dependencies,
          actor,
          transaction,
          [checked.personId],
        );
        if (personStatus !== "ready") return { status: personStatus };
        const occurredAt = dependencies.clock.now();
        const task = await dependencies.repository.create({
          ...actor,
          ...(checked.description ? { description: checked.description } : {}),
          ...(checked.dueAt ? { dueAt: checked.dueAt } : {}),
          id,
          occurredAt,
          ...(checked.personId ? { personId: checked.personId } : {}),
          title: checked.title!,
          transaction,
        });
        if (!task) return { status: "not-found" };
        await auditTask(
          dependencies,
          actor,
          transaction,
          task,
          "created",
          occurredAt,
        );
        return {
          status: "created",
          task: await hydrateOne(actor, transaction, task),
        };
      });
    },
    change: (
      actor: PlanningActor,
      taskId: string,
      input: ChangeTaskInput,
      existingTransaction?: PlanningTransaction,
    ): Promise<ChangeTaskResult> => {
      const checked = validateChangeTask(taskId, input);
      if (Object.keys(checked.errors).length > 0) {
        return Promise.resolve({
          errors: checked.errors,
          status: "validation-error",
        });
      }
      return inTransaction(dependencies, existingTransaction, async (
        transaction,
      ): Promise<ChangeTaskResult> => {
        if (!await actorStands(dependencies, actor, transaction)) {
          return { status: "forbidden" };
        }
        const current = await dependencies.repository.find({
          ...actor,
          // The validation above rejected a non-canonical identifier.
          id: checked.id!,
          lock: true,
          transaction,
        });
        if (current.status !== "found") return { status: "not-found" };
        if (current.task.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" };
        }
        const target = targetPersonId(current.task, input.personId);
        const personStatus = await inspectWritablePeople(
          dependencies,
          actor,
          transaction,
          target === current.task.personId
            ? [current.task.personId]
            : [current.task.personId, target],
        );
        if (personStatus !== "ready") return { status: personStatus };
        if (taskChangeIsUnchanged(current.task, checked, input, target)) {
          return {
            status: "unchanged",
            task: await hydrateOne(actor, transaction, current.task),
          };
        }
        const occurredAt = dependencies.clock.now();
        const saved = await dependencies.repository.save({
          ...actor,
          ...(checked.description !== undefined
            ? { description: checked.description }
            : {}),
          ...(checked.dueAt !== undefined ? { dueAt: checked.dueAt } : {}),
          expectedUpdatedAt: input.expectedUpdatedAt,
          id: current.task.id,
          occurredAt,
          ...(input.personId !== undefined ? { personId: target ?? null } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.status && current.task.status === "completed"
            ? { completedAt: null }
            : {}),
          ...(checked.title ? { title: checked.title } : {}),
          transaction,
        });
        if (!saved) return { status: "stale" };
        await auditTask(
          dependencies,
          actor,
          transaction,
          saved,
          "changed",
          occurredAt,
        );
        return {
          status: "saved",
          task: await hydrateOne(actor, transaction, saved),
        };
      });
    },
    setCompletion: (
      actor: PlanningActor,
      taskId: string,
      completed: boolean,
      existingTransaction?: PlanningTransaction,
    ): Promise<ChangeTaskResult> => {
      const id = uuid(taskId);
      if (id === undefined) {
        return Promise.resolve({
          errors: { taskId: "Use a canonical task identifier." },
          status: "validation-error",
        });
      }
      return inTransaction(dependencies, existingTransaction, async (
        transaction,
      ): Promise<ChangeTaskResult> => {
        if (!await actorStands(dependencies, actor, transaction)) {
          return { status: "forbidden" };
        }
        const current = await dependencies.repository.find({
          ...actor,
          id,
          lock: true,
          transaction,
        });
        if (current.status !== "found") return { status: "not-found" };
        const personStatus = await inspectWritablePeople(
          dependencies,
          actor,
          transaction,
          [current.task.personId],
        );
        if (personStatus !== "ready") return { status: personStatus };
        const target = completionTarget(completed);
        if (current.task.status === target.status) {
          return {
            status: "unchanged",
            task: await hydrateOne(actor, transaction, current.task),
          };
        }
        const occurredAt = dependencies.clock.now();
        const saved = await dependencies.repository.save({
          ...actor,
          completedAt: completed ? occurredAt : null,
          id: current.task.id,
          occurredAt,
          status: target.status,
          transaction,
        });
        if (!saved) return { status: "stale" };
        await auditTask(
          dependencies,
          actor,
          transaction,
          saved,
          target.action,
          occurredAt,
        );
        return {
          status: "saved",
          task: await hydrateOne(actor, transaction, saved),
        };
      });
    },
  };
}
