/**
 * What the calendar feed says about a date or a reminder (GAP-052,
 * `INTEGRATION-002`).
 *
 * The feed is read-only and computed on each request, so an event keeps no
 * row of its own: its identity is derived from the row it describes. A
 * person's date is `person-date-<id>@<host>`, one yearly series; a reminder
 * is `reminder-<reminderId>-<occurs_on>@<host>`, one day, so the email and
 * in-app occurrences of the same day are one event. `DTSTAMP` is the source
 * row's own last change, never the time of the request, so the document —
 * and the entity tag derived from it — changes only when what it says does.
 *
 * The entity tag is not a hash of the body, because a poll that matched would
 * still pay for reading and rendering every event (BEQ-14). It is a hash of
 * the read model's revision — the member's today, the workspace's name, and
 * each row set's size and latest change — with the origin links open at and
 * `CALENDAR_FEED_FORMAT`, so the same inputs always render the same bytes.
 * Change the format's version whenever the rendering here changes, or a
 * calendar holding the old body would be told it is current.
 *
 * A date with no year starts in `CALENDAR_FEED_BASE_YEAR` and says so. That
 * year is a leap year so a Feb 29 date keeps its own day; RFC 5545 skips a
 * yearly instance that falls on a date that does not exist, so the series
 * recurs only in leap years — exactly how planning schedules a Feb 29
 * person-date reminder, which it leaves out of every common year.
 */

import { type ICalendarEvent, renderCalendar } from "./ical.ts";

/** Where a date with an unknown year starts. A leap year, for Feb 29. */
export const CALENDAR_FEED_BASE_YEAR = 2000;

/** The rendering's version, part of every entity tag. Bump it on any change. */
export const CALENDAR_FEED_FORMAT = "kinship-calendar-feed/1";

/**
 * The strong entity tag of the body these inputs render: SHA-256, base64url,
 * over the format, the origin, and the read model's revision.
 */
export async function calendarFeedTag(
  revision: string,
  origin: string,
): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(
        JSON.stringify([CALENDAR_FEED_FORMAT, origin, revision]),
      ),
    ),
  );
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return `"${
    btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "")
  }"`;
}

/** One person's month-and-day date, as the read model lists it. */
export interface CalendarFeedDate {
  readonly day: number;
  readonly id: string;
  /** The vocabulary's name for the date: "Birthday", or its own label. */
  readonly label: string;
  readonly month: number;
  readonly personId: string;
  readonly personName: string;
  readonly updatedAt: string;
  readonly year?: number | undefined;
}

/** One day a reminder occurs on for the feed's member. */
export interface CalendarFeedReminder {
  /** `YYYY-MM-DD`. */
  readonly occursOn: string;
  readonly personId?: string | undefined;
  readonly reminderId: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface CalendarFeedContent {
  readonly calendarName: string;
  readonly dates: readonly CalendarFeedDate[];
  readonly reminders: readonly CalendarFeedReminder[];
  /** Present when the read model stopped at its event limit. */
  readonly truncated?: { readonly limit: number } | undefined;
}

/** Whether the day exists in that year of the Gregorian calendar. */
function exists(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
}

/** The person workspace a calendar event links to. */
function personUrl(origin: string, personId: string): string {
  return new URL(`/app/people/${personId}`, origin).href;
}

const opens = (url: string) => `Open in Kinship: ${url}`;

function dateEvent(
  date: CalendarFeedDate,
  origin: string,
  host: string,
): ICalendarEvent | undefined {
  const year = date.year ?? CALENDAR_FEED_BASE_YEAR;
  if (!exists(year, date.month, date.day)) return undefined;
  const url = personUrl(origin, date.personId);
  return {
    description: date.year === undefined
      ? `Year unknown; ${CALENDAR_FEED_BASE_YEAR} is only a placeholder.\n${
        opens(url)
      }`
      : opens(url),
    start: { day: date.day, month: date.month, year },
    stamp: date.updatedAt,
    summary: `${date.personName} — ${date.label}`,
    uid: `person-date-${date.id}@${host}`,
    url,
    yearly: true,
  };
}

function reminderEvent(
  reminder: CalendarFeedReminder,
  origin: string,
  host: string,
): ICalendarEvent | undefined {
  const [year, month, day] = reminder.occursOn.split("-").map(Number);
  if (!year || !month || !day || !exists(year, month, day)) return undefined;
  const url = reminder.personId
    ? personUrl(origin, reminder.personId)
    : undefined;
  return {
    ...(url ? { description: opens(url), url } : {}),
    start: { day, month, year },
    stamp: reminder.updatedAt,
    summary: reminder.title,
    uid: `reminder-${reminder.reminderId}-${reminder.occursOn}@${host}`,
    yearly: false,
  };
}

/**
 * The feed's document: the reminders first, in the order the read model
 * listed them, then the dates. `origin` is the configured public web origin
 * links open at, and its host names every event.
 */
export function calendarFeedDocument(
  content: CalendarFeedContent,
  origin: string,
): string {
  const host = new URL(origin).host;
  return renderCalendar({
    events: [
      ...content.reminders.map((reminder) =>
        reminderEvent(reminder, origin, host)
      ),
      ...content.dates.map((date) => dateEvent(date, origin, host)),
    ].filter((event) => event !== undefined),
    name: `${content.calendarName} — Kinship`,
    ...(content.truncated
      ? {
        notes: [{
          name: "X-KINSHIP-TRUNCATED",
          value:
            `Only the first ${content.truncated.limit} events are included.`,
        }],
      }
      : {}),
  });
}
