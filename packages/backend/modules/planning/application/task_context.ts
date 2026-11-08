/**
 * What reading or writing a task needs before it may proceed.
 *
 * Both halves of the use case — the two reads and the three writes — share
 * three steps: the actor is revalidated under lock inside the caller's
 * transaction, the people a task points at are checked for writability, and
 * every stored task is hydrated with the person the reader is allowed to see.
 * They were written out repeatedly inside one 768-line file; they are written
 * once here, and the two use-case files that follow are left with their own
 * work.
 *
 * Hydration is deliberately forgiving: a task whose person the boundary no
 * longer returns keeps its history as a read-only placeholder rather than
 * disappearing or leaking a name the actor may not see.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import type {
  StoredTask,
  TaskAuditAction,
  TaskPerson,
  TaskRecord,
} from "../domain/task_rules.ts";
import type { TaskCursorKeyset } from "../domain/cursors.ts";
import type { TaskAudit } from "../ports/audit.ts";
import type {
  PlanningActor,
  PlanningTransaction,
  PlanningTransactionRunner,
} from "../ports/context.ts";
import type { TaskRepository } from "../ports/task_repository.ts";
import type { RelationshipPersonBoundary } from "../../people/public.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

/** How many people one hydration asks the person boundary about at a time. */
const PERSON_SUMMARY_BATCH = 50;

export interface TaskManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: TaskAudit;
  readonly clock: Clock;
  readonly cursorKeyset: TaskCursorKeyset;
  readonly people: RelationshipPersonBoundary;
  readonly repository: TaskRepository;
  readonly transaction: PlanningTransactionRunner;
}

/** Every way a task read or write can fail. */
export type TaskFailure =
  | Failure<"archived-write-rejected" | "forbidden" | "not-found", "stale">
  | ValidationFailure;

/** True while the actor still stands, asked under lock before any work. */
export async function actorStands(
  dependencies: Pick<TaskManagementDependencies, "actors">,
  actor: PlanningActor,
  transaction: PlanningTransaction,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock: true,
    transaction,
  }) !== "revoked";
}

/**
 * Runs the work in the caller's transaction, or in one of its own in the
 * actor's workspace.
 */
export function inTransaction<T>(
  dependencies: Pick<TaskManagementDependencies, "transaction">,
  actor: Pick<PlanningActor, "workspaceId">,
  existing: PlanningTransaction | undefined,
  work: (transaction: PlanningTransaction) => Promise<T>,
): Promise<T> {
  return existing
    ? work(existing)
    : dependencies.transaction.run(work, { workspaceId: actor.workspaceId });
}

/** The stored tasks with the person each one names resolved for the reader. */
export async function hydrate(
  dependencies: Pick<TaskManagementDependencies, "people">,
  actor: PlanningActor,
  transaction: PlanningTransaction,
  tasks: readonly StoredTask[],
): Promise<readonly TaskRecord[]> {
  const personIds = [
    ...new Set(tasks.flatMap((task) => task.personId ? [task.personId] : [])),
  ];
  const summaries: TaskPerson[] = [];
  for (let index = 0; index < personIds.length; index += PERSON_SUMMARY_BATCH) {
    summaries.push(
      ...await dependencies.people.summarize({
        ...actor,
        personIds: personIds.slice(index, index + PERSON_SUMMARY_BATCH),
        transaction,
      }),
    );
  }
  const peopleById = new Map(summaries.map((person) => [person.id, person]));
  return tasks.map(({ personId, ...task }) => ({
    ...task,
    ...(personId
      ? {
        person: peopleById.get(personId) ?? {
          archived: true,
          id: personId,
          name: "Deleted/Unavailable person",
          unavailable: true,
        },
      }
      : {}),
  }));
}

/** Whether the people a write touches may be written to at all. */
export async function inspectWritablePeople(
  dependencies: Pick<TaskManagementDependencies, "people">,
  actor: PlanningActor,
  transaction: PlanningTransaction,
  personIds: readonly (string | undefined)[],
): Promise<"archived-write-rejected" | "not-found" | "ready"> {
  const selectedIds = personIds.filter((personId): personId is string =>
    personId !== undefined
  );
  if (selectedIds.length === 0) return "ready";
  const result = await dependencies.people.inspect({
    ...actor,
    lock: true,
    personIds: selectedIds,
    transaction,
  });
  return result.status === "archived"
    ? "archived-write-rejected"
    : result.status;
}

/**
 * Records the audit event a write owes and proves both rows are there.
 *
 * The repository and the recorder each read their own write back inside the
 * transaction, so a save that silently did nothing cannot commit as an
 * audited success.
 */
export async function auditTask(
  dependencies: Pick<TaskManagementDependencies, "audit" | "repository">,
  actor: PlanningActor,
  transaction: PlanningTransaction,
  task: StoredTask,
  action: TaskAuditAction,
  occurredAt: Date,
): Promise<void> {
  const command = { action, actor, occurredAt, task, transaction };
  const auditId = await dependencies.audit.record(command);
  await dependencies.repository.assertPostcondition({
    ...actor,
    task,
    transaction,
  });
  await dependencies.audit.assertPostcondition({ ...command, auditId });
}
