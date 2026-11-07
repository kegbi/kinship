import { type Kysely, type RawBuilder, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { MILLISECOND_INSTANT_FORMAT } from "../../../../platform/postgres/timestamps.ts";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import type {
  NotificationKind,
  NotificationPosition,
  NotificationRecord,
  NotificationsActor,
  NotificationsRepository,
} from "../../ports/notifications_repository.ts";

interface FeedRow {
  readonly id: string;
  readonly kind: NotificationKind;
  readonly occurred_at: string;
  readonly person_archived: boolean | null;
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly subject_id: string | null;
  readonly title: string | null;
}

const PERSON_NAME = sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"));

/**
 * Which of an arm's rows a statement reads, at most `limit` of them: a page
 * takes the arm's newest before a position, and the unread count takes any
 * after the read-through watermark.
 */
type FeedWindow =
  | {
    readonly after?: NotificationPosition;
    readonly kind: "page";
    readonly limit: number;
  }
  | {
    readonly kind: "count";
    readonly limit: number;
    /** The watermark on the `itemTime` key; null counts every item. */
    readonly since: RawBuilder<unknown>;
  };

/**
 * An item's time cut to milliseconds, the precision the read-through
 * watermark is stored at, so an item is never after the watermark that was
 * set from its own time. It is the UTC wall-clock `timestamp`: the cut is
 * then immutable, so an index can be ordered by the very key the feed is.
 */
function itemTime(column: RawBuilder<unknown>): RawBuilder<unknown> {
  return sql`date_trunc('milliseconds', ${column} at time zone 'UTC')`;
}

/** An instant the client sent, on the same key as `itemTime`. */
function instantKey(instant: string): RawBuilder<unknown> {
  return sql`(${instant}::timestamptz at time zone 'UTC')`;
}

/**
 * The read-through watermark the member's interface state holds, on the
 * `itemTime` key, or null when there is none it could mean. A value is read
 * as an instant exactly when `readThroughInstant` accepts it: a UTC instant
 * with at most three fractional digits whose date and time exist. Anything
 * else counts every item, as it always did.
 */
function storedWatermark(actor: NotificationsActor): RawBuilder<unknown> {
  return sql`
    select stored.read_through,
      case when stored.read_through ~ ${READ_THROUGH_PATTERN}
          and pg_input_is_valid(stored.read_through, 'timestamptz')
        then stored.read_through::timestamptz at time zone 'UTC'
      end as since
    from (
      select (
        select preference.ui_state ->> 'notificationsReadThrough'
        from crm.member_preferences preference
        join crm.workspace_members member
          on member.id = preference.member_id
        where preference.member_id = ${actor.memberId}::uuid
          and member.workspace_id = ${actor.workspaceId}::uuid
      ) as read_through
    ) stored`;
}

/**
 * The form `readThroughInstant` accepts, with the clock fields bounded to
 * the times PostgreSQL and JavaScript's `Date` both read, so one stored value
 * is the same watermark to the count and to the page's unread flags.
 */
const READ_THROUGH_PATTERN =
  "^[0-9]{4}-[0-9]{2}-[0-9]{2}T([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]([.][0-9]{1,3})?Z$";

/**
 * One arm of the feed. `select` names `kind`, `id`, `at` (its `itemTime`),
 * `title`, `person_id`, and `subject_id`, and ends with its `where`, so the
 * window's conditions follow it.
 */
interface FeedArm {
  readonly at: RawBuilder<unknown>;
  readonly id: RawBuilder<unknown>;
  readonly select: RawBuilder<unknown>;
}

/**
 * The arm's own rows in the window, newest first for a page, and no more
 * than the statement can use, so merging the arms never sorts the history.
 * A page orders each arm by the same key and tie-break as the merged feed,
 * so each arm's page holds every row of its own that the feed's page shows.
 */
function windowed(arm: FeedArm, window: FeedWindow): RawBuilder<unknown> {
  const at = itemTime(arm.at);
  if (window.kind === "count") {
    return sql`(${arm.select}
      and ${at} > coalesce(${window.since}, '-infinity'::timestamp)
      limit ${window.limit})`;
  }
  const after = window.after
    ? sql`and (${at}, ${arm.id}) <
        (${instantKey(window.after.at)}, ${window.after.id}::uuid)`
    : sql``;
  return sql`(${arm.select} ${after}
    order by ${at} desc, ${arm.id} desc limit ${window.limit})`;
}

/**
 * The member's feed in the window, as one union whose every arm is scoped to
 * the workspace, addressed to the member alone, and cut to the window before
 * the arms are merged.
 *
 * - Delivered in-app reminders are the member's own occurrences (`member_id`)
 *   of a live reminder in this workspace, timed by when they became visible.
 * - Undeliverable email reminders are `planning.reminder-failed` events on
 *   the email channel whose occurrence is the member's own, of a reminder
 *   that was not deleted.
 * - Finished data jobs are the member's own `export.completed` and
 *   `import.committed` events, and only while the member still holds a role
 *   that may run them (`data.export`, `data.import`).
 * - Accepted invitations are `workspace.member-joined` events for a member
 *   this member invited.
 *
 * A notification about a person who has since been deleted is left out
 * inside its arm, so it never takes the place of one that is shown.
 */
function feed(
  actor: NotificationsActor,
  window: FeedWindow,
): RawBuilder<unknown> {
  const workspaceId = sql`${actor.workspaceId}::uuid`;
  const memberId = sql`${actor.memberId}::uuid`;
  const personShown = sql`(reminder.person_id is null or exists (
    select 1 from crm.people person
    where person.id = reminder.person_id
      and person.workspace_id = ${workspaceId}
      and person.deleted_at is null))`;
  const arms: readonly FeedArm[] = [
    {
      at: sql`occurrence.visible_at`,
      id: sql`occurrence.id`,
      select: sql`
        select 'reminder' as kind, occurrence.id,
          ${itemTime(sql`occurrence.visible_at`)} as at,
          coalesce(nullif(occurrence.title_snapshot, ''), reminder.title)
            as title,
          reminder.person_id, null::uuid as subject_id
        from crm.reminder_occurrences occurrence
        join crm.reminders reminder on reminder.id = occurrence.reminder_id
          and reminder.workspace_id = ${workspaceId}
          and reminder.deleted_at is null
        where occurrence.member_id = ${memberId}
          and occurrence.channel = 'in_app'
          and occurrence.status = 'sent'
          and occurrence.visible_at is not null
          and ${personShown}`,
    },
    {
      at: sql`event.occurred_at`,
      id: sql`event.id`,
      select: sql`
        select 'reminder-email-failed' as kind, event.id,
          ${itemTime(sql`event.occurred_at`)} as at,
          coalesce(nullif(occurrence.title_snapshot, ''), reminder.title)
            as title,
          reminder.person_id, null::uuid as subject_id
        from crm.audit_events event
        join crm.reminder_occurrences occurrence
          on occurrence.id = event.subject_id
          and occurrence.member_id = ${memberId}
          and occurrence.channel = 'email'
        join crm.reminders reminder on reminder.id = occurrence.reminder_id
          and reminder.workspace_id = ${workspaceId}
          and reminder.deleted_at is null
        where event.workspace_id = ${workspaceId}
          and event.action = 'planning.reminder-failed'
          and event.subject_type = 'reminder_occurrence'
          and ${personShown}`,
    },
    {
      at: sql`event.occurred_at`,
      id: sql`event.id`,
      select: sql`
        select case event.action when 'export.completed' then 'export-ready'
            else 'import-finished' end as kind,
          event.id, ${itemTime(sql`event.occurred_at`)} as at,
          null::text as title, null::uuid as person_id, event.subject_id
        from crm.audit_events event
        join crm.workspace_members member on member.id = ${memberId}
          and member.workspace_id = ${workspaceId}
          and member.role in ('owner', 'admin')
        where event.workspace_id = ${workspaceId}
          and event.actor_member_id = ${memberId}
          and event.action in ('export.completed', 'import.committed')`,
    },
    {
      at: sql`event.occurred_at`,
      id: sql`event.id`,
      select: sql`
        select 'invitation-accepted' as kind, event.id,
          ${itemTime(sql`event.occurred_at`)} as at, null::text as title,
          null::uuid as person_id, event.subject_id
        from crm.audit_events event
        join crm.workspace_members joined on joined.id = event.subject_id
          and joined.workspace_id = ${workspaceId}
          and joined.invited_by_member_id = ${memberId}
          and joined.id <> ${memberId}
        where event.workspace_id = ${workspaceId}
          and event.action = 'workspace.member-joined'`,
    },
  ];
  return sql.join(
    arms.map((arm) => windowed(arm, window)),
    sql` union all `,
  );
}

function record(row: FeedRow): NotificationRecord {
  return {
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    ...(row.person_id && row.person_name
      ? {
        person: {
          archived: row.person_archived === true,
          id: row.person_id,
          name: row.person_name,
        },
      }
      : {}),
    ...pickDefined({ subjectId: row.subject_id, title: row.title }),
  };
}

export class PostgresNotificationsRepository
  implements NotificationsRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  /** The page, merged from the arms' own pages, with its people named. */
  async list(
    command: Parameters<NotificationsRepository["list"]>[0],
  ): Promise<readonly NotificationRecord[]> {
    const window: FeedWindow = {
      ...(command.after ? { after: command.after } : {}),
      kind: "page",
      limit: command.limit,
    };
    const result = await sql<FeedRow>`
      select item.kind, item.id::text,
        to_char(item.at, ${sql.lit(MILLISECOND_INSTANT_FORMAT)})
          as occurred_at,
        item.title, item.person_id::text,
        case when person.id is null then null else ${PERSON_NAME} end
          as person_name,
        person.archived_at is not null as person_archived,
        item.subject_id::text
      from (
        select page.* from (${feed(command, window)}) page
        order by page.at desc, page.id desc
        limit ${command.limit}
      ) item
      left join crm.people person on person.id = item.person_id
        and person.workspace_id = ${command.workspaceId}::uuid
      order by item.at desc, item.id desc
    `.execute(this.database);
    return result.rows.map(record);
  }

  async countUnread(
    command: Parameters<NotificationsRepository["countUnread"]>[0],
  ): ReturnType<NotificationsRepository["countUnread"]> {
    const window: FeedWindow = {
      kind: "count",
      limit: command.cap,
      since: sql`(select since from watermark)`,
    };
    const result = await sql<{
      readonly count: number;
      readonly read_through: string | null;
    }>`
      with watermark as (${storedWatermark(command)})
      select (select read_through from watermark) as read_through,
        (select count(*)::int from (
          select 1 from (${feed(command, window)}) unread
          limit ${command.cap}
        ) unread) as count
    `.execute(this.database);
    const row = result.rows[0];
    return {
      count: row?.count ?? 0,
      ...(row?.read_through ? { readThrough: row.read_through } : {}),
    };
  }
}
