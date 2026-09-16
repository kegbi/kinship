import type { Clock } from "../../../shared-kernel/clock.ts";
import { deterministicId } from "../../../shared-kernel/ids.ts";
import {
  type CursorKeyset,
  signCursor,
  verifyCursor,
} from "../../../shared-kernel/pagination.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import {
  boundedText,
  instant,
  isInstant,
  uuid,
} from "../../../shared-kernel/validation.ts";
import type {
  PeopleActor,
  PeopleTransaction,
  RelationshipPersonBoundary,
} from "../../people/public.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

/** The namespace that makes a task creation idempotent across retries. */
const TASK_ID_NAMESPACE = "kinship.planning.task-id.v1";
/** The signing domain that keeps a task cursor usable only for task listing. */
const TASK_CURSOR_DOMAIN = "kinship.planning.task-cursor.v1";

export type TaskStatus = "cancelled" | "completed" | "open";

export interface TaskRecord {
  readonly completedAt?: string;
  readonly completedByMemberId?: string;
  readonly createdAt: string;
  readonly createdByMemberId?: string;
  readonly description?: string;
  readonly dueAt?: string;
  readonly id: string;
  readonly person?: TaskPerson;
  readonly status: TaskStatus;
  readonly title: string;
  readonly updatedAt: string;
}

export interface TaskPerson {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
  readonly unavailable?: boolean;
}

export interface StoredTask extends Omit<TaskRecord, "person"> {
  readonly personId?: string;
}

export interface TaskRepository {
  lockRequest(command: {
    readonly id: string;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
  find(
    command: PeopleActor & {
      readonly id: string;
      readonly lock: boolean;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | Failure<"not-found">
    | { readonly status: "found"; readonly task: StoredTask }
  >;
  list(
    command: PeopleActor & {
      readonly after?: TaskListAnchor;
      readonly dueBefore?: Date;
      readonly limit: number;
      readonly personId?: string;
      readonly status?: TaskStatus;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly status: "stale-cursor" }
    | {
      readonly items: readonly StoredTask[];
      readonly next?: TaskListAnchor;
      readonly status: "ready";
    }
  >;
  create(
    command: PeopleActor & {
      readonly description?: string;
      readonly dueAt?: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId?: string;
      readonly title: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<StoredTask | undefined>;
  save(
    command: PeopleActor & {
      readonly completedAt?: Date | null;
      readonly description?: string | null;
      readonly dueAt?: string | null;
      readonly expectedUpdatedAt?: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId?: string | null;
      readonly status?: TaskStatus;
      readonly title?: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<StoredTask | undefined>;
  assertPostcondition(
    command: PeopleActor & {
      readonly task: StoredTask;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
}

export interface TaskListAnchor {
  readonly dueAt?: string;
  readonly id: string;
  readonly status: TaskStatus;
  readonly updatedAt: string;
}

export type TaskCursorKeyset = CursorKeyset;

export type TaskAuditAction = "changed" | "completed" | "created" | "reopened";

export interface TaskAudit {
  record(command: {
    readonly action: TaskAuditAction;
    readonly actor: PeopleActor;
    readonly occurredAt: Date;
    readonly task: StoredTask;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly action: TaskAuditAction;
    readonly actor: PeopleActor;
    readonly auditId: string;
    readonly occurredAt: Date;
    readonly task: StoredTask;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface TaskManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: TaskAudit;
  readonly clock: Clock;
  readonly cursorKeyset: TaskCursorKeyset;
  readonly people: RelationshipPersonBoundary;
  readonly repository: TaskRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

export interface CreateTaskInput {
  readonly description?: string;
  readonly dueAt?: string;
  readonly personId?: string;
  readonly requestId: string;
  readonly title: string;
}

export interface ChangeTaskInput {
  readonly description?: string | null;
  readonly dueAt?: string | null;
  readonly expectedUpdatedAt: string;
  readonly personId?: string | null;
  readonly status?: "cancelled" | "open";
  readonly title?: string;
}

export type TaskFailure =
  | Failure<"archived-write-rejected" | "forbidden" | "not-found", "stale">
  | ValidationFailure;

export type CreateTaskResult =
  | { readonly status: "created"; readonly task: TaskRecord }
  | { readonly status: "idempotency-conflict" }
  | TaskFailure;

export type GetTaskResult =
  // A malformed task identifier names no field, so this is the module's own
  // bare `validation-error`, not the kernel's payload-carrying one.
  | Failure<"forbidden" | "not-found", "validation-error">
  | { readonly status: "ready"; readonly task: TaskRecord };

export type ChangeTaskResult =
  | { readonly status: "saved" | "unchanged"; readonly task: TaskRecord }
  | TaskFailure;

export type ListTasksResult =
  | {
    readonly items: readonly TaskRecord[];
    readonly nextCursor?: string;
    readonly status: "ready";
  }
  | Failure<"forbidden", "stale-cursor">;

/**
 * A patchable text field: `null` clears it, `undefined` leaves it alone, and a
 * value is kept only while it fits.
 */
function nullableText(
  value: string | null | undefined,
  maximum: number,
): string | null | undefined {
  if (value === null) return null;
  if (value === undefined) return undefined;
  return boundedText(value, maximum);
}

function parsedDate(value: string | undefined): Date | undefined {
  return isInstant(value) ? new Date(value) : undefined;
}

function createValidation(input: CreateTaskInput): {
  readonly description?: string;
  readonly dueAt?: string;
  readonly errors: Readonly<Record<string, string>>;
  readonly personId?: string;
  readonly requestId?: string;
  readonly title?: string;
} {
  const errors: Record<string, string> = {};
  const title = boundedText(input.title, 500);
  if (!title) errors.title = "Add a title of at most 500 characters.";
  const description = input.description === undefined
    ? undefined
    : boundedText(input.description, 10_000);
  if (input.description !== undefined && !description) {
    errors.description = "Description must be at most 10,000 characters.";
  }
  const dueAt = instant(input.dueAt);
  if (input.dueAt !== undefined && !dueAt) {
    errors.dueAt = "Choose a valid due time.";
  }
  const requestId = uuid(input.requestId);
  if (requestId === undefined) {
    errors.requestId = "Use a canonical request identifier.";
  }
  const personId = input.personId ? uuid(input.personId) : undefined;
  if (input.personId && personId === undefined) {
    errors.personId = "Choose a person from this workspace.";
  }
  return {
    ...(description ? { description } : {}),
    ...(dueAt ? { dueAt } : {}),
    errors,
    ...(personId ? { personId } : {}),
    ...(requestId ? { requestId } : {}),
    ...(title ? { title } : {}),
  };
}

function matchesCreate(
  task: StoredTask,
  input: ReturnType<typeof createValidation>,
  memberId: string,
): boolean {
  return task.createdByMemberId === memberId && task.title === input.title &&
    task.description === input.description &&
    task.personId === input.personId &&
    task.dueAt === input.dueAt;
}

async function hydrate(
  people: RelationshipPersonBoundary,
  actor: PeopleActor,
  transaction: PeopleTransaction,
  tasks: readonly StoredTask[],
): Promise<readonly TaskRecord[]> {
  const personIds = [
    ...new Set(tasks.flatMap((task) => task.personId ? [task.personId] : [])),
  ];
  const summaries: TaskPerson[] = [];
  for (let index = 0; index < personIds.length; index += 50) {
    summaries.push(
      ...await people.summarize({
        ...actor,
        personIds: personIds.slice(index, index + 50),
        transaction,
      }),
    );
  }
  const peopleById = new Map(
    summaries.map((person) => [person.id, person]),
  );
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

interface TaskCursorBody extends Omit<TaskListAnchor, "dueAt"> {
  readonly dueAt: string | null;
  readonly dueBefore: string | null;
  readonly personId: string | null;
  readonly statusFilter: TaskStatus | null;
  readonly version: 1;
  readonly workspaceId: string;
}

function encodeCursor(
  body: TaskCursorBody,
  keyset: TaskCursorKeyset,
): Promise<string> {
  return signCursor(TASK_CURSOR_DOMAIN, body, keyset);
}

/**
 * Reads a signed task cursor. The signature proves the anchor is one this
 * service minted; the checks below prove it belongs to the listing being
 * continued, so a cursor cannot carry a caller into another workspace's rows
 * or past a filter they did not ask for.
 */
async function decodeCursor(
  cursor: string,
  expected: Pick<
    TaskCursorBody,
    "dueBefore" | "personId" | "statusFilter" | "workspaceId"
  >,
  keyset: TaskCursorKeyset,
): Promise<TaskListAnchor | undefined> {
  const verified = await verifyCursor(TASK_CURSOR_DOMAIN, cursor, keyset);
  if (verified === null || typeof verified !== "object") return undefined;
  const body = verified as Record<string, unknown>;
  const id = typeof body.id === "string" ? uuid(body.id) : undefined;
  if (
    body.version !== 1 || body.workspaceId !== expected.workspaceId ||
    body.personId !== expected.personId ||
    body.statusFilter !== expected.statusFilter ||
    body.dueBefore !== expected.dueBefore || id === undefined ||
    !["cancelled", "completed", "open"].includes(String(body.status)) ||
    typeof body.updatedAt !== "string" || !isInstant(body.updatedAt) ||
    !(body.dueAt === null ||
      (typeof body.dueAt === "string" && isInstant(body.dueAt)))
  ) return undefined;
  return {
    ...(typeof body.dueAt === "string" ? { dueAt: body.dueAt } : {}),
    id,
    status: body.status as TaskStatus,
    updatedAt: body.updatedAt,
  };
}

async function inspectWritablePeople(
  people: RelationshipPersonBoundary,
  actor: PeopleActor,
  transaction: PeopleTransaction,
  personIds: readonly (string | undefined)[],
): Promise<"archived-write-rejected" | "not-found" | "ready"> {
  const selectedIds = personIds.filter((personId): personId is string =>
    personId !== undefined
  );
  if (selectedIds.length === 0) return "ready";
  const result = await people.inspect({
    ...actor,
    lock: true,
    personIds: selectedIds,
    transaction,
  });
  return result.status === "archived"
    ? "archived-write-rejected"
    : result.status;
}

export function createTaskManagement(dependencies: TaskManagementDependencies) {
  const audited = async (
    actor: PeopleActor,
    transaction: PeopleTransaction,
    task: StoredTask,
    action: TaskAuditAction,
    occurredAt: Date,
  ) => {
    const command = { action, actor, occurredAt, task, transaction };
    const auditId = await dependencies.audit.record(command);
    await dependencies.repository.assertPostcondition({
      ...actor,
      task,
      transaction,
    });
    await dependencies.audit.assertPostcondition({ ...command, auditId });
  };
  return {
    get: (
      actor: PeopleActor,
      taskId: string,
      existingTransaction?: PeopleTransaction,
    ): Promise<GetTaskResult> => {
      const id = uuid(taskId);
      if (id === undefined) {
        return Promise.resolve({ status: "validation-error" });
      }
      const work = async (
        transaction: PeopleTransaction,
      ): Promise<GetTaskResult> => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: true,
          transaction,
        });
        if (standing === "revoked") return { status: "forbidden" };
        const current = await dependencies.repository.find({
          ...actor,
          id,
          lock: false,
          transaction,
        });
        if (current.status !== "found") return { status: "not-found" };
        const [task] = await hydrate(dependencies.people, actor, transaction, [
          current.task,
        ]);
        return { status: "ready", task: task! };
      };
      return existingTransaction
        ? work(existingTransaction)
        : dependencies.transaction.run(work);
    },
    create: (
      actor: PeopleActor,
      input: CreateTaskInput,
      existingTransaction?: PeopleTransaction,
    ): Promise<CreateTaskResult> => {
      const checked = createValidation(input);
      if (Object.keys(checked.errors).length > 0) {
        return Promise.resolve({
          errors: checked.errors,
          status: "validation-error",
        });
      }
      const work = async (
        transaction: PeopleTransaction,
      ): Promise<CreateTaskResult> => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: true,
          transaction,
        });
        if (standing === "revoked") return { status: "forbidden" };
        const id = await deterministicId(TASK_ID_NAMESPACE, [
          actor.workspaceId,
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
          if (!matchesCreate(replay.task, checked, actor.memberId)) {
            return { status: "idempotency-conflict" };
          }
          const [task] = await hydrate(
            dependencies.people,
            actor,
            transaction,
            [replay.task],
          );
          return { status: "created", task: task! };
        }
        const personStatus = await inspectWritablePeople(
          dependencies.people,
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
        await audited(actor, transaction, task, "created", occurredAt);
        const [record] = await hydrate(
          dependencies.people,
          actor,
          transaction,
          [task],
        );
        return { status: "created", task: record! };
      };
      return existingTransaction
        ? work(existingTransaction)
        : dependencies.transaction.run(work);
    },
    list: (
      actor: PeopleActor,
      input: {
        readonly cursor?: string;
        readonly dueBefore?: string;
        readonly limit?: number;
        readonly personId?: string;
        readonly status?: TaskStatus;
      } = {},
    ): Promise<ListTasksResult> =>
      dependencies.transaction.run(async (transaction) => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: true,
          transaction,
        });
        if (standing === "revoked") return { status: "forbidden" };
        const dueBefore = input.dueBefore && parsedDate(input.dueBefore)
          ? parsedDate(input.dueBefore)!.toISOString()
          : undefined;
        const scope = {
          dueBefore: dueBefore ?? null,
          personId: input.personId ? input.personId.toLowerCase() : null,
          statusFilter: input.status ?? null,
          workspaceId: actor.workspaceId,
        };
        const after = input.cursor
          ? await decodeCursor(input.cursor, scope, dependencies.cursorKeyset)
          : undefined;
        if (input.cursor && !after) return { status: "stale-cursor" };
        const result = await dependencies.repository.list({
          ...actor,
          ...(after ? { after } : {}),
          ...(dueBefore ? { dueBefore: new Date(dueBefore) } : {}),
          limit: Math.max(1, Math.min(100, Math.trunc(input.limit ?? 100))),
          ...(input.personId ? { personId: input.personId.toLowerCase() } : {}),
          ...(input.status ? { status: input.status } : {}),
          transaction,
        });
        if (result.status !== "ready") return result;
        return {
          items: await hydrate(
            dependencies.people,
            actor,
            transaction,
            result.items,
          ),
          ...(result.next
            ? {
              nextCursor: await encodeCursor({
                ...scope,
                dueAt: result.next.dueAt ?? null,
                id: result.next.id,
                status: result.next.status,
                updatedAt: result.next.updatedAt,
                version: 1,
              }, dependencies.cursorKeyset),
            }
            : {}),
          status: "ready",
        };
      }),
    change: (
      actor: PeopleActor,
      taskId: string,
      input: ChangeTaskInput,
      existingTransaction?: PeopleTransaction,
    ): Promise<ChangeTaskResult> => {
      const errors: Record<string, string> = {};
      const id = uuid(taskId);
      if (id === undefined) {
        errors.taskId = "Use a canonical task identifier.";
      }
      if (!isInstant(input.expectedUpdatedAt)) {
        errors.expectedUpdatedAt = "Refresh this task before saving.";
      }
      const title = input.title === undefined
        ? undefined
        : boundedText(input.title, 500);
      if (input.title !== undefined && !title) {
        errors.title = "Add a title of at most 500 characters.";
      }
      const description = nullableText(input.description, 10_000);
      if (typeof input.description === "string" && description === undefined) {
        errors.description = "Description must be at most 10,000 characters.";
      }
      const dueAt = input.dueAt === null
        ? null
        : instant(input.dueAt ?? undefined);
      if (typeof input.dueAt === "string" && !dueAt) {
        errors.dueAt = "Choose a valid due time.";
      }
      if (
        typeof input.personId === "string" &&
        uuid(input.personId) === undefined
      ) {
        errors.personId = "Choose a person from this workspace.";
      }
      if (Object.keys(errors).length > 0) {
        return Promise.resolve({ errors, status: "validation-error" });
      }
      const work = async (
        transaction: PeopleTransaction,
      ): Promise<ChangeTaskResult> => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: true,
          transaction,
        });
        if (standing === "revoked") return { status: "forbidden" };
        const current = await dependencies.repository.find({
          ...actor,
          // The validation above rejected a non-canonical identifier.
          id: id!,
          lock: true,
          transaction,
        });
        if (current.status !== "found") return { status: "not-found" };
        if (current.task.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" };
        }
        const targetPersonId = input.personId === undefined
          ? current.task.personId
          : input.personId === null
          ? undefined
          : uuid(input.personId)!;
        const personStatus = await inspectWritablePeople(
          dependencies.people,
          actor,
          transaction,
          targetPersonId === current.task.personId
            ? [current.task.personId]
            : [current.task.personId, targetPersonId],
        );
        if (personStatus !== "ready") return { status: personStatus };
        const unchanged =
          (title === undefined || title === current.task.title) &&
          (description === undefined ||
            description === (current.task.description ?? null)) &&
          (dueAt === undefined ||
            (dueAt === null ? undefined : dueAt) ===
              current.task.dueAt) &&
          (input.personId === undefined ||
            targetPersonId === current.task.personId) &&
          (input.status === undefined || input.status === current.task.status);
        if (unchanged) {
          const [task] = await hydrate(
            dependencies.people,
            actor,
            transaction,
            [current.task],
          );
          return { status: "unchanged", task: task! };
        }
        const occurredAt = dependencies.clock.now();
        const saved = await dependencies.repository.save({
          ...actor,
          ...(description !== undefined ? { description } : {}),
          ...(dueAt !== undefined ? { dueAt } : {}),
          expectedUpdatedAt: input.expectedUpdatedAt,
          id: current.task.id,
          occurredAt,
          ...(input.personId !== undefined
            ? { personId: targetPersonId ?? null }
            : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(input.status && current.task.status === "completed"
            ? { completedAt: null }
            : {}),
          ...(title ? { title } : {}),
          transaction,
        });
        if (!saved) return { status: "stale" };
        await audited(actor, transaction, saved, "changed", occurredAt);
        const [task] = await hydrate(dependencies.people, actor, transaction, [
          saved,
        ]);
        return { status: "saved", task: task! };
      };
      return existingTransaction
        ? work(existingTransaction)
        : dependencies.transaction.run(work);
    },
    setCompletion: (
      actor: PeopleActor,
      taskId: string,
      completed: boolean,
      existingTransaction?: PeopleTransaction,
    ): Promise<ChangeTaskResult> => {
      const id = uuid(taskId);
      if (id === undefined) {
        return Promise.resolve({
          errors: { taskId: "Use a canonical task identifier." },
          status: "validation-error",
        });
      }
      const work = async (
        transaction: PeopleTransaction,
      ): Promise<ChangeTaskResult> => {
        const standing = await dependencies.actors.revalidate({
          ...actor,
          lock: true,
          transaction,
        });
        if (standing === "revoked") return { status: "forbidden" };
        const current = await dependencies.repository.find({
          ...actor,
          id,
          lock: true,
          transaction,
        });
        if (current.status !== "found") return { status: "not-found" };
        const personStatus = await inspectWritablePeople(
          dependencies.people,
          actor,
          transaction,
          [current.task.personId],
        );
        if (personStatus !== "ready") return { status: personStatus };
        const target = completed ? "completed" : "open";
        if (current.task.status === target) {
          const [task] = await hydrate(
            dependencies.people,
            actor,
            transaction,
            [current.task],
          );
          return { status: "unchanged", task: task! };
        }
        const occurredAt = dependencies.clock.now();
        const saved = await dependencies.repository.save({
          ...actor,
          completedAt: completed ? occurredAt : null,
          id: current.task.id,
          occurredAt,
          status: target,
          transaction,
        });
        if (!saved) return { status: "stale" };
        const action = completed ? "completed" : "reopened";
        await audited(actor, transaction, saved, action, occurredAt);
        const [task] = await hydrate(dependencies.people, actor, transaction, [
          saved,
        ]);
        return { status: "saved", task: task! };
      };
      return existingTransaction
        ? work(existingTransaction)
        : dependencies.transaction.run(work);
    },
  };
}

export type TaskManagement = Pick<
  ReturnType<typeof createTaskManagement>,
  "change" | "create" | "list" | "setCompletion"
>;
