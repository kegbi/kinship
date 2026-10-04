import type { ImportedPersonReference } from "../../../people/public.ts";
import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PlanningBusinessImportBoundary } from "../../application/business_import_boundary.ts";
import {
  generateCalendarOccurrences,
  type RecurrenceUnit,
} from "../../domain/recurrence.ts";
import type {
  ReminderDeliveryPreferences,
  ReminderRecipients,
} from "../../ports/reminder_repository.ts";
import {
  leadDeliveryAt,
  PostgresReminderWorkspaceBoundary,
  recipientChannels,
} from "./reminder_repository.ts";
export class PostgresPlanningBusinessImportBoundary
  implements PlanningBusinessImportBoundary {
  async assertReminder(
    c: {
      readonly workspaceId: string;
      readonly reminderId: string;
      readonly transaction: { readonly opaque: unknown };
    },
  ): Promise<boolean> {
    const result =
      await sql`select id from crm.reminders where id=${c.reminderId}::uuid and workspace_id=${c.workspaceId}::uuid`
        .execute(databaseFromSession(c.transaction));
    return result.rows.length === 1;
  }
  constructor(
    private readonly recipients: ReminderRecipients,
    private readonly preferences: ReminderDeliveryPreferences,
    private readonly people: ImportedPersonReference,
    private readonly dateBelongsToPerson: (
      c: {
        id: string;
        personId: string;
        workspaceId: string;
        transaction: { readonly opaque: unknown };
      },
    ) => Promise<boolean>,
  ) {}
  async importRecords(
    c: Parameters<PlanningBusinessImportBoundary["importRecords"]>[0],
  ) {
    const db = databaseFromSession(c.transaction),
      retarget: Record<string, string> = {};
    for (const r of c.records) {
      const d = r.data, p = r.references;
      if (
        p.personId &&
        (await this.people.existsForImport({
            ...c.actor,
            personIds: [p.personId],
            transaction: c.transaction,
          })) === false
      ) throw new Error("Imported person reference is outside the workspace.");
      if (
        p.dateId &&
        (!p.personId ||
          !await this.dateBelongsToPerson({
            id: p.dateId,
            personId: p.personId,
            workspaceId: c.actor.workspaceId,
            transaction: c.transaction,
          }))
      ) throw new Error("Imported date reference is outside the workspace.");
      if (d.kind === "rule") {
        await sql`insert into crm.reminder_rules(id,workspace_id,days_before,is_active,created_at,updated_at) values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${d.daysBefore},${d.isActive},coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict (workspace_id,days_before) do update set is_active=excluded.is_active,created_at=excluded.created_at,updated_at=excluded.updated_at`
          .execute(db);
        const actual = await sql<
          { id: string }
        >`select id::text from crm.reminder_rules where workspace_id=${c.actor.workspaceId}::uuid and days_before=${d.daysBefore}`
          .execute(db);
        if (actual.rows[0]) retarget[r.id] = actual.rows[0].id;
      } else if (d.kind === "cadence") {
        await sql`insert into crm.stay_in_touch_cadences(id,person_id,interval_count,interval_unit,next_due_at,last_contacted_at,is_active,created_at,updated_at) values(${r.id}::uuid,${p.personId}::uuid,${d.intervalCount},'day',${d.nextDueAt}::timestamptz,${d.lastContactedAt}::timestamptz,${d.isActive},coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else if (d.kind === "reminder") {
        let reminderId = r.id;
        let existingReminder = false;
        if (p.dateId) {
          const existing = await sql<
            { id: string }
          >`select id::text from crm.reminders where workspace_id=${c.actor.workspaceId}::uuid and person_date_id=${p.dateId}::uuid order by created_at,id limit 1 for update`
            .execute(db);
          if (existing.rows[0]) {
            reminderId = existing.rows[0].id;
            existingReminder = true;
            retarget[r.id] = reminderId;
            await sql`update crm.reminders set title=${d.title},description=${d.description},anchor_on=${d.anchorOn}::date,recurrence_unit=${d.recurrenceUnit},recurrence_interval=${d.recurrenceInterval},send_time=${d.sendTime}::time,is_active=${d.isActive},can_delete=${d.canDelete},deleted_at=${d.deletedAt}::timestamptz,created_at=coalesce(${d.createdAt}::timestamptz,created_at),updated_at=coalesce(${d.updatedAt}::timestamptz,updated_at),created_by_member_id=null where id=${reminderId}::uuid`
              .execute(db);
            if (!d.isActive || d.deletedAt) {
              await sql`update crm.reminder_occurrences set status='cancelled',updated_at=now() where reminder_id=${reminderId}::uuid and status='pending'`
                .execute(db);
            }
            if (d.isActive && !d.deletedAt) {
              // Replace only future work whose delivery has never started.
              // Sent and attempted rows remain immutable historical evidence.
              await sql`delete from crm.reminder_occurrences where reminder_id=${reminderId}::uuid and status in ('pending','cancelled') and attempt_count=0 and provider_result_state='unattempted' and deliver_at>now()`
                .execute(db);
              await sql`update crm.reminder_occurrences set status='cancelled',updated_at=now() where reminder_id=${reminderId}::uuid and status='pending' and attempt_count=0 and provider_result_state='unattempted' and deliver_at<=now()`
                .execute(db);
            }
          }
        }
        const inserted = existingReminder
          ? { rows: [{ id: reminderId }] }
          : await sql<
            { id: string }
          >`insert into crm.reminders(id,workspace_id,person_id,person_date_id,target_kind,title,description,anchor_on,recurrence_unit,recurrence_interval,send_time,is_active,can_delete,deleted_at,created_by_member_id,created_at,updated_at) values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${
            p.personId ?? null
          }::uuid,${p.dateId ?? null}::uuid,${
            p.dateId ? "person_date" : p.personId ? "person" : "custom"
          },${d.title},${d.description},${d.anchorOn}::date,${d.recurrenceUnit},${d.recurrenceInterval},${d.sendTime}::time,${d.isActive},${d.canDelete},${d.deletedAt}::timestamptz,null,coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing returning id::text`
            .execute(db);
        if (!inserted.rows.length || !d.isActive || d.deletedAt) continue;
        const recipients = existingReminder
          ? await this.recipients.listEligible({
            workspaceId: c.actor.workspaceId,
            transaction: c.transaction,
          })
          : await this.recipients.filterEligible({
            memberIds: [c.actor.memberId],
            transaction: c.transaction,
          });
        const rules = p.dateId
          ? (await sql<
            { days_before: number }
          >`select days_before from crm.reminder_rules where workspace_id=${c.actor.workspaceId}::uuid and is_active order by days_before`
            .execute(db)).rows.map((row) => row.days_before)
          : [];
        const leadTimes: readonly (number | null)[] = p.dateId
          ? (rules.length ? rules : [0])
          : [null];
        const channels = await recipientChannels(
          this.preferences,
          c.transaction,
          recipients,
        );
        const now = new Date();
        for (const recipient of recipients) {
          const zone = await new PostgresReminderWorkspaceBoundary()
            .effectiveTimezone({
              ...c.actor,
              memberId: recipient.memberId,
              workspaceId: recipient.workspaceId,
              transaction: c.transaction,
            });
          if (zone.status !== "ready") {
            throw new Error("Import reminder timezone is unavailable.");
          }
          const timezone = zone.timezone;
          const occurrences = generateCalendarOccurrences({
            anchorOn: String(d.anchorOn),
            recurrenceUnit: d.recurrenceUnit as RecurrenceUnit,
            recurrenceInterval: Number(d.recurrenceInterval),
            sendTime: typeof d.sendTime === "string" ? d.sendTime : "12:00",
            timezone,
            from: now.toISOString(),
            count: 8,
          });
          for (const occurrence of occurrences) {
            for (const leadTime of leadTimes) {
              const deliverAt = leadDeliveryAt(
                occurrence.occursOn,
                leadTime,
                typeof d.sendTime === "string" ? d.sendTime : "12:00",
                timezone,
              );
              if (Date.parse(deliverAt) <= now.valueOf()) continue;
              for (
                const channel of channels.get(recipient.memberId) ?? ["in_app"]
              ) {
                await sql`insert into crm.reminder_occurrences(reminder_id,member_id,occurs_on,deliver_at,lead_time_days,channel,status,title_snapshot,created_at,updated_at) values(${reminderId}::uuid,${recipient.memberId}::uuid,${occurrence.occursOn}::date,${deliverAt}::timestamptz,${leadTime}::int,${channel},'pending',${d.title},${now},${now}) on conflict do nothing`
                  .execute(db);
              }
            }
          }
        }
      }
    }
    return retarget;
  }
}
