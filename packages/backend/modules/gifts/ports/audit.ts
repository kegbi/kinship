/**
 * What the module promises to write into the audit history.
 *
 * A gift and a debt are audited through one port because the event they
 * produce differs only in the subject it names, so the command carries the
 * record and says which of the two it is.
 *
 * This is a contract, not a description — `application/audit_events.ts` holds
 * the pure function that turns the command into the row governance stores.
 */

import type { StoredDebt, StoredGift } from "../domain/gift_rules.ts";
import type { GiftActor, GiftTransaction } from "./context.ts";

export interface GiftAudit {
  record(command: {
    readonly action: "changed" | "created";
    readonly actor: GiftActor;
    readonly occurredAt: Date;
    readonly record: StoredDebt | StoredGift;
    readonly recordType: "debt" | "gift";
    readonly transaction: GiftTransaction;
  }): Promise<string>;
}
