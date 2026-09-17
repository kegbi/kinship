/**
 * What the module promises to write into the audit history.
 *
 * Both writes record their event in the same transaction that created the row
 * and then read it back: `record` writes and hands back the identifier it
 * wrote, and `assertPostcondition` proves that exact row is there before the
 * transaction is allowed to commit.
 *
 * These are contracts, not descriptions — `application/audit_events.ts` holds
 * the pure functions that turn a command into the row governance stores.
 */

import type { CommunicationRecord } from "../domain/communication_rules.ts";
import type { InteractionRecord } from "../domain/interaction_rules.ts";
import type { InteractionActor, InteractionTransaction } from "./context.ts";

export interface InteractionAudit {
  record(command: {
    readonly actor: InteractionActor;
    readonly occurredAt: Date;
    readonly record: InteractionRecord;
    readonly transaction: InteractionTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly actor: InteractionActor;
    readonly auditId: string;
    readonly occurredAt: Date;
    readonly record: InteractionRecord;
    readonly transaction: InteractionTransaction;
  }): Promise<void>;
}

export interface CommunicationAudit {
  record(command: {
    readonly actor: InteractionActor;
    readonly occurredAt: Date;
    readonly record: CommunicationRecord;
    readonly transaction: InteractionTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly actor: InteractionActor;
    readonly auditId: string;
    readonly occurredAt: Date;
    readonly record: CommunicationRecord;
    readonly transaction: InteractionTransaction;
  }): Promise<void>;
}
