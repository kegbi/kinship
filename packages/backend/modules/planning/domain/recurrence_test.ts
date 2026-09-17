import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  addCalendar,
  generateCalendarOccurrences,
  MAXIMUM_OCCURRENCES,
  MAXIMUM_RECURRENCE_INTERVAL,
  zonedInstant,
} from "./recurrence.ts";

Deno.test("PLANNING-002 calendar recurrence is deterministic across DST gaps, folds, and month edges", () => {
  const gap = generateCalendarOccurrences({
    anchorOn: "2026-03-29",
    count: 1,
    from: "2026-03-01T00:00:00Z",
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    sendTime: "02:30:00",
    timezone: "Europe/Belgrade",
  });
  const fold = generateCalendarOccurrences({
    anchorOn: "2026-10-25",
    count: 1,
    from: "2026-10-01T00:00:00Z",
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    sendTime: "02:30:00",
    timezone: "Europe/Belgrade",
  });
  const monthly = generateCalendarOccurrences({
    anchorOn: "2026-01-31",
    count: 3,
    from: "2026-01-01T00:00:00Z",
    recurrenceInterval: 1,
    recurrenceUnit: "month",
    sendTime: "00:00:00",
    timezone: "UTC",
  });
  if (
    gap[0]?.deliverAt !== "2026-03-29T01:30:00Z" ||
    fold[0]?.deliverAt !== "2026-10-25T00:30:00Z" ||
    monthly.map((item) => item.occursOn).join(",") !==
      "2026-01-31,2026-02-28,2026-03-31"
  ) {
    throw new Error(JSON.stringify({ fold, gap, monthly }));
  }
});

Deno.test("PLANNING-002 recurrence jumps to old daily, monthly, and yearly anchors", () => {
  const cases = [
    generateCalendarOccurrences({
      anchorOn: "2000-01-01",
      count: 2,
      from: "2026-08-18T00:00:00Z",
      recurrenceInterval: 1,
      recurrenceUnit: "day",
      sendTime: "09:00:00",
      timezone: "UTC",
    }),
    generateCalendarOccurrences({
      anchorOn: "1600-01-31",
      count: 2,
      from: "2026-08-18T00:00:00Z",
      recurrenceInterval: 1,
      recurrenceUnit: "month",
      sendTime: "09:00:00",
      timezone: "UTC",
    }),
    generateCalendarOccurrences({
      anchorOn: "1600-02-29",
      count: 2,
      from: "2026-08-18T00:00:00Z",
      recurrenceInterval: 1,
      recurrenceUnit: "year",
      sendTime: "09:00:00",
      timezone: "UTC",
    }),
  ];
  if (
    cases.some((items) => items.length !== 2) ||
    cases[0]?.[0]?.occursOn !== "2026-08-18" ||
    cases[1]?.[0]?.occursOn !== "2026-08-31" ||
    cases[2]?.[0]?.occursOn !== "2027-02-28"
  ) {
    throw new Error(JSON.stringify(cases));
  }
});

Deno.test("[GAP-016] a skipped wall-clock time moves forward and a repeated one takes the first", () => {
  assertEquals(
    zonedInstant(
      Temporal.PlainDate.from("2026-03-29"),
      "02:30:00",
      "Europe/Belgrade",
    ),
    "2026-03-29T01:30:00Z",
    "the hour the zone skips resolves forward by the gap",
  );
  assertEquals(
    zonedInstant(
      Temporal.PlainDate.from("2026-10-25"),
      "02:30:00",
      "Europe/Belgrade",
    ),
    "2026-10-25T00:30:00Z",
    "the hour the zone repeats resolves to the earlier of the two",
  );
  assertEquals(
    zonedInstant(Temporal.PlainDate.from("2026-06-01"), "09:15", "UTC"),
    "2026-06-01T09:15:00Z",
    "a send time without seconds is still a wall-clock time",
  );
});

Deno.test("[GAP-016] a calendar step constrains rather than overflowing", () => {
  const anchor = Temporal.PlainDate.from("2026-01-31");
  assertEquals(addCalendar(anchor, "none", 4).toString(), "2026-01-31");
  assertEquals(addCalendar(anchor, "month", 0).toString(), "2026-01-31");
  assertEquals(addCalendar(anchor, "day", 1).toString(), "2026-02-01");
  assertEquals(addCalendar(anchor, "week", 2).toString(), "2026-02-14");
  assertEquals(addCalendar(anchor, "month", 1).toString(), "2026-02-28");
  assertEquals(addCalendar(anchor, "year", 1).toString(), "2027-01-31");
  assertEquals(
    addCalendar(Temporal.PlainDate.from("2028-02-29"), "year", 1).toString(),
    "2029-02-28",
    "a leap day lands on the last day of a common February",
  );
});

Deno.test("[GAP-016] a one-off reminder fires once, whatever the window asks for", () => {
  const once = generateCalendarOccurrences({
    anchorOn: "2026-05-04",
    count: 8,
    from: "2026-01-01T00:00:00Z",
    recurrenceInterval: 1,
    recurrenceUnit: "none",
    sendTime: "09:00:00",
    timezone: "UTC",
  });
  assertEquals(once.length, 1);
  assertEquals(once[0], {
    deliverAt: "2026-05-04T09:00:00Z",
    occursOn: "2026-05-04",
  });
  assertEquals(
    generateCalendarOccurrences({
      anchorOn: "2026-05-04",
      count: 1,
      from: "2026-06-01T00:00:00Z",
      recurrenceInterval: 1,
      recurrenceUnit: "none",
      sendTime: "09:00:00",
      timezone: "UTC",
    }),
    [],
    "a one-off reminder whose day has passed mints nothing",
  );
});

Deno.test("[GAP-016] the count and the interval are clamped rather than refused", () => {
  assertEquals(MAXIMUM_OCCURRENCES, 32);
  assertEquals(MAXIMUM_RECURRENCE_INTERVAL, 100);
  const clampedLow = generateCalendarOccurrences({
    anchorOn: "2026-01-01",
    count: 0,
    from: "2026-01-01T00:00:00Z",
    recurrenceInterval: 0,
    recurrenceUnit: "day",
    sendTime: "00:00:00",
    timezone: "UTC",
  });
  assertEquals(clampedLow.length, 1, "a count below one still mints one");
  assertEquals(clampedLow[0]?.occursOn, "2026-01-01");
  const clampedHigh = generateCalendarOccurrences({
    anchorOn: "2026-01-01",
    count: 500,
    from: "2026-01-01T00:00:00Z",
    recurrenceInterval: 1,
    recurrenceUnit: "day",
    sendTime: "00:00:00",
    timezone: "UTC",
  });
  assertEquals(clampedHigh.length, MAXIMUM_OCCURRENCES);
  const wideInterval = generateCalendarOccurrences({
    anchorOn: "2026-01-01",
    count: 2,
    from: "2026-01-01T00:00:00Z",
    recurrenceInterval: 1_000,
    recurrenceUnit: "day",
    sendTime: "00:00:00",
    timezone: "UTC",
  });
  assertEquals(
    wideInterval.map((item) => item.occursOn),
    ["2026-01-01", "2026-04-11"],
    "an interval beyond the maximum is clamped to one hundred days",
  );
});

Deno.test("[GAP-016] a weekly series resumes from the caller's instant, not the anchor", () => {
  const weekly = generateCalendarOccurrences({
    anchorOn: "2026-01-07",
    count: 3,
    from: "2026-02-10T00:00:00Z",
    recurrenceInterval: 2,
    recurrenceUnit: "week",
    sendTime: "08:00:00",
    timezone: "UTC",
  });
  assertEquals(
    weekly.map((item) => item.occursOn),
    ["2026-02-18", "2026-03-04", "2026-03-18"],
  );
  assert(
    weekly.every((item) => item.deliverAt.endsWith("T08:00:00Z")),
    "every weekly firing keeps the same wall-clock send time",
  );
});
