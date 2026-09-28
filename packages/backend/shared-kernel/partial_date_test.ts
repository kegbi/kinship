import {
  componentShape,
  DATE_PRECISIONS,
  type DatePrecision,
  isRealCalendarDate,
  parsePartialDateText,
  type PartialDateComponents,
  partialDateErrors,
  partialDateText,
} from "./partial_date.ts";
import { assert, assertEquals } from "../testing/assert.ts";

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

Deno.test("[GAP-046] a partial date carries exactly its precision's real components", () => {
  assert(
    Object.keys(partialDateErrors({ precision: "unknown" })).length === 0,
    "an unknown date names nothing and is valid",
  );
  assert(
    Object.keys(
      partialDateErrors({ day: 29, month: 2, precision: "full", year: 2024 }),
    ).length === 0,
    "a leap day in a leap year is a date",
  );
  assert(
    Object.keys(
      partialDateErrors({ day: 29, month: 2, precision: "month_day" }),
    )
      .length === 0,
    "a month and day without a year may be a leap day",
  );
  const contradicted = partialDateErrors({
    precision: "month_day",
    year: 1990,
  });
  assert(
    contradicted.year === "Remove year; it contradicts month_day precision." &&
      contradicted.month === "Enter month for month_day precision." &&
      contradicted.day === "Enter day for month_day precision.",
    "a component outside the precision, and one it lacks, are both named",
  );
  const ranged = partialDateErrors({
    day: 32,
    month: 13,
    precision: "full",
    year: 0,
  });
  assert(
    ranged.year === "Enter a year from 1 through 9999." &&
      ranged.month === "Enter a month from 1 through 12." &&
      ranged.day === "Enter a day from 1 through 31.",
    "each out-of-range component is named",
  );
  assert(
    partialDateErrors({ day: 31, month: 4, precision: "full", year: 2026 })
      .day === "Enter a real calendar date.",
    "April 31st is refused",
  );
  assert(
    partialDateErrors({ day: 1.5, precision: "day" }).day ===
      "Enter a day from 1 through 31.",
    "a fractional day is not a day",
  );
});

Deno.test("[GAP-050] every precision has one canonical text form", () => {
  const cases: readonly [PartialDateComponents, string][] = [
    [{ day: 9, month: 3, precision: "full", year: 1815 }, "1815-03-09"],
    [{ month: 12, precision: "year_month", year: 1990 }, "1990-12"],
    [{ day: 1, month: 2, precision: "month_day" }, "--02-01"],
    [{ precision: "year", year: 42 }, "0042"],
    [{ month: 7, precision: "month" }, "--07"],
    [{ day: 31, precision: "day" }, "---31"],
    [{ precision: "unknown" }, ""],
  ];
  for (const [value, text] of cases) {
    assertEquals(partialDateText(value), text);
    // A blank cell is an absent date, not an unknown one.
    assertEquals(
      parsePartialDateText(text),
      value.precision === "unknown" ? undefined : value,
    );
  }
});

Deno.test("[GAP-050] the basic and truncated vCard spellings parse too", () => {
  assertEquals(parsePartialDateText("18150309"), {
    day: 9,
    month: 3,
    precision: "full",
    year: 1815,
  });
  assertEquals(parsePartialDateText("--0201"), {
    day: 1,
    month: 2,
    precision: "month_day",
  });
  assertEquals(parsePartialDateText(" 1990-12-31T08:00:00Z "), {
    day: 31,
    month: 12,
    precision: "full",
    year: 1990,
  });
  assertEquals(parsePartialDateText("1990"), { precision: "year", year: 1990 });
});

Deno.test("[GAP-050] text that is not a real partial date is refused", () => {
  for (
    const text of [
      "1990-02-30",
      "--13-01",
      "0000",
      "1990/01/01",
      "March 3",
      "--02-30",
      "19900101T",
      "",
    ]
  ) {
    assertEquals(parsePartialDateText(text), undefined, text);
  }
});

Deno.test("[GAP-050] a component a malformed value lacks renders as zeros", () => {
  assertEquals(partialDateText({ precision: "full" }), "0000-00-00");
});
