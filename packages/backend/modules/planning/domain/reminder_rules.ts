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
  | "created"
  | "disabled"
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

/** The field errors a proposed reminder carries, and its canonical parts. */
export function validateCreateReminder(
  input: CreateReminderInput,
): CheckedReminder {
  const errors: Record<string, string> = {};
  const title = input.title.trim();
  if (!title || title.length > MAXIMUM_TITLE_LENGTH) {
    errors.title = "Add a title of at most 500 characters.";
  }
  if (uuid(input.personId) === undefined) {
    errors.personId = "Choose a person from this workspace.";
  }
  if (uuid(input.requestId) === undefined) {
    errors.requestId = "Use a canonical request identifier.";
  }
  if (isoDate(input.anchorOn) === undefined) {
    errors.anchorOn = "Choose a calendar date.";
  }
  const sendTime = isoTime(input.sendTime);
  if (!sendTime) errors.sendTime = "Choose a local delivery time.";
  if (
    !Number.isInteger(input.recurrenceInterval) ||
    input.recurrenceInterval < 1 ||
    input.recurrenceInterval > MAXIMUM_RECURRENCE_INTERVAL
  ) {
    errors.recurrenceInterval = "Choose an interval from 1 to 100.";
  }
  try {
    if (isoDate(input.anchorOn) !== undefined) {
      Temporal.PlainDate.from(input.anchorOn);
    }
  } catch {
    errors.anchorOn = "Choose a valid calendar date.";
  }
  return {
    errors,
    ...(sendTime ? { sendTime } : {}),
    ...(title ? { title } : {}),
  };
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
