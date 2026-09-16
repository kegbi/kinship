import {
  componentShape,
  DATE_PRECISIONS,
  type DatePrecision,
  isRealCalendarDate,
} from "./partial_date.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

Deno.test("[GAP-006] one precision vocabulary describes every partial date", () => {
  assert(
    DATE_PRECISIONS.length === new Set(DATE_PRECISIONS).size,
    "the precision vocabulary must not repeat",
  );
  for (
    const precision of [
      "day",
      "full",
      "month",
      "month_day",
      "unknown",
      "year",
      "year_month",
    ] as const
  ) {
    assert(
      (DATE_PRECISIONS as readonly string[]).includes(precision),
      `the kernel must name ${precision}`,
    );
  }
});

Deno.test("[GAP-006] every precision declares exactly the components it stores", () => {
  const expected = new Map<DatePrecision, string>([
    ["day", "day"],
    ["full", "year,month,day"],
    ["month", "month"],
    ["month_day", "month,day"],
    ["unknown", ""],
    ["year", "year"],
    ["year_month", "year,month"],
  ]);
  for (const precision of DATE_PRECISIONS) {
    assert(
      componentShape[precision].join(",") === expected.get(precision),
      `${precision} must store ${expected.get(precision)}`,
    );
  }
});

Deno.test("[GAP-006] month lengths and leap years are honoured", () => {
  assert(isRealCalendarDate(2026, 1, 31), "January has 31 days");
  assert(!isRealCalendarDate(2026, 2, 29), "2026 is not a leap year");
  assert(isRealCalendarDate(2024, 2, 29), "2024 is a leap year");
  assert(!isRealCalendarDate(1900, 2, 29), "1900 is a century non-leap year");
  assert(isRealCalendarDate(2000, 2, 29), "2000 is a 400-year leap year");
  assert(!isRealCalendarDate(2026, 4, 31), "April has 30 days");
  assert(isRealCalendarDate(2026, 4, 30), "April accepts its last day");
  assert(!isRealCalendarDate(2026, 13, 1), "month 13 is not a month");
  assert(!isRealCalendarDate(2026, 0, 1), "month 0 is not a month");
});
