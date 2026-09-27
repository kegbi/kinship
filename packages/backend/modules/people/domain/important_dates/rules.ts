/**
 * What a remembered date may say.
 *
 * A birthday nobody knows the year of, a first meeting recalled only by its
 * month, an anniversary that is exact: the value carries the components it has
 * plus the precision that says which ones are meaningful, and almost every
 * rule here is about keeping those two honest with each other. A `month_day`
 * date with a year contradicts itself as loudly as one missing its month, an
 * approximate year still needs a year to be approximate about, and an age can
 * only be shown when a year is known.
 *
 * Whether a date can drive a yearly reminder is the same kind of rule, so it
 * lives here too rather than in the query that reads the row: a date is
 * schedulable exactly when it names a month and a day.
 */

import {
  type DatePrecision,
  partialDateErrors,
} from "../../../../shared-kernel/partial_date.ts";
import type { ValidationErrors } from "../../../../shared-kernel/result.ts";
import { optionalText } from "../../../../shared-kernel/validation.ts";

export type ImportantDateKind =
  | "birthday"
  | "custom"
  | "deceased"
  | "first_met";
/** The shared partial-date precision, named for this module's readers. */
export type ImportantDatePrecision = DatePrecision;
export type ImportantDateAction = "create" | "delete" | "update";
/** Whether the date can drive a yearly reminder. */
export type ImportantDateScheduling = "annual-reminder" | "not-schedulable";

export interface ImportantDateValue {
  readonly day?: number;
  readonly isAgeBased: boolean;
  readonly isYearApproximate: boolean;
  readonly kind: ImportantDateKind;
  readonly label?: string;
  readonly month?: number;
  readonly notes?: string;
  readonly precision: ImportantDatePrecision;
  readonly year?: number;
}

export interface ImportantDateRecord extends ImportantDateValue {
  readonly createdAt: string;
  readonly id: string;
  readonly personId: string;
  readonly scheduling: ImportantDateScheduling;
  readonly updatedAt: string;
}

/**
 * The canonical spelling of a value: text trimmed, blank-only text dropped,
 * and absent components left absent rather than stored as `undefined`.
 */
export function normalizeImportantDate(
  input: ImportantDateValue,
): ImportantDateValue {
  const label = optionalText(input.label);
  const notes = optionalText(input.notes);
  return {
    ...(input.day === undefined ? {} : { day: input.day }),
    isAgeBased: input.isAgeBased,
    isYearApproximate: input.isYearApproximate,
    kind: input.kind,
    ...(label ? { label } : {}),
    ...(input.month === undefined ? {} : { month: input.month }),
    ...(notes ? { notes } : {}),
    precision: input.precision,
    ...(input.year === undefined ? {} : { year: input.year }),
  };
}

/**
 * The field errors a normalized value carries.
 *
 * The components follow the shared kernel's partial-date rule; what is left
 * here is what only an important date says — its flags, label, and notes.
 */
export function validateImportantDate(
  value: ImportantDateValue,
): ValidationErrors {
  const errors = partialDateErrors(value);
  if (value.isYearApproximate && value.year === undefined) {
    errors.isYearApproximate = "An approximate year still needs a year value.";
  }
  if (value.isAgeBased && value.year === undefined) {
    errors.isAgeBased = "Age display needs a known year.";
  }
  if (value.kind === "custom" && !value.label) {
    errors.label = "Enter an honest label for this custom date.";
  }
  if (value.kind !== "custom" && value.label) {
    errors.label = "Core dates use their standard label.";
  }
  if ((value.label?.length ?? 0) > 200) {
    errors.label = "Use 200 characters or fewer.";
  }
  if ((value.notes?.length ?? 0) > 2_000) {
    errors.notes = "Use 2,000 characters or fewer.";
  }
  return errors;
}

/**
 * Whether the date recurs on a day of the year.
 *
 * A year alone, or a bare month, names no day to remind anybody on, so only a
 * date carrying both a month and a day is schedulable.
 */
export function schedulingFor(
  month: number | undefined,
  day: number | undefined,
): ImportantDateScheduling {
  return month !== undefined && day !== undefined
    ? "annual-reminder"
    : "not-schedulable";
}
