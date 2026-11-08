/**
 * The calendar feed in PostgreSQL (GAP-052, `INTEGRATION-002`).
 *
 * One read-only statement answers the whole feed, because a calendar
 * application polls it in the background and should cost one round trip:
 *
 * - the member's today, in their own time zone, falling back to the
 *   workspace's and then UTC, as planning schedules reminders;
 * - reminder days: the member's own occurrences from `windowDaysBefore` days
 *   before that today to `windowDaysAfter` after it, one row per reminder and
 *   day however many channels or lead times it was generated for, never a
 *   cancelled or skipped one, and only for a person who is neither archived
 *   nor deleted, as Today's reminder panel lists them. A paused reminder
 *   keeps only the days it was already delivered, as Today keeps them. A
 *   person-date reminder is left out: its date is already the yearly event;
 * - person dates: every date with a known month and day on a person who is
 *   neither archived nor deleted, as the active directory lists people. A
 *   deceased person keeps their dates, as the person workspace and Today do.
 *   Important dates and reminders are core person sections that
 *   `workspace_profile_modules` cannot hide, so no section rule applies.
 *
 * Reminders come first, then dates from the member's today onward through
 * the year, and the statement stops one row past `limit` so the caller knows
 * the feed was cut. A trailing row carries the workspace's name, so an empty
 * feed still has a title. The transaction is read-only and bounded by a
 * transaction-local `statement_timeout`; a cancelled read answers
 * `timed-out`.
 *
 * `revision` is the feed's cheap validator (BEQ-14): over the same two row
 * sets, built from the same fragments, it answers only aggregates — how many
 * rows each has, the latest `updated_at` among every row a published event
 * is drawn from (occurrence, reminder, and person; date and person), and the
 * sum of a 64-bit hash of each such row's id and `updated_at` — beside the
 * member's today and the workspace's name. The sum does not depend on order,
 * so a row joining or leaving the set, as when one person is archived and
 * another restored, or a row rewritten with an older `updated_at`, as a
 * Monica import writes, changes it even when the count and the latest change
 * do not. A poll whose tag still matches answers 304 without naming,
 * ordering, or sending a row.
 */

import { readOnlyWithin } from "../../../../platform/postgres/transactions.ts";
import { type Kysely, sql } from "kysely";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { postgresErrorCode } from "../../../../platform/postgres/errors.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type {
  CalendarFeedCriteria,
  CalendarFeedDateRow,
  CalendarFeedReminderRow,
  CalendarFeedRepository,
  CalendarFeedRevisionRow,
} from "../../ports/calendar_feed_repository.ts";

/** The longest the feed statement may run before PostgreSQL cancels it. */
export const CALENDAR_FEED_STATEMENT_TIMEOUT_MS = 1500;

/** `query_canceled`: the statement ran past its timeout. */
const QUERY_CANCELED = "57014";

interface FeedRow {
  /** 0 a reminder day, 1 a person date, 2 the workspace's name. */
  readonly section: number;
  readonly calendar_name: string | null;
  readonly day: number | null;
  readonly id: string | null;
  readonly kind: CalendarFeedDateRow["kind"] | null;
  readonly label: string | null;
  readonly month: number | null;
  readonly occurs_on: string | null;
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly title: string | null;
  readonly updated_at: string | null;
  readonly year: number | null;
}

interface RevisionRow {
  readonly calendar_name: string;
  readonly date_checksum: string;
  readonly date_count: number;
  readonly dates_updated_at: string | null;
  readonly reminder_checksum: string;
  readonly reminder_count: number;
  readonly reminders_updated_at: string | null;
  readonly today: string;
}

/** The workspace's name and the member's today, as planning reckons it. */
function feedContext(criteria: CalendarFeedCriteria) {
  return sql`context as (
    select workspace.name as calendar_name,
      (${criteria.now}::timestamptz at time zone coalesce(
        (select preference.timezone from crm.member_preferences preference
          where preference.member_id = ${criteria.memberId}::uuid),
        (select setting.default_timezone from crm.workspace_settings setting
          where setting.workspace_id = workspace.id),
        'UTC'))::date as today
    from crm.workspaces workspace
    where workspace.id = ${criteria.workspaceId}::uuid
  )`;
}

/** Every occurrence a reminder day is published from, channels uncollapsed. */
function reminderOccurrences(criteria: CalendarFeedCriteria) {
  return sql`from context
    join crm.reminder_occurrences occurrence
      on occurrence.member_id = ${criteria.memberId}::uuid
      and occurrence.occurs_on
        between context.today - ${criteria.windowDaysBefore}::int
        and context.today + ${criteria.windowDaysAfter}::int
    join crm.reminders reminder on reminder.id = occurrence.reminder_id
      and reminder.workspace_id = ${criteria.workspaceId}::uuid
    join crm.people person on person.id = reminder.person_id
      and person.workspace_id = ${criteria.workspaceId}::uuid
    where occurrence.status not in ('cancelled', 'skipped')
      and (reminder.is_active or occurrence.visible_at is not null)
      and reminder.deleted_at is null
      and reminder.target_kind <> 'person_date'
      and person.archived_at is null and person.deleted_at is null`;
}

/** Every person date the feed publishes as a yearly event. */
function personDates(criteria: CalendarFeedCriteria) {
  return sql`from context
    join crm.people person
      on person.workspace_id = ${criteria.workspaceId}::uuid
    join crm.person_dates date on date.person_id = person.id
    where person.archived_at is null and person.deleted_at is null
      and date.month is not null and date.day is not null`;
}

const EMPTY_REVISION: CalendarFeedRevisionRow = {
  calendarName: "",
  dates: { checksum: "0", count: 0 },
  reminders: { checksum: "0", count: 0 },
  status: "ready",
  today: "",
};

/**
 * The sum of a 64-bit hash of each row's identity and last change, as
 * decimal text: order-independent, and `0` for no rows. Instants enter as
 * epoch seconds so the session's time zone cannot move the sum.
 */
function rowChecksum(
  ...rows: readonly (readonly [id: string, updatedAt: string])[]
) {
  const parts = rows.map(([id, updatedAt]) =>
    `${id}::text, extract(epoch from ${updatedAt})::text`
  ).join(", ");
  return sql.raw(
    `coalesce(sum(hashtextextended(concat_ws('|', ${parts}), 0)), 0)::text`,
  );
}

export class PostgresCalendarFeedRepository implements CalendarFeedRepository {
  private readonly statementTimeoutMs: number;

  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    options: { readonly statementTimeoutMs?: number } = {},
  ) {
    this.statementTimeoutMs = options.statementTimeoutMs ??
      CALENDAR_FEED_STATEMENT_TIMEOUT_MS;
  }

  async revision(criteria: CalendarFeedCriteria) {
    return await this.bounded(criteria.workspaceId, async (transaction) => {
      const result = await sql<RevisionRow>`
        with ${feedContext(criteria)}, reminder_days as (
          select count(*)::int as count,
            max(greatest(occurrence.updated_at, reminder.updated_at,
              person.updated_at)) as latest,
            ${
        rowChecksum(
          ["occurrence.id", "occurrence.updated_at"],
          ["reminder.id", "reminder.updated_at"],
          ["person.id", "person.updated_at"],
        )
      } as checksum
          ${reminderOccurrences(criteria)}
        ), dates as (
          select count(*)::int as count,
            max(greatest(date.updated_at, person.updated_at)) as latest,
            ${
        rowChecksum(
          ["date.id", "date.updated_at"],
          ["person.id", "person.updated_at"],
        )
      } as checksum
          ${personDates(criteria)}
        )
        select context.today::text as today, context.calendar_name,
          reminder_days.count as reminder_count,
          ${instantColumn("reminder_days.latest")} as reminders_updated_at,
          reminder_days.checksum as reminder_checksum,
          dates.count as date_count,
          ${instantColumn("dates.latest")} as dates_updated_at,
          dates.checksum as date_checksum
        from context cross join reminder_days cross join dates
      `.execute(transaction);
      const row = result.rows[0];
      // No row only when the workspace is gone: an empty feed's revision.
      if (!row) return EMPTY_REVISION;
      const revision: CalendarFeedRevisionRow = {
        calendarName: row.calendar_name,
        dates: {
          checksum: row.date_checksum,
          count: row.date_count,
          ...(row.dates_updated_at ? { updatedAt: row.dates_updated_at } : {}),
        },
        reminders: {
          checksum: row.reminder_checksum,
          count: row.reminder_count,
          ...(row.reminders_updated_at
            ? { updatedAt: row.reminders_updated_at }
            : {}),
        },
        status: "ready",
        today: row.today,
      };
      return revision;
    });
  }

  async read(criteria: CalendarFeedCriteria) {
    return await this.bounded(criteria.workspaceId, async (transaction) => {
      const result = await sql<FeedRow>`
          with ${feedContext(criteria)}, reminder_days as (
            select distinct on (reminder.id, occurrence.occurs_on)
              reminder.id, occurrence.occurs_on, person.id as person_id,
              coalesce(nullif(reminder.title, ''), occurrence.title_snapshot,
                'Reminder') as title,
              reminder.updated_at
            ${reminderOccurrences(criteria)}
            order by reminder.id, occurrence.occurs_on
          ), events as (
            select 0 as section, reminder_days.id, reminder_days.person_id,
              null::text as person_name, null::text as kind, null::text as label,
              null::int as year, null::int as month, null::int as day,
              reminder_days.occurs_on, reminder_days.title,
              reminder_days.updated_at,
              0 as season, reminder_days.occurs_on as sort_on,
              null::text as sort_name
            from reminder_days
            union all
            select 1, date.id, person.id,
              ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))},
              date.kind, date.label, date.year::int, date.month::int,
              date.day::int, null::date, null::text,
              greatest(date.updated_at, person.updated_at),
              case when (date.month, date.day) >= (
                extract(month from context.today)::int,
                extract(day from context.today)::int) then 0 else 1 end,
              make_date(2000, date.month, 1) + (date.day - 1),
              lower(${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))})
            ${personDates(criteria)}
          ), limited as (
            select * from events
            order by section, season, sort_on, sort_name, id
            limit ${criteria.limit + 1}
          ), numbered as (
            select limited.*, row_number() over (
              order by section, season, sort_on, sort_name, id) as ordinal
            from limited
          )
          select section, null::text as calendar_name, id::text,
            person_id::text, person_name, kind, label, year, month, day,
            occurs_on::text, title, ${
        instantColumn("updated_at")
      } as updated_at,
            ordinal
          from numbered
          union all
          select 2, calendar_name, null, null, null, null, null, null, null,
            null, null, null, null, null
          from context
          order by section, ordinal
        `.execute(transaction);
      return this.rows(result.rows, criteria.limit);
    });
  }

  /**
   * One read-only transaction in the feed's workspace, under the feed's
   * statement timeout, opened in one round trip; a cancelled statement
   * answers `timed-out`.
   */
  private async bounded<T>(
    workspaceId: string,
    work: (transaction: Kysely<ApplicationDatabase>) => Promise<T>,
  ): Promise<T | { readonly status: "timed-out" }> {
    try {
      return await readOnlyWithin(
        this.database,
        this.statementTimeoutMs,
        work,
        workspaceId,
      );
    } catch (error) {
      if (postgresErrorCode(error) === QUERY_CANCELED) {
        return { status: "timed-out" as const };
      }
      throw error;
    }
  }

  private rows(rows: readonly FeedRow[], limit: number) {
    const events = rows.filter((row) => row.section !== 2);
    const kept = events.slice(0, limit);
    const reminders: CalendarFeedReminderRow[] = [];
    const dates: CalendarFeedDateRow[] = [];
    for (const row of kept) {
      if (row.section === 0) {
        reminders.push({
          occursOn: row.occurs_on!,
          personId: row.person_id!,
          reminderId: row.id!,
          title: row.title!,
          updatedAt: row.updated_at!,
        });
        continue;
      }
      dates.push({
        day: row.day!,
        id: row.id!,
        kind: row.kind!,
        ...(row.label === null ? {} : { label: row.label }),
        month: row.month!,
        personId: row.person_id!,
        personName: row.person_name!,
        updatedAt: row.updated_at!,
        ...(row.year === null ? {} : { year: row.year }),
      });
    }
    return {
      calendarName: rows.find((row) => row.section === 2)?.calendar_name ??
        "",
      dates,
      reminders,
      status: "ready" as const,
      truncated: events.length > limit,
    };
  }
}
