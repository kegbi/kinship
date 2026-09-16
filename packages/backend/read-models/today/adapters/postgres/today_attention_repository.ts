import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import type {
  TodayAttentionItem,
  TodayAttentionRepository,
} from "../../application/get_today_attention.ts";
import { todayAttentionWindow } from "../../application/get_today_attention.ts";

interface ItemRow {
  readonly archived: boolean | null;
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

const instant = (expression: string) =>
  sql.raw(
    `to_char(${expression} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
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
        const result = await sql<ItemRow>`
      with authorized as (
        select ${command.workspaceId}::uuid as id
      ), projection_source as (
        select task.id, 'task'::text as kind, task.title, task.due_at,
          null::date as occurs_on, null::text as reminder_status,
          null::timestamptz as last_contacted_at, person.id as person_id,
          0::int as source_order, task.id as source_id,
          person.archived_at is not null as archived,
          person.id is not null and person.deleted_at is not null as unavailable,
          case when person.id is null then null
            when person.deleted_at is not null then 'Deleted/Unavailable person'
            else coalesce(nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''), nullif(person.nickname, ''), 'Unnamed person') end as person_name
        from authorized join crm.tasks task on task.workspace_id = authorized.id
        left join crm.people person on person.id = task.person_id
          and person.workspace_id = authorized.id
        where task.status = 'open' and task.deleted_at is null
          and task.due_at is not null and task.due_at < ${window.thirtyDaysEnd}
        union all
        select case when reminder.target_kind = 'task' then target_task.id
            else occurrence.id end,
          case reminder.target_kind when 'task' then 'task'
            when 'person_date' then 'important-date'
            when 'life_event' then 'life-event' else 'reminder' end,
          coalesce(occurrence.title_snapshot, reminder.title,
            target_task.title, target_event.name, target_date.label, 'Reminder'),
          effective.due_at,
          occurrence.occurs_on, occurrence.status, null::timestamptz,
          target_person.id as person_id,
          1::int, occurrence.id,
          target_person.archived_at is not null,
          target_person.id is not null and target_person.deleted_at is not null,
          case when target_person.id is null then null
            when target_person.deleted_at is not null then 'Deleted/Unavailable person'
            else coalesce(nullif(trim(concat_ws(' ', nullif(target_person.given_name, ''), target_person.family_name)), ''), nullif(target_person.nickname, ''), 'Unnamed person') end
        from authorized join crm.reminders reminder on reminder.workspace_id = authorized.id
        join crm.reminder_occurrences occurrence on occurrence.reminder_id = reminder.id
          and occurrence.member_id = ${command.memberId}::uuid
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
          and occurrence.channel = 'in_app'
          and occurrence.status in ('pending','retry','failed','manual_attention')
          and (occurrence.status <> 'retry' or occurrence.next_attempt_at is not null)
          and effective.due_at < ${window.thirtyDaysEnd}
          and not exists (select 1 from crm.stay_in_touch_cadences cadence
            where cadence.reminder_id = reminder.id and cadence.is_active)
        union all
        select cadence.id, 'cadence', 'Reconnect with ' || coalesce(nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''), nullif(person.nickname, ''), 'Unnamed person'),
          cadence.next_due_at, null::date, null::text, cadence.last_contacted_at,
          person.id, 2::int, cadence.id, person.archived_at is not null, false,
          coalesce(nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''), nullif(person.nickname, ''), 'Unnamed person')
        from authorized join crm.people person on person.workspace_id = authorized.id
        join crm.stay_in_touch_cadences cadence on cadence.person_id = person.id
        where cadence.is_active and cadence.next_due_at is not null
          and cadence.next_due_at < ${window.thirtyDaysEnd}
          and person.deleted_at is null
      ), projection as (
        select distinct on (kind, id) * from projection_source
        order by kind, id, due_at, source_order, source_id
      ), ranked as (
        select projection.*, case
          when due_at < ${window.todayStart} then 'overdue'
          when due_at < ${window.tomorrowStart} then 'today'
          when due_at < ${window.nextSevenDaysEnd} then 'next'
          else 'upcoming' end as bucket,
          row_number() over (partition by case
            when due_at < ${window.todayStart} then 'overdue'
            when due_at < ${window.tomorrowStart} then 'today'
            when due_at < ${window.nextSevenDaysEnd} then 'next'
          else 'upcoming' end order by due_at,
            lower(coalesce(person_name, title)), kind, id) as position
        from projection
      )
      select id::text, kind, title, ${instant("due_at")} as due_at,
        occurs_on::text, reminder_status,
        ${instant("last_contacted_at")} as last_contacted_at,
        person_id::text, archived, unavailable, person_name
      from ranked where position <= case when bucket = 'upcoming'
        then ${command.upcomingLimit}::bigint
        else ${command.perAttentionGroupLimit}::bigint end
      union all select null, null, null, null, null, null, null, null, null, null, null
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
              ...(row.last_contacted_at
                ? { lastContactedAt: row.last_contacted_at }
                : {}),
              person,
              title: row.title,
            }];
          }
          return (row.kind === "important-date" || row.kind === "life-event" ||
              row.kind === "reminder") &&
              row.occurs_on &&
              ["failed", "manual_attention", "pending", "retry"].includes(
                row.reminder_status ?? "",
              )
            ? [{
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
