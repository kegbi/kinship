/**
 * When a recurring reminder actually happens.
 *
 * A reminder is anchored on a calendar date and a local wall-clock time, and
 * it repeats every so many days, weeks, months, or years. Turning that into
 * the instants a worker delivers is calendar arithmetic, not storage: it
 * depends on the member's time zone, on the days a zone skips or repeats, and
 * on what "the 31st" means in a month that has no 31st. All of it is pure, so
 * it lives here and the use case merely asks.
 *
 * `Temporal` is the language's calendar, not an infrastructure client, so the
 * domain may use it. Every rule below is expressed through it rather than
 * through `Date`, because only `Temporal` can say "02:30 local on the day the
 * clock jumps" without silently picking a different hour.
 */

/** How often a reminder repeats; `none` fires exactly once. */
export type RecurrenceUnit = "day" | "month" | "none" | "week" | "year";

/** One firing: the local day it belongs to, and the instant it is due. */
export interface CalendarOccurrence {
  readonly deliverAt: string;
  readonly occursOn: string;
}

/** The most occurrences one generation may mint. */
export const MAXIMUM_OCCURRENCES = 32;
/** The widest recurrence interval a reminder may carry. */
export const MAXIMUM_RECURRENCE_INTERVAL = 100;

/**
 * The instant a local date and send time name in a zone.
 *
 * `compatible` disambiguation is the rule that makes a spring-forward gap and
 * an autumn fold deterministic: a wall-clock time the zone skips moves forward
 * by the gap, and one it repeats takes the first of the two.
 */
export function zonedInstant(
  date: Temporal.PlainDate,
  sendTime: string,
  timezone: string,
): string {
  const time = Temporal.PlainTime.from(sendTime);
  return Temporal.ZonedDateTime.from({
    day: date.day,
    hour: time.hour,
    minute: time.minute,
    month: date.month,
    second: time.second,
    timeZone: timezone,
    year: date.year,
  }, { disambiguation: "compatible" }).toInstant().toString();
}

/**
 * The anchor advanced by whole calendar units.
 *
 * Month and year steps constrain rather than overflow, so a reminder anchored
 * on the 31st lands on the last day of a shorter month and returns to the 31st
 * afterwards, because every step is measured from the anchor and not from the
 * previous occurrence.
 */
export function addCalendar(
  anchor: Temporal.PlainDate,
  unit: RecurrenceUnit,
  amount: number,
): Temporal.PlainDate {
  if (unit === "none" || amount === 0) return anchor;
  return anchor.add(
    unit === "day"
      ? { days: amount }
      : unit === "week"
      ? { weeks: amount }
      : unit === "month"
      ? { months: amount }
      : { years: amount },
  );
}

/**
 * How many whole recurrence units separate the anchor from a local date.
 *
 * It is deliberately coarse: month and year distances ignore the day of the
 * month, which is what lets the generator step to a decades-old anchor without
 * walking every occurrence in between.
 */
function calendarDistance(
  anchor: Temporal.PlainDate,
  localFrom: Temporal.PlainDate,
  unit: RecurrenceUnit,
): number {
  return unit === "day"
    ? anchor.until(localFrom, { largestUnit: "day" }).days
    : unit === "week"
    ? anchor.until(localFrom, { largestUnit: "day" }).days / 7
    : unit === "month"
    ? (localFrom.year - anchor.year) * 12 + localFrom.month - anchor.month
    : unit === "year"
    ? localFrom.year - anchor.year
    : 0;
}

/**
 * The next `count` occurrences at or after `from`, in the member's zone.
 *
 * The count and the interval are clamped rather than rejected, because this is
 * called with numbers a repository already stored; validation of a proposed
 * reminder belongs to `reminder_rules.ts`.
 */
export function generateCalendarOccurrences(input: {
  readonly anchorOn: string;
  readonly count: number;
  readonly from: string;
  readonly recurrenceInterval: number;
  readonly recurrenceUnit: RecurrenceUnit;
  readonly sendTime: string;
  readonly timezone: string;
}): readonly CalendarOccurrence[] {
  const anchor = Temporal.PlainDate.from(input.anchorOn);
  const from = Temporal.Instant.from(input.from);
  const count = Math.max(
    1,
    Math.min(MAXIMUM_OCCURRENCES, Math.trunc(input.count)),
  );
  const interval = Math.max(
    1,
    Math.min(MAXIMUM_RECURRENCE_INTERVAL, Math.trunc(input.recurrenceInterval)),
  );
  const occurrences: CalendarOccurrence[] = [];
  const localFrom = from.toZonedDateTimeISO(input.timezone).toPlainDate();
  const distance = calendarDistance(anchor, localFrom, input.recurrenceUnit);
  // Start one recurrence before the coarse calendar distance. That small
  // overlap preserves constrained month/year edges without scanning history.
  const firstIndex = input.recurrenceUnit === "none"
    ? 0
    : Math.max(0, Math.floor(distance / interval) - 1);
  const maximumIterations = input.recurrenceUnit === "none" ? 1 : count + 3;
  for (let offset = 0; offset < maximumIterations; offset += 1) {
    const index = firstIndex + offset;
    const date = addCalendar(anchor, input.recurrenceUnit, index * interval);
    const deliverAt = zonedInstant(date, input.sendTime, input.timezone);
    if (Temporal.Instant.compare(Temporal.Instant.from(deliverAt), from) >= 0) {
      occurrences.push({ deliverAt, occursOn: date.toString() });
      if (occurrences.length >= count) break;
    }
  }
  return occurrences;
}
