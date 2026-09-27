/**
 * What a person's life event may say (JOURNAL-002).
 *
 * A life event is a milestone on a person — a move, a graduation, a birth —
 * with a date that is often only partly remembered. It is kept with the
 * calendar components its precision declares, judged by the shared kernel's
 * partial-date rule exactly as an important date is, and it has to be called
 * something: a name the member wrote, a type from the workspace vocabulary,
 * or both.
 *
 * An imported event may also carry the instant it happened at. That instant
 * describes the date it was recorded with, so it survives an edit only while
 * the precision and components stay the same; the member edits components,
 * never an instant.
 */

import {
  type DatePrecision,
  partialDateErrors,
} from "../../../shared-kernel/partial_date.ts";
import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import { optionalText, uuid } from "../../../shared-kernel/validation.ts";

/** The longest name a life event keeps. */
export const LIFE_EVENT_NAME_MAX = 200;
/** The longest note a life event keeps. */
export const LIFE_EVENT_NOTE_MAX = 10_000;

/** What a member writes when they record or edit a life event. */
export interface LifeEventValue {
  readonly day?: number;
  readonly month?: number;
  readonly name?: string;
  readonly note?: string;
  readonly precision: DatePrecision;
  readonly typeId?: string;
  readonly year?: number;
}

/** A life event as the journal stores it. */
export interface StoredLifeEvent extends LifeEventValue {
  readonly createdAt: string;
  readonly happenedAt?: string;
  readonly id: string;
  readonly personId: string;
  readonly typeName?: string;
  readonly updatedAt: string;
}

/**
 * The canonical spelling of a value: text trimmed, blank-only text dropped, a
 * type identifier in lower case, and absent components left absent.
 */
export function normalizeLifeEvent(input: LifeEventValue): LifeEventValue {
  const name = optionalText(input.name);
  const note = optionalText(input.note);
  const typeId = optionalText(input.typeId);
  return {
    ...(input.day === undefined ? {} : { day: input.day }),
    ...(input.month === undefined ? {} : { month: input.month }),
    ...(name ? { name } : {}),
    ...(note ? { note } : {}),
    precision: input.precision,
    ...(typeId ? { typeId: uuid(typeId) ?? typeId } : {}),
    ...(input.year === undefined ? {} : { year: input.year }),
  };
}

/** The field errors a normalized value carries. */
export function validateLifeEvent(value: LifeEventValue): ValidationErrors {
  const errors = partialDateErrors(value);
  if (!value.name && !value.typeId) {
    errors.name = "Enter a name or choose a type.";
  }
  if ((value.name?.length ?? 0) > LIFE_EVENT_NAME_MAX) {
    errors.name = `Use ${LIFE_EVENT_NAME_MAX} characters or fewer.`;
  }
  if ((value.note?.length ?? 0) > LIFE_EVENT_NOTE_MAX) {
    errors.note = "Use 10,000 characters or fewer.";
  }
  if (value.typeId !== undefined && !uuid(value.typeId)) {
    errors.typeId = "Choose a life-event type from this workspace.";
  }
  return errors;
}

/**
 * Whether the instant an event was recorded at still describes it after an
 * edit: only when it had one and the precision and every component are
 * unchanged.
 */
export function keepsRecordedInstant(
  before: Pick<
    StoredLifeEvent,
    "day" | "happenedAt" | "month" | "precision" | "year"
  >,
  after: LifeEventValue,
): boolean {
  return before.happenedAt !== undefined &&
    before.precision === after.precision && before.year === after.year &&
    before.month === after.month && before.day === after.day;
}
