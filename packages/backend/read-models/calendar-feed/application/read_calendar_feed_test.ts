import {
  CALENDAR_FEED_EVENT_LIMIT,
  CALENDAR_FEED_WINDOW_DAYS_AFTER,
  CALENDAR_FEED_WINDOW_DAYS_BEFORE,
  type CalendarFeedCriteria,
  type CalendarFeedRepository,
  type CalendarFeedRows,
  createCalendarFeed,
  importantDateLabel,
} from "../public.ts";
import { assertEquals } from "../../../testing/assert.ts";
import { fixedClock } from "../../../testing/fakes.ts";
import * as fixtures from "../../../testing/fixtures.ts";

const actor = fixtures.actor();
const NOW = new Date("2026-09-28T10:00:00.000Z");

const ROWS: CalendarFeedRows = {
  calendarName: "Lovelace circle",
  dates: [
    {
      day: 10,
      id: "date-1",
      kind: "birthday",
      label: "ignored for a birthday",
      month: 12,
      personId: "person-1",
      personName: "Ada Lovelace",
      updatedAt: "2026-09-01T00:00:00.000Z",
      year: 1815,
    },
    {
      day: 3,
      id: "date-2",
      kind: "custom",
      label: "Wedding anniversary",
      month: 6,
      personId: "person-1",
      personName: "Ada Lovelace",
      updatedAt: "2026-09-01T00:00:00.000Z",
    },
  ],
  reminders: [{
    occursOn: "2026-10-03",
    personId: "person-1",
    reminderId: "reminder-1",
    title: "Call Ada",
    updatedAt: "2026-09-02T00:00:00.000Z",
  }],
  status: "ready",
  truncated: false,
};

function feed(
  rows: CalendarFeedRows | { readonly status: "timed-out" },
  standing: "active" | "revoked" = "active",
  seen: CalendarFeedCriteria[] = [],
) {
  const repository: CalendarFeedRepository = {
    read: (criteria) => {
      seen.push(criteria);
      return Promise.resolve(rows);
    },
  };
  return createCalendarFeed({
    actors: { revalidate: () => Promise.resolve(standing) },
    clock: fixedClock(NOW),
    repository,
    transaction: { run: (work) => work({ opaque: undefined }) },
  });
}

Deno.test("[INTEGRATION-002] each date is named by the vocabulary", () => {
  assertEquals(importantDateLabel("birthday"), "Birthday");
  assertEquals(importantDateLabel("deceased"), "Date of death");
  assertEquals(importantDateLabel("first_met"), "First meeting");
  assertEquals(importantDateLabel("custom", "Anniversary"), "Anniversary");
  assertEquals(importantDateLabel("custom"), "Important date");
});

Deno.test("[INTEGRATION-002] the feed reads one bounded window for the member", async () => {
  const seen: CalendarFeedCriteria[] = [];
  const result = await feed(ROWS, "active", seen).read(actor);
  assertEquals(seen, [{
    ...actor,
    limit: CALENDAR_FEED_EVENT_LIMIT,
    now: NOW,
    windowDaysAfter: CALENDAR_FEED_WINDOW_DAYS_AFTER,
    windowDaysBefore: CALENDAR_FEED_WINDOW_DAYS_BEFORE,
  }]);
  assertEquals(
    [
      CALENDAR_FEED_EVENT_LIMIT,
      CALENDAR_FEED_WINDOW_DAYS_BEFORE,
      CALENDAR_FEED_WINDOW_DAYS_AFTER,
    ],
    [2000, 30, 365],
  );
  assertEquals(result, {
    calendarName: "Lovelace circle",
    dates: [
      {
        day: 10,
        id: "date-1",
        label: "Birthday",
        month: 12,
        personId: "person-1",
        personName: "Ada Lovelace",
        updatedAt: "2026-09-01T00:00:00.000Z",
        year: 1815,
      },
      {
        day: 3,
        id: "date-2",
        label: "Wedding anniversary",
        month: 6,
        personId: "person-1",
        personName: "Ada Lovelace",
        updatedAt: "2026-09-01T00:00:00.000Z",
      },
    ],
    reminders: ROWS.reminders,
    status: "ready",
  });
});

Deno.test("[INTEGRATION-002] a capped feed names its limit", async () => {
  const result = await feed({ ...ROWS, truncated: true }).read(actor);
  assertEquals(
    result.status === "ready" ? result.truncated : undefined,
    { limit: CALENDAR_FEED_EVENT_LIMIT },
  );
});

Deno.test("[INTEGRATION-002] a revoked member reads nothing and a timeout is unavailable", async () => {
  const seen: CalendarFeedCriteria[] = [];
  assertEquals(await feed(ROWS, "revoked", seen).read(actor), {
    status: "forbidden",
  });
  assertEquals(seen.length, 0, "the repository is never asked");
  assertEquals(await feed({ status: "timed-out" }).read(actor), {
    status: "unavailable",
  });
});
