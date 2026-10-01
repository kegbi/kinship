/**
 * What a recurring debt is, and when each of its charges falls due.
 *
 * A rule charges a person the same debt every `intervalMonths` months on
 * `dayOfMonth`. The first charge is the first such day on or after the start;
 * every later one is counted from that first month, never from the previous
 * charge, so a rule on the 31st falls on the last day of a shorter month and
 * returns to the 31st afterwards. Each due period becomes its own debt.
 *
 * Everything here is calendar arithmetic over plain dates, so it is pure and
 * lives in the domain. `Temporal` is the language's calendar rather than an
 * infrastructure client, as it is for planning's recurrence. A date is the
 * `YYYY-MM-DD` text the columns hold, and two of them compare as text.
 */

import {
  boundedText,
  currencyCode as canonicalCurrency,
  isoDate,
} from "../../../shared-kernel/validation.ts";
import { type DebtDirection, money } from "./gift_rules.ts";

/** The widest interval a rule may repeat at: ten years. */
export const MAXIMUM_INTERVAL_MONTHS = 120;
/** The most periods one generation run charges for a single rule. */
export const MAXIMUM_OCCURRENCES_PER_RUN = 120;
/** The most rules one person may carry, which bounds the section's list. */
export const RECURRING_DEBT_LIMIT = 50;
/** The currency a money form starts from when nobody chose one. */
export const FALLBACK_CURRENCY = "USD";

/** When a rule's charges fall due. */
export interface RecurringDebtSchedule {
  readonly dayOfMonth: number;
  readonly endsOn?: string;
  readonly intervalMonths: number;
  readonly startsOn: string;
}

/** What every charge a rule generates carries, and when it falls due. */
export interface RecurringDebtValues extends RecurringDebtSchedule {
  readonly amount: string;
  readonly currencyCode: string;
  readonly direction: DebtDirection;
  readonly reason?: string;
}

export interface RecurringDebtRecord extends RecurringDebtValues {
  /** False while the member has paused the rule. */
  readonly active: boolean;
  readonly createdAt: string;
  readonly id: string;
  /** The next due date not yet charged; absent once the rule has ended. */
  readonly nextOccurrenceOn?: string;
  readonly personId: string;
  readonly updatedAt: string;
}

export type StoredRecurringDebt = RecurringDebtRecord;

/** A proposed rule, as a member submits it. */
export interface CreateRecurringDebtInput {
  readonly amount: string;
  readonly currencyCode: string;
  readonly dayOfMonth: number;
  readonly direction: DebtDirection;
  readonly endsOn?: string;
  readonly intervalMonths: number;
  readonly reason?: string;
  readonly startsOn: string;
}

/**
 * A change to a rule. A field left out keeps its value; `null` clears the end
 * date or the reason, the two parts of a rule that may be absent.
 */
export interface RecurringDebtChange {
  readonly active?: boolean;
  readonly amount?: string;
  readonly currencyCode?: string;
  readonly dayOfMonth?: number;
  readonly direction?: DebtDirection;
  readonly endsOn?: string | null;
  readonly intervalMonths?: number;
  readonly reason?: string | null;
  readonly startsOn?: string;
}

/** The plain date `value` names, or nothing when no such day exists. */
function plainDate(value: string | undefined): Temporal.PlainDate | undefined {
  if (isoDate(value) === undefined) return undefined;
  try {
    return Temporal.PlainDate.from(value!, { overflow: "reject" });
  } catch {
    return undefined;
  }
}

/** The number of whole months from year zero to `date`'s month. */
function monthIndex(date: Temporal.PlainDate): number {
  return date.year * 12 + date.month - 1;
}

/** The due day in the month `index`, clamped to that month's last day. */
function dueIn(index: number, dayOfMonth: number): Temporal.PlainDate {
  const month = Temporal.PlainYearMonth.from({
    month: (index % 12) + 1,
    year: Math.floor(index / 12),
  });
  return month.toPlainDate({ day: Math.min(dayOfMonth, month.daysInMonth) });
}

/** The month of the first charge: the start month, or the next one. */
function firstMonth(schedule: RecurringDebtSchedule): number {
  const start = Temporal.PlainDate.from(schedule.startsOn);
  const index = monthIndex(start);
  return Temporal.PlainDate.compare(dueIn(index, schedule.dayOfMonth), start) <
      0
    ? index + 1
    : index;
}

/** The `index`-th charge's due date, counting the first charge as zero. */
export function occurrenceOn(
  schedule: RecurringDebtSchedule,
  index: number,
): string {
  return dueIn(
    firstMonth(schedule) + index * schedule.intervalMonths,
    schedule.dayOfMonth,
  ).toString();
}

/**
 * The first charge on or after `date`, or nothing when the rule has ended by
 * then. Charges before the start never exist.
 */
export function firstOccurrenceOnOrAfter(
  schedule: RecurringDebtSchedule,
  date: string,
): string | undefined {
  const floor = Temporal.PlainDate.from(date);
  const elapsed = monthIndex(floor) - firstMonth(schedule);
  let index = Math.max(0, Math.floor(elapsed / schedule.intervalMonths));
  let candidate = occurrenceOn(schedule, index);
  while (candidate < date) {
    index += 1;
    candidate = occurrenceOn(schedule, index);
  }
  return schedule.endsOn !== undefined && candidate > schedule.endsOn
    ? undefined
    : candidate;
}

/** The first day of the month after `date`'s. */
function nextMonthStart(date: string): string {
  return Temporal.PlainDate.from(date).toPlainYearMonth().add({ months: 1 })
    .toPlainDate({ day: 1 }).toString();
}

/**
 * The charge after the period `date` belongs to. Every charge of a rule falls
 * in a different month, so the next one is the first on or after the month
 * that follows, whatever day the rule names now.
 */
export function occurrenceAfter(
  schedule: RecurringDebtSchedule,
  date: string,
): string | undefined {
  return firstOccurrenceOnOrAfter(schedule, nextMonthStart(date));
}

/**
 * The periods due from `next` through `today`, at most `limit` of them, and
 * where the rule resumes. A rule whose end has passed has no `next`.
 */
export function dueOccurrences(
  schedule: RecurringDebtSchedule,
  next: string,
  today: string,
  limit: number,
): { readonly dates: readonly string[]; readonly next?: string } {
  const dates: string[] = [];
  let pending: string | undefined = next;
  while (pending !== undefined && pending <= today && dates.length < limit) {
    if (schedule.endsOn !== undefined && pending > schedule.endsOn) {
      pending = undefined;
      break;
    }
    dates.push(pending);
    pending = occurrenceAfter(schedule, pending);
  }
  return pending === undefined ? { dates } : { dates, next: pending };
}

/** The later of two dates, either of which may be absent. */
function later(first: string, second: string | undefined): string {
  return second !== undefined && second > first ? second : first;
}

/**
 * Where a resumed rule continues: the first period on or after the day it
 * resumes, and never one already charged. The periods that passed while it
 * was paused are skipped, which is what pausing means.
 */
export function resumedNextOccurrence(
  schedule: RecurringDebtSchedule,
  today: string,
  lastCharged: string | undefined,
): string | undefined {
  return firstOccurrenceOnOrAfter(
    schedule,
    later(
      later(schedule.startsOn, today),
      lastCharged === undefined ? undefined : nextMonthStart(lastCharged),
    ),
  );
}

/**
 * Where an edited rule continues. It never charges a period again: the next
 * charge is after the month last charged. A rule whose start did not move also
 * keeps the month it was waiting for, so an edit never revives the periods a
 * pause skipped; a start moved earlier is the member asking for those periods
 * and charges from it.
 */
export function changedNextOccurrence(
  current: StoredRecurringDebt,
  schedule: RecurringDebtSchedule,
  lastCharged: string | undefined,
): string | undefined {
  const waiting = current.startsOn === schedule.startsOn &&
      current.nextOccurrenceOn !== undefined
    ? Temporal.PlainDate.from(current.nextOccurrenceOn).with({ day: 1 })
      .toString()
    : undefined;
  return firstOccurrenceOnOrAfter(
    schedule,
    later(
      later(schedule.startsOn, waiting),
      lastCharged === undefined ? undefined : nextMonthStart(lastCharged),
    ),
  );
}

/** A whole number within `minimum` and `maximum`, or nothing. */
function bounded(
  value: number,
  minimum: number,
  maximum: number,
): number | undefined {
  return Number.isInteger(value) && value >= minimum && value <= maximum
    ? value
    : undefined;
}

/**
 * The canonical rule, or nothing when the member has to fix something.
 *
 * Like a debt, a rule always names its amount and currency. The schedule has
 * to describe days that exist: a day of the month from 1 to 31, an interval of
 * one month to ten years, a real start date, and an end no earlier than it.
 */
export function normalizeRecurringDebt(
  input: CreateRecurringDebtInput,
): RecurringDebtValues | undefined {
  const amount = money(input.amount);
  const currencyCode = canonicalCurrency(input.currencyCode);
  const dayOfMonth = bounded(input.dayOfMonth, 1, 31);
  const intervalMonths = bounded(
    input.intervalMonths,
    1,
    MAXIMUM_INTERVAL_MONTHS,
  );
  const startsOn = plainDate(input.startsOn);
  const endsOn = input.endsOn === undefined
    ? undefined
    : plainDate(input.endsOn);
  if (
    !amount || !currencyCode || dayOfMonth === undefined ||
    intervalMonths === undefined || !startsOn ||
    (input.endsOn !== undefined &&
      (!endsOn || Temporal.PlainDate.compare(endsOn, startsOn) < 0))
  ) return undefined;
  const reason = boundedText(input.reason, 10_000);
  return {
    amount,
    currencyCode,
    dayOfMonth,
    direction: input.direction,
    ...(endsOn ? { endsOn: endsOn.toString() } : {}),
    intervalMonths,
    ...(reason ? { reason } : {}),
    startsOn: startsOn.toString(),
  };
}

/**
 * The rule a change leaves behind, validated as a whole, or nothing when the
 * result is not a rule.
 */
export function mergeRecurringDebtChange(
  current: StoredRecurringDebt,
  change: RecurringDebtChange,
): (RecurringDebtValues & { readonly active: boolean }) | undefined {
  const endsOn = change.endsOn === null
    ? undefined
    : change.endsOn ?? current.endsOn;
  const reason = change.reason === null
    ? undefined
    : change.reason ?? current.reason;
  const values = normalizeRecurringDebt({
    amount: change.amount ?? current.amount,
    currencyCode: change.currencyCode ?? current.currencyCode,
    dayOfMonth: change.dayOfMonth ?? current.dayOfMonth,
    direction: change.direction ?? current.direction,
    ...(endsOn !== undefined ? { endsOn } : {}),
    intervalMonths: change.intervalMonths ?? current.intervalMonths,
    ...(reason !== undefined ? { reason } : {}),
    startsOn: change.startsOn ?? current.startsOn,
  });
  return values && { active: change.active ?? current.active, ...values };
}

/**
 * The calendar date it is in `timezone` at `now`. A zone the runtime does not
 * know reads as UTC, the schema's documented fallback.
 */
export function localDate(now: Date, timezone: string): string {
  const instant = Temporal.Instant.fromEpochMilliseconds(now.getTime());
  try {
    return instant.toZonedDateTimeISO(timezone).toPlainDate().toString();
  } catch {
    return instant.toZonedDateTimeISO("UTC").toPlainDate().toString();
  }
}

/**
 * The currency a new debt or gift starts from: the member's or workspace's
 * preferred currency when one is set, else US dollars.
 */
export function defaultCurrency(preferred: string | undefined): string {
  return preferred ?? FALLBACK_CURRENCY;
}
