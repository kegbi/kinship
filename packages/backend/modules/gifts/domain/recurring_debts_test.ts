import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  changedNextOccurrence,
  defaultCurrency,
  dueOccurrences,
  firstOccurrenceOnOrAfter,
  localDate,
  mergeRecurringDebtChange,
  normalizeRecurringDebt,
  occurrenceOn,
  resumedNextOccurrence,
  type StoredRecurringDebt,
} from "./recurring_debts.ts";

const monthly31 = { dayOfMonth: 31, intervalMonths: 1, startsOn: "2026-01-31" };

function stored(
  overrides: Partial<StoredRecurringDebt> = {},
): StoredRecurringDebt {
  return {
    active: true,
    amount: "40.00",
    createdAt: "2026-01-01T10:00:00.000000Z",
    currencyCode: "EUR",
    dayOfMonth: 15,
    direction: "they_owe",
    id: "40000000-0000-4000-8000-000000000001",
    intervalMonths: 1,
    nextOccurrenceOn: "2026-03-15",
    personId: "10000000-0000-4000-8000-000000000001",
    reason: "Rent share",
    startsOn: "2026-01-15",
    updatedAt: "2026-01-01T10:00:00.000000Z",
    ...overrides,
  };
}

Deno.test("[GIFTS-001] a day the month lacks clamps to its last day and comes back", () => {
  assertEquals(
    [0, 1, 2, 3, 4].map((index) => occurrenceOn(monthly31, index)),
    ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30", "2026-05-31"],
  );
  assertEquals(
    occurrenceOn({ ...monthly31, startsOn: "2028-01-31" }, 1),
    "2028-02-29",
    "a leap February ends on the 29th",
  );
});

Deno.test("[GIFTS-001] the first charge is the first matching day on or after the start", () => {
  assertEquals(
    occurrenceOn(
      { dayOfMonth: 1, intervalMonths: 3, startsOn: "2026-01-15" },
      0,
    ),
    "2026-02-01",
    "a day already past in the start month waits for the next month",
  );
  assertEquals(
    occurrenceOn(
      { dayOfMonth: 1, intervalMonths: 3, startsOn: "2026-01-15" },
      1,
    ),
    "2026-05-01",
    "later charges follow every interval from the first",
  );
  assertEquals(
    occurrenceOn(
      { dayOfMonth: 15, intervalMonths: 1, startsOn: "2026-01-15" },
      0,
    ),
    "2026-01-15",
    "a start on the due day charges that day",
  );
  assertEquals(
    firstOccurrenceOnOrAfter(monthly31, "2026-02-01"),
    "2026-02-28",
  );
  assertEquals(
    firstOccurrenceOnOrAfter(monthly31, "2025-06-01"),
    "2026-01-31",
    "nothing falls due before the start",
  );
  assertEquals(
    firstOccurrenceOnOrAfter(
      { ...monthly31, endsOn: "2026-02-27" },
      "2026-02-01",
    ),
    undefined,
    "nothing falls due after the end",
  );
});

Deno.test("[GIFTS-001] catch-up generates every missed period once, up to today", () => {
  assertEquals(
    dueOccurrences(monthly31, "2026-01-31", "2026-04-30", 120),
    {
      dates: ["2026-01-31", "2026-02-28", "2026-03-31", "2026-04-30"],
      next: "2026-05-31",
    },
  );
  assertEquals(
    dueOccurrences(monthly31, "2026-05-31", "2026-05-30", 120),
    { dates: [], next: "2026-05-31" },
    "a period not yet due is left for later",
  );
  assertEquals(
    dueOccurrences(monthly31, "2026-01-31", "2026-12-31", 2),
    { dates: ["2026-01-31", "2026-02-28"], next: "2026-03-31" },
    "a capped run resumes where it stopped",
  );
});

Deno.test("[GIFTS-001] the end date stops generation and finishes the rule", () => {
  assertEquals(
    dueOccurrences(
      { ...monthly31, endsOn: "2026-03-31" },
      "2026-01-31",
      "2026-12-31",
      120,
    ),
    { dates: ["2026-01-31", "2026-02-28", "2026-03-31"] },
  );
  assertEquals(
    dueOccurrences(
      { ...monthly31, endsOn: "2026-03-30" },
      "2026-02-28",
      "2026-12-31",
      120,
    ),
    { dates: ["2026-02-28"] },
  );
});

Deno.test("[GIFTS-001] resuming skips the periods that passed while paused", () => {
  const schedule = {
    dayOfMonth: 10,
    intervalMonths: 1,
    startsOn: "2026-01-10",
  };
  assertEquals(
    resumedNextOccurrence(schedule, "2026-06-11", "2026-02-10"),
    "2026-07-10",
  );
  assertEquals(
    resumedNextOccurrence(schedule, "2026-06-10", "2026-02-10"),
    "2026-06-10",
    "a period due on the resume day is still charged",
  );
  assertEquals(
    resumedNextOccurrence(schedule, "2026-01-01", undefined),
    "2026-01-10",
  );
  assertEquals(
    resumedNextOccurrence(schedule, "2026-02-01", "2026-02-10"),
    "2026-03-10",
    "a period already charged is never charged again",
  );
});

Deno.test("[GIFTS-001] an edited schedule continues after the last charged period", () => {
  const current = stored({ dayOfMonth: 5, startsOn: "2026-01-05" });
  assertEquals(
    changedNextOccurrence(
      current,
      { dayOfMonth: 20, intervalMonths: 1, startsOn: "2026-01-05" },
      "2026-09-05",
    ),
    "2026-10-20",
    "a later day in the charged month waits for the next period",
  );
  assertEquals(
    changedNextOccurrence(
      stored({ nextOccurrenceOn: "2026-10-05", startsOn: "2026-01-05" }),
      { dayOfMonth: 3, intervalMonths: 1, startsOn: "2026-01-05" },
      undefined,
    ),
    "2026-10-03",
    "an unchanged start keeps the pending period's month",
  );
  assertEquals(
    changedNextOccurrence(
      stored({ nextOccurrenceOn: "2026-10-05", startsOn: "2026-09-05" }),
      { dayOfMonth: 5, intervalMonths: 1, startsOn: "2026-07-05" },
      undefined,
    ),
    "2026-07-05",
    "a start moved earlier charges from the new start",
  );
  assertEquals(
    changedNextOccurrence(
      current,
      {
        dayOfMonth: 5,
        endsOn: "2026-09-30",
        intervalMonths: 1,
        startsOn: "2026-01-05",
      },
      "2026-09-05",
    ),
    undefined,
    "an end before the next period finishes the rule",
  );
});

Deno.test("[GIFTS-001] a rule is a positive schedule over money in a currency", () => {
  assertEquals(
    normalizeRecurringDebt({
      amount: "40.5",
      currencyCode: "eur",
      dayOfMonth: 31,
      direction: "i_owe",
      intervalMonths: 2,
      reason: "  Gym  ",
      startsOn: "2026-01-31",
    }),
    {
      amount: "40.5",
      currencyCode: "EUR",
      dayOfMonth: 31,
      direction: "i_owe",
      intervalMonths: 2,
      reason: "Gym",
      startsOn: "2026-01-31",
    },
  );
  const valid = {
    amount: "1",
    currencyCode: "EUR",
    dayOfMonth: 1,
    direction: "they_owe" as const,
    intervalMonths: 1,
    startsOn: "2026-01-01",
  };
  for (
    const [label, change] of [
      ["day zero", { dayOfMonth: 0 }],
      ["day 32", { dayOfMonth: 32 }],
      ["fractional day", { dayOfMonth: 1.5 }],
      ["no interval", { intervalMonths: 0 }],
      ["interval past ten years", { intervalMonths: 121 }],
      ["impossible start", { startsOn: "2026-02-30" }],
      ["malformed start", { startsOn: "2026-1-1" }],
      ["end before start", { endsOn: "2025-12-31" }],
      ["impossible end", { endsOn: "2026-02-30" }],
      ["no amount", { amount: "" }],
      ["bad currency", { currencyCode: "EU" }],
    ] as const
  ) {
    assertEquals(
      normalizeRecurringDebt({ ...valid, ...change }),
      undefined,
      `${label} was accepted`,
    );
  }
  assertEquals(
    normalizeRecurringDebt({ ...valid, endsOn: "2026-01-01" })?.endsOn,
    "2026-01-01",
    "a rule may end on its start",
  );
});

Deno.test("[GIFTS-001] a change keeps every field it does not name", () => {
  assertEquals(mergeRecurringDebtChange(stored(), { amount: "45" }), {
    active: true,
    amount: "45",
    currencyCode: "EUR",
    dayOfMonth: 15,
    direction: "they_owe",
    intervalMonths: 1,
    reason: "Rent share",
    startsOn: "2026-01-15",
  });
  const ended = mergeRecurringDebtChange(
    stored({ endsOn: "2026-12-15" }),
    { endsOn: null, reason: null },
  );
  assert(
    ended !== undefined && !("endsOn" in ended) && !("reason" in ended),
    "a null clears the end date and the reason",
  );
  assertEquals(
    mergeRecurringDebtChange(stored(), { active: false })?.active,
    false,
  );
  assertEquals(
    mergeRecurringDebtChange(stored(), { dayOfMonth: 40 }),
    undefined,
  );
});

Deno.test("[GIFTS-001] today is the workspace's local date", () => {
  const now = new Date("2026-03-31T23:30:00.000Z");
  assertEquals(localDate(now, "UTC"), "2026-03-31");
  assertEquals(localDate(now, "Europe/Belgrade"), "2026-04-01");
  assertEquals(localDate(now, "America/Los_Angeles"), "2026-03-31");
  assertEquals(
    localDate(now, "Not/AZone"),
    "2026-03-31",
    "an unknown zone falls back to UTC",
  );
});

Deno.test("[GIFTS-001] the default currency is the preference, else USD", () => {
  assertEquals(defaultCurrency("EUR"), "EUR");
  assertEquals(defaultCurrency(undefined), "USD");
});
