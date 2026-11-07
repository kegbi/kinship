import { sql } from "kysely";
import type { ImportantDatePublisher } from "../../../people/public.ts";
import type {
  ReminderDeliveryPreferences,
  ReminderRecipients,
} from "../../ports/reminder_repository.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { recipientChannels } from "./reminder_repository.ts";

interface ReminderRow {
  readonly id: string;
  readonly is_active: boolean;
}

function title(command: Parameters<ImportantDatePublisher["regenerate"]>[0]) {
  const date = command.after ?? command.before;
  if (!date) return "Important date";
  if (date.kind === "birthday") return "Birthday";
  if (date.kind === "deceased") return "Date of death";
  if (date.kind === "first_met") return "First meeting";
  return date.label ?? "Important date";
}

export class PostgresPersonDateReminderPublisher
  implements ImportantDatePublisher {
  constructor(
    private readonly recipients: ReminderRecipients,
    private readonly preferences: ReminderDeliveryPreferences,
  ) {}

  async regenerate(
    command: Parameters<ImportantDatePublisher["regenerate"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    const personDateId = command.after?.id ?? command.before?.id;
    const personId = command.after?.personId ?? command.before?.personId;
    if (!personDateId || !personId) {
      throw new Error("Person-date reminder regeneration has no target.");
    }
    const existing = await sql<ReminderRow>`
      select id::text, is_active
      from crm.reminders
      where person_date_id = ${personDateId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
      order by created_at, id
      for update
    `.execute(database);
    if (existing.rows.length > 1) {
      throw new Error("A person date has duplicate reminder definitions.");
    }
    const reminderId = existing.rows[0]?.id;
    if (reminderId) {
      await sql`
        delete from crm.reminder_occurrences
        where reminder_id = ${reminderId}::uuid and status = 'pending'
      `.execute(database);
    }

    // A merge moves a date to another person without deciding whether its
    // reminder runs: a paused reminder follows its date and stays paused.
    if (
      command.keepActive && reminderId && command.after &&
      existing.rows[0]?.is_active === false
    ) {
      await sql`
        update crm.reminders set person_id = ${personId}::uuid,
          updated_at = ${command.occurredAt}::timestamptz
        where id = ${reminderId}::uuid and workspace_id = ${command.workspaceId}::uuid
      `.execute(database);
      return;
    }
    const schedulable = command.after?.month !== undefined &&
      command.after.day !== undefined;
    if (!command.after || !schedulable) {
      if (!reminderId) return;
      const history = await sql<{ readonly retained: boolean }>`
        select exists(
          select 1 from crm.reminder_occurrences
          where reminder_id = ${reminderId}::uuid
        ) as retained
      `.execute(database);
      if (!command.after && history.rows[0]?.retained === true) {
        await sql`
          update crm.reminders set
            target_kind = 'person', person_date_id = null,
            is_active = false, deleted_at = ${command.occurredAt}::timestamptz,
            updated_at = ${command.occurredAt}::timestamptz
          where id = ${reminderId}::uuid and workspace_id = ${command.workspaceId}::uuid
        `.execute(database);
      } else if (!command.after) {
        await sql`
          delete from crm.reminders
          where id = ${reminderId}::uuid and workspace_id = ${command.workspaceId}::uuid
        `.execute(database);
      } else {
        await sql`
          update crm.reminders set is_active = false,
            deleted_at = ${command.occurredAt}::timestamptz,
            updated_at = ${command.occurredAt}::timestamptz
          where id = ${reminderId}::uuid and workspace_id = ${command.workspaceId}::uuid
        `.execute(database);
      }
      return;
    }

    const next = await sql<{ readonly occurs_on: string }>`
      with local_today as (
        select (${command.occurredAt}::timestamptz at time zone
          coalesce(settings.default_timezone, 'UTC'))::date as value
        from crm.workspace_settings settings
        where settings.workspace_id = ${command.workspaceId}::uuid
      ), candidate_years as (
        select series::int as value, local_today.value as today
        from local_today,
          generate_series(
            extract(year from local_today.value)::int,
            extract(year from local_today.value)::int + 8
          ) series
      )
      select candidate.value::text as occurs_on
      from candidate_years
      cross join lateral (
        select (
          make_date(candidate_years.value, ${command.after.month}, 1) +
          make_interval(days => ${command.after.day} - 1)
        )::date as value
      ) candidate
      where extract(month from candidate.value)::int = ${command.after.month}
        and candidate.value >= today
      order by candidate_years.value
      limit 1
    `.execute(database);
    const occursOn = next.rows[0]?.occurs_on;
    if (!occursOn) {
      throw new Error(
        "Could not calculate the next important-date occurrence.",
      );
    }
    let activeReminderId = reminderId;
    if (activeReminderId) {
      await sql`
        update crm.reminders set
          person_id = ${personId}::uuid,
          person_date_id = ${personDateId}::uuid,
          target_kind = 'person_date', title = ${title(command)},
          anchor_on = ${occursOn}::date, recurrence_unit = 'year',
          recurrence_interval = 1, is_active = true, can_delete = false,
          deleted_at = null, updated_at = ${command.occurredAt}::timestamptz
        where id = ${activeReminderId}::uuid and workspace_id = ${command.workspaceId}::uuid
      `.execute(database);
    } else {
      const inserted = await sql<ReminderRow>`
        insert into crm.reminders (
          workspace_id, person_id, person_date_id, target_kind, title,
          anchor_on, recurrence_unit, recurrence_interval, is_active,
          can_delete, created_by_member_id, created_at, updated_at
        ) values (
          ${command.workspaceId}::uuid, ${personId}::uuid,
          ${personDateId}::uuid, 'person_date', ${title(command)},
          ${occursOn}::date, 'year', 1, true, false,
          ${command.memberId}::uuid, ${command.occurredAt}::timestamptz,
          ${command.occurredAt}::timestamptz
        ) returning id::text
      `.execute(database);
      activeReminderId = inserted.rows[0]?.id;
    }
    if (!activeReminderId) {
      throw new Error("Important-date reminder definition was not persisted.");
    }
    // `workspaces` owns membership, so it names the members this fan-out may
    // still deliver to; this module only schedules for them.
    const recipients = await this.recipients.listEligible({
      transaction: command.transaction,
      workspaceId: command.workspaceId,
    });
    if (recipients.length === 0) return;
    const recipientIds = recipients.map((recipient) => recipient.memberId);
    // Each member's occurrences go out on the channels they chose.
    const channels = await recipientChannels(
      this.preferences,
      command.transaction,
      recipients,
    );
    const deliveries = recipients.flatMap((recipient) =>
      (channels.get(recipient.memberId) ?? ["in_app"]).map((channel) => ({
        channel,
        memberId: recipient.memberId,
      }))
    );
    await sql`
      with member_schedule as (
        select recipient.member_id, lead.days_before,
          settings.default_reminder_time,
          coalesce(preferences.timezone, settings.default_timezone, 'UTC')
            as timezone_name
        from unnest(${recipientIds}::uuid[]) as recipient(member_id)
        join crm.workspace_settings settings
          on settings.workspace_id = ${command.workspaceId}::uuid
        left join crm.member_preferences preferences
          on preferences.member_id = recipient.member_id
        -- The day itself always notifies; active rules add advance notices.
        cross join lateral (
          select 0 as days_before
          union
          select rule.days_before
          from crm.reminder_rules rule
          where rule.workspace_id = ${command.workspaceId}::uuid
            and rule.is_active
        ) lead
      ), candidate_years as (
        select schedule.*, series::int as candidate_year
        from member_schedule schedule
        cross join lateral generate_series(
          extract(year from (${command.occurredAt}::timestamptz at time zone
            schedule.timezone_name))::int,
          extract(year from (${command.occurredAt}::timestamptz at time zone
            schedule.timezone_name))::int + 8
        ) series
      ), calendar_candidates as (
        select candidate_years.*,
          (
            make_date(candidate_year, ${command.after.month}, 1) +
            make_interval(days => ${command.after.day} - 1)
          )::date as occurs_on
        from candidate_years
      ), delivery_candidates as (
        select calendar_candidates.*,
          (
            ((occurs_on - days_before) + default_reminder_time)
              at time zone timezone_name
          ) as deliver_at
        from calendar_candidates
        where extract(month from occurs_on)::int = ${command.after.month}
      ), next_delivery as (
        select distinct on (member_id, days_before)
          member_id, occurs_on, deliver_at, days_before
        from delivery_candidates
        where deliver_at >= ${command.occurredAt}::timestamptz
        order by member_id, days_before, deliver_at, occurs_on
      )
      insert into crm.reminder_occurrences (
        reminder_id, member_id, occurs_on, deliver_at, lead_time_days,
        channel, status, title_snapshot, created_at, updated_at
      )
      select ${activeReminderId}::uuid, next_delivery.member_id,
        next_delivery.occurs_on, next_delivery.deliver_at,
        next_delivery.days_before, delivery.channel, 'pending',
        ${title(command)}, ${command.occurredAt}::timestamptz,
        ${command.occurredAt}::timestamptz
      from next_delivery
      join unnest(
        ${deliveries.map((delivery) => delivery.memberId)}::uuid[],
        ${deliveries.map((delivery) => delivery.channel)}::text[]
      ) as delivery(member_id, channel)
        on delivery.member_id = next_delivery.member_id
      on conflict do nothing
    `.execute(database);
    await sql`
      update crm.reminders set anchor_on = coalesce(
        (
          select min(occurs_on)
          from crm.reminder_occurrences
          where reminder_id = ${activeReminderId}::uuid
            and status = 'pending'
        ),
        anchor_on
      )
      where id = ${activeReminderId}::uuid and workspace_id = ${command.workspaceId}::uuid
    `.execute(database);
  }
}
