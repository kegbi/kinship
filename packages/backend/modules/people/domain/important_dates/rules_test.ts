import { assertEquals } from "../../../../testing/assert.ts";
import {
  type ImportantDateValue,
  normalizeImportantDate,
  schedulingFor,
  validateImportantDate,
} from "./rules.ts";

function value(
  overrides: Partial<ImportantDateValue> = {},
): ImportantDateValue {
  return {
    isAgeBased: false,
    isYearApproximate: false,
    kind: "birthday",
    precision: "unknown",
    ...overrides,
  };
}

Deno.test("[GAP-015] normalization keeps the components and trims the text", () => {
  assertEquals(
    normalizeImportantDate({
      day: 10,
      isAgeBased: false,
      isYearApproximate: true,
      kind: "birthday",
      label: "   ",
      month: 12,
      notes: "  born in London  ",
      precision: "full",
      year: 1815,
    }),
    {
      day: 10,
      isAgeBased: false,
      isYearApproximate: true,
      kind: "birthday",
      month: 12,
      notes: "born in London",
      precision: "full",
      year: 1815,
    },
  );
  assertEquals(
    normalizeImportantDate({
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "  Graduation  ",
      precision: "unknown",
    }),
    {
      isAgeBased: false,
      isYearApproximate: false,
      kind: "custom",
      label: "Graduation",
      precision: "unknown",
    },
  );
});

Deno.test("[GAP-015] the components must be exactly the ones the precision stores", () => {
  assertEquals(
    validateImportantDate(value({ month: 2, precision: "month_day" })),
    { day: "Enter day for month_day precision." },
  );
  assertEquals(
    validateImportantDate(value({ precision: "unknown", year: 1815 })),
    { year: "Remove year; it contradicts unknown precision." },
  );
  assertEquals(
    validateImportantDate(
      value({ day: 10, month: 12, precision: "full", year: 1815 }),
    ),
    {},
  );
});

Deno.test("[GAP-015] each component is range checked before the calendar is asked", () => {
  assertEquals(
    validateImportantDate(
      value({ day: 32, month: 13, precision: "full", year: 0 }),
    ),
    {
      year: "Enter a year from 1 through 9999.",
      month: "Enter a month from 1 through 12.",
      day: "Enter a day from 1 through 31.",
    },
  );
  assertEquals(
    validateImportantDate(value({ precision: "year", year: 10_000 })),
    { year: "Enter a year from 1 through 9999." },
  );
  assertEquals(
    validateImportantDate(value({ precision: "year", year: 1815.5 })),
    { year: "Enter a year from 1 through 9999." },
  );
  assertEquals(
    validateImportantDate(value({ month: 0, precision: "month" })),
    { month: "Enter a month from 1 through 12." },
  );
  assertEquals(
    validateImportantDate(value({ month: 1.5, precision: "month" })),
    { month: "Enter a month from 1 through 12." },
  );
  assertEquals(validateImportantDate(value({ day: 0, precision: "day" })), {
    day: "Enter a day from 1 through 31.",
  });
  assertEquals(validateImportantDate(value({ day: 1.5, precision: "day" })), {
    day: "Enter a day from 1 through 31.",
  });
});

Deno.test("[GAP-015] a month and day that pass their ranges must name a real day", () => {
  assertEquals(
    validateImportantDate(value({ day: 30, month: 2, precision: "month_day" })),
    { day: "Enter a real calendar date." },
    "a yearless date is checked against a leap year",
  );
  assertEquals(
    validateImportantDate(value({ day: 29, month: 2, precision: "month_day" })),
    {},
  );
  assertEquals(
    validateImportantDate(
      value({ day: 29, month: 2, precision: "full", year: 1900 }),
    ),
    { day: "Enter a real calendar date." },
    "1900 is not a leap year",
  );
});

Deno.test("[GAP-015] approximate and age-based display both need a known year", () => {
  assertEquals(
    validateImportantDate(
      value({
        day: 1,
        isYearApproximate: true,
        month: 1,
        precision: "month_day",
      }),
    ),
    { isYearApproximate: "An approximate year still needs a year value." },
  );
  assertEquals(
    validateImportantDate(
      value({ day: 1, isAgeBased: true, month: 1, precision: "month_day" }),
    ),
    { isAgeBased: "Age display needs a known year." },
  );
  assertEquals(
    validateImportantDate(
      value({
        isAgeBased: true,
        isYearApproximate: true,
        precision: "year",
        year: 1815,
      }),
    ),
    {},
  );
});

Deno.test("[GAP-015] only a custom date carries a label, and it is bounded", () => {
  assertEquals(validateImportantDate(value({ kind: "custom" })), {
    label: "Enter an honest label for this custom date.",
  });
  assertEquals(
    validateImportantDate(value({ kind: "deceased", label: "Passed away" })),
    { label: "Core dates use their standard label." },
  );
  assertEquals(
    validateImportantDate(value({ kind: "custom", label: "x".repeat(201) })),
    { label: "Use 200 characters or fewer." },
  );
  assertEquals(
    validateImportantDate(value({ kind: "custom", label: "x".repeat(200) })),
    {},
  );
  assertEquals(
    validateImportantDate(
      value({ kind: "first_met", notes: "n".repeat(2001) }),
    ),
    { notes: "Use 2,000 characters or fewer." },
  );
});

Deno.test("[GAP-015] a date recurs only when it names a month and a day", () => {
  assertEquals(schedulingFor(12, 10), "annual-reminder");
  assertEquals(schedulingFor(12, undefined), "not-schedulable");
  assertEquals(schedulingFor(undefined, 10), "not-schedulable");
  assertEquals(schedulingFor(undefined, undefined), "not-schedulable");
});
