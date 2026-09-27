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

/**
 * What a life-event write records. The event is named by its identifier and
 * the person it belongs to, so the person's audit history lists it; a
 * deletion has nothing else left to describe.
 */
export interface LifeEventAudit {
  record(command: {
    readonly action: "created" | "deleted" | "updated";
    readonly actor: JournalActor;
    readonly lifeEventId: string;
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: JournalTransaction;
  }): Promise<string>;
}
