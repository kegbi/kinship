/**
 * What the module promises to write into the audit history.
 *
 * A gift, a debt, and a recurring debt rule are audited through one port
 * because the event they produce differs only in the subject it names, so the
 * command carries the record and says which of the three it is. A debt a rule
 * charged on the worker's schedule has no member behind it, so it is recorded
 * through its own method that names no actor.
 *
 * This is a contract, not a description — `application/audit_events.ts` holds
 * the pure function that turns the command into the row governance stores.
 */

import type { StoredDebt, StoredGift } from "../domain/gift_rules.ts";
import type { StoredRecurringDebt } from "../domain/recurring_debts.ts";
import type { GiftActor, GiftTransaction } from "./context.ts";

export interface GiftAudit {
  record(command: {
    readonly action: "changed" | "created" | "deleted";
    readonly actor: GiftActor;
    readonly occurredAt: Date;
    readonly record: StoredDebt | StoredGift | StoredRecurringDebt;
    readonly recordType: "debt" | "gift" | "recurring-debt";
    readonly transaction: GiftTransaction;
  }): Promise<string>;
  /** A debt a recurring rule charged on the worker's schedule. */
  recordCharged(command: {
    readonly debt: StoredDebt;
    readonly occurredAt: Date;
    /** The job run that charged it, when the worker correlates its runs. */
    readonly requestId?: string | undefined;
    readonly transaction: GiftTransaction;
    readonly workspaceId: string;
  }): Promise<string>;
}
