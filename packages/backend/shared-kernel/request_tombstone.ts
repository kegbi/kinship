/**
 * The request tombstone contract (MCP-E3, schema v16).
 *
 * A create sent with a retry key (`requestId`) derives its record's id from
 * the workspace and the key (`deterministicId`), so every retry names the same
 * row and a retry that finds it returns it. Once that row is deleted
 * permanently nothing is left to find, and the retry would record the item
 * again. A tombstone is what is left instead: the delete writes the record's id
 * in its own transaction, and a keyed create that finds no row asks for one
 * and is refused when it is there.
 *
 * `governance` owns `request_tombstones` and its one adapter; every other
 * module reaches it through this port, the way it reaches `audit_events`
 * through `AuditEventRecorder`. The port runs inside the caller's transaction,
 * which is already scoped to the workspace, so row-level security limits it to
 * that workspace's tombstones.
 *
 * This module implements nothing and imports nothing, so the kernel stays a
 * leaf and the adapter is built at a composition root.
 */

export interface RequestTombstoneTransaction {
  readonly opaque: unknown;
}

/**
 * The record kinds a keyed create can make and a member can delete
 * permanently. Stored as `request_tombstones.record_type`.
 */
export type RequestTombstoneKind =
  | "activity"
  | "call"
  | "conversation"
  | "debt"
  | "gift"
  | "journal_post"
  | "note"
  | "recurring_debt";

export interface RequestTombstoneWrite {
  /** When the record was deleted; the delete's own instant. */
  readonly deletedAt: Date;
  readonly kind: RequestTombstoneKind;
  /** The id of the row the delete removed. */
  readonly recordId: string;
  readonly transaction: RequestTombstoneTransaction;
  readonly workspaceId: string;
}

export interface RequestTombstoneQuery {
  /** The id a keyed create derived and found no row under. */
  readonly recordId: string;
  readonly transaction: RequestTombstoneTransaction;
  readonly workspaceId: string;
}

export interface RequestTombstones {
  /**
   * Leaves the deleted record's tombstone, in the delete's transaction. Only an
   * id a retry key could have derived needs one, so the adapter keeps only
   * those (`isRequestDerivedId`) and writes nothing for any other id.
   */
  record(command: RequestTombstoneWrite): Promise<void>;
  /**
   * Whether a record under this id was deleted. A keyed create asks after it
   * locked its request and found no row: a tombstone means the key already
   * recorded something a member then removed.
   */
  recorded(command: RequestTombstoneQuery): Promise<boolean>;
}
