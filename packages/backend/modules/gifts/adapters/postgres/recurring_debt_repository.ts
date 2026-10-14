import { type ExpressionBuilder, type Selectable, sql } from "kysely";
import type { Database } from "../../../../platform/postgres/database.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { schemaDatabaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantOf } from "../../../../platform/postgres/timestamps.ts";
import type { DebtDirection } from "../../domain/gift_rules.ts";
import {
  RECURRING_DEBT_LIMIT,
  type StoredRecurringDebt,
} from "../../domain/recurring_debts.ts";
import type { RecurringDebtRepository } from "../../ports/recurring_debt_repository.ts";
import {
  chargeablePerson,
  debt,
  debtColumns,
  type DebtVocabulary,
  personStatus,
} from "./gift_repository.ts";

/*
 * Every query here is built against the generated `Database`, so `deno check`
 * holds each table, column, and written value to the canonical DDL. Whether a
 * person is live is asked through the gift repository's helpers, the one
 * place this module reads the people it records money for.
 */

interface RuleRow {
  readonly amount: string;
  readonly created_at: string;
  readonly currency_code: string;
  readonly day_of_month: number;
  readonly direction: DebtDirection;
  readonly ends_on: string | null;
  readonly id: string;
  readonly interval_months: number;
  readonly is_active: boolean;
  readonly next_occurrence_on: string | null;
  readonly person_id: string;
  readonly reason: string | null;
  readonly starts_on: string;
  readonly updated_at: string;
}

type RuleSource = Selectable<Database["crm.recurring_debts"]>;

/** The projection every rule query returns, one column per `RuleRow` field. */
function ruleColumns<DB extends { rule: RuleSource }>(
  eb: ExpressionBuilder<DB, "rule">,
) {
  return [
    eb.cast<string>(eb.ref("rule.id"), "text").as("id"),
    eb.cast<string>(eb.ref("rule.person_id"), "text").as("person_id"),
    eb.ref("rule.direction").as("direction"),
    eb.cast<string>(eb.ref("rule.amount"), "text").as("amount"),
    eb.cast<string>(eb.ref("rule.currency_code"), "text").as("currency_code"),
    eb.ref("rule.reason").as("reason"),
    eb.ref("rule.interval_months").as("interval_months"),
    eb.ref("rule.day_of_month").as("day_of_month"),
    eb.cast<string>(eb.ref("rule.starts_on"), "text").as("starts_on"),
    eb.cast<string | null>(eb.ref("rule.ends_on"), "text").as("ends_on"),
    eb.ref("rule.is_active").as("is_active"),
    eb.cast<string | null>(eb.ref("rule.next_occurrence_on"), "text")
      .as("next_occurrence_on"),
    instantOf(eb.ref("rule.created_at")).as("created_at"),
    instantOf(eb.ref("rule.updated_at")).as("updated_at"),
  ];
}

/** The text column the schema constrains to the domain's vocabulary. */
type RuleVocabulary = { readonly direction: DebtDirection };

function rule(row: RuleRow): StoredRecurringDebt {
  return {
    active: row.is_active,
    amount: row.amount,
    createdAt: row.created_at,
    currencyCode: row.currency_code,
    dayOfMonth: row.day_of_month,
    direction: row.direction,
    ...pickDefined({ endsOn: row.ends_on }),
    id: row.id,
    intervalMonths: row.interval_months,
    ...pickDefined({ nextOccurrenceOn: row.next_occurrence_on }),
    personId: row.person_id,
    ...pickDefined({ reason: row.reason }),
    startsOn: row.starts_on,
    updatedAt: row.updated_at,
  };
}

/** The failure a write reports when its person is not an active one. */
function personFailure(status: "archived" | "not-found") {
  return {
    status: status === "archived"
      ? "archived-write-rejected" as const
      : "not-found" as const,
  };
}

export class PostgresRecurringDebtRepository
  implements RecurringDebtRepository {
  async listForPerson(
    command: Parameters<RecurringDebtRepository["listForPerson"]>[0],
  ): Promise<Awaited<ReturnType<RecurringDebtRepository["listForPerson"]>>> {
    const rows = await schemaDatabaseFromSession(command.transaction)
      .selectFrom("crm.recurring_debts as rule")
      .select(ruleColumns)
      .$narrowType<RuleVocabulary>()
      .where("rule.workspace_id", "=", command.workspaceId)
      .where("rule.person_id", "=", command.personId)
      .orderBy("rule.created_at")
      .orderBy("rule.id")
      .limit(RECURRING_DEBT_LIMIT)
      .execute();
    return rows.map(rule);
  }

  async create(
    command: Parameters<RecurringDebtRepository["create"]>[0],
  ): Promise<Awaited<ReturnType<RecurringDebtRepository["create"]>>> {
    const status = await personStatus({ ...command, lock: true });
    if (status !== "active") return personFailure(status);
    const row = await schemaDatabaseFromSession(command.transaction)
      .with(
        "inserted",
        (database) =>
          database.insertInto("crm.recurring_debts").values({
            amount: command.amount,
            created_at: command.occurredAt,
            created_by_member_id: command.memberId,
            currency_code: command.currencyCode,
            day_of_month: command.dayOfMonth,
            direction: command.direction,
            ends_on: command.endsOn ?? null,
            id: command.id,
            interval_months: command.intervalMonths,
            next_occurrence_on: command.nextOccurrenceOn ?? null,
            person_id: command.personId,
            reason: command.reason ?? null,
            starts_on: command.startsOn,
            updated_at: command.occurredAt,
            workspace_id: command.workspaceId,
          }).returningAll(),
      )
      .selectFrom("inserted as rule")
      .select(ruleColumns)
      .$narrowType<RuleVocabulary>()
      .executeTakeFirst();
    return row
      ? { recurringDebt: rule(row), status: "created" }
      : { status: "not-found" };
  }

  async find(
    command: Parameters<RecurringDebtRepository["find"]>[0],
  ): Promise<Awaited<ReturnType<RecurringDebtRepository["find"]>>> {
    const status = await personStatus({ ...command, lock: true });
    if (status !== "active") return personFailure(status);
    const database = schemaDatabaseFromSession(command.transaction);
    const row = await database
      .selectFrom("crm.recurring_debts as rule")
      .select(ruleColumns)
      .$narrowType<RuleVocabulary>()
      .where("rule.workspace_id", "=", command.workspaceId)
      .where("rule.person_id", "=", command.personId)
      .where("rule.id", "=", command.id)
      .forUpdate("rule")
      .executeTakeFirst();
    if (!row) return { status: "not-found" };
    const last = await database
      .selectFrom("crm.debts as debt")
      .select((eb) =>
        eb.cast<string | null>(eb.fn.max("debt.occurrence_on"), "text").as(
          "last",
        )
      )
      .where("debt.workspace_id", "=", command.workspaceId)
      .where("debt.recurring_debt_id", "=", command.id)
      .executeTakeFirst();
    return {
      ...pickDefined({ lastChargedOn: last?.last }),
      recurringDebt: rule(row),
      status: "found",
    };
  }

  async save(
    command: Parameters<RecurringDebtRepository["save"]>[0],
  ): Promise<Awaited<ReturnType<RecurringDebtRepository["save"]>>> {
    const row = await schemaDatabaseFromSession(command.transaction)
      .with("updated", (database) =>
        database.updateTable("crm.recurring_debts")
          .set({
            amount: command.amount,
            currency_code: command.currencyCode,
            day_of_month: command.dayOfMonth,
            direction: command.direction,
            ends_on: command.endsOn ?? null,
            interval_months: command.intervalMonths,
            is_active: command.active,
            next_occurrence_on: command.nextOccurrenceOn ?? null,
            reason: command.reason ?? null,
            starts_on: command.startsOn,
            updated_at: command.occurredAt,
          })
          .where("id", "=", command.id)
          .where("workspace_id", "=", command.workspaceId)
          .where("person_id", "=", command.personId)
          .returningAll())
      .selectFrom("updated as rule")
      .select(ruleColumns)
      .$narrowType<RuleVocabulary>()
      .executeTakeFirst();
    return row
      ? { recurringDebt: rule(row), status: "saved" }
      : { status: "not-found" };
  }

  async remove(
    command: Parameters<RecurringDebtRepository["remove"]>[0],
  ): Promise<boolean> {
    const removed = await schemaDatabaseFromSession(command.transaction)
      .deleteFrom("crm.recurring_debts")
      .where("id", "=", command.id)
      .where("workspace_id", "=", command.workspaceId)
      .where("person_id", "=", command.personId)
      .executeTakeFirst();
    return removed.numDeletedRows > 0n;
  }

  async listDue(
    command: Parameters<RecurringDebtRepository["listDue"]>[0],
  ): Promise<readonly string[]> {
    const rows = await schemaDatabaseFromSession(command.transaction)
      .selectFrom("crm.recurring_debts as rule")
      .select((eb) => eb.cast<string>(eb.ref("rule.id"), "text").as("id"))
      .where("rule.is_active", "=", true)
      .where("rule.next_occurrence_on", "is not", null)
      .where(
        "rule.next_occurrence_on",
        "<=",
        sql<Date>`${command.through}::date`,
      )
      .where(chargeablePerson("rule.person_id", "rule.workspace_id"))
      .orderBy("rule.next_occurrence_on")
      .orderBy("rule.id")
      .limit(command.limit)
      .execute();
    return rows.map((row) => row.id);
  }

  async claim(
    command: Parameters<RecurringDebtRepository["claim"]>[0],
  ): Promise<Awaited<ReturnType<RecurringDebtRepository["claim"]>>> {
    const row = await schemaDatabaseFromSession(command.transaction)
      .selectFrom("crm.recurring_debts as rule")
      .select(ruleColumns)
      .select((eb) =>
        eb.cast<string>(eb.ref("rule.workspace_id"), "text").as("workspace_id")
      )
      .$narrowType<RuleVocabulary>()
      .where("rule.id", "=", command.id)
      .where("rule.is_active", "=", true)
      .where("rule.next_occurrence_on", "is not", null)
      .where(chargeablePerson("rule.person_id", "rule.workspace_id"))
      .forUpdate("rule")
      .skipLocked()
      .executeTakeFirst();
    return row
      ? { recurringDebt: rule(row), workspaceId: row.workspace_id }
      : undefined;
  }

  async charge(
    command: Parameters<RecurringDebtRepository["charge"]>[0],
  ): Promise<Awaited<ReturnType<RecurringDebtRepository["charge"]>>> {
    if (command.dates.length === 0) return [];
    const source = command.recurringDebt;
    const database = schemaDatabaseFromSession(command.transaction);
    // The caller holds the rule lock throughout charging. Skip its existing
    // charged months even when a schedule edit changed the due day.
    const months = command.dates.map((date) => date.slice(0, 7));
    const existing = await database.selectFrom("crm.debts as debt")
      .select(sql<string>`to_char(debt.occurrence_on, 'YYYY-MM')`.as("month"))
      .where("debt.workspace_id", "=", command.workspaceId)
      .where("debt.recurring_debt_id", "=", source.id)
      .where(sql<string>`to_char(debt.occurrence_on, 'YYYY-MM')`, "in", months)
      .distinct()
      .execute();
    const chargedMonths = new Set(existing.map((row) => row.month));
    const pending = command.dates.map((date, index) => ({
      date,
      id: command.ids[index]!,
    })).filter(({ date }) => !chargedMonths.has(date.slice(0, 7)));
    if (pending.length === 0) return [];
    const rows = await database
      .with("inserted", (database) =>
        database.insertInto("crm.debts").values(
          pending.map(({ date, id }) => ({
            amount: source.amount,
            created_at: command.occurredAt,
            currency_code: source.currencyCode,
            direction: source.direction,
            id,
            occurrence_on: date,
            person_id: source.personId,
            reason: source.reason ?? null,
            recurring_debt_id: source.id,
            status: "open",
            updated_at: command.occurredAt,
            workspace_id: command.workspaceId,
          })),
        ).onConflict((conflict) =>
          conflict.columns(["recurring_debt_id", "occurrence_on"]).doNothing()
        ).returningAll())
      .selectFrom("inserted as debt")
      .select(debtColumns)
      .$narrowType<DebtVocabulary>()
      .orderBy("debt.occurrence_on")
      .execute();
    return rows.map(debt);
  }

  async advance(
    command: Parameters<RecurringDebtRepository["advance"]>[0],
  ): Promise<void> {
    await schemaDatabaseFromSession(command.transaction)
      .updateTable("crm.recurring_debts")
      .set({ next_occurrence_on: command.nextOccurrenceOn ?? null })
      .where("id", "=", command.id)
      .where("workspace_id", "=", command.workspaceId)
      .execute();
  }
}
