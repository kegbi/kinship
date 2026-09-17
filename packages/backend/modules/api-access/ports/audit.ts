/**
 * What the module promises to write into the audit history.
 *
 * Minting and revoking a credential are both recorded in the transaction that
 * changed the row, and the command carries the whole record rather than its
 * identifier, because what the audit history needs to say is which permissions
 * the token carried.
 *
 * This is a contract, not a description — `application/audit_events.ts` holds
 * the pure function that turns the command into the row governance stores.
 */

import type { ApiTokenRecord } from "../domain/token_rules.ts";
import type { ApiTokenActor, ApiTokenTransaction } from "./context.ts";

export interface ApiTokenAudit {
  record(command: {
    readonly action: "created" | "revoked";
    readonly actor: ApiTokenActor;
    readonly occurredAt: Date;
    readonly record: ApiTokenRecord;
    readonly transaction: ApiTokenTransaction;
  }): Promise<void>;
}
