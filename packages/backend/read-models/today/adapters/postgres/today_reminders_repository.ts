import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type {
  TodayCadenceItem,
  TodayReminderItem,
  TodayRemindersRepository,
} from "../../application/get_today_reminders.ts";

interface ReminderRow {
  readonly attempt_count: number;
  readonly deliver_at: string;
  readonly id: string;
  readonly next_attempt_at: string | null;
  readonly person_id: string;
  readonly person_archived: boolean;
  readonly person_name: string;
  readonly status: TodayReminderItem["status"];
  readonly title: string;
  readonly visible_at: string | null;
}

interface CadenceRow {
  readonly due_at: string;
  readonly id: string;
  readonly last_contacted_at: string | null;
  readonly person_id: string;
  readonly person_archived: boolean;
  readonly person_name: string;
}

export class PostgresTodayRemindersRepository
  implements TodayRemindersRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async get(command: Parameters<TodayRemindersRepository["get"]>[0]) {
    const context = await sql<{ readonly timezone: string }>`
      select coalesce(
        (select preference.timezone from crm.member_preferences preference
          where preference.member_id = ${command.memberId}::uuid),
        (select setting.default_timezone from crm.workspace_settings setting
          where setting.workspace_id = ${command.workspaceId}::uuid),
        'UTC') as timezone
    `.execute(this.database);
    const timezone = context.rows[0]!.timezone;
    const [reminders, cadences] = await Promise.all([
      sql<ReminderRow>`
        with ranked as (
          select occurrence.id, occurrence.attempt_count,
            occurrence.deliver_at, occurrence.next_attempt_at,
            occurrence.status,
            coalesce(occurrence.title_snapshot, reminder.title, 'Reminder') as title,
            occurrence.visible_at, person.id as person_id,
            person.archived_at is not null as person_archived,
            coalesce(nullif(person.nickname, ''), nullif(concat_ws(' ', person.given_name, person.family_name), ''), 'Person') as person_name,
            row_number() over (partition by reminder.id order by
              case occurrence.status when 'manual_attention' then 0
                when 'failed' then 1 else 2 end,
              case when occurrence.status not in ('manual_attention','failed')
                  and (case when occurrence.status = 'retry'
                    then occurrence.next_attempt_at else occurrence.deliver_at end)
                    >= ${command.now}::timestamptz
                then 0 else 1 end,
              case when occurrence.status not in ('manual_attention','failed')
                  and (case when occurrence.status = 'retry'
                    then occurrence.next_attempt_at else occurrence.deliver_at end)
                    >= ${command.now}::timestamptz
                then case when occurrence.status = 'retry'
                  then occurrence.next_attempt_at else occurrence.deliver_at end end,
              occurrence.deliver_at desc, occurrence.id) as relevance
          from crm.reminder_occurrences occurrence
          join crm.reminders reminder on reminder.id = occurrence.reminder_id
          join crm.people person on person.id = reminder.person_id
            and person.workspace_id = reminder.workspace_id
          where reminder.workspace_id = ${command.workspaceId}::uuid
            and (reminder.is_active or occurrence.visible_at is not null)
            and reminder.deleted_at is null
            and person.deleted_at is null
            and occurrence.member_id = ${command.memberId}::uuid
            and occurrence.status in ('pending','claimed','retry','sent','failed','manual_attention')
            and (occurrence.status <> 'retry' or occurrence.next_attempt_at is not null)
            and (occurrence.status <> 'claimed' or occurrence.visible_at is not null)
            and (occurrence.status in ('failed','manual_attention')
              or (case when occurrence.status = 'retry'
                then occurrence.next_attempt_at else occurrence.deliver_at end)
                < ${command.now}::timestamptz + interval '30 days')
            and (occurrence.status <> 'sent'
              or occurrence.deliver_at >= ${command.now}::timestamptz - interval '90 days')
        )
        select occurrence.id::text, occurrence.attempt_count,
          ${instantColumn("occurrence.deliver_at")} as deliver_at,
          ${instantColumn("occurrence.next_attempt_at")} as next_attempt_at,
          occurrence.status, occurrence.title,
          ${instantColumn("occurrence.visible_at")} as visible_at,
          occurrence.person_id::text, occurrence.person_archived,
          occurrence.person_name
        from ranked occurrence where occurrence.relevance = 1
        order by case occurrence.status when 'manual_attention' then 0 when 'failed' then 1
          when 'retry' then 2 when 'pending' then 3 else 4 end,
          case when occurrence.status = 'retry' then occurrence.next_attempt_at
            else occurrence.deliver_at end,
          occurrence.person_id, occurrence.id limit 100
      `.execute(this.database),
      sql<CadenceRow>`
        select cadence.id::text, person.id::text as person_id,
          person.archived_at is not null as person_archived,
          coalesce(nullif(person.nickname, ''), nullif(concat_ws(' ', person.given_name, person.family_name), ''), 'Person') as person_name,
          ${instantColumn("cadence.next_due_at")} as due_at,
          ${instantColumn("cadence.last_contacted_at")} as last_contacted_at
        from crm.stay_in_touch_cadences cadence
        join crm.people person on person.id = cadence.person_id
        where person.workspace_id = ${command.workspaceId}::uuid
          and person.deleted_at is null and cadence.is_active
          and cadence.next_due_at <= ${command.now}::timestamptz + interval '30 days'
        order by cadence.next_due_at, lower(coalesce(person.nickname, person.given_name, person.family_name, '')), person.id
        limit 100
      `.execute(this.database),
    ]);
    return {
      cadences: cadences.rows.map((row): TodayCadenceItem => ({
        dueAt: row.due_at,
        id: row.id,
        ...pickDefined({ lastContactedAt: row.last_contacted_at }),
        person: {
          archived: row.person_archived,
          id: row.person_id,
          name: row.person_name,
        },
      })),
      reminders: reminders.rows.map((row): TodayReminderItem => {
        const item = {
          attemptCount: row.attempt_count,
          deliverAt: row.deliver_at,
          id: row.id,
          person: {
            archived: row.person_archived,
            id: row.person_id,
            name: row.person_name,
          },
          title: row.title,
          ...pickDefined({ visibleAt: row.visible_at }),
        };
        return row.status === "retry"
          ? { ...item, nextAttemptAt: row.next_attempt_at!, status: row.status }
          : { ...item, status: row.status };
      }),
      status: "ready" as const,
      timezone,
    };
  }
}
