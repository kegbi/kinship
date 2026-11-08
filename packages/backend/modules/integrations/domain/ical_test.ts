import { assert, assertEquals } from "../../../testing/assert.ts";
import {
  CALENDAR_FEED_BASE_YEAR,
  type CalendarFeedContent,
  calendarFeedDocument,
  calendarFeedTag,
} from "./calendar_feed_rules.ts";
import { escapeText, foldLine, renderCalendar } from "./ical.ts";

const ORIGIN = "https://kinship.example";
const ADA = "5f0c2a4e-8d1b-4c3a-9e7f-0a1b2c3d4e5f";
const BIRTHDAY = "0b6d8e2f-1a3c-4d5e-8f7a-9b0c1d2e3f4a";
const LEAP = "1c7e9f30-2b4d-4e6f-8a8b-0c1d2e3f4a5b";
const REMINDER = "2d8f0a41-3c5e-4f70-9b9c-1d2e3f4a5b6c";

const CONTENT: CalendarFeedContent = {
  calendarName: "Lovelace circle",
  dates: [
    {
      day: 10,
      id: BIRTHDAY,
      label: "Birthday",
      month: 12,
      personId: ADA,
      personName: "Ada Lovelace",
      updatedAt: "2026-09-01T08:30:15.123Z",
      year: 1815,
    },
    {
      day: 29,
      id: LEAP,
      label: "Anniversary; first, then again",
      month: 2,
      personId: ADA,
      personName: "Ada Lovelace",
      updatedAt: "2026-09-02T09:00:00.000Z",
    },
  ],
  reminders: [{
    occursOn: "2026-10-03",
    personId: ADA,
    reminderId: REMINDER,
    title: "Call Ada about the engine",
    updatedAt: "2026-09-03T10:00:00.000Z",
  }],
};

/** The feed above, byte for byte: CRLF line endings, folded, escaped. */
const FIXTURE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Kinship//Calendar feed//EN",
  "CALSCALE:GREGORIAN",
  "METHOD:PUBLISH",
  "X-WR-CALNAME:Lovelace circle — Kinship",
  "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
  "X-PUBLISHED-TTL:PT1H",
  "BEGIN:VEVENT",
  "UID:reminder-2d8f0a41-3c5e-4f70-9b9c-1d2e3f4a5b6c-2026-10-03@kinship.exampl",
  " e",
  "DTSTAMP:20260903T100000Z",
  "DTSTART;VALUE=DATE:20261003",
  "SUMMARY:Call Ada about the engine",
  "DESCRIPTION:Open in Kinship: https://kinship.example/app/people/5f0c2a4e-8d",
  " 1b-4c3a-9e7f-0a1b2c3d4e5f",
  "URL:https://kinship.example/app/people/5f0c2a4e-8d1b-4c3a-9e7f-0a1b2c3d4e5f",
  "TRANSP:TRANSPARENT",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:person-date-0b6d8e2f-1a3c-4d5e-8f7a-9b0c1d2e3f4a@kinship.example",
  "DTSTAMP:20260901T083015Z",
  "DTSTART;VALUE=DATE:18151210",
  "RRULE:FREQ=YEARLY",
  "SUMMARY:Ada Lovelace — Birthday",
  "DESCRIPTION:Open in Kinship: https://kinship.example/app/people/5f0c2a4e-8d",
  " 1b-4c3a-9e7f-0a1b2c3d4e5f",
  "URL:https://kinship.example/app/people/5f0c2a4e-8d1b-4c3a-9e7f-0a1b2c3d4e5f",
  "TRANSP:TRANSPARENT",
  "END:VEVENT",
  "BEGIN:VEVENT",
  "UID:person-date-1c7e9f30-2b4d-4e6f-8a8b-0c1d2e3f4a5b@kinship.example",
  "DTSTAMP:20260902T090000Z",
  "DTSTART;VALUE=DATE:20000229",
  "RRULE:FREQ=YEARLY",
  "SUMMARY:Ada Lovelace — Anniversary\\; first\\, then again",
  "DESCRIPTION:Year unknown\\; 2000 is only a placeholder.\\nOpen in Kinship: ht",
  " tps://kinship.example/app/people/5f0c2a4e-8d1b-4c3a-9e7f-0a1b2c3d4e5f",
  "URL:https://kinship.example/app/people/5f0c2a4e-8d1b-4c3a-9e7f-0a1b2c3d4e5f",
  "TRANSP:TRANSPARENT",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const bytes = (value: string) => new TextEncoder().encode(value).length;

Deno.test("[INTEGRATION-002] the fixture calendar is rendered byte for byte", () => {
  assertEquals(calendarFeedDocument(CONTENT, ORIGIN), FIXTURE);
});

Deno.test("[INTEGRATION-002] every line ends in CRLF and fits 75 octets", () => {
  const document = calendarFeedDocument(CONTENT, ORIGIN);
  assert(document.endsWith("END:VCALENDAR\r\n"), "the last line is closed");
  assert(!/[^\r]\n/.test(document), "no bare line feed");
  for (const line of document.split("\r\n")) {
    assert(bytes(line) <= 75, `${line} is ${bytes(line)} octets`);
  }
});

Deno.test("[INTEGRATION-002] text values are escaped as RFC 5545 requires", () => {
  assertEquals(escapeText("a\\b;c,d"), "a\\\\b\\;c\\,d");
  assertEquals(
    escapeText("one\r\ntwo\nthree\rfour"),
    "one\\ntwo\\nthree\\nfour",
  );
  assertEquals(
    escapeText("tab\there\u0000\u0007\u007f gone"),
    "tab\there gone",
    "a tab stays and every other control character is dropped",
  );
});

Deno.test("[INTEGRATION-002] folding never splits a UTF-8 sequence", () => {
  const line = `SUMMARY:${"é".repeat(40)}${"😀".repeat(20)}`;
  const folded = foldLine(line);
  const parts = folded.split("\r\n");
  assert(parts.length > 1, "a long line is folded");
  for (const [index, part] of parts.entries()) {
    assert(bytes(part) <= 75, `part ${index} is ${bytes(part)} octets`);
    if (index > 0) {
      assert(part.startsWith(" "), "a continuation starts with a space");
    }
    assert(!part.includes("�"), "no replacement character");
  }
  assertEquals(
    parts.map((part, index) => index === 0 ? part : part.slice(1)).join(""),
    line,
    "unfolding restores the line exactly",
  );
  assertEquals(foldLine("SHORT:line"), "SHORT:line", "a short line is kept");
  const exact = `X:${"a".repeat(73)}`;
  assertEquals(foldLine(exact), exact, "75 octets exactly is not folded");
});

Deno.test("[INTEGRATION-002] a Feb 29 date recurs yearly from a leap base year", () => {
  assert(
    CALENDAR_FEED_BASE_YEAR % 4 === 0 &&
      (CALENDAR_FEED_BASE_YEAR % 100 !== 0 ||
        CALENDAR_FEED_BASE_YEAR % 400 === 0),
    "the placeholder year holds a Feb 29",
  );
  const document = calendarFeedDocument(CONTENT, ORIGIN);
  // RFC 5545 skips an instance that would fall on an invalid date, so a
  // Feb 29 series recurs only in leap years — the rule planning follows for a
  // Feb 29 person-date reminder, which skips every common year.
  assert(
    document.includes("DTSTART;VALUE=DATE:20000229\r\nRRULE:FREQ=YEARLY\r\n"),
    "Feb 29 keeps its own day rather than moving to Feb 28 or Mar 1",
  );
});

Deno.test("[INTEGRATION-002] a date that exists in no year is left out", () => {
  const document = calendarFeedDocument({
    ...CONTENT,
    dates: [
      { ...CONTENT.dates[0]!, day: 31, month: 4, year: undefined },
      { ...CONTENT.dates[0]!, day: 29, id: LEAP, month: 2, year: 2023 },
      { ...CONTENT.dates[0]!, day: 30, month: 2, year: undefined },
    ],
    reminders: [],
  }, ORIGIN);
  assert(!document.includes("BEGIN:VEVENT"), document);
});

Deno.test("[INTEGRATION-002] a truncated feed says so", () => {
  const document = calendarFeedDocument(
    { ...CONTENT, truncated: { limit: 2000 } },
    ORIGIN,
  );
  assert(
    document.includes(
      "X-KINSHIP-TRUNCATED:Only the first 2000 events are included.\r\n",
    ),
    document,
  );
  assert(
    !calendarFeedDocument(CONTENT, ORIGIN).includes("X-KINSHIP-TRUNCATED"),
    "a complete feed carries no truncation note",
  );
});

Deno.test("[INTEGRATION-002] a reminder with no person carries no link", () => {
  const document = renderCalendar({
    events: [{
      start: { day: 1, month: 1, year: 2027 },
      stamp: "2026-01-01T00:00:00Z",
      summary: "New year",
      uid: "reminder-x@host",
      yearly: false,
    }],
    name: "N",
  });
  assert(!document.includes("DESCRIPTION"), document);
  assert(!document.includes("URL:"), document);
  assert(!document.includes("RRULE"), document);
});

Deno.test("[INTEGRATION-002] a reminder day that does not exist is left out, and one with no person has no link", () => {
  const document = calendarFeedDocument({
    ...CONTENT,
    dates: [],
    reminders: [
      { ...CONTENT.reminders[0]!, occursOn: "2026-02-30" },
      { ...CONTENT.reminders[0]!, occursOn: "not-a-date" },
      {
        occursOn: "2026-11-01",
        reminderId: REMINDER,
        title: "Unattached",
        updatedAt: "2026-09-03T10:00:00.000Z",
      },
    ],
  }, ORIGIN);
  assertEquals(
    document.match(/BEGIN:VEVENT/g)?.length,
    1,
    "only the real day is published",
  );
  assert(document.includes("SUMMARY:Unattached\r\n"), document);
  assert(!document.includes("DESCRIPTION"), document);
  assert(!document.includes("URL:"), document);
});

const REVISION =
  "2026-11-08|Lovelace circle|2:2026-09-01T08:30:15.123Z|1:2026-09-03T10:00:00.000Z";

Deno.test("[INTEGRATION-002] the feed tag is a strong base64url SHA-256 of the format, origin, and revision", async () => {
  // SHA-256 over `["kinship-calendar-feed/1","https://kinship.example",REVISION]`,
  // computed outside Deno; its base64 form is `0/vc…+1dmH1Co=`, so the tag
  // proves both alphabet substitutions and the dropped padding.
  assertEquals(
    await calendarFeedTag(REVISION, ORIGIN),
    '"0_vcdxK6d3qO_5j1MfArLKAOUePxymPin98-1dmH1Co"',
  );
});

Deno.test("[INTEGRATION-002] the feed tag is stable and moves with the revision and the origin", async () => {
  const tag = await calendarFeedTag(REVISION, ORIGIN);
  assertEquals(await calendarFeedTag(REVISION, ORIGIN), tag);
  assert(/^"[A-Za-z0-9_-]{43}"$/.test(tag), tag);
  const moved = [
    await calendarFeedTag(`${REVISION}x`, ORIGIN),
    await calendarFeedTag(REVISION, "https://other.example"),
    await calendarFeedTag(ORIGIN, REVISION),
  ];
  assertEquals(new Set([tag, ...moved]).size, 4, moved.join(" "));
});
