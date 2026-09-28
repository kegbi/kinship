/**
 * The calendar feed read model (GAP-052, `INTEGRATION-002`): what one
 * member's subscribed calendar shows — every person date with a known month
 * and day as a yearly event, and the member's own reminder days from thirty
 * days back to a year ahead.
 *
 * It is read-only and answers only the actor it is handed, after `workspaces`
 * confirms that actor still stands. The repository decides which rows are
 * visible; this file bounds the read and names each date by the same
 * vocabulary planning titles its important-date reminders with, so the feed
 * and the reminder say "Birthday" alike.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import type { ImportantDateKind } from "../../../modules/people/public.ts";
import type { ActorRevalidation } from "../../../modules/workspaces/public.ts";
import type {
  CalendarFeedActor,
  CalendarFeedReminderRow,
  CalendarFeedRepository,
} from "../ports/calendar_feed_repository.ts";

export interface ReadModelTransaction {
  readonly opaque: unknown;
}

/** The most events one feed publishes; the rest are left out and noted. */
export const CALENDAR_FEED_EVENT_LIMIT = 2000;
/** How far back reminder days stay in the feed, in the member's days. */
export const CALENDAR_FEED_WINDOW_DAYS_BEFORE = 30;
/** How far ahead reminder days are published. */
export const CALENDAR_FEED_WINDOW_DAYS_AFTER = 365;

/** One date, named for the calendar. */
export interface CalendarFeedDateEvent {
  readonly day: number;
  readonly id: string;
  readonly label: string;
  readonly month: number;
  readonly personId: string;
  readonly personName: string;
  readonly updatedAt: string;
  readonly year?: number;
}

export type CalendarFeedResult =
  | Failure<"forbidden" | "unavailable">
  | {
    readonly calendarName: string;
    readonly dates: readonly CalendarFeedDateEvent[];
    readonly reminders: readonly CalendarFeedReminderRow[];
    readonly status: "ready";
    readonly truncated?: { readonly limit: number };
  };

/** The vocabulary's name for a date: planning's reminder title, exactly. */
export function importantDateLabel(
  kind: ImportantDateKind,
  label?: string,
): string {
  if (kind === "birthday") return "Birthday";
  if (kind === "deceased") return "Date of death";
  if (kind === "first_met") return "First meeting";
  return label ?? "Important date";
}

export function createCalendarFeed(dependencies: {
  readonly actors: ActorRevalidation;
  readonly clock: Clock;
  readonly repository: CalendarFeedRepository;
  readonly transaction: {
    run<T>(
      work: (transaction: ReadModelTransaction) => Promise<T>,
    ): Promise<T>;
  };
}) {
  return {
    read: async (actor: CalendarFeedActor): Promise<CalendarFeedResult> => {
      const standing = await dependencies.transaction.run((transaction) =>
        dependencies.actors.revalidate({ ...actor, lock: false, transaction })
      );
      if (standing !== "active") return { status: "forbidden" };
      const rows = await dependencies.repository.read({
        ...actor,
        limit: CALENDAR_FEED_EVENT_LIMIT,
        now: dependencies.clock.now(),
        windowDaysAfter: CALENDAR_FEED_WINDOW_DAYS_AFTER,
        windowDaysBefore: CALENDAR_FEED_WINDOW_DAYS_BEFORE,
      });
      if (rows.status !== "ready") return { status: "unavailable" };
      return {
        calendarName: rows.calendarName,
        dates: rows.dates.map((date) => ({
          day: date.day,
          id: date.id,
          label: importantDateLabel(date.kind, date.label),
          month: date.month,
          personId: date.personId,
          personName: date.personName,
          updatedAt: date.updatedAt,
          ...(date.year === undefined ? {} : { year: date.year }),
        })),
        reminders: rows.reminders,
        status: "ready",
        ...(rows.truncated
          ? { truncated: { limit: CALENDAR_FEED_EVENT_LIMIT } }
          : {}),
      };
    },
  };
}

export type CalendarFeed = ReturnType<typeof createCalendarFeed>;
