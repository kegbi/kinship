/**
 * Partial-date values.
 *
 * A remembered date is often incomplete: a birthday with no year, a month the
 * person only half recalls. The canonical schema stores the components it has
 * plus the precision that says which ones are meaningful. People's important
 * dates and the person-profile life events had each declared that precision
 * enum separately; this is the one both now use.
 *
 * The database enums are unchanged — this is the code-level vocabulary.
 */

/** A component of a calendar date. */
export type DateComponent = "day" | "month" | "year";

/** Every precision a stored partial date may carry. */
export const DATE_PRECISIONS = [
  "day",
  "full",
  "month",
  "month_day",
  "unknown",
  "year",
  "year_month",
] as const;

export type DatePrecision = typeof DATE_PRECISIONS[number];

/**
 * Exactly the components each precision stores. A value is well formed when
 * the components it carries are precisely these: a `month_day` birthday with a
 * year contradicts itself just as much as one missing its month.
 */
export const componentShape: Readonly<
  Record<DatePrecision, readonly DateComponent[]>
> = {
  day: ["day"],
  full: ["year", "month", "day"],
  month: ["month"],
  month_day: ["month", "day"],
  unknown: [],
  year: ["year"],
  year_month: ["year", "month"],
};

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/**
 * True when the day exists in that month of that year. Callers range-check the
 * components first; this answers the question ranges cannot, such as whether
 * February has a 29th in the year being recorded.
 */
export function isRealCalendarDate(
  year: number,
  month: number,
  day: number,
): boolean {
  if (month === 2 && isLeapYear(year)) return day <= 29;
  return day <= (MONTH_LENGTHS[month - 1] ?? 0);
}

/** The components a partial date may carry, with the precision that rules them. */
export interface PartialDateComponents {
  readonly day?: number;
  readonly month?: number;
  readonly precision: DatePrecision;
  readonly year?: number;
}

/**
 * The field errors a partial date carries, keyed by component.
 *
 * The components are checked against the precision first, then range-checked,
 * and only a month and day that both survived are asked whether they name a
 * real calendar day — a February 30th is a different mistake from a month 13.
 * A month and day with no year are judged against a leap year, because the
 * 29th of February recurs.
 */
export function partialDateErrors(
  value: PartialDateComponents,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const expected = componentShape[value.precision];
  for (const component of ["year", "month", "day"] as const) {
    const present = value[component] !== undefined;
    if (present !== expected.includes(component)) {
      errors[component] = present
        ? `Remove ${component}; it contradicts ${value.precision} precision.`
        : `Enter ${component} for ${value.precision} precision.`;
    }
  }
  if (!inRange(value.year, 9999)) {
    errors.year = "Enter a year from 1 through 9999.";
  }
  if (!inRange(value.month, 12)) {
    errors.month = "Enter a month from 1 through 12.";
  }
  if (!inRange(value.day, 31)) errors.day = "Enter a day from 1 through 31.";
  if (
    value.month !== undefined && value.day !== undefined &&
    !errors.month && !errors.day &&
    !isRealCalendarDate(value.year ?? 2000, value.month, value.day)
  ) errors.day = "Enter a real calendar date.";
  return errors;
}

/** An absent component, or a whole number from 1 through `maximum`. */
function inRange(value: number | undefined, maximum: number): boolean {
  return value === undefined ||
    (Number.isInteger(value) && value >= 1 && value <= maximum);
}
