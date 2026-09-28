/**
 * What the calendar feed reads (GAP-052, `INTEGRATION-002`).
 *
 * For one member of one workspace, the repository answers the workspace's
 * name, the person dates a yearly event is published for, and the member's
 * own reminder days inside the feed's window — all in one statement, capped at
 * `limit` rows. It decides which rows are visible; the application names them.
 */

import type { ImportantDateKind } from "../../../modules/people/public.ts";

export interface CalendarFeedActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** A person's date whose month and day are known. */
export interface CalendarFeedDateRow {
  readonly day: number;
  readonly id: string;
  readonly kind: ImportantDateKind;
  readonly label?: string;
  readonly month: number;
  readonly personId: string;
  readonly personName: string;
  /** The later of the date's and the person's last change. */
  readonly updatedAt: string;
  readonly year?: number;
}

/** One day a reminder occurs on for the member, channels collapsed. */
export interface CalendarFeedReminderRow {
  readonly occursOn: string;
  readonly personId: string;
  readonly reminderId: string;
  readonly title: string;
  readonly updatedAt: string;
}

export interface CalendarFeedCriteria extends CalendarFeedActor {
  /** The most events one feed publishes. */
  readonly limit: number;
  readonly now: Date;
  /** Reminder days from this many days before the member's today… */
  readonly windowDaysBefore: number;
  /** …to this many days after it, inclusive. */
  readonly windowDaysAfter: number;
}

export interface CalendarFeedRows {
  readonly calendarName: string;
  readonly dates: readonly CalendarFeedDateRow[];
  readonly reminders: readonly CalendarFeedReminderRow[];
  readonly status: "ready";
  /** Whether rows past `limit` were left out. */
  readonly truncated: boolean;
}

export interface CalendarFeedRepository {
  read(
    criteria: CalendarFeedCriteria,
  ): Promise<CalendarFeedRows | { readonly status: "timed-out" }>;
}
