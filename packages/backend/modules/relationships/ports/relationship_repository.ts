/**
 * How the module stores the relationship graph.
 *
 * `get` reads the edge a caller named; `lockRelationship` takes it again under
 * lock once a write is actually going to happen, so the revision the caller
 * expected is compared against a row nobody else can move. `create` answers
 * with nothing when the edge already exists, which is why `findExact` follows
 * it: a duplicate is the outcome the caller wanted, not a conflict.
 *
 * `assertPostcondition` is the other half of the write discipline — the row is
 * read back inside the transaction, so a write that silently did nothing fails
 * loudly instead of being audited as a success.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { RelationshipCursor } from "../domain/cursors.ts";
import type {
  RelationshipRecord,
  RelationshipTypeOption,
} from "../domain/relationship_rules.ts";
import type { RelationshipActor, RelationshipTransaction } from "./context.ts";

/** One page of a person's relationships, or a cursor that no longer fits. */
export type RelationshipPage =
  | {
    readonly records: readonly RelationshipRecord[];
    readonly status: "ready";
  }
  | { readonly status: "stale-cursor" };

/** The locked edge, or the fact that there is none. */
export type RelationshipLock =
  | { readonly relationship: RelationshipRecord; readonly status: "ready" }
  | Failure<"not-found">;

export interface RelationshipRepository {
  list(
    command: RelationshipActor & {
      readonly after?: RelationshipCursor;
      readonly limit: number;
      readonly personId: string;
      readonly transaction: RelationshipTransaction;
    },
  ): Promise<RelationshipPage>;
  get(
    command: RelationshipActor & {
      readonly personId: string;
      readonly relationshipId: string;
      readonly transaction: RelationshipTransaction;
    },
  ): Promise<RelationshipRecord | undefined>;
  lockRelationship(
    command: RelationshipActor & {
      readonly personId: string;
      readonly relationshipId: string;
      readonly transaction: RelationshipTransaction;
    },
  ): Promise<RelationshipLock>;
  findExact(
    command: RelationshipActor & {
      readonly relationshipTypeId: string;
      readonly sourcePersonId: string;
      readonly targetPersonId: string;
      readonly transaction: RelationshipTransaction;
    },
  ): Promise<RelationshipRecord | undefined>;
  create(
    command: RelationshipActor & {
      readonly id: string;
      readonly occurredAt: Date;
      readonly sourcePersonId: string;
      readonly targetPersonId: string;
      readonly transaction: RelationshipTransaction;
      readonly type: RelationshipTypeOption;
    },
  ): Promise<RelationshipRecord | undefined>;
  update(
    command: RelationshipActor & {
      readonly occurredAt: Date;
      readonly relationshipId: string;
      readonly transaction: RelationshipTransaction;
      readonly type: RelationshipTypeOption;
    },
  ): Promise<RelationshipRecord | undefined>;
  delete(
    command: RelationshipActor & {
      readonly relationshipId: string;
      readonly transaction: RelationshipTransaction;
    },
  ): Promise<boolean>;
  assertPostcondition(
    command: RelationshipActor & {
      readonly action: "create" | "delete" | "update";
      readonly after?: RelationshipRecord;
      readonly before?: RelationshipRecord;
      readonly transaction: RelationshipTransaction;
    },
  ): Promise<void>;
}
