/**
 * What the module promises to write into the audit history.
 *
 * A journal write records its event in the same transaction that changed the
 * row, and the command names the item rather than carrying it: a deletion has
 * no row left to describe by the time the event is written, so the identifier
 * and the kind are all three actions have in common.
 *
 * This is a contract, not a description — `application/audit_events.ts` holds
 * the pure function that turns the command into the row governance stores.
 */

import type { JournalActor, JournalTransaction } from "./context.ts";
import type { JournalItemType } from "./journal_repository.ts";

export interface JournalAudit {
  record(command: {
    readonly action: "created" | "deleted" | "updated";
    readonly actor: JournalActor;
    readonly itemId: string;
    readonly itemType: JournalItemType;
    readonly occurredAt: Date;
    readonly transaction: JournalTransaction;
  }): Promise<string>;
}
