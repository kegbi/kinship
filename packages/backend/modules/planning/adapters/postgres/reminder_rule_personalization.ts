import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { refreshLeadNotices } from "./reminder_repository.ts";
import {
  UNIQUE_CONFLICT,
  writeWithUniqueConflict,
} from "../../../../platform/postgres/transactions.ts";
import type {
  ReminderRulePersonalizationCommand,
  ReminderRulePersonalizationFacade,
} from "../../application/reminder_rule_personalization.ts";

interface ReminderRuleRow {
  readonly daysBefore: number;
  readonly id: string;
  readonly isActive: boolean;
  readonly updatedAt: string;
}

function label(daysBefore: number): string {
  if (daysBefore === 0) return "On the day";
  return `${daysBefore} ${daysBefore === 1 ? "day" : "days"} before`;
}

function entry(row: ReminderRuleRow) {
  return {
    capabilities: {
      delete: true,
      disable: true,
      editValue: true,
      rename: false,
      reorder: false,
      replace: false,
      setDefault: false,
    },
    canDelete: true,
    daysBefore: row.daysBefore,
    id: row.id,
    isActive: row.isActive,
    isDefault: false,
    kind: "reminder-rule" as const,
    name: label(row.daysBefore),
    readOnly: false,
    referenceCount: 0,
    sortOrder: row.daysBefore,
    updatedAt: row.updatedAt.replace(" ", "T").replace(/\+00$/, "Z"),
  };
}

const SAVEPOINT = "planning_reminder_rule_personalization_write";

async function find(
  command: ReminderRulePersonalizationCommand & { readonly id: string },
  lock = false,
) {
  const lockClause = lock ? sql`for update` : sql``;
  const result = await sql<
    ReminderRuleRow
  >`select id::text, days_before::int as "daysBefore",
    is_active as "isActive", updated_at::text as "updatedAt" from crm.reminder_rules
    where id = ${command.id}::uuid and workspace_id = ${command.workspaceId}::uuid
    ${lockClause}`
    .execute(databaseFromSession(command.transaction));
  return result.rows[0];
}

export class PostgresReminderRulePersonalization
  implements ReminderRulePersonalizationFacade {
  async list(command: ReminderRulePersonalizationCommand): Promise<unknown> {
    if (command.section !== "reminder-rules") return { status: "unavailable" };
    const result = await sql<
      ReminderRuleRow
    >`select id::text, days_before::int as "daysBefore",
      is_active as "isActive", updated_at::text as "updatedAt" from crm.reminder_rules
      where workspace_id = ${command.workspaceId}::uuid order by days_before, id`
      .execute(databaseFromSession(command.transaction));
    return {
      capabilities: { create: true, editValue: true },
      entries: result.rows.map(entry),
      readOnly: false,
      status: "ready",
    };
  }

  async inspect(command: ReminderRulePersonalizationCommand): Promise<unknown> {
    if (command.section !== "reminder-rules") return { status: "unavailable" };
    if (!command.id) return { status: "not-found" };
    const row = await find({ ...command, id: command.id });
    return row
      ? { entry: entry(row), status: "ready" }
      : { status: "not-found" };
  }

  async mutate(command: ReminderRulePersonalizationCommand): Promise<unknown> {
    if (command.section !== "reminder-rules") return { status: "invalid" };
    const database = databaseFromSession(command.transaction);
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.workspaceId}, 31))`
      .execute(database);
    if (command.action === "create" && command.daysBefore !== undefined) {
      const created = await writeWithUniqueConflict(
        database,
        SAVEPOINT,
        () =>
          sql<ReminderRuleRow>`insert into crm.reminder_rules
            (workspace_id, days_before) values (${command.workspaceId}::uuid, ${command.daysBefore})
            returning id::text, days_before::int as "daysBefore", is_active as "isActive",
              updated_at::text as "updatedAt"`.execute(database),
      );
      if (created === UNIQUE_CONFLICT) return { status: "conflict" };
      const row = created.rows[0];
      if (!row) return { status: "conflict" };
      await refreshLeadNotices(command.transaction, command.workspaceId);
      return { entry: entry(row), status: "saved" };
    }
    if (!command.id || !command.expectedUpdatedAt) return { status: "invalid" };
    const row = await find({ ...command, id: command.id }, true);
    if (!row) return { status: "not-found" };
    if (entry(row).updatedAt !== command.expectedUpdatedAt) {
      return { status: "stale" };
    }
    if (command.action === "delete") {
      await sql`delete from crm.reminder_rules where id = ${command.id}::uuid
        and workspace_id = ${command.workspaceId}::uuid`.execute(database);
      await refreshLeadNotices(command.transaction, command.workspaceId);
      return { id: command.id, status: "deleted" };
    }
    const daysBefore = command.daysBefore ?? row.daysBefore;
    const isActive = command.isActive ?? row.isActive;
    const updated = await writeWithUniqueConflict(
      database,
      SAVEPOINT,
      () =>
        sql<ReminderRuleRow>`update crm.reminder_rules
          set days_before = ${daysBefore}, is_active = ${isActive}, updated_at = now()
          where id = ${command.id}::uuid and workspace_id = ${command.workspaceId}::uuid
            and not exists(select 1 from crm.reminder_rules other
              where other.workspace_id = ${command.workspaceId}::uuid
                and other.days_before = ${daysBefore} and other.id <> ${command.id}::uuid)
          returning id::text, days_before::int as "daysBefore", is_active as "isActive",
            updated_at::text as "updatedAt"`.execute(database),
    );
    if (updated === UNIQUE_CONFLICT) return { status: "conflict" };
    const value = updated.rows[0];
    if (!value) return { status: "conflict" };
    // A rule's notices follow it at once, not at the worker's next hourly
    // replenishment (AUD-W1).
    await refreshLeadNotices(command.transaction, command.workspaceId);
    return { entry: entry(value), status: "saved" };
  }
}
