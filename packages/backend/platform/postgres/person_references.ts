/**
 * Counting and relinking the rows that name a person (GAP-049).
 *
 * A person merge asks every module that keeps rows about people the same two
 * questions: how many of your rows name this person, and point the ones that
 * name the duplicate at the primary instead. For most references the answer
 * is one scoped `count(*)` and one scoped `update`, differing only in the
 * table, the column, and whether the table carries `workspace_id` and
 * `updated_at`. A module declares those sites and this file writes the
 * statements, so each participant adapter spells out only the references
 * whose merge needs a rule of its own — a junction row the primary already
 * has, a single-valued row the primary keeps.
 *
 * Sites are written by the adapter, never by a caller: each table and column
 * is checked against a plain identifier pattern before it is spliced into the
 * statement, and every value is a bound parameter.
 */

import { sql } from "kysely";
import { databaseFromSession } from "./session.ts";

export interface PersonReferenceSite {
  /** The referencing table, schema-qualified: `crm.<table>`. */
  readonly table: string;
  /** The column that holds the person's identifier. */
  readonly column: string;
  /** The table has `workspace_id`; every statement is scoped by it too. */
  readonly workspaceScoped?: boolean;
  /** The table has `updated_at`; a relinked row's value moves forward. */
  readonly touches?: boolean;
}

export interface PersonReferenceScope {
  readonly personId: string;
  readonly transaction: { readonly opaque: unknown };
  readonly workspaceId: string;
}

export interface PersonRelinkScope {
  readonly duplicateId: string;
  readonly occurredAt: Date;
  readonly primaryId: string;
  readonly transaction: { readonly opaque: unknown };
  readonly workspaceId: string;
}

const TABLE = /^crm\.[a-z][a-z_]*$/;
const COLUMN = /^[a-z][a-z_]*$/;

function checked(site: PersonReferenceSite): PersonReferenceSite {
  if (!TABLE.test(site.table) || !COLUMN.test(site.column)) {
    throw new Error(`"${site.table}.${site.column}" is no reference site`);
  }
  return site;
}

/** The name a reference is reported under: `crm.<table>.<column>`. */
export function referenceName(site: PersonReferenceSite): string {
  return `${site.table}.${site.column}`;
}

function scoped(site: PersonReferenceSite, workspaceId: string) {
  return site.workspaceScoped
    ? sql` and workspace_id = ${workspaceId}::uuid`
    : sql``;
}

/** How many rows name the person, per site, in one statement. */
export async function countPersonReferences(
  sites: readonly PersonReferenceSite[],
  scope: PersonReferenceScope,
): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const site of sites.map(checked)) {
    const result = await sql<{ readonly count: number }>`
      select count(*)::int as count
      from ${sql.raw(site.table)}
      where ${sql.raw(site.column)} = ${scope.personId}::uuid${
      scoped(site, scope.workspaceId)
    }
    `.execute(databaseFromSession(scope.transaction));
    counts[referenceName(site)] = result.rows[0]?.count ?? 0;
  }
  return counts;
}

/** Points every row naming the duplicate at the primary, per site. */
export async function relinkPersonReferences(
  sites: readonly PersonReferenceSite[],
  scope: PersonRelinkScope,
): Promise<Record<string, number>> {
  const relinked: Record<string, number> = {};
  for (const site of sites.map(checked)) {
    const touch = site.touches
      ? sql`, updated_at = greatest(
          ${scope.occurredAt}::timestamptz,
          updated_at + interval '1 microsecond'
        )`
      : sql``;
    const result = await sql<{ readonly moved: number }>`
      update ${sql.raw(site.table)}
      set ${sql.raw(site.column)} = ${scope.primaryId}::uuid${touch}
      where ${sql.raw(site.column)} = ${scope.duplicateId}::uuid${
      scoped(site, scope.workspaceId)
    }
      returning 1 as moved
    `.execute(databaseFromSession(scope.transaction));
    relinked[referenceName(site)] = result.rows.length;
  }
  return relinked;
}
