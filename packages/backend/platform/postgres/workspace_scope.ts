/**
 * The workspace-ownership path, written once.
 *
 * Every tenant-scoped statement in the backend answers the same question
 * before it does anything else: which rows of this table belong to this
 * workspace? A table either carries `workspace_id` itself or is reached
 * through one or two owners that do, and the fifteen adapters that inspected
 * or rewrote a whole module at a time spelled that join chain out again for
 * every table they touched.
 *
 * This module states the path once, as a short source string a caller writes
 * next to the table it describes:
 *
 * ```
 * "schema.table@order,columns via schema.owner.child_column via ..."
 * ```
 *
 * The table comes first, the optional `@` list names the columns an ordered
 * aggregate sorts by, and each ` via ` step joins an owner on its `id` to the
 * named column of the step before it. The last owner — or the table itself,
 * when there is none — is the row that carries `workspace_id`.
 *
 * The compiled fragments are deliberately plain: a comma-separated table list
 * and a conjunction of predicates, which `select`, `update ... from`, and
 * `delete ... using` all accept unchanged.
 */

import { type RawBuilder, sql } from "kysely";

/** The alias the described table always takes. */
export const SCOPED_ROW = "t";

const QUALIFIED_TABLE = /^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/;
const COLUMN_NAME = /^[a-z_][a-z0-9_]*$/;

export interface WorkspaceScopeOwner {
  /** The column on the previous step that points at this owner's `id`. */
  readonly column: string;
  readonly table: string;
}

export interface WorkspaceScope {
  /** The `@` columns, for callers that order an aggregate by them. */
  readonly columns: readonly string[];
  readonly owners: readonly WorkspaceScopeOwner[];
  readonly table: string;
}

/** A column of the described table, qualified by its alias. */
export function scopedColumn(name: string): RawBuilder<unknown> {
  if (!COLUMN_NAME.test(name)) throw new Error(`"${name}" is no column name`);
  return sql.ref(`${SCOPED_ROW}.${name}`);
}

const ownerAlias = (index: number) => `o${index + 1}`;

/** Reads a source string; throws at import time when it is malformed. */
export function parseWorkspaceScope(source: string): WorkspaceScope {
  const [head = "", ...steps] = source.split(" via ");
  const [table = "", order = ""] = head.split("@");
  const owners = steps.map((step) => {
    const separator = step.lastIndexOf(".");
    return {
      column: step.slice(separator + 1),
      table: step.slice(0, separator),
    };
  });
  for (const name of [table, ...owners.map((owner) => owner.table)]) {
    if (!QUALIFIED_TABLE.test(name)) {
      throw new Error(`"${source}" names no schema-qualified table`);
    }
  }
  const columns = order === "" ? [] : order.split(",");
  for (const name of [...columns, ...owners.map((owner) => owner.column)]) {
    if (!COLUMN_NAME.test(name)) {
      throw new Error(`"${source}" names no column`);
    }
  }
  return { columns, owners, table };
}

/** The owners alone, for `update ... from` and `delete ... using`. */
export function ownerTables(
  scope: WorkspaceScope,
): RawBuilder<unknown> | undefined {
  if (scope.owners.length === 0) return undefined;
  return sql.join(
    scope.owners.map((owner, index) =>
      sql`${sql.table(owner.table)} as ${sql.id(ownerAlias(index))}`
    ),
    sql.raw(", "),
  );
}

/** The described table and its owners, as one `from` list. */
export function scopedTables(scope: WorkspaceScope): RawBuilder<unknown> {
  const owners = ownerTables(scope);
  const row = sql`${sql.table(scope.table)} as ${sql.id(SCOPED_ROW)}`;
  return owners === undefined ? row : sql`${row}, ${owners}`;
}

/** The join chain and the workspace predicate, as one conjunction. */
export function scopedWhere(
  scope: WorkspaceScope,
  workspaceId: string,
): RawBuilder<unknown> {
  const conditions = scope.owners.map((owner, index) =>
    sql`${sql.ref(`${ownerAlias(index)}.id`)} = ${
      sql.ref(
        `${index === 0 ? SCOPED_ROW : ownerAlias(index - 1)}.${owner.column}`,
      )
    }`
  );
  const owner = scope.owners.length === 0
    ? SCOPED_ROW
    : ownerAlias(scope.owners.length - 1);
  conditions.push(
    sql`${sql.ref(`${owner}.workspace_id`)} = ${workspaceId}::uuid`,
  );
  return sql.join(conditions, sql.raw(" and "));
}

/** The whole `from ... where ...` tail a scoped `select` needs. */
export function scopedFrom(
  scope: WorkspaceScope,
  workspaceId: string,
): RawBuilder<unknown> {
  return sql`from ${scopedTables(scope)} where ${
    scopedWhere(scope, workspaceId)
  }`;
}
