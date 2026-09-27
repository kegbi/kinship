import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type { Clock } from "../../../../shared-kernel/clock.ts";
import type { StayInTouchCadenceRecord } from "../../domain/cadence.ts";
import {
  type ClaimedReminderOccurrence,
  type DeliveryChannel,
  deliveryChannels,
  digestIdempotencyKey,
  digestWindow,
  type ProviderDeliveryResult,
} from "../../domain/delivery_rules.ts";
import {
  type CalendarOccurrence,
  generateCalendarOccurrences,
} from "../../domain/recurrence.ts";
import type {
  ReminderDefinitionRecord,
  ReminderOccurrenceRecord,
  ReminderOccurrenceStatus,
} from "../../domain/reminder_rules.ts";
import type {
  InAppReminderEffectStore,
  ReminderAttemptLedger,
  ReminderDeliveryRepository,
} from "../../ports/reminder_delivery.ts";
import type {
  MemberDeliveryChoice,
  ReminderDeliveryPreferences,
  ReminderRecipient,
  ReminderRecipients,
  ReminderRepository,
  ReminderWorkspaceBoundary,
} from "../../ports/reminder_repository.ts";
import type { PlanningTransaction } from "../../ports/context.ts";

interface ReminderRow {
  readonly anchor_on: string;
  readonly created_at: string;
  readonly id: string;
  readonly is_active: boolean;
  readonly person_id: string;
  readonly recurrence_interval: number;
  readonly recurrence_unit: "day" | "month" | "none" | "week" | "year";
  readonly send_time: string;
  readonly title: string;
  readonly updated_at: string;
}

interface OccurrenceRow {
  readonly attempt_count: number;
  readonly deliver_at: string;
  readonly error: string | null;
  readonly id: string;
  readonly occurs_on: string;
  readonly provider_effect_at: string | null;
  readonly sent_at: string | null;
  readonly status: ReminderOccurrenceStatus;
  readonly visible_at: string | null;
}

interface CadenceRow {
  readonly id: string;
  readonly interval_count: number;
  readonly interval_unit: "day" | "month" | "week" | "year";
  readonly is_active: boolean;
  readonly last_contacted_at: string | null;
  readonly next_due_at: string;
  readonly person_id: string;
  readonly updated_at: string;
}

const reminderColumns = sql`
  reminder.id::text, reminder.person_id::text, reminder.title,
  reminder.anchor_on::text, reminder.recurrence_unit,
  reminder.recurrence_interval,
  coalesce(reminder.send_time, (
    select setting.default_reminder_time
    from crm.workspace_settings setting
    where setting.workspace_id = reminder.workspace_id
  ), '12:00'::time)::text as send_time,
  reminder.is_active,
  ${instantColumn("reminder.created_at")} as created_at,
  ${instantColumn("reminder.updated_at")} as updated_at
`;

const occurrenceColumns = sql`
  occurrence.id::text, occurrence.occurs_on::text,
  ${instantColumn("occurrence.deliver_at")} as deliver_at,
  occurrence.status, occurrence.attempt_count, occurrence.error,
  ${instantColumn("occurrence.sent_at")} as sent_at,
  ${instantColumn("occurrence.provider_effect_at")} as provider_effect_at,
  ${instantColumn("occurrence.visible_at")} as visible_at
`;

function occurrence(row: OccurrenceRow): ReminderOccurrenceRecord {
  return {
    attemptCount: row.attempt_count,
    deliverAt: row.deliver_at,
    ...pickDefined({ error: row.error }),
    id: row.id,
    occursOn: row.occurs_on,
    ...pickDefined({
      providerEffectAt: row.provider_effect_at,
      sentAt: row.sent_at,
    }),
    status: row.status,
    ...pickDefined({ visibleAt: row.visible_at }),
  };
}

function reminder(row: ReminderRow): ReminderDefinitionRecord {
  return {
    anchorOn: row.anchor_on,
    createdAt: row.created_at,
    id: row.id,
    isActive: row.is_active,
    personId: row.person_id,
    recurrenceInterval: row.recurrence_interval,
    recurrenceUnit: row.recurrence_unit,
    sendTime: row.send_time,
    title: row.title,
    updatedAt: row.updated_at,
  };
}

function leadDeliveryAt(
  occursOn: string,
  leadTimeDays: number | null,
  sendTime: string,
  timezone: string,
): string {
  const date = Temporal.PlainDate.from(occursOn).subtract({
    days: leadTimeDays ?? 0,
  });
  const time = Temporal.PlainTime.from(sendTime);
  return Temporal.ZonedDateTime.from({
    day: date.day,
    hour: time.hour,
    minute: time.minute,
    month: date.month,
    second: time.second,
    timeZone: timezone,
    year: date.year,
  }, { disambiguation: "compatible" }).toInstant().toString();
}

function cadence(row: CadenceRow): StayInTouchCadenceRecord {
  return {
    id: row.id,
    intervalCount: row.interval_count,
    intervalUnit: row.interval_unit,
    isActive: row.is_active,
    ...pickDefined({ lastContactedAt: row.last_contacted_at }),
    nextDueAt: row.next_due_at,
    personId: row.person_id,
    updatedAt: row.updated_at,
  };
}

/** What each member chose about delivery, keyed by member. */
async function choicesOf(
  preferences: ReminderDeliveryPreferences,
  transaction: PlanningTransaction,
  memberIds: readonly string[],
): Promise<ReadonlyMap<string, MemberDeliveryChoice>> {
  if (memberIds.length === 0) return new Map();
  const choices = await preferences.listDeliveryPreferences({
    memberIds,
    transaction,
  });
  return new Map(choices.map((choice) => [choice.memberId, choice]));
}

/**
 * The channels each recipient's newly generated occurrences use: their
 * choice from `workspaces`, and in-app alone without a verified address.
 */
export async function recipientChannels(
  preferences: ReminderDeliveryPreferences,
  transaction: PlanningTransaction,
  recipients: readonly ReminderRecipient[],
): Promise<ReadonlyMap<string, readonly DeliveryChannel[]>> {
  const choices = await choicesOf(
    preferences,
    transaction,
    recipients.map((recipient) => recipient.memberId),
  );
  return new Map(recipients.map((recipient) => [
    recipient.memberId,
    deliveryChannels({
      hasVerifiedEmail: recipient.verifiedEmail !== undefined,
      preference: choices.get(recipient.memberId)?.reminderDelivery ??
        "in_app",
    }),
  ]));
}

/**
 * The reminder use case revalidates the actor under lock before it asks for a
 * delivery time zone (see the `ActorRevalidation` port), so this boundary only
 * resolves the member's preference over the workspace default.
 */
export class PostgresReminderWorkspaceBoundary
  implements ReminderWorkspaceBoundary {
  async effectiveTimezone(
    command: Parameters<ReminderWorkspaceBoundary["effectiveTimezone"]>[0],
  ): Promise<
    Awaited<ReturnType<ReminderWorkspaceBoundary["effectiveTimezone"]>>
  > {
    const result = await sql<{ readonly timezone: string | null }>`
      select coalesce(
        (select preference.timezone from crm.member_preferences preference
          where preference.member_id = ${command.memberId}::uuid),
        (select setting.default_timezone from crm.workspace_settings setting
          where setting.workspace_id = ${command.workspaceId}::uuid),
        'UTC'
      ) as timezone
    `.execute(databaseFromSession(command.transaction));
    const timezone = result.rows[0]?.timezone;
    if (!timezone) return { status: "forbidden" };
    try {
      Temporal.Now.zonedDateTimeISO(timezone);
      return { status: "ready", timezone };
    } catch {
      return { status: "forbidden" };
    }
  }
}

export class PostgresReminderRepository implements ReminderRepository {
  constructor(
    private readonly recipients: ReminderRecipients,
    private readonly preferences: ReminderDeliveryPreferences,
  ) {}

  async lockRequest(
    command: Parameters<ReminderRepository["lockRequest"]>[0],
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.id}, 0))`
      .execute(databaseFromSession(command.transaction));
  }

  async findReminder(
    command: Parameters<ReminderRepository["findReminder"]>[0],
  ): Promise<ReminderDefinitionRecord | undefined> {
    const result = await sql<ReminderRow>`
      select ${reminderColumns} from crm.reminders reminder
      where reminder.id = ${command.id}::uuid
        and reminder.workspace_id = ${command.workspaceId}::uuid
        and reminder.deleted_at is null
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? reminder(row) : undefined;
  }

  async createReminder(
    command: Parameters<ReminderRepository["createReminder"]>[0],
  ): Promise<ReminderDefinitionRecord | undefined> {
    const result = await sql<ReminderRow>`
      insert into crm.reminders as reminder (
        id, workspace_id, person_id, target_kind, title, anchor_on,
        recurrence_unit, recurrence_interval, send_time, is_active,
        created_by_member_id, created_at, updated_at
      ) values (
        ${command.id}::uuid, ${command.workspaceId}::uuid,
        ${command.personId}::uuid, 'person', ${command.title},
        ${command.anchorOn}::date, ${command.recurrenceUnit},
        ${command.recurrenceInterval}, ${command.sendTime}::time, true,
        ${command.memberId}::uuid, ${command.occurredAt}, ${command.occurredAt}
      ) returning ${reminderColumns}
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row ? reminder(row) : undefined;
  }

  async upsertOccurrences(
    command: Parameters<ReminderRepository["upsertOccurrences"]>[0],
  ): Promise<readonly ReminderOccurrenceRecord[]> {
    const database = databaseFromSession(command.transaction);
    const eligible = await this.recipients.filterEligible({
      memberIds: [command.memberId],
      transaction: command.transaction,
    });
    const channels = (await recipientChannels(
      this.preferences,
      command.transaction,
      eligible,
    )).get(command.memberId) ?? ["in_app"];
    // A date that still has a live occurrence on a channel the member no
    // longer chose keeps it: already generated occurrences keep their channel.
    for (const item of command.occurrences) {
      for (const channel of channels) {
        await sql`
        insert into crm.reminder_occurrences (
          reminder_id, member_id, occurs_on, deliver_at, channel, status,
          title_snapshot, body_snapshot, created_at, updated_at
        ) select
          ${command.reminder.id}::uuid, ${command.memberId}::uuid,
          ${item.occursOn}::date, ${item.deliverAt}::timestamptz,
          ${channel}, 'pending', ${command.reminder.title},
          ${`Reminder for ${command.reminder.title}`}, now(), now()
        where not exists (
          select 1 from crm.reminder_occurrences existing
          where existing.reminder_id = ${command.reminder.id}::uuid
            and existing.member_id = ${command.memberId}::uuid
            and existing.occurs_on = ${item.occursOn}::date
            and existing.lead_time_days is null
            and existing.channel <> all(${channels}::text[])
            and existing.status <> 'cancelled'
        )
        on conflict (
          reminder_id, member_id, occurs_on, channel,
          (coalesce(lead_time_days, -1))
        ) do update set
          deliver_at = excluded.deliver_at, status = 'pending',
          claim_token = null, claim_owner = null, lease_expires_at = null,
          next_attempt_at = null, error = null,
          updated_at = excluded.updated_at
        where reminder_occurrences.status = 'cancelled'
          and reminder_occurrences.attempt_count = 0
          and reminder_occurrences.provider_result_state = 'unattempted'
          and reminder_occurrences.provider_receipt is null
          and reminder_occurrences.provider_effect_at is null
          and reminder_occurrences.visible_at is null
      `.execute(database);
      }
    }
    if (command.occurrences.length === 0) return [];
    const occurrenceDates = command.occurrences.map((item) => item.occursOn);
    const result = await sql<OccurrenceRow>`
      select ${occurrenceColumns} from crm.reminder_occurrences occurrence
      where occurrence.reminder_id = ${command.reminder.id}::uuid
        and occurrence.member_id = ${command.memberId}::uuid
        and occurrence.occurs_on in (${
      sql.join(occurrenceDates.map((value) => sql`${value}::date`))
    })
        and occurrence.channel = any(${channels}::text[])
      order by occurrence.deliver_at, occurrence.id
    `.execute(database);
    return result.rows.map(occurrence);
  }

  async setReminderActive(
    command: Parameters<ReminderRepository["setReminderActive"]>[0],
  ): Promise<
    | { reminder: ReminderDefinitionRecord; wasActive: boolean }
    | undefined
  > {
    const result = await sql<ReminderRow & { readonly was_active: boolean }>`
      with target as (
        select reminder.id, reminder.is_active as was_active
        from crm.reminders reminder
        where reminder.id = ${command.id}::uuid
          and reminder.workspace_id = ${command.workspaceId}::uuid
          and reminder.deleted_at is null
          and exists (
            select 1 from crm.people person
            where person.id = reminder.person_id
              and person.workspace_id = ${command.workspaceId}::uuid
              and person.archived_at is null and person.deleted_at is null
          )
        for update of reminder
      ), updated as (
        update crm.reminders reminder set is_active = ${command.active},
          updated_at = greatest(${command.occurredAt}::timestamptz, reminder.updated_at + interval '1 microsecond')
        from target where reminder.id = target.id
        returning reminder.*, target.was_active
      )
      select ${reminderColumns}, reminder.was_active
      from updated reminder
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? { reminder: reminder(row), wasActive: row.was_active }
      : undefined;
  }

  async cancelFutureOccurrences(
    command: Parameters<ReminderRepository["cancelFutureOccurrences"]>[0],
  ): Promise<void> {
    await sql`
      update crm.reminder_occurrences occurrence set status = 'cancelled',
        claim_token = null, claim_owner = null, lease_expires_at = null,
        next_attempt_at = null, updated_at = ${command.now}
      from crm.reminders reminder
      where occurrence.reminder_id = reminder.id
        and reminder.id = ${command.reminderId}::uuid
        and reminder.workspace_id = ${command.workspaceId}::uuid
        and occurrence.status = 'pending'
        and occurrence.attempt_count = 0
        and occurrence.provider_result_state = 'unattempted'
        and occurrence.provider_receipt is null
        and occurrence.provider_effect_at is null
        and occurrence.visible_at is null
    `.execute(databaseFromSession(command.transaction));
  }

  async upsertCadence(
    command: Parameters<ReminderRepository["upsertCadence"]>[0],
  ): Promise<StayInTouchCadenceRecord | undefined> {
    const database = databaseFromSession(command.transaction);
    const result = await sql<CadenceRow>`
      insert into crm.stay_in_touch_cadences as cadence (
        id, person_id, interval_count, interval_unit, next_due_at,
        is_active, created_at, updated_at, last_request_id,
        last_request_fingerprint
      ) values (
        ${command.id}::uuid, ${command.personId}::uuid,
        ${command.intervalCount}, ${command.intervalUnit},
        ${command.nextDueAt}::timestamptz, true,
        ${command.occurredAt}, ${command.occurredAt}, ${command.requestId}::uuid,
        ${command.requestFingerprint}
      ) on conflict (person_id) do update set
        interval_count = excluded.interval_count,
        interval_unit = excluded.interval_unit,
        next_due_at = excluded.next_due_at,
        is_active = true,
        last_request_id = excluded.last_request_id,
        last_request_fingerprint = excluded.last_request_fingerprint,
        updated_at = greatest(excluded.updated_at, cadence.updated_at + interval '1 microsecond')
      returning id::text, person_id::text, interval_count, interval_unit,
        is_active,
        ${instantColumn("last_contacted_at")} as last_contacted_at,
        ${instantColumn("next_due_at")} as next_due_at,
        ${instantColumn("updated_at")} as updated_at
    `.execute(database);
    const row = result.rows[0];
    if (row) {
      await sql`
        insert into crm.stay_in_touch_cadence_requests (
          workspace_id, request_id, cadence_id, request_fingerprint,
          accepted_at
        ) values (
          ${command.workspaceId}::uuid, ${command.requestId}::uuid,
          ${row.id}::uuid, ${command.requestFingerprint},
          ${command.occurredAt}
        ) on conflict (workspace_id, request_id) do nothing
      `.execute(database);
    }
    return row ? cadence(row) : undefined;
  }

  async findCadenceRequest(
    command: Parameters<ReminderRepository["findCadenceRequest"]>[0],
  ) {
    const result = await sql<
      CadenceRow & { readonly last_request_fingerprint: string }
    >`
      select cadence.id::text, cadence.person_id::text,
        cadence.interval_count, cadence.interval_unit, cadence.is_active,
        request.request_fingerprint as last_request_fingerprint,
        ${instantColumn("cadence.last_contacted_at")} as last_contacted_at,
        ${instantColumn("cadence.next_due_at")} as next_due_at,
        ${instantColumn("cadence.updated_at")} as updated_at
      from crm.stay_in_touch_cadence_requests request
      join crm.stay_in_touch_cadences cadence on cadence.id = request.cadence_id
      join crm.people person on person.id = cadence.person_id
      where request.workspace_id = ${command.workspaceId}::uuid
        and request.request_id = ${command.requestId}::uuid
        and person.workspace_id = request.workspace_id
      for update of cadence
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? {
        cadence: cadence(row),
        requestFingerprint: row.last_request_fingerprint,
      }
      : undefined;
  }

  async updateCadenceFromInteraction(
    command: Parameters<ReminderRepository["updateCadenceFromInteraction"]>[0],
  ): Promise<void> {
    if (command.personIds.length === 0) return;
    await sql`
      with context as (
        select coalesce(
          (select preference.timezone from crm.member_preferences preference
            where preference.member_id = ${command.memberId}::uuid),
          (select setting.default_timezone from crm.workspace_settings setting
            where setting.workspace_id = ${command.workspaceId}::uuid),
          'UTC') as timezone
      ), selected as (
        select cadence.id, cadence.interval_count, cadence.interval_unit,
          greatest(coalesce(cadence.last_contacted_at, '-infinity'::timestamptz), ${command.happenedAt}::timestamptz) as contacted,
          context.timezone
        from crm.stay_in_touch_cadences cadence
        join crm.people person on person.id = cadence.person_id
        cross join context
        where person.workspace_id = ${command.workspaceId}::uuid
          and cadence.person_id in (${
      sql.join(command.personIds.map((id) => sql`${id}::uuid`))
    })
          and ${command.happenedAt}::timestamptz >
            coalesce(cadence.last_contacted_at, cadence.created_at)
      )
      update crm.stay_in_touch_cadences cadence set
        last_contacted_at = selected.contacted,
        next_due_at = ${CADENCE_NEXT_DUE},
        updated_at = greatest(cadence.updated_at + interval '1 microsecond', selected.contacted)
      from selected where cadence.id = selected.id
    `.execute(databaseFromSession(command.transaction));
  }

  async regenerateForTimezone(
    command: Parameters<ReminderRepository["regenerateForTimezone"]>[0],
  ): Promise<void> {
    await sql`
      with recalculated as (
        select occurrence.id,
          ((occurrence.occurs_on - coalesce(occurrence.lead_time_days, 0)) + coalesce(
            reminder.send_time,
            (select setting.default_reminder_time
              from crm.workspace_settings setting
              where setting.workspace_id = reminder.workspace_id),
            '12:00'::time
          )) at time zone ${command.timezone} as deliver_at
        from crm.reminder_occurrences occurrence
        join crm.reminders reminder on reminder.id = occurrence.reminder_id
        where reminder.workspace_id = ${command.workspaceId}::uuid
          and reminder.is_active and reminder.deleted_at is null
          and occurrence.member_id = ${command.memberId}::uuid
          and occurrence.status = 'pending'
          and occurrence.attempt_count = 0
          and occurrence.provider_result_state = 'unattempted'
      )
      update crm.reminder_occurrences occurrence set
        deliver_at = recalculated.deliver_at,
        updated_at = ${command.now}
      from recalculated where occurrence.id = recalculated.id
        and occurrence.status = 'pending'
        and occurrence.attempt_count = 0
        and occurrence.provider_result_state = 'unattempted'
    `.execute(databaseFromSession(command.transaction));
  }

  async regenerateForWorkspaceTimezone(
    command: Parameters<
      ReminderRepository["regenerateForWorkspaceTimezone"]
    >[0],
  ): Promise<void> {
    // `workspaces` names the members still eligible for delivery; this module
    // no longer reads membership to find out.
    const recipients = await this.recipients.listEligible({
      transaction: command.transaction,
      workspaceId: command.workspaceId,
    });
    if (recipients.length === 0) return;
    const recipientIds = recipients.map((recipient) => recipient.memberId);
    await sql`
      with recalculated as (
        select occurrence.id,
          ((occurrence.occurs_on - coalesce(occurrence.lead_time_days, 0)) + coalesce(
            reminder.send_time,
            (select setting.default_reminder_time
              from crm.workspace_settings setting
              where setting.workspace_id = reminder.workspace_id),
            '12:00'::time
          )) at time zone ${command.timezone} as deliver_at
        from crm.reminder_occurrences occurrence
        join crm.reminders reminder on reminder.id = occurrence.reminder_id
        left join crm.member_preferences preference
          on preference.member_id = occurrence.member_id
        where reminder.workspace_id = ${command.workspaceId}::uuid
          and reminder.is_active and reminder.deleted_at is null
          and occurrence.member_id = any(${recipientIds}::uuid[])
          and preference.timezone is null
          and occurrence.status = 'pending'
          and occurrence.attempt_count = 0
          and occurrence.provider_result_state = 'unattempted'
      )
      update crm.reminder_occurrences occurrence set
        deliver_at = recalculated.deliver_at,
        updated_at = ${command.now}
      from recalculated where occurrence.id = recalculated.id
        and occurrence.status = 'pending'
        and occurrence.attempt_count = 0
        and occurrence.provider_result_state = 'unattempted'
    `.execute(databaseFromSession(command.transaction));
  }

  async listPerson(command: Parameters<ReminderRepository["listPerson"]>[0]) {
    const database = databaseFromSession(command.transaction);
    const after = command.after;
    const [reminders, cadences] = await Promise.all([
      sql<ReminderRow>`select ${reminderColumns} from crm.reminders reminder
        where reminder.workspace_id = ${command.workspaceId}::uuid
          and reminder.person_id = ${command.personId}::uuid and reminder.deleted_at is null
          ${
        after
          ? sql`and (reminder.is_active < ${after.isActive}
          or (reminder.is_active = ${after.isActive} and (
            reminder.updated_at < ${after.updatedAt}::timestamptz
            or (reminder.updated_at = ${after.updatedAt}::timestamptz
              and reminder.id > ${after.id}::uuid))))`
          : sql``
      }
        order by reminder.is_active desc, reminder.updated_at desc, reminder.id
        limit ${command.limit + 1}`
        .execute(database),
      sql<
        CadenceRow
      >`select cadence.id::text, cadence.person_id::text, cadence.interval_count,
        cadence.interval_unit, cadence.is_active,
        ${instantColumn("cadence.last_contacted_at")} as last_contacted_at,
        ${instantColumn("cadence.next_due_at")} as next_due_at,
        ${instantColumn("cadence.updated_at")} as updated_at
        from crm.stay_in_touch_cadences cadence join crm.people person on person.id = cadence.person_id
        where person.workspace_id = ${command.workspaceId}::uuid and cadence.person_id = ${command.personId}::uuid
        order by cadence.updated_at desc limit 1`.execute(database),
    ]);
    const page = reminders.rows.slice(0, command.limit);
    // The occurrence lookup follows the page rather than the person, so a
    // second page of reminders keeps its delivery states instead of falling
    // off the end of a fixed cap.
    const occurrences = await sql<
      OccurrenceRow & { readonly reminder_id: string }
    >`select occurrence.reminder_id::text, ${occurrenceColumns}
        from crm.reminders reminder
        cross join lateral (
          select candidate.* from crm.reminder_occurrences candidate
          where candidate.reminder_id = reminder.id
            and candidate.member_id = ${command.memberId}::uuid
            and candidate.status in ('pending','claimed','retry','sent','failed','manual_attention')
            and (candidate.status <> 'claimed' or candidate.visible_at is not null)
            and (candidate.status <> 'sent'
              or candidate.deliver_at >= now() - interval '90 days')
          order by
            case candidate.status when 'manual_attention' then 0
              when 'failed' then 1 else 2 end,
            case when candidate.status not in ('manual_attention','failed')
                and candidate.deliver_at >= now() then 0 else 1 end,
            case when candidate.status not in ('manual_attention','failed')
                and candidate.deliver_at >= now() then candidate.deliver_at end,
            candidate.deliver_at desc, candidate.id
          limit 1
        ) occurrence
        where reminder.workspace_id = ${command.workspaceId}::uuid
          and reminder.id = any(${page.map((row) => row.id)}::uuid[])
        order by reminder.updated_at desc, reminder.id`.execute(database);
    const nextByReminder = new Map<string, ReminderOccurrenceRecord>();
    for (const row of occurrences.rows) {
      if (!nextByReminder.has(row.reminder_id)) {
        nextByReminder.set(row.reminder_id, occurrence(row));
      }
    }
    const final = page.at(-1);
    return {
      cadences: cadences.rows.map(cadence),
      ...(reminders.rows.length > command.limit && final
        ? {
          next: {
            id: final.id,
            isActive: final.is_active,
            updatedAt: final.updated_at,
          },
        }
        : {}),
      reminders: page.map((row) => ({
        ...reminder(row),
        ...(nextByReminder.get(row.id)
          ? { nextOccurrence: nextByReminder.get(row.id)! }
          : {}),
      })),
    };
  }
}

interface ClaimRow {
  readonly attempt_count: number;
  readonly attempt_key: string | null;
  readonly body: string | null;
  readonly channel: DeliveryChannel;
  readonly claim_token: string;
  readonly id: string;
  readonly member_id: string;
  readonly person_id: string | null;
  readonly provider_idempotency_key: string;
  readonly provider_result_state:
    | "ambiguous"
    | "confirmed"
    | "rejected"
    | "unattempted";
  readonly title: string | null;
  readonly workspace_id: string;
}

interface ReplenishmentRow {
  readonly anchor_on: string;
  readonly member_id: string;
  readonly lead_time_days: number | null;
  readonly recurrence_interval: number;
  readonly recurrence_unit: "day" | "month" | "week" | "year";
  readonly reminder_id: string;
  readonly send_time: string;
  readonly timezone: string;
  readonly title: string;
}

/** How many of one member's due digest occurrences one claim may carry. */
const DIGEST_CLAIM_LIMIT = 100;

export class PostgresReminderDeliveryRepository
  implements ReminderAttemptLedger, ReminderDeliveryRepository {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly recipients: ReminderRecipients,
    private readonly preferences: ReminderDeliveryPreferences,
  ) {}

  async replenish(
    command: Parameters<ReminderDeliveryRepository["replenish"]>[0],
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await sql`
        select setting.workspace_id
        from crm.workspace_settings setting
        where setting.workspace_id in (
          select reminder.workspace_id from crm.reminders reminder
          join crm.reminder_occurrences occurrence
            on occurrence.reminder_id = reminder.id
          where reminder.is_active and reminder.deleted_at is null
        )
        order by setting.workspace_id
        for share
      `.execute(transaction);
      await sql`
        select preference.member_id
        from crm.member_preferences preference
        where preference.member_id in (
          select occurrence.member_id from crm.reminder_occurrences occurrence
          join crm.reminders reminder on reminder.id = occurrence.reminder_id
          where reminder.is_active and reminder.deleted_at is null
        )
        order by preference.member_id
        for share
      `.execute(transaction);
      // The scan reaches every workspace at once, so the eligible members come
      // from the `workspaces` port rather than a membership join here.
      const candidateMembers = await sql<{ readonly member_id: string }>`
        select distinct occurrence.member_id::text as member_id
        from crm.reminders reminder
        join crm.reminder_occurrences occurrence
          on occurrence.reminder_id = reminder.id
        join crm.people person on person.id = reminder.person_id
        where reminder.is_active and reminder.deleted_at is null
          and reminder.recurrence_unit <> 'none'
          and person.archived_at is null and person.deleted_at is null
      `.execute(transaction);
      const eligible = await this.recipients.filterEligible({
        memberIds: candidateMembers.rows.map((row) => row.member_id),
        transaction: { opaque: transaction },
      });
      if (eligible.length === 0) return;
      const eligibleMemberIds = eligible.map((row) => row.memberId);
      const eligibleWorkspaceIds = eligible.map((row) => row.workspaceId);
      const channels = await recipientChannels(
        this.preferences,
        { opaque: transaction },
        eligible,
      );
      const candidates = await sql<ReplenishmentRow>`
        select distinct reminder.id::text as reminder_id,
          occurrence.member_id::text, reminder.anchor_on::text,
          reminder.recurrence_unit, reminder.recurrence_interval,
          case when reminder.target_kind = 'person_date'
            then occurrence.lead_time_days else null end as lead_time_days,
          coalesce(
            reminder.send_time, setting.default_reminder_time, '12:00'::time
          )::text as send_time, reminder.title,
          coalesce(preference.timezone, setting.default_timezone, 'UTC') as timezone
        from crm.reminders reminder
        join crm.reminder_occurrences occurrence
          on occurrence.reminder_id = reminder.id
        join crm.people person on person.id = reminder.person_id
        join unnest(${eligibleMemberIds}::uuid[], ${eligibleWorkspaceIds}::uuid[])
          as eligible(member_id, workspace_id)
          on eligible.member_id = occurrence.member_id
          and eligible.workspace_id = reminder.workspace_id
        left join crm.member_preferences preference
          on preference.member_id = occurrence.member_id
        left join crm.workspace_settings setting
          on setting.workspace_id = reminder.workspace_id
        where reminder.is_active and reminder.deleted_at is null
          and reminder.recurrence_unit <> 'none'
          and person.archived_at is null and person.deleted_at is null
      `.execute(transaction);
      for (const candidate of candidates.rows) {
        let occurrences: readonly CalendarOccurrence[];
        try {
          occurrences = generateCalendarOccurrences({
            anchorOn: candidate.anchor_on,
            count: 8,
            from: command.now.toISOString(),
            recurrenceInterval: candidate.recurrence_interval,
            recurrenceUnit: candidate.recurrence_unit,
            sendTime: candidate.send_time,
            timezone: candidate.timezone,
          });
        } catch {
          continue;
        }
        const candidateChannels = channels.get(candidate.member_id) ??
          ["in_app"];
        for (const occurrence of occurrences) {
          const deliverAt = leadDeliveryAt(
            occurrence.occursOn,
            candidate.lead_time_days,
            candidate.send_time,
            candidate.timezone,
          );
          // One statement per date, so `both` mints both channels while a
          // date generated earlier on any channel keeps what it has.
          await sql`
            insert into crm.reminder_occurrences (
              reminder_id, member_id, occurs_on, deliver_at, lead_time_days,
              channel, status, title_snapshot, body_snapshot, created_at,
              updated_at
            ) select
              ${candidate.reminder_id}::uuid, ${candidate.member_id}::uuid,
              ${occurrence.occursOn}::date,
              ${deliverAt}::timestamptz, ${candidate.lead_time_days}::int,
              channel, 'pending', ${candidate.title},
              ${`Reminder for ${candidate.title}`}, ${command.now},
              ${command.now}
            from unnest(${candidateChannels}::text[]) as channel
            where not exists (
              select 1 from crm.reminder_occurrences existing
              where existing.reminder_id = ${candidate.reminder_id}::uuid
                and existing.member_id = ${candidate.member_id}::uuid
                and existing.occurs_on = ${occurrence.occursOn}::date
                and coalesce(existing.lead_time_days, -1) =
                  coalesce(${candidate.lead_time_days}::int, -1)
            )
            on conflict do nothing
          `.execute(transaction);
        }
      }
    });
  }

  async claimDue(
    command: Parameters<ReminderDeliveryRepository["claimDue"]>[0],
  ): Promise<readonly ClaimedReminderOccurrence[]> {
    const channels = command.channels ?? ["in_app"];
    // The same set-based question: which members may still be delivered to.
    const candidateMembers = await sql<{ readonly member_id: string }>`
      select distinct occurrence.member_id::text as member_id
      from crm.reminder_occurrences occurrence
      join crm.reminders reminder on reminder.id = occurrence.reminder_id
      where occurrence.channel = any(${channels}::text[])
        and (
          occurrence.status in ('pending','retry','claimed')
          or occurrence.provider_result_state in ('ambiguous','confirmed')
        )
    `.execute(this.database);
    const eligible = await this.recipients.filterEligible({
      memberIds: candidateMembers.rows.map((row) => row.member_id),
      transaction: { opaque: this.database },
    });
    const eligibleMemberIds = eligible.map((row) => row.memberId);
    const eligibleWorkspaceIds = eligible.map((row) => row.workspaceId);
    const recipients = new Map(eligible.map((row) => [row.memberId, row]));
    // A member with a digest time receives their pending email occurrences
    // once the latest local digest time has passed their delivery time.
    const digests = new Map<
      string,
      { readonly cutoff: Date; readonly localDate: string }
    >();
    if (channels.includes("email")) {
      const choices = await choicesOf(
        this.preferences,
        { opaque: this.database },
        eligibleMemberIds,
      );
      for (const [memberId, choice] of choices) {
        if (!choice.digestTime) continue;
        digests.set(
          memberId,
          digestWindow({
            digestTime: choice.digestTime,
            now: command.now,
            ...(choice.timezone ? { timezone: choice.timezone } : {}),
          }),
        );
      }
    }
    const digestMemberIds = [...digests.keys()];
    const digestCutoffs = [...digests.values()].map((digest) =>
      digest.cutoff.toISOString()
    );
    const result = await sql<ClaimRow>`
      with inactive_expired_unattempted as (
        update crm.reminder_occurrences occurrence set
          status = 'cancelled', claim_token = null, claim_owner = null,
          lease_expires_at = null, next_attempt_at = null,
          error = 'definition-inactive-before-effect',
          updated_at = ${command.now}
        from crm.reminders reminder
        where reminder.id = occurrence.reminder_id
          and (not reminder.is_active or reminder.deleted_at is not null)
          and occurrence.status = 'claimed'
          and occurrence.lease_expires_at <= ${command.now}
          and occurrence.provider_result_state = 'unattempted'
          and occurrence.provider_receipt is null
          and occurrence.provider_effect_at is null
          and occurrence.visible_at is null
        returning occurrence.id
      ), due as (
        select occurrence.id, occurrence.member_id
        from crm.reminder_occurrences occurrence
        join crm.reminders reminder on reminder.id = occurrence.reminder_id
        join crm.people person on person.id = reminder.person_id
        join unnest(${eligibleMemberIds}::uuid[], ${eligibleWorkspaceIds}::uuid[])
          as eligible(member_id, workspace_id)
          on eligible.member_id = occurrence.member_id
          and eligible.workspace_id = reminder.workspace_id
        left join unnest(${digestMemberIds}::uuid[], ${digestCutoffs}::timestamptz[])
          as digest(member_id, cutoff)
          on digest.member_id = occurrence.member_id
          and occurrence.channel = 'email'
        where occurrence.channel = any(${channels}::text[])
          and (
            (
              reminder.is_active and reminder.deleted_at is null
              and person.archived_at is null and person.deleted_at is null
              and (
                (occurrence.status in ('pending','retry') and case
                  when occurrence.next_attempt_at is null
                    and digest.cutoff is not null
                  then occurrence.deliver_at <= digest.cutoff
                  else coalesce(occurrence.next_attempt_at, occurrence.deliver_at) <= ${command.now}
                end)
                or (occurrence.status = 'claimed' and occurrence.lease_expires_at <= ${command.now})
              )
            )
            or (
              occurrence.provider_result_state in ('ambiguous','confirmed')
              and (
                (occurrence.status = 'retry' and occurrence.next_attempt_at <= ${command.now})
                or (occurrence.status = 'claimed' and occurrence.lease_expires_at <= ${command.now})
              )
            )
          )
        order by coalesce(occurrence.next_attempt_at, occurrence.deliver_at), occurrence.id
        for update of occurrence skip locked
        limit ${command.limit}
      ), digest_rest as (
        -- The rest of a digest member's due email, so one digest carries all
        -- of it rather than whatever fitted in the batch.
        select occurrence.id
        from crm.reminder_occurrences occurrence
        join crm.reminders reminder on reminder.id = occurrence.reminder_id
        join crm.people person on person.id = reminder.person_id
        join unnest(${eligibleMemberIds}::uuid[], ${eligibleWorkspaceIds}::uuid[])
          as eligible(member_id, workspace_id)
          on eligible.member_id = occurrence.member_id
          and eligible.workspace_id = reminder.workspace_id
        join unnest(${digestMemberIds}::uuid[], ${digestCutoffs}::timestamptz[])
          as digest(member_id, cutoff)
          on digest.member_id = occurrence.member_id
        where occurrence.channel = 'email'
          and occurrence.member_id in (select member_id from due)
          and occurrence.id not in (select id from due)
          and reminder.is_active and reminder.deleted_at is null
          and person.archived_at is null and person.deleted_at is null
          and occurrence.status = 'pending'
          and occurrence.next_attempt_at is null
          and occurrence.deliver_at <= digest.cutoff
        order by occurrence.deliver_at, occurrence.id
        for update of occurrence skip locked
        limit ${DIGEST_CLAIM_LIMIT}
      ), claimable as (
        select id from due union select id from digest_rest
      )
      update crm.reminder_occurrences occurrence set
        status = 'claimed', claim_token = gen_random_uuid(),
        claim_owner = ${command.owner}, lease_expires_at = ${command.leaseExpiresAt},
        attempt_count = occurrence.attempt_count + 1,
        last_attempt_at = ${command.now}, next_attempt_at = null,
        updated_at = ${command.now}
      from claimable, crm.reminders reminder
      where occurrence.id = claimable.id and reminder.id = occurrence.reminder_id
      returning occurrence.id::text, occurrence.member_id::text,
        reminder.person_id::text, reminder.workspace_id::text,
        occurrence.channel, occurrence.claim_token::text,
        occurrence.attempt_count, occurrence.provider_idempotency_key,
        occurrence.provider_result_state, occurrence.title_snapshot as title,
        occurrence.body_snapshot as body,
        case when occurrence.channel = 'email'
            and occurrence.provider_result_state = 'ambiguous'
            and occurrence.provider_receipt like 'digest:%'
          then occurrence.provider_receipt end as attempt_key
    `.execute(this.database);
    return result.rows.map((row) => {
      const email = row.channel === "email";
      const recipientEmail = email
        ? recipients.get(row.member_id)?.verifiedEmail
        : undefined;
      const digestDate = email
        ? digests.get(row.member_id)?.localDate
        : undefined;
      return {
        ...(row.attempt_key ? { attemptKey: row.attempt_key } : {}),
        attemptCount: row.attempt_count,
        body: row.body ?? "",
        channel: row.channel,
        claimToken: row.claim_token,
        ...(digestDate ? { digestDate } : {}),
        id: row.id,
        memberId: row.member_id,
        ...(row.person_id ? { personId: row.person_id } : {}),
        providerIdempotencyKey: row.provider_idempotency_key,
        providerResultState: row.provider_result_state,
        ...(recipientEmail ? { recipientEmail } : {}),
        title: row.title ?? "Reminder",
        workspaceId: row.workspace_id,
      };
    });
  }

  async renewLeases(
    command: Parameters<ReminderAttemptLedger["renewLeases"]>[0],
  ): Promise<readonly string[]> {
    const renewed = await sql<{ readonly id: string }>`
      update crm.reminder_occurrences occurrence set
        lease_expires_at = greatest(
          occurrence.lease_expires_at, ${command.leaseExpiresAt}::timestamptz
        ),
        updated_at = ${command.now}
      from unnest(
        ${command.claims.map((claim) => claim.id)}::uuid[],
        ${command.claims.map((claim) => claim.claimToken)}::uuid[]
      ) as held(id, claim_token)
      where occurrence.id = held.id
        and occurrence.claim_token = held.claim_token
        and occurrence.status = 'claimed'
        and occurrence.lease_expires_at > ${command.now}
      returning occurrence.id::text
    `.execute(this.database);
    return renewed.rows.map((row) => row.id);
  }

  async markAttempted(
    command: Parameters<ReminderAttemptLedger["markAttempted"]>[0],
  ): ReturnType<ReminderAttemptLedger["markAttempted"]> {
    return await this.database.transaction().execute(async (transaction) => {
      // Only claims this worker still holds: same token, still claimed, and
      // a lease that has not run out. Anything else belongs to someone else.
      const held = await sql<{ readonly id: string }>`
        select occurrence.id::text
        from crm.reminder_occurrences occurrence
        join unnest(
          ${command.claims.map((claim) => claim.id)}::uuid[],
          ${command.claims.map((claim) => claim.claimToken)}::uuid[]
        ) as attempt(id, claim_token)
          on occurrence.id = attempt.id
          and occurrence.claim_token = attempt.claim_token
        where occurrence.status = 'claimed'
          and occurrence.lease_expires_at > ${command.now}
          and occurrence.channel = 'email'
          and occurrence.provider_result_state = 'unattempted'
        order by occurrence.id
        for update of occurrence
      `.execute(transaction);
      const recordedIds = held.rows.map((row) => row.id);
      if (recordedIds.length === 0) return { recordedIds };
      // A digest's key covers exactly what is recorded, and is stored on each
      // occurrence as its attempt reference until a receipt replaces it.
      const attemptKey = command.digest
        ? await digestIdempotencyKey({
          ...command.digest,
          occurrenceIds: recordedIds,
        })
        : undefined;
      await sql`
        update crm.reminder_occurrences set
          provider_result_state = 'ambiguous',
          lease_expires_at = ${command.leaseExpiresAt},
          provider_receipt = ${attemptKey ?? null},
          updated_at = ${command.now}
        where id = any(${recordedIds}::uuid[])
      `.execute(transaction);
      return { ...(attemptKey ? { attemptKey } : {}), recordedIds };
    });
  }

  async finalize(
    command: Parameters<ReminderDeliveryRepository["finalize"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly id: string }>`
      update crm.reminder_occurrences occurrence set
        status = ${command.status},
        sent_at = case when ${command.status} = 'sent' then ${command.now} else occurrence.sent_at end,
        provider_effect_at = case when ${command.status} = 'sent'
          then coalesce(occurrence.provider_effect_at, ${command.now})
          else occurrence.provider_effect_at end,
        visible_at = case when ${command.status} = 'sent'
          then coalesce(occurrence.visible_at, ${command.now})
          else occurrence.visible_at end,
        claim_token = null, claim_owner = null, lease_expires_at = null,
        next_attempt_at = ${command.nextAttemptAt ?? null},
        provider_result_state = ${command.providerResultState},
        provider_receipt = case
          when ${command.providerResultState} = 'unattempted' then null
          else coalesce(${
      command.receipt ?? null
    }, occurrence.provider_receipt) end,
        error = ${command.error ?? null}, updated_at = ${command.now}
      where occurrence.id = ${command.id}::uuid
        and occurrence.status = 'claimed'
        and occurrence.claim_token = ${command.claimToken}::uuid
      returning occurrence.id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows.length === 1;
  }
}

export class PostgresInAppReminderEffectStore
  implements InAppReminderEffectStore {
  constructor(
    private readonly database: Kysely<ApplicationDatabase>,
    private readonly clock: Clock,
  ) {}

  async record(command: {
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
  }): Promise<ProviderDeliveryResult> {
    return await this.database.transaction().execute(async (transaction) => {
      const now = this.clock.now();
      const receipt =
        `in_app:${command.idempotencyKey}:${command.occurrenceId}`;
      const result = await sql<{ readonly provider_receipt: string }>`
        update crm.reminder_occurrences occurrence set
          provider_receipt = coalesce(occurrence.provider_receipt, ${receipt}),
          provider_result_state = 'confirmed',
          provider_effect_at = coalesce(occurrence.provider_effect_at, ${now}),
          visible_at = coalesce(occurrence.visible_at, ${now}),
          updated_at = greatest(occurrence.updated_at, ${now})
        where occurrence.id = ${command.occurrenceId}::uuid
          and occurrence.provider_idempotency_key = ${command.idempotencyKey}
          and occurrence.channel = 'in_app'
          and occurrence.provider_result_state in ('unattempted','ambiguous','confirmed')
          and (
            occurrence.status = 'claimed'
            or occurrence.provider_result_state = 'confirmed'
          )
        returning occurrence.provider_receipt
      `.execute(transaction);
      const stored = result.rows[0]?.provider_receipt;
      return stored
        ? { receipt: stored, status: "confirmed" }
        : { code: "in-app-effect-rejected", status: "rejected" };
    });
  }

  async reconcile(command: {
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
  }): Promise<ProviderDeliveryResult> {
    const result = await sql<{
      readonly provider_effect_at: Date | null;
      readonly provider_receipt: string | null;
      readonly visible_at: Date | null;
    }>`
      select provider_receipt, provider_effect_at, visible_at
      from crm.reminder_occurrences
      where id = ${command.occurrenceId}::uuid
        and provider_idempotency_key = ${command.idempotencyKey}
        and channel = 'in_app'
    `.execute(this.database);
    const effect = result.rows[0];
    return effect?.provider_receipt && effect.provider_effect_at &&
        effect.visible_at
      ? { receipt: effect.provider_receipt, status: "confirmed" }
      : { code: "in-app-effect-not-confirmed", status: "transient" };
  }
}

/**
 * When a cadence is next due after its last contact, in the member's zone:
 * the one expression both an interaction and a person merge (GAP-049) move a
 * cadence forward with. It reads `selected.contacted`, `selected.timezone`,
 * and the interval of the row it is written for.
 */
const CADENCE_NEXT_DUE = sql`(
          (selected.contacted at time zone selected.timezone) +
          case selected.interval_unit
            when 'day' then make_interval(days => selected.interval_count)
            when 'week' then make_interval(days => selected.interval_count * 7)
            when 'month' then make_interval(months => selected.interval_count)
            else make_interval(years => selected.interval_count)
          end
        ) at time zone selected.timezone`;

/**
 * A person merge's cadences (GAP-049): the primary keeps its own interval,
 * and when the duplicate was contacted more recently the primary takes that
 * last contact and becomes due again from it, in the acting member's zone,
 * exactly as an interaction would have moved it.
 */
export async function mergeStayInTouchCadences(command: {
  readonly duplicateId: string;
  readonly memberId: string;
  readonly occurredAt: Date;
  readonly primaryId: string;
  readonly transaction: { readonly opaque: unknown };
  readonly workspaceId: string;
}): Promise<void> {
  await sql`
    with context as (
      select coalesce(
        (select preference.timezone from crm.member_preferences preference
          where preference.member_id = ${command.memberId}::uuid),
        (select setting.default_timezone from crm.workspace_settings setting
          where setting.workspace_id = ${command.workspaceId}::uuid),
        'UTC') as timezone
    ), selected as (
      select kept.id, kept.interval_count, kept.interval_unit,
        duplicate.last_contacted_at as contacted, context.timezone
      from crm.stay_in_touch_cadences kept
      join crm.stay_in_touch_cadences duplicate
        on duplicate.person_id = ${command.duplicateId}::uuid
      cross join context
      where kept.person_id = ${command.primaryId}::uuid
        and duplicate.last_contacted_at is not null
        and (kept.last_contacted_at is null
          or duplicate.last_contacted_at > kept.last_contacted_at)
    )
    update crm.stay_in_touch_cadences cadence set
      last_contacted_at = selected.contacted,
      next_due_at = ${CADENCE_NEXT_DUE},
      updated_at = greatest(
        ${command.occurredAt}::timestamptz,
        cadence.updated_at + interval '1 microsecond'
      )
    from selected where cadence.id = selected.id
  `.execute(databaseFromSession(command.transaction));
}
