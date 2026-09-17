/**
 * The workspace lifecycle impact query, written once.
 *
 * Before a workspace is reset or deleted, every module reports what the
 * cascade is about to destroy: a few counts, and a revision digest the use
 * case folds into the impact token so a stale preview cannot authorise the
 * mutation. Eleven adapters answered that with the same query — a handful of
 * scoped `count(*)`s, an ordered `jsonb_agg` per table, and one `md5` over the
 * lot — and differed only in which tables they named.
 *
 * That difference is all a module declares here. The spec names the counted
 * tables, the labelled revision sources in the order the digest hashes them,
 * and, for the module that owns stored objects, the column holding their keys.
 * Each source is a `workspace_scope.ts` path, so a table owned through a join
 * costs one ` via ` step rather than a hand-written subquery.
 *
 * The generated digest matches the eleven hand-written ones value for value:
 * the labels, their order, the sort columns, and the `'[]'` defaults all come
 * from the spec, and a module whose revision is a single unlabelled source
 * hashes the bare array exactly as it did before.
 */

import { type RawBuilder, sql } from "kysely";
import { databaseFromSession } from "./session.ts";
import {
  parseWorkspaceScope,
  SCOPED_ROW,
  scopedColumn,
  scopedFrom,
  type WorkspaceScope,
} from "./workspace_scope.ts";

const LABEL = /^[A-Za-z][A-Za-z0-9]*$/;

export interface WorkspaceLifecycleImpactSpec {
  /**
   * The reported counts. A count is one scoped table, or several whose counts
   * are summed into a single number.
   */
  readonly counts: Readonly<Record<string, string | readonly string[]>>;
  /**
   * The stored-object keys this module contributes to the cleanup, as a source
   * whose single `@` column is the key column. Only the module owning files
   * declares it.
   */
  readonly objectKeys?: string;
  /**
   * The digest sources. A record hashes a labelled object in declaration
   * order; a bare source hashes that one array on its own.
   */
  readonly revision: string | Readonly<Record<string, string>>;
}

export interface WorkspaceLifecycleImpactContribution {
  readonly counts: Readonly<Record<string, number>>;
  readonly objectKeys?: readonly string[];
  readonly revision: string;
}

export interface WorkspaceLifecycleImpactCommand {
  readonly transaction: { readonly opaque: unknown };
  readonly workspaceId: string;
}

function named(name: string): string {
  if (!LABEL.test(name)) throw new Error(`"${name}" is no digest label`);
  return name;
}

/** A parsed source that an ordered aggregate can sort by. */
function sorted(source: string): WorkspaceScope {
  const scope = parseWorkspaceScope(source);
  if (scope.columns.length === 0) {
    throw new Error(`"${source}" names no ordering columns`);
  }
  return scope;
}

/** `coalesce((select jsonb_agg(to_jsonb(t) order by ...) ...), '[]')`. */
function aggregate(
  scope: WorkspaceScope,
  workspaceId: string,
): RawBuilder<unknown> {
  return sql`coalesce((select jsonb_agg(to_jsonb(${
    sql.id(SCOPED_ROW)
  }) order by ${sql.join(scope.columns.map(scopedColumn), sql.raw(", "))}) ${
    scopedFrom(scope, workspaceId)
  }), '[]'::jsonb)`;
}

function total(
  scopes: readonly WorkspaceScope[],
  workspaceId: string,
): RawBuilder<unknown> {
  return sql`(${
    sql.join(
      scopes.map((scope) =>
        sql`(select count(*) ${scopedFrom(scope, workspaceId)})`
      ),
      sql.raw(" + "),
    )
  })::int`;
}

/** A digest over one bare array, or over a labelled object of arrays. */
type Digest =
  | { readonly fields: readonly (readonly [string, WorkspaceScope])[] }
  | { readonly only: WorkspaceScope };

function digest(
  revision: Digest,
  workspaceId: string,
): RawBuilder<unknown> {
  if ("only" in revision) {
    return sql`md5(${aggregate(revision.only, workspaceId)}::text)`;
  }
  const fields = revision.fields.flatMap(([name, scope]) => [
    sql.lit(name),
    aggregate(scope, workspaceId),
  ]);
  return sql`md5(jsonb_build_object(${sql.join(fields, sql.raw(", "))})::text)`;
}

/** A parsed source whose one `@` column is the stored object's key. */
function keyed(source: string): WorkspaceScope {
  const scope = sorted(source);
  if (scope.columns.length !== 1) {
    throw new Error(`"${source}" names no single object-key column`);
  }
  return scope;
}

function keys(
  scope: WorkspaceScope,
  workspaceId: string,
): RawBuilder<unknown> {
  const column = scopedColumn(scope.columns[0] ?? "");
  return sql`coalesce((select jsonb_agg(${column} order by ${column}) filter (where ${column} is not null) ${
    scopedFrom(scope, workspaceId)
  }), '[]'::jsonb)`;
}

/**
 * The module's cascade participant, built from its spec. The spec is read at
 * import time, so a malformed source fails the composition root, not a reset.
 */
export function workspaceLifecycleImpact(
  spec: WorkspaceLifecycleImpactSpec,
): {
  inspectBeforeCascade(
    command: WorkspaceLifecycleImpactCommand,
  ): Promise<WorkspaceLifecycleImpactContribution>;
} {
  const counts = Object.entries(spec.counts).map(
    ([name, sources]) =>
      [
        named(name),
        (typeof sources === "string" ? [sources] : sources).map(
          parseWorkspaceScope,
        ),
      ] as const,
  );
  const revision: Digest = typeof spec.revision === "string"
    ? { only: sorted(spec.revision) }
    : {
      fields: Object.entries(spec.revision).map(
        ([name, source]) => [named(name), sorted(source)] as const,
      ),
    };
  const objectKeys = spec.objectKeys === undefined
    ? undefined
    : keyed(spec.objectKeys);
  return {
    async inspectBeforeCascade(command: WorkspaceLifecycleImpactCommand) {
      const { workspaceId } = command;
      const selections = counts.map(([name, scopes]) =>
        sql`${total(scopes, workspaceId)} as ${sql.id(name)}`
      );
      selections.push(sql`${digest(revision, workspaceId)} as "revision"`);
      if (objectKeys !== undefined) {
        selections.push(sql`${keys(objectKeys, workspaceId)} as "objectKeys"`);
      }
      const result = await sql<
        Record<string, number | string | readonly unknown[]>
      >`select ${sql.join(selections, sql.raw(", "))}`.execute(
        databaseFromSession(command.transaction),
      );
      const row = result.rows[0] ?? {};
      const reported: Record<string, number> = {};
      for (const [name] of counts) reported[name] = Number(row[name] ?? 0);
      const storage = row["objectKeys"];
      return {
        counts: reported,
        ...(objectKeys === undefined ? {} : {
          objectKeys: Array.isArray(storage)
            ? storage.filter((key): key is string => typeof key === "string")
            : [],
        }),
        revision: String(row["revision"] ?? ""),
      };
    },
  };
}
