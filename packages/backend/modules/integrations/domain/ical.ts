/**
 * A small RFC 5545 writer for the read-only calendar feed (GAP-052,
 * `INTEGRATION-002`).
 *
 * It writes exactly what the feed publishes and nothing a parser would need:
 * one `VCALENDAR` of all-day `VEVENT`s, each either a single day or a yearly
 * series. Three encoding rules are the whole of the work, and each is where a
 * hand-rolled writer usually goes wrong:
 *
 * - TEXT values escape backslash, semicolon, comma, and every line break
 *   (RFC 5545 §3.3.11), and drop the control characters TEXT may not hold;
 * - content lines longer than 75 octets fold onto continuation lines that
 *   begin with one space (§3.1), and a fold never splits a UTF-8 sequence,
 *   because it is cut between code points and measured in octets;
 * - every line, the last included, ends in CRLF.
 *
 * Nothing here reads a clock or a random source: the same calendar always
 * renders to the same bytes, which is what lets the route answer with a
 * strong entity tag.
 */

/** The longest content line RFC 5545 allows, in octets, without its CRLF. */
const MAX_LINE_OCTETS = 75;

const encoder = new TextEncoder();

/** A calendar date, with the year the series starts in. */
export interface ICalendarDate {
  readonly day: number;
  readonly month: number;
  readonly year: number;
}

/** One all-day event. */
export interface ICalendarEvent {
  readonly description?: string;
  readonly start: ICalendarDate;
  /** When the event's source last changed, as an ISO instant. */
  readonly stamp: string;
  readonly summary: string;
  readonly uid: string;
  readonly url?: string;
  /** A yearly series from `start`, rather than the one day. */
  readonly yearly: boolean;
}

/** A calendar-level `X-` property, such as a note that the feed is cut. */
export interface ICalendarNote {
  readonly name: `X-${string}`;
  readonly value: string;
}

export interface ICalendar {
  readonly events: readonly ICalendarEvent[];
  readonly name: string;
  readonly notes?: readonly ICalendarNote[];
}

/** A TEXT value with RFC 5545's escapes and without disallowed controls. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, "\n")
    // deno-lint-ignore no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * One content line, folded: 75 octets on the first line and 74 after each
 * continuation's leading space, cut between code points.
 */
export function foldLine(line: string): string {
  if (encoder.encode(line).length <= MAX_LINE_OCTETS) return line;
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  let limit = MAX_LINE_OCTETS;
  for (const character of line) {
    const size = encoder.encode(character).length;
    if (octets + size > limit) {
      parts.push(current);
      current = "";
      octets = 0;
      limit = MAX_LINE_OCTETS - 1;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function digits(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** `YYYYMMDD`, a DATE value. */
function dateValue(date: ICalendarDate): string {
  return `${digits(date.year, 4)}${digits(date.month, 2)}${
    digits(date.day, 2)
  }`;
}

/** `YYYYMMDDTHHMMSSZ`, a UTC DATE-TIME value, to the whole second. */
function instantValue(instant: string): string {
  return new Date(instant).toISOString().replace(/\.\d{3}Z$/, "Z")
    .replace(/[-:]/g, "");
}

function eventLines(event: ICalendarEvent): string[] {
  return [
    "BEGIN:VEVENT",
    `UID:${event.uid}`,
    `DTSTAMP:${instantValue(event.stamp)}`,
    `DTSTART;VALUE=DATE:${dateValue(event.start)}`,
    ...(event.yearly ? ["RRULE:FREQ=YEARLY"] : []),
    `SUMMARY:${escapeText(event.summary)}`,
    ...(event.description === undefined
      ? []
      : [`DESCRIPTION:${escapeText(event.description)}`]),
    ...(event.url === undefined ? [] : [`URL:${event.url}`]),
    // A birthday is not a meeting: it never makes anybody look busy.
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ];
}

/** The whole calendar, as the bytes a subscriber downloads. */
export function renderCalendar(calendar: ICalendar): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Kinship//Calendar feed//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendar.name)}`,
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
    ...(calendar.notes ?? []).map((note) =>
      `${note.name}:${escapeText(note.value)}`
    ),
    ...calendar.events.flatMap(eventLines),
    "END:VCALENDAR",
  ];
  return lines.map((line) => `${foldLine(line)}\r\n`).join("");
}
