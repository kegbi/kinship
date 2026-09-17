/**
 * What a task is, and what may be done to one.
 *
 * A task is a title, an optional description, an optional due time, an
 * optional person, and a status. Everything the use case used to decide inline
 * — whether a proposal is well formed, whether a replayed request is the same
 * request, which person a change is pointing at, whether a change changes
 * anything at all, and which audit action a completion writes — is a rule, and
 * none of it needs a database, a lock, or a clock.
 *
 * A patch is three-valued throughout: `undefined` leaves a field alone, `null`
 * clears it, and a value replaces it. That distinction is the reason the
 * checked shapes below keep their fields required and widen the type instead
 * of making them optional.
 */

import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import {
  boundedText,
  instant,
  isInstant,
  uuid,
} from "../../../shared-kernel/validation.ts";

/** The namespace that makes a task creation idempotent across retries. */
export const TASK_ID_NAMESPACE = "kinship.planning.task-id.v1";

/** The longest title and description the schema and the product accept. */
export const MAXIMUM_TITLE_LENGTH = 500;
export const MAXIMUM_DESCRIPTION_LENGTH = 10_000;

export type TaskStatus = "cancelled" | "completed" | "open";

/** What `planning` says about a task in the audit history. */
export type TaskAuditAction = "changed" | "completed" | "created" | "reopened";

/** The person a task names, as the reader is allowed to see them. */
export interface TaskPerson {
  readonly archived: boolean;
  readonly id: string;
  readonly name: string;
  readonly unavailable?: boolean;
}

/** A task as the product shows it, with its person resolved. */
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

/** A task as it is stored: the person is an identifier, not a summary. */
export interface StoredTask extends Omit<TaskRecord, "person"> {
  readonly personId?: string;
}

/** Where a page of tasks resumes. */
export interface TaskListAnchor {
  readonly dueAt?: string;
  readonly id: string;
  readonly status: TaskStatus;
  readonly updatedAt: string;
}

/** What a member proposes when they ask for a task. */
export interface CreateTaskInput {
  readonly description?: string;
  readonly dueAt?: string;
  readonly personId?: string;
  readonly requestId: string;
  readonly title: string;
}

/** What a member proposes when they change one. */
export interface ChangeTaskInput {
  readonly description?: string | null;
  readonly dueAt?: string | null;
  readonly expectedUpdatedAt: string;
  readonly personId?: string | null;
  readonly status?: "cancelled" | "open";
  readonly title?: string;
}

/** A proposed task after checking, with the parts it canonicalized. */
export interface CheckedTaskCreation {
  readonly description?: string;
  readonly dueAt?: string;
  readonly errors: ValidationErrors;
  readonly personId?: string;
  readonly requestId?: string;
  readonly title?: string;
}

/** A proposed change after checking; every field stays three-valued. */
export interface CheckedTaskChange {
  readonly description: string | null | undefined;
  readonly dueAt: string | null | undefined;
  readonly errors: ValidationErrors;
  readonly id: string | undefined;
  readonly title: string | undefined;
}

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

/** The field errors a proposed task carries, and its canonical parts. */
export function validateCreateTask(
  input: CreateTaskInput,
): CheckedTaskCreation {
  const errors: Record<string, string> = {};
  const title = boundedText(input.title, MAXIMUM_TITLE_LENGTH);
  if (!title) errors.title = "Add a title of at most 500 characters.";
  const description = input.description === undefined
    ? undefined
    : boundedText(input.description, MAXIMUM_DESCRIPTION_LENGTH);
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

/** The field errors a proposed change carries, and its canonical parts. */
export function validateChangeTask(
  taskId: string,
  input: ChangeTaskInput,
): CheckedTaskChange {
  const errors: Record<string, string> = {};
  const id = uuid(taskId);
  if (id === undefined) errors.taskId = "Use a canonical task identifier.";
  if (!isInstant(input.expectedUpdatedAt)) {
    errors.expectedUpdatedAt = "Refresh this task before saving.";
  }
  const title = input.title === undefined
    ? undefined
    : boundedText(input.title, MAXIMUM_TITLE_LENGTH);
  if (input.title !== undefined && !title) {
    errors.title = "Add a title of at most 500 characters.";
  }
  const description = nullableText(
    input.description,
    MAXIMUM_DESCRIPTION_LENGTH,
  );
  if (typeof input.description === "string" && description === undefined) {
    errors.description = "Description must be at most 10,000 characters.";
  }
  const dueAt = input.dueAt === null ? null : instant(input.dueAt ?? undefined);
  if (typeof input.dueAt === "string" && !dueAt) {
    errors.dueAt = "Choose a valid due time.";
  }
  if (
    typeof input.personId === "string" && uuid(input.personId) === undefined
  ) {
    errors.personId = "Choose a person from this workspace.";
  }
  return { description, dueAt, errors, id, title };
}

/**
 * The due-time filter a listing applies, canonicalized so the same request
 * always mints the same cursor scope, or `undefined` when it is not a time.
 */
export function dueBeforeFilter(value: string | undefined): string | undefined {
  return isInstant(value) ? new Date(value).toISOString() : undefined;
}

/** The page size a task listing accepts, clamped to what it will serve. */
export function taskPageLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(100, Math.trunc(limit ?? 100)));
}

/**
 * True when the task already stored under a replayed request identifier is
 * the one this request is asking for, created by the same member.
 */
export function taskMatchesCreate(
  stored: StoredTask,
  checked: CheckedTaskCreation,
  memberId: string,
): boolean {
  return stored.createdByMemberId === memberId &&
    stored.title === checked.title &&
    stored.description === checked.description &&
    stored.personId === checked.personId &&
    stored.dueAt === checked.dueAt;
}

/**
 * The person a change leaves the task pointing at: the one it already names
 * when the patch is silent, nobody when the patch clears it, and otherwise the
 * canonical form of the one it names. The identifier was proven canonical by
 * `validateChangeTask`.
 */
export function targetPersonId(
  stored: StoredTask,
  personId: string | null | undefined,
): string | undefined {
  if (personId === undefined) return stored.personId;
  if (personId === null) return undefined;
  return uuid(personId);
}

/**
 * True when the change asks for exactly what the task already says, which is
 * reported as `unchanged` rather than written and audited.
 */
export function taskChangeIsUnchanged(
  stored: StoredTask,
  checked: CheckedTaskChange,
  input: ChangeTaskInput,
  target: string | undefined,
): boolean {
  return (checked.title === undefined || checked.title === stored.title) &&
    (checked.description === undefined ||
      checked.description === (stored.description ?? null)) &&
    (checked.dueAt === undefined ||
      (checked.dueAt === null ? undefined : checked.dueAt) === stored.dueAt) &&
    (input.personId === undefined || target === stored.personId) &&
    (input.status === undefined || input.status === stored.status);
}

/** The status a completion toggle targets, and the action it audits. */
export function completionTarget(
  completed: boolean,
): { readonly action: TaskAuditAction; readonly status: TaskStatus } {
  return completed
    ? { action: "completed", status: "completed" }
    : { action: "reopened", status: "open" };
}
