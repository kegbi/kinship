/**
 * How the module stores recurring debt rules and the debts they charge.
 *
 * A member's side reads and writes one person's rules the way the gift
 * repository reads and writes one person's debts: `find` locks the rule a
 * change is about to touch, and every write may find the person archived or
 * gone. The worker's side has no actor. It asks which rules are due across
 * every workspace, claims one rule at a time so two workers never charge the
 * same rule at once, and charges each period through the one-debt-per-period
 * key, so a period already charged is skipped rather than charged again.
 *
 * Nothing here decides when a period falls due; `domain/recurring_debts.ts`
 * has said that before any of these is called.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { StoredDebt } from "../domain/gift_rules.ts";
import type {
  RecurringDebtValues,
  StoredRecurringDebt,
} from "../domain/recurring_debts.ts";
import type { GiftActor, GiftTransaction } from "./context.ts";

/** A rule claimed for charging, with the workspace whose calendar it uses. */
export interface ClaimedRecurringDebt {
  readonly recurringDebt: StoredRecurringDebt;
  readonly workspaceId: string;
}

export interface RecurringDebtRepository {
  /** The person's rules, oldest first; at most the module's rule limit. */
  listForPerson(
    command: GiftActor & {
      readonly personId: string;
      readonly transaction: GiftTransaction;
    },
  ): Promise<readonly StoredRecurringDebt[]>;
  create(
    command: GiftActor & RecurringDebtValues & {
      readonly id: string;
      readonly nextOccurrenceOn?: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | {
      readonly recurringDebt: StoredRecurringDebt;
      readonly status: "created";
    }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  /**
   * The rule, locked for the change about to be made, and the due date of
   * the last period it charged, if any.
   */
  find(
    command: GiftActor & {
      readonly id: string;
      readonly personId: string;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | {
      readonly lastChargedOn?: string;
      readonly recurringDebt: StoredRecurringDebt;
      readonly status: "found";
    }
    | Failure<"archived-write-rejected" | "not-found">
  >;
  save(
    command: GiftActor & RecurringDebtValues & {
      readonly active: boolean;
      readonly id: string;
      readonly nextOccurrenceOn?: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly transaction: GiftTransaction;
    },
  ): Promise<
    | { readonly recurringDebt: StoredRecurringDebt; readonly status: "saved" }
    | Failure<"not-found">
  >;
  /** Removes the rule; the debts it already charged stay. */
  remove(
    command: GiftActor & {
      readonly id: string;
      readonly personId: string;
      readonly transaction: GiftTransaction;
    },
  ): Promise<boolean>;
  /**
   * Rules in any workspace that are active, whose person is live and not
   * archived, and whose next period falls due on or before `through`.
   */
  listDue(command: {
    readonly limit: number;
    readonly through: string;
    readonly transaction: GiftTransaction;
  }): Promise<readonly string[]>;
  /**
   * The rule locked for charging, or nothing when another worker holds it or
   * it is no longer an active rule of a live, unarchived person.
   */
  claim(command: {
    readonly id: string;
    readonly transaction: GiftTransaction;
  }): Promise<ClaimedRecurringDebt | undefined>;
  /**
   * One open debt per date, each with the rule's values. A date the rule
   * already charged is skipped; only the debts inserted now are returned.
   */
  charge(command: {
    readonly dates: readonly string[];
    readonly ids: readonly string[];
    readonly occurredAt: Date;
    readonly recurringDebt: StoredRecurringDebt;
    readonly transaction: GiftTransaction;
    readonly workspaceId: string;
  }): Promise<readonly StoredDebt[]>;
  /** Moves the rule's next period on; nothing once the rule has ended. */
  advance(command: {
    readonly id: string;
    readonly nextOccurrenceOn?: string;
    readonly transaction: GiftTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
}
