import { type Kysely, type RawBuilder, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import type {
  TodayAttentionItem,
  TodayAttentionRepository,
} from "../../application/get_today_attention.ts";
import { todayAttentionWindow } from "../../application/get_today_attention.ts";

interface ItemRow {
  readonly archived: boolean | null;
  readonly channel: "email" | "in_app" | null;
  readonly due_at: string | null;
  readonly id: string | null;
  readonly kind: TodayAttentionItem["kind"] | null;
  readonly last_contacted_at: string | null;
  readonly occurs_on: string | null;
  readonly person_id: string | null;
  readonly person_name: string | null;
  readonly reminder_status: string | null;
  readonly title: string | null;
  readonly unavailable: boolean | null;
}

/** The columns every attention arm lists, in order. */
const ARM_COLUMNS = sql.raw(
  "id, kind, title, due_at, occurs_on, reminder_status, channel, " +
    "last_contacted_at, person_id, source_order, source_id, archived, " +
    "unavailable, person_name",
);

export class PostgresTodayAttentionRepository
  implements TodayAttentionRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async getSnapshot(
    command: Parameters<TodayAttentionRepository["getSnapshot"]>[0],
  ) {
    return await this.database.transaction().setIsolationLevel(
      "repeatable read",
    )
      .execute(async (transaction) => {
        const context = await sql<{ readonly timezone: string }>`
      select coalesce(
        (select preference.timezone from crm.member_preferences preference
          where preference.member_id = ${command.memberId}::uuid),
        (select setting.default_timezone from crm.workspace_settings setting
          where setting.workspace_id = ${command.workspaceId}::uuid),
        'UTC') as timezone
    `.execute(transaction);
        const timezone = context.rows[0]!.timezone;
        const window = todayAttentionWindow(command.now, timezone);
        const bucket = (dueAt: RawBuilder<unknown>) =>
          sql`case when ${dueAt} < ${window.todayStart} then 'overdue'
            when ${dueAt} < ${window.tomorrowStart} then 'today'
            when ${dueAt} < ${window.nextSevenDaysEnd} then 'next'
            else 'upcoming' end`;
        const shown = (dueAt: RawBuilder<unknown>) =>
          sql`case when ${bucket(dueAt)} = 'upcoming'
            then ${command.upcomingLimit}::bigint
            else ${command.perAttentionGroupLimit}::bigint end`;
        const attentionOrder = (row: RawBuilder<unknown>) =>
          sql`${row}.due_at, lower(coalesce(${row}.person_name, ${row}.title)),
            ${row}.kind, ${row}.id`;
        // One arm's items, cut to as many of each bucket as Today shows,
        // ranked as the merged list is. An arm's ids are its own, so the
        // merged list's top of each bucket is always among its arms' tops.
        const limitedArm = (arm: RawBuilder<unknown>) =>
          sql`(select ${ARM_COLUMNS} from (
            select source.*, row_number() over (
              partition by ${bucket(sql`source.due_at`)}
              order by ${attentionOrder(sql`source`)}
            ) as arm_position
            from (${arm}) as source (${ARM_COLUMNS})
          ) candidate
          where candidate.arm_position <= ${shown(sql`candidate.due_at`)})`;
        const result = await sql<ItemRow>`
      with authorized as (
        select ${command.workspaceId}::uuid as id
      ), calendar as (
        -- Calendar events are independent of notification definitions, leads,
        -- channels and delivery state. Enumerating valid dates also skips Feb 29
        -- in non-leap years without normalizing it into a different day.
        select ${window.date}::date + offset_day as occurs_on
        from generate_series(0, 30) offset_day
      ), reminder_source (${ARM_COLUMNS}) as (
        select case when reminder.target_kind = 'task' then target_task.id
            else occurrence.id end,
          case reminder.target_kind when 'task' then 'task' else 'reminder' end,
          coalesce(occurrence.title_snapshot, reminder.title,
            target_task.title, target_event.name, target_date.label, 'Reminder'),
          effective.due_at,
          occurrence.occurs_on, occurrence.status, occurrence.channel,
          null::timestamptz,
          target_person.id as person_id,
          1::int, occurrence.id,
          target_person.archived_at is not null,
          target_person.id is not null and target_person.deleted_at is not null,
          case when target_person.id is null then null
            when target_person.deleted_at is not null then 'Deleted/Unavailable person'
            else ${
          sql.raw(personDisplayNameSql(UNNAMED_PERSON, "target_person"))
        } end
        from authorized join crm.reminders reminder on reminder.workspace_id = authorized.id
        join (
          -- One row per occurrence: a member on 'both' has an in-app and an
          -- email row for it. Attention is listed first, then failure, then
          -- in-app. An email row is listed only when it failed or needs
          -- attention (REL-059), since in-app already shows pending work.
          -- The 30-day bound is applied here, before the sort, so the
          -- member's window of future occurrences is not ranked only to be
          -- dropped (REL-088). The copies of one occurrence share their
          -- delivery time, and a retry's next attempt is later still, so
          -- the bound never trades a listed winner for a hidden one.
          select distinct on (delivery.reminder_id, delivery.occurs_on,
              coalesce(delivery.lead_time_days, -1)) delivery.*
          from crm.reminder_occurrences delivery
          where delivery.member_id = ${command.memberId}::uuid
            and (delivery.channel = 'in_app' or (delivery.channel = 'email'
              and delivery.status in ('failed','manual_attention')))
            and delivery.status in ('pending','retry','failed','manual_attention')
            and (delivery.status <> 'retry' or delivery.next_attempt_at is not null)
            and case when delivery.status = 'retry' then delivery.next_attempt_at
              else delivery.deliver_at end < ${window.thirtyDaysEnd}
          order by delivery.reminder_id, delivery.occurs_on,
            coalesce(delivery.lead_time_days, -1),
            case delivery.status when 'manual_attention' then 0
              when 'failed' then 1 else 2 end,
            delivery.channel = 'email', delivery.id
        ) occurrence on occurrence.reminder_id = reminder.id
        cross join lateral (select case when occurrence.status = 'retry'
          then occurrence.next_attempt_at else occurrence.deliver_at end as due_at) effective
        left join crm.tasks target_task on target_task.id = reminder.task_id
          and target_task.workspace_id = authorized.id
        left join crm.person_dates target_date on target_date.id = reminder.person_date_id
        left join crm.people date_person on date_person.id = target_date.person_id
          and date_person.workspace_id = authorized.id
        left join crm.life_events target_event on target_event.id = reminder.life_event_id
          and target_event.workspace_id = authorized.id
        left join crm.people event_person on event_person.id = target_event.person_id
          and event_person.workspace_id = authorized.id
        left join crm.people target_person on target_person.id = case reminder.target_kind
          when 'task' then target_task.person_id
          when 'person_date' then date_person.id
          when 'life_event' then event_person.id
          else reminder.person_id end and target_person.workspace_id = authorized.id
        where reminder.is_active and reminder.deleted_at is null
          -- Event delivery failures remain actionable operational reminders;
          -- their delivery schedule never populates the calendar previews.
          and (reminder.target_kind not in ('person_date', 'life_event') or
            (occurrence.status in ('failed', 'manual_attention')
              and effective.due_at < ${window.tomorrowStart}))
          and case reminder.target_kind
            when 'task' then target_task.id is not null and target_task.status = 'open'
              and target_task.deleted_at is null
            when 'person_date' then target_date.id is not null
              and date_person.id is not null and date_person.deleted_at is null
            when 'life_event' then target_event.id is not null
              and event_person.id is not null and event_person.deleted_at is null
            when 'person' then target_person.id is not null
              and target_person.deleted_at is null
            else reminder.target_kind = 'custom' and
              (reminder.person_id is null or (target_person.id is not null and target_person.deleted_at is null))
          end
          and not exists (select 1 from crm.stay_in_touch_cadences cadence
            where cadence.reminder_id = reminder.id and cadence.is_active)
      ), task_source as (
        -- A task its own reminder brings forward is one item: it is listed
        -- once, at the earlier time, before any arm is cut to its buckets.
        -- Every other arm's ids are its own, so no other item repeats.
        select distinct on (candidate.id) candidate.* from (
        select task.id, 'task'::text as kind, task.title, task.due_at,
          null::date as occurs_on, null::text as reminder_status,
          null::text as channel,
          null::timestamptz as last_contacted_at, person.id as person_id,
          0::int as source_order, task.id as source_id,
          person.archived_at is not null as archived,
          person.id is not null and person.deleted_at is not null as unavailable,
          case when person.id is null then null
            when person.deleted_at is not null then 'Deleted/Unavailable person'
            else ${
          sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))
        } end as person_name
        from authorized join crm.tasks task on task.workspace_id = authorized.id
        left join crm.people person on person.id = task.person_id
          and person.workspace_id = authorized.id
        where task.status = 'open' and task.deleted_at is null
          and task.due_at is not null and task.due_at < ${window.thirtyDaysEnd}
          union all
          select * from reminder_source where kind = 'task'
        ) candidate
        order by candidate.id, candidate.due_at, candidate.source_order,
          candidate.source_id
      ), projection as (
        ${limitedArm(sql`select * from task_source`)}
        union all
        ${
          limitedArm(sql`select * from reminder_source where kind = 'reminder'`)
        }
        union all
        ${
          limitedArm(sql`
        select person_date.id, 'important-date',
          coalesce(person_date.label, case person_date.kind
            when 'birthday' then 'Birthday' when 'deceased' then 'Death anniversary'
            when 'first_met' then 'First met' when 'anniversary' then 'Anniversary'
            else 'Important date' end),
          calendar.occurs_on::timestamp at time zone ${timezone},
          calendar.occurs_on, null::text, null::text, null::timestamptz,
          person.id, 0::int, person_date.id, person.archived_at is not null,
          false, ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))}
        from authorized join crm.people person on person.workspace_id = authorized.id
        join crm.person_dates person_date on person_date.person_id = person.id
        join calendar on extract(month from calendar.occurs_on) = person_date.month
          and extract(day from calendar.occurs_on) = person_date.day
          and (person_date.year is null or person_date.year <= extract(year from calendar.occurs_on))
        where person.deleted_at is null and person_date.precision in ('full', 'month_day')`)
        }
        union all
        ${
          limitedArm(sql`
        select event.id, 'life-event', coalesce(event.name, 'Life event'),
          calendar.occurs_on::timestamp at time zone ${timezone},
          calendar.occurs_on, null::text, null::text, null::timestamptz,
          person.id, 0::int, event.id, person.archived_at is not null,
          false, ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))}
        from authorized join crm.life_events event on event.workspace_id = authorized.id
        join crm.people person on person.id = event.person_id
          and person.workspace_id = authorized.id
        join calendar on (event.year = extract(year from calendar.occurs_on)
          and event.month = extract(month from calendar.occurs_on)
          and event.day = extract(day from calendar.occurs_on))
          or (event.year is null and event.month is null and event.day is null
            and (event.happened_at at time zone ${timezone})::date = calendar.occurs_on)
        where person.deleted_at is null and event.precision = 'full'`)
        }
        union all
        ${
          limitedArm(sql`
        select cadence.id, 'cadence', 'Reconnect with ' || ${
            sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))
          },
          cadence.next_due_at, null::date, null::text, null::text,
          cadence.last_contacted_at,
          person.id, 2::int, cadence.id, person.archived_at is not null, false,
          ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))}
        from authorized join crm.people person on person.workspace_id = authorized.id
        join crm.stay_in_touch_cadences cadence on cadence.person_id = person.id
        where cadence.is_active and cadence.next_due_at is not null
          and cadence.next_due_at < ${window.thirtyDaysEnd}
          and person.deleted_at is null`)
        }
      ), ranked as (
        select projection.*, ${bucket(sql`projection.due_at`)} as bucket,
          row_number() over (
            partition by ${bucket(sql`projection.due_at`)}
            order by ${attentionOrder(sql`projection`)}
          ) as position
        from projection
      )
      select id::text, kind, title, ${instantColumn("due_at")} as due_at,
        occurs_on::text, reminder_status, channel,
        ${instantColumn("last_contacted_at")} as last_contacted_at,
        person_id::text, archived, unavailable, person_name
      from ranked where position <= case when bucket = 'upcoming'
        then ${command.upcomingLimit}::bigint
        else ${command.perAttentionGroupLimit}::bigint end
      union all select null, null, null, null, null, null, null, null, null, null,
        null, null
        from authorized
    `.execute(transaction);
        if (result.rows.length === 0) return { status: "forbidden" as const };
        const items = result.rows.flatMap((row): TodayAttentionItem[] => {
          if (!row.id || !row.kind || !row.title || !row.due_at) return [];
          const person = row.person_id && row.person_name
            ? {
              archived: row.archived === true,
              id: row.person_id,
              name: row.person_name,
              ...(row.unavailable ? { unavailable: true } : {}),
            }
            : undefined;
          if (row.kind === "task") {
            return [{
              dueAt: row.due_at,
              id: row.id,
              kind: row.kind,
              ...(person ? { person } : {}),
              title: row.title,
            }];
          }
          if (row.kind === "cadence" && person) {
            return [{
              dueAt: row.due_at,
              id: row.id,
              kind: row.kind,
              ...pickDefined({ lastContactedAt: row.last_contacted_at }),
              person,
              title: row.title,
            }];
          }
          if (
            (row.kind === "important-date" || row.kind === "life-event") &&
            row.occurs_on
          ) {
            return [{
              dueAt: row.due_at,
              id: row.id,
              kind: row.kind,
              occursOn: row.occurs_on,
              ...(person ? { person } : {}),
              title: row.title,
            }];
          }
          return row.kind === "reminder" &&
              row.occurs_on && row.channel &&
              ["failed", "manual_attention", "pending", "retry"].includes(
                row.reminder_status ?? "",
              )
            ? [{
              channel: row.channel,
              dueAt: row.due_at,
              id: row.id,
              kind: row.kind,
              occursOn: row.occurs_on,
              ...(person ? { person } : {}),
              reminderStatus: row.reminder_status as
                | "failed"
                | "manual_attention"
                | "pending"
                | "retry",
              title: row.title,
            }]
            : [];
        });
        return { items, status: "ready" as const, timezone };
      });
  }
}
