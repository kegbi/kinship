/**
 * What the module promises to write into the audit history.
 *
 * Every relationship write records an event in the same transaction and then
 * reads it back: `record` writes and hands back the identifier it wrote, and
 * `assertPostcondition` proves that exact row is there before the transaction
 * is allowed to commit.
 *
 * The command carries the edge on both sides of the change, because a deletion
 * has only a `before` and a creation only an `after`, and the event has to name
 * the edge either way.
 *
 * These are contracts, not descriptions — `application/audit_events.ts` holds
 * the pure function that turns the command into the row governance stores.
 */

import type { RelationshipRecord } from "../domain/relationship_rules.ts";
import type { RelationshipActor, RelationshipTransaction } from "./context.ts";

export interface RelationshipAuditCommand {
  readonly action: "create" | "delete" | "update";
  readonly actor: RelationshipActor;
  readonly after?: RelationshipRecord;
  readonly before?: RelationshipRecord;
  readonly occurredAt: Date;
  readonly transaction: RelationshipTransaction;
}

export interface RelationshipAudit {
  record(command: RelationshipAuditCommand): Promise<string>;
  assertPostcondition(
    command: RelationshipAuditCommand & { readonly auditId: string },
  ): Promise<void>;
}
