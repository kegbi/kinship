/**
 * What a timeline row says: its date, its type, and its detail lines.
 *
 * Pure presentation over one `PersonTimelineItem`, kept apart from the island
 * so each rule is tested without a DOM. A partial date is shown with only the
 * components it has, and a date whose components are unknown is never
 * invented from the instant the server sorted it by.
 */

import {
  formatInstant,
  formatPartialDate,
  type TimePreferences,
} from "../../lib/time-presentation.ts";
import type {
  PersonTimelineItem,
  PersonTimelineKind,
} from "../../../../../packages/contracts/generated/auth-client.ts";

export type TimelineFilter = "all" | PersonTimelineKind;

/** The filter chips, in the order the card shows them. */
export const TIMELINE_FILTERS: readonly {
  readonly filter: TimelineFilter;
  readonly label: string;
}[] = [
  { filter: "all", label: "All types" },
  { filter: "note", label: "Notes" },
  { filter: "call", label: "Calls" },
  { filter: "conversation", label: "Conversations" },
  { filter: "activity", label: "Activities" },
  { filter: "life-event", label: "Life events" },
];

export const KIND_LABELS: Readonly<Record<PersonTimelineKind, string>> = {
  activity: "Activity",
  call: "Call",
  conversation: "Conversation",
  "life-event": "Life event",
  note: "Note",
};

function utcComponents(instant: string) {
  const date = new Date(instant);
  return {
    day: date.getUTCDate(),
    month: date.getUTCMonth() + 1,
    year: date.getUTCFullYear(),
  };
}

/** The row's date as the reader sees it. */
export function displayDate(
  item: PersonTimelineItem,
  preferences: TimePreferences | undefined,
): string {
  const locale = preferences?.locale ?? "en";
  if (item.calendarDate) {
    return formatPartialDate(item.calendarDate, item.datePrecision, locale);
  }
  if (item.datePrecision === "full") {
    return formatInstant(item.occurredAt, preferences);
  }
  return formatPartialDate(
    utcComponents(item.occurredAt),
    item.datePrecision,
    locale,
  );
}

/**
 * The machine-readable `datetime` of the row's date, or `undefined` when its
 * precision has no valid `<time>` form and the date renders as plain text.
 */
export function dateTimeValue(item: PersonTimelineItem): string | undefined {
  if (item.datePrecision === "full" && !item.calendarDate) {
    return item.occurredAt;
  }
  if (
    item.datePrecision === "month" || item.datePrecision === "day" ||
    item.datePrecision === "unknown"
  ) return undefined;
  const components = item.calendarDate ?? utcComponents(item.occurredAt);
  const year = components.year === undefined
    ? undefined
    : String(components.year).padStart(4, "0");
  const month = components.month === undefined
    ? undefined
    : String(components.month).padStart(2, "0");
  const day = components.day === undefined
    ? undefined
    : String(components.day).padStart(2, "0");
  if (item.datePrecision === "year") return year;
  if (item.datePrecision === "year_month") {
    return year && month ? `${year}-${month}` : undefined;
  }
  if (item.datePrecision === "month_day") {
    return month && day ? `${month}-${day}` : undefined;
  }
  return year && month && day ? `${year}-${month}-${day}` : undefined;
}

/** The row's detail lines, in the order the contract lists their fields. */
export function detailLines(item: PersonTimelineItem): string[] {
  const lines: string[] = [];
  if (item.participants?.length) {
    lines.push(
      `Participants: ${
        item.participants.map((entry) => entry.name).join(", ")
      }`,
    );
  }
  if (item.activityType) lines.push(`Category: ${item.activityType}`);
  if (item.emotions?.length) {
    lines.push(
      `Emotions: ${item.emotions.map((entry) => entry.name).join(", ")}`,
    );
  }
  if (item.contactWasCaller !== undefined) {
    lines.push(item.contactWasCaller ? "Incoming call" : "Outgoing call");
  }
  if (item.channelType) lines.push(`Channel: ${item.channelType}`);
  if (item.contactMethod) lines.push(`Via ${item.contactMethod}`);
  if (item.messages?.length) {
    for (const message of item.messages) {
      lines.push(
        `${
          message.direction === "inbound" ? "Inbound" : "Outbound"
        }: ${message.content}`,
      );
    }
  } else if (item.kind === "conversation") {
    lines.push("Direction not recorded");
  }
  return lines;
}

/** The count line under the filters. */
export function countText(count: number): string {
  return count === 0
    ? "No timeline events recorded."
    : `${count} timeline event${count === 1 ? "" : "s"}`;
}
