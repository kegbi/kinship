/**
 * Recurring debts: the member's rules, and the worker that charges them.
 *
 * A member creates, changes, pauses, resumes, and deletes a person's rules the
 * way they record a debt — the actor's standing first, under lock, then the
 * currency, then the write and its audit. Whenever a write leaves an active
 * rule with periods already due, those periods are charged in the same
 * transaction, which is how a rule that starts in the past catches up at once
 * instead of waiting for the worker.
 *
 * The worker charges every other period. It has no actor: it lists the rules
 * that may be due, then claims and charges each one in a transaction of its
 * own, so one rule that fails never stops the rest, and a rule another worker
 * holds is skipped rather than waited for. A period is charged through the
 * one-debt-per-period key, so a run that is retried, or that overlaps a
 * member's edit, never charges a period twice; a worker that was down simply
 * finds more periods due when it comes back.
 *
 * "Due" is the workspace's calendar date, never the server's.
 */

import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import type { StoredDebt } from "../domain/gift_rules.ts";
import {
  changedNextOccurrence,
  type CreateRecurringDebtInput,
  dueOccurrences,
  firstOccurrenceOnOrAfter,
  localDate,
  MAXIMUM_OCCURRENCES_PER_RUN,
  mergeRecurringDebtChange,
  normalizeRecurringDebt,
  RECURRING_DEBT_LIMIT,
  type RecurringDebtChange,
  type RecurringDebtRecord,
  type RecurringDebtSchedule,
  resumedNextOccurrence,
  type StoredRecurringDebt,
} from "../domain/recurring_debts.ts";
import type { GiftActor, GiftTransaction } from "../ports/context.ts";
import {
  active,
  type GiftManagementDependencies,
  type GiftMutationFailure,
} from "./gift_context.ts";

/** The time zone a workspace without one schedules in. */
const FALLBACK_TIMEZONE = "UTC";
/** How far ahead of UTC any time zone's calendar runs: UTC+14. */
const WIDEST_OFFSET_MILLISECONDS = 14 * 60 * 60 * 1000;
/** The rules one worker run looks at. */
export const RECURRING_DEBT_BATCH = 100;

type ChargingDependencies = Pick<
  GiftManagementDependencies,
  "audit" | "calendar" | "clock" | "ids" | "recurringDebts" | "transaction"
>;

/** The calendar date it is in the workspace now. */
async function todayIn(
  dependencies: Pick<GiftManagementDependencies, "calendar">,
  workspaceId: string,
  now: Date,
  transaction: GiftTransaction,
): Promise<string> {
  const zones = await dependencies.calendar.timezones({
    transaction,
    workspaceIds: [workspaceId],
  });
  return localDate(now, zones.get(workspaceId) ?? FALLBACK_TIMEZONE);
}

/**
 * Charges every period of `rule` due by `today` and moves its next period on.
 * A paused or finished rule charges nothing.
 */
async function chargeDue(
  dependencies: ChargingDependencies,
  rule: StoredRecurringDebt,
  workspaceId: string,
  today: string,
  occurredAt: Date,
  transaction: GiftTransaction,
): Promise<{
  readonly debts: readonly StoredDebt[];
  readonly recurringDebt: StoredRecurringDebt;
}> {
  if (!rule.active || rule.nextOccurrenceOn === undefined) {
    return { debts: [], recurringDebt: rule };
  }
  const due = dueOccurrences(
    rule,
    rule.nextOccurrenceOn,
    today,
    MAXIMUM_OCCURRENCES_PER_RUN,
  );
  if (due.next === rule.nextOccurrenceOn) {
    return { debts: [], recurringDebt: rule };
  }
  const debts = due.dates.length === 0
    ? []
    : await dependencies.recurringDebts.charge({
      dates: due.dates,
      ids: due.dates.map(() => dependencies.ids.next()),
      occurredAt,
      recurringDebt: rule,
      transaction,
      workspaceId,
    });
  await dependencies.recurringDebts.advance({
    id: rule.id,
    ...(due.next ? { nextOccurrenceOn: due.next } : {}),
    transaction,
    workspaceId,
  });
  const { nextOccurrenceOn: _previous, ...rest } = rule;
  return {
    debts,
    recurringDebt: due.next ? { ...rest, nextOccurrenceOn: due.next } : rest,
  };
}

/** Whether a change moved when the rule's periods fall due. */
function scheduleChanged(
  current: RecurringDebtSchedule,
  next: RecurringDebtSchedule,
): boolean {
  return current.dayOfMonth !== next.dayOfMonth ||
    current.intervalMonths !== next.intervalMonths ||
    current.startsOn !== next.startsOn || current.endsOn !== next.endsOn;
}

export function createRecurringDebtWrites(
  dependencies: GiftManagementDependencies,
) {
  /** Charges what a member's write left due, auditing each debt as theirs. */
  const chargeForMember = async (
    actor: GiftActor,
    rule: StoredRecurringDebt,
    occurredAt: Date,
    transaction: GiftTransaction,
  ) => {
    const today = await todayIn(
      dependencies,
      actor.workspaceId,
      occurredAt,
      transaction,
    );
    const charged = await chargeDue(
      dependencies,
      rule,
      actor.workspaceId,
      today,
      occurredAt,
      transaction,
    );
    for (const debt of charged.debts) {
      await dependencies.audit.record({
        action: "created",
        actor,
        occurredAt,
        record: debt,
        recordType: "debt",
        transaction,
      });
    }
    return charged;
  };

  return {
    createRecurringDebt: async (
      actor: GiftActor,
      personId: string,
      input: CreateRecurringDebtInput,
    ): Promise<
      | {
        readonly charged: number;
        readonly recurringDebt: RecurringDebtRecord;
        readonly status: "created";
      }
      | GiftMutationFailure
    > => {
      const values = normalizeRecurringDebt(input);
      if (!values) return { status: "validation-error" };
      const occurredAt = dependencies.clock.now();
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          if (
            !await dependencies.currencies.isSupported({
              code: values.currencyCode,
              transaction,
            })
          ) return { status: "validation-error" as const };
          const existing = await dependencies.recurringDebts.listForPerson({
            ...actor,
            personId,
            transaction,
          });
          if (existing.length >= RECURRING_DEBT_LIMIT) {
            return { status: "limit-reached" as const };
          }
          const next = firstOccurrenceOnOrAfter(values, values.startsOn);
          const created = await dependencies.recurringDebts.create({
            ...actor,
            ...values,
            id: dependencies.ids.next(),
            ...(next ? { nextOccurrenceOn: next } : {}),
            occurredAt,
            personId,
            transaction,
          });
          if (created.status !== "created") return created;
          await dependencies.audit.record({
            action: "created",
            actor,
            occurredAt,
            record: created.recurringDebt,
            recordType: "recurring-debt",
            transaction,
          });
          const charged = await chargeForMember(
            actor,
            created.recurringDebt,
            occurredAt,
            transaction,
          );
          return {
            charged: charged.debts.length,
            recurringDebt: charged.recurringDebt,
            status: "created" as const,
          };
        },
      );
    },

    changeRecurringDebt: async (
      actor: GiftActor,
      personId: string,
      id: string,
      change: RecurringDebtChange,
    ): Promise<
      | {
        readonly charged: number;
        readonly recurringDebt: RecurringDebtRecord;
        readonly status: "saved";
      }
      | GiftMutationFailure
    > => {
      const occurredAt = dependencies.clock.now();
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const found = await dependencies.recurringDebts.find({
            ...actor,
            id,
            personId,
            transaction,
          });
          if (found.status !== "found") return found;
          const current = found.recurringDebt;
          const values = mergeRecurringDebtChange(current, change);
          if (!values) return { status: "validation-error" as const };
          if (
            values.currencyCode !== current.currencyCode &&
            !await dependencies.currencies.isSupported({
              code: values.currencyCode,
              transaction,
            })
          ) return { status: "validation-error" as const };
          const next = values.active && !current.active
            ? resumedNextOccurrence(
              values,
              await todayIn(
                dependencies,
                actor.workspaceId,
                occurredAt,
                transaction,
              ),
              found.lastChargedOn,
            )
            : scheduleChanged(current, values)
            ? changedNextOccurrence(current, values, found.lastChargedOn)
            : current.nextOccurrenceOn;
          const saved = await dependencies.recurringDebts.save({
            ...actor,
            ...values,
            id,
            ...(next ? { nextOccurrenceOn: next } : {}),
            occurredAt,
            personId,
            transaction,
          });
          if (saved.status !== "saved") return saved;
          await dependencies.audit.record({
            action: "changed",
            actor,
            occurredAt,
            record: saved.recurringDebt,
            recordType: "recurring-debt",
            transaction,
          });
          const charged = await chargeForMember(
            actor,
            saved.recurringDebt,
            occurredAt,
            transaction,
          );
          return {
            charged: charged.debts.length,
            recurringDebt: charged.recurringDebt,
            status: "saved" as const,
          };
        },
      );
    },

    deleteRecurringDebt: async (
      actor: GiftActor,
      personId: string,
      id: string,
    ): Promise<
      | { readonly recurringDebtId: string; readonly status: "deleted" }
      | GiftMutationFailure
    > => {
      const occurredAt = dependencies.clock.now();
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const found = await dependencies.recurringDebts.find({
            ...actor,
            id,
            personId,
            transaction,
          });
          if (found.status !== "found") return found;
          if (
            !await dependencies.recurringDebts.remove({
              ...actor,
              id,
              personId,
              transaction,
            })
          ) return { status: "not-found" as const };
          await dependencies.audit.record({
            action: "deleted",
            actor,
            occurredAt,
            record: found.recurringDebt,
            recordType: "recurring-debt",
            transaction,
          });
          return { recurringDebtId: id, status: "deleted" as const };
        },
      );
    },
  };
}

/** What one worker run did. */
export interface RecurringDebtRun {
  /** Debts charged across every rule. */
  readonly charged: number;
  /** Rules whose transaction failed; each is retried on a later run. */
  readonly failed: number;
  /** Rules the run looked at. */
  readonly rules: number;
}

/**
 * The worker's half: charge every rule whose periods have fallen due in its
 * workspace. Each rule is claimed and charged in a transaction of its own.
 */
export function createRecurringDebtCharging(
  dependencies: ChargingDependencies,
) {
  return {
    chargeDue: async (
      options: {
        readonly limit?: number;
        readonly requestId?: string;
      } = {},
    ): Promise<RecurringDebtRun> => {
      const now = dependencies.clock.now();
      // No workspace's calendar is further ahead than UTC+14, so every rule
      // due anywhere is due by that date; each claim then asks its own zone.
      const through = localDate(
        new Date(now.getTime() + WIDEST_OFFSET_MILLISECONDS),
        FALLBACK_TIMEZONE,
      );
      let ids: readonly string[];
      try {
        ids = await dependencies.transaction.run((transaction) =>
          dependencies.recurringDebts.listDue({
            limit: options.limit ?? RECURRING_DEBT_BATCH,
            through,
            transaction,
          })
        );
      } catch {
        return { charged: 0, failed: 1, rules: 0 };
      }
      let charged = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          charged += await dependencies.transaction.run(async (transaction) => {
            const claimed = await dependencies.recurringDebts.claim({
              id,
              transaction,
            });
            if (!claimed) return 0;
            const result = await chargeDue(
              dependencies,
              claimed.recurringDebt,
              claimed.workspaceId,
              await todayIn(
                dependencies,
                claimed.workspaceId,
                now,
                transaction,
              ),
              now,
              transaction,
            );
            for (const debt of result.debts) {
              await dependencies.audit.recordCharged({
                debt,
                occurredAt: now,
                requestId: options.requestId,
                transaction,
                workspaceId: claimed.workspaceId,
              });
            }
            return result.debts.length;
          });
        } catch {
          failed += 1;
        }
      }
      return { charged, failed, rules: ids.length };
    },
  };
}

export type RecurringDebtCharging = ReturnType<
  typeof createRecurringDebtCharging
>;
