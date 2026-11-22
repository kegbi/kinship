/**
 * What a reminder is, and what a member may propose.
 *
 * The records here are the shapes the rules reason about; the ports store
 * them and the adapters map them to rows. The rules themselves answer three
 * questions the use case used to spell out inline: whether a proposed reminder
 * is well formed, whether a replayed request is the same request, and how far
 * ahead a reminder's occurrences are generated.
 *
 * The anchor is checked twice on purpose. `isoDate` proves the text is shaped
 * like a calendar date; `Temporal.PlainDate.from` proves the date exists, so
 * the 30th of February is refused as an invalid date rather than accepted and
 * then constrained by the recurrence arithmetic.
 */

import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import { isoDate, isoTime, uuid } from "../../../shared-kernel/validation.ts";
import type { RecurrenceUnit } from "./recurrence.ts";
import { MAXIMUM_RECURRENCE_INTERVAL } from "./recurrence.ts";

/** The namespace that makes a reminder creation idempotent across retries. */
export const REMINDER_ID_NAMESPACE = "kinship.planning.reminder-id.v1";

/** How many occurrences a repeating reminder keeps minted ahead of itself. */
export const OCCURRENCE_WINDOW = 8;

/** The longest reminder title the schema and the product accept. */
export const MAXIMUM_TITLE_LENGTH = 500;

export type ReminderOccurrenceStatus =
  | "cancelled"
  | "claimed"
  | "failed"
  | "manual_attention"
  | "pending"
  | "retry"
  | "sent"
  | "skipped";

/** What `planning` says about a reminder in the audit history. */
export type ReminderAuditAction =
  | "acknowledged"
  | "cadence-created"
  | "cadence-deleted"
  | "created"
  | "deleted"
  | "disabled"
  | "edited"
  | "generated";

export interface ReminderDefinitionRecord {
  readonly anchorOn: string;
  readonly createdAt: string;
  readonly id: string;
  readonly isActive: boolean;
  readonly nextOccurrence?: ReminderOccurrenceRecord;
  readonly personId: string;
  readonly recurrenceInterval: number;
  readonly recurrenceUnit: RecurrenceUnit;
  readonly sendTime: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface ReminderOccurrenceRecord {
  readonly attemptCount: number;
  readonly deliverAt: string;
  readonly error?: string;
  readonly id: string;
  readonly occursOn: string;
  readonly providerEffectAt?: string;
  readonly sentAt?: string;
  readonly status: ReminderOccurrenceStatus;
  readonly visibleAt?: string;
}

/** What a member proposes when they ask for a reminder. */
export interface CreateReminderInput {
  readonly anchorOn: string;
  readonly personId: string;
  readonly recurrenceInterval: number;
  readonly recurrenceUnit: RecurrenceUnit;
  readonly requestId: string;
  readonly sendTime: string;
  readonly title: string;
}

/** A proposed reminder after checking, with the parts it canonicalized. */
export interface CheckedReminder {
  readonly errors: ValidationErrors;
  readonly sendTime?: string;
  readonly title?: string;
}

/** The trimmed title, recording an error when it is empty or too long. */
function checkedTitle(
  value: string,
  errors: Record<string, string>,
): string | undefined {
  const title = value.trim();
  if (!title || title.length > MAXIMUM_TITLE_LENGTH) {
    errors.title = "Add a title of at most 500 characters.";
  }
  return title || undefined;
}

/** Records an error unless the anchor is a calendar date that exists. */
function checkAnchor(value: string, errors: Record<string, string>): void {
  if (isoDate(value) === undefined) {
    errors.anchorOn = "Choose a calendar date.";
    return;
  }
  try {
    Temporal.PlainDate.from(value);
  } catch {
    errors.anchorOn = "Choose a valid calendar date.";
  }
}

/** The canonical send time, recording an error when it is not one. */
function checkedSendTime(
  value: string,
  errors: Record<string, string>,
): string | undefined {
  const sendTime = isoTime(value);
  if (!sendTime) errors.sendTime = "Choose a local delivery time.";
  return sendTime;
}

/** Records an error unless the interval is a whole 1 to 100. */
function checkInterval(value: number, errors: Record<string, string>): void {
  if (
    !Number.isInteger(value) || value < 1 ||
    value > MAXIMUM_RECURRENCE_INTERVAL
  ) {
    errors.recurrenceInterval = "Choose an interval from 1 to 100.";
  }
}

/** The field errors a proposed reminder carries, and its canonical parts. */
export function validateCreateReminder(
  input: CreateReminderInput,
): CheckedReminder {
  const errors: Record<string, string> = {};
  const title = checkedTitle(input.title, errors);
  if (uuid(input.personId) === undefined) {
    errors.personId = "Choose a person from this workspace.";
  }
  if (uuid(input.requestId) === undefined) {
    errors.requestId = "Use a canonical request identifier.";
  }
  checkAnchor(input.anchorOn, errors);
  const sendTime = checkedSendTime(input.sendTime, errors);
  checkInterval(input.recurrenceInterval, errors);
  return {
    errors,
    ...(sendTime ? { sendTime } : {}),
    ...(title ? { title } : {}),
  };
}

/** The schedule and title a member may change on a reminder (MCP-D2). */
export interface ReminderPatch {
  readonly anchorOn?: string;
  readonly recurrenceInterval?: number;
  readonly recurrenceUnit?: RecurrenceUnit;
  readonly sendTime?: string;
  readonly title?: string;
}

/** What a member proposes when they edit a reminder they read. */
export interface EditReminderInput extends ReminderPatch {
  readonly expectedUpdatedAt: string;
}

/**
 * The field errors an edit carries, and the canonical patch it asks for.
 * Only the fields it names are checked: a stored reminder may hold values a
 * member never typed, such as an imported title.
 */
export function validateEditReminder(
  input: EditReminderInput,
): { readonly errors: ValidationErrors; readonly patch: ReminderPatch } {
  const errors: Record<string, string> = {};
  if (!input.expectedUpdatedAt) {
    errors.expectedUpdatedAt = "Send the updatedAt of the reminder you read.";
  }
  const title = input.title === undefined
    ? undefined
    : checkedTitle(input.title, errors);
  if (input.anchorOn !== undefined) checkAnchor(input.anchorOn, errors);
  const sendTime = input.sendTime === undefined
    ? undefined
    : checkedSendTime(input.sendTime, errors);
  if (input.recurrenceInterval !== undefined) {
    checkInterval(input.recurrenceInterval, errors);
  }
  const patch: ReminderPatch = {
    ...(input.anchorOn !== undefined ? { anchorOn: input.anchorOn } : {}),
    ...(input.recurrenceInterval !== undefined
      ? { recurrenceInterval: input.recurrenceInterval }
      : {}),
    ...(input.recurrenceUnit !== undefined
      ? { recurrenceUnit: input.recurrenceUnit }
      : {}),
    ...(sendTime ? { sendTime } : {}),
    ...(title ? { title } : {}),
  };
  if (
    Object.keys(errors).length === 0 &&
    input.anchorOn === undefined && input.recurrenceInterval === undefined &&
    input.recurrenceUnit === undefined && input.sendTime === undefined &&
    input.title === undefined
  ) {
    errors.reminder = "Change at least one reminder field.";
  }
  return { errors, patch };
}

/** The reminder an edit would leave, its untouched fields kept. */
export function applyReminderEdit(
  current: ReminderDefinitionRecord,
  patch: ReminderPatch,
): ReminderDefinitionRecord {
  return { ...current, ...patch };
}

/** True when the edit asks for exactly what the reminder already is. */
export function reminderEditIsUnchanged(
  current: ReminderDefinitionRecord,
  patch: ReminderPatch,
): boolean {
  const next = applyReminderEdit(current, patch);
  return next.anchorOn === current.anchorOn &&
    next.recurrenceInterval === current.recurrenceInterval &&
    next.recurrenceUnit === current.recurrenceUnit &&
    next.sendTime === current.sendTime && next.title === current.title;
}

/** Where a stored reminder came from, as its row records it. */
export interface ReminderSource {
  readonly canDelete: boolean;
  readonly targetKind: string;
}

/**
 * True for a reminder its source owns (MCP-D2). A member's own reminder is
 * `person`-targeted and deletable; an important date's is `person_date`, and
 * the date regenerates it whenever it changes, so editing or deleting it here
 * would be silently undone. Imported rows that Monica marked undeletable, or
 * that target a life event, a task, or nobody, are left to their source too.
 */
export function reminderIsManaged(source: ReminderSource): boolean {
  return source.targetKind !== "person" || !source.canDelete;
}

/**
 * True when the reminder already stored under a replayed request identifier
 * is the one this request is asking for. A request identifier reused for a
 * different reminder is a conflict, not a retry.
 */
export function reminderMatchesCreate(
  stored: ReminderDefinitionRecord,
  input: CreateReminderInput,
  checked: CheckedReminder,
): boolean {
  return stored.personId === input.personId.toLowerCase() &&
    stored.title === checked.title &&
    stored.anchorOn === input.anchorOn &&
    stored.sendTime === checked.sendTime &&
    stored.recurrenceUnit === input.recurrenceUnit &&
    stored.recurrenceInterval === input.recurrenceInterval;
}

/**
 * How many occurrences to mint for a reminder.
 *
 * A one-off reminder has exactly one; a repeating one keeps a rolling window
 * ahead of now, so a member sees the next few dates without the worker having
 * to materialize the whole series.
 */
export function occurrenceCount(unit: RecurrenceUnit): number {
  return unit === "none" ? 1 : OCCURRENCE_WINDOW;
}
