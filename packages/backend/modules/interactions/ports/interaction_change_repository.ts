/**
 * How the module changes or removes a record it already stored (MCP-D1).
 *
 * `find` locks the record's row before reading it, so the revision the use
 * case compares is the one the write then replaces, and two concurrent edits
 * of one record serialise instead of interleaving. `save` and `remove` repeat
 * the revision in their own `where` clause and answer `false` when no row
 * matched, which the use case reports as a stale revision.
 *
 * Every statement is scoped by workspace as well as by identifier, so an
 * identifier from another workspace finds nothing and changes nothing.
 */

import type {
  CheckedChange,
  InteractionKind,
  StoredRecord,
} from "../domain/interaction_changes.ts";
import type { InteractionActor, InteractionTransaction } from "./context.ts";

export interface InteractionChangeRepository {
  find(command: {
    readonly id: string;
    readonly kind: InteractionKind;
    readonly transaction: InteractionTransaction;
    readonly workspaceId: string;
  }): Promise<StoredRecord | undefined>;
  save(
    command: InteractionActor & {
      readonly change: CheckedChange;
      readonly expectedUpdatedAt: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<boolean>;
  remove(command: {
    readonly expectedUpdatedAt: string;
    readonly id: string;
    readonly kind: InteractionKind;
    readonly transaction: InteractionTransaction;
    readonly workspaceId: string;
  }): Promise<boolean>;
}
