/**
 * Counting and re-pointing the references to a personalization entry.
 *
 * Deleting a workspace's own option — a gender, a contact label, a
 * relationship type — is only allowed once every row that names it names a
 * replacement instead. Four adapters answered the same two questions for
 * eleven reference sites: how many rows point at this entry, and rewrite them
 * to point at that one. Each site was a scoped `count(*)` and a scoped
 * `update ... set column = $replacement, updated_at = now()`, except the label
 * junctions, which have no `updated_at` and cannot simply be rewritten — a row
 * may already carry the replacement label — so they insert the replacement
 * rows, ignore the collisions, and delete the originals.
 *
 * Two sections cannot be rewritten at all when the replacement would collide
 * on a composite key: a person may not end up with two primary contact methods
 * of one type, and a pair of people may not be related twice under one type.
 * Both are the same rule — lock the affected rows in key order, group them by
 * that key, and refuse when a group holds both the old entry and the
 * replacement — so a section declares the key columns rather than a detector.
 *
 * A site whose section is counted but never rewritten says so: emotions are
 * reported to the operator and left alone, exactly as before.
 */

import { sql } from "kysely";
import { databaseFromSession } from "./session.ts";
import {
  ownerTables,
  parseWorkspaceScope,
  SCOPED_ROW,
  scopedColumn,
  scopedFrom,
  scopedTables,
  scopedWhere,
  type WorkspaceScope,
} from "./workspace_scope.ts";

export interface ReferenceSite {
  /** The column naming the personalization entry. */
  readonly column: string;
  /** The site is reported but never rewritten. */
  readonly countOnly?: boolean;
  /**
   * The other half of a junction row's key. Its presence makes the rewrite an
   * insert-select that ignores collisions followed by a delete.
   */
  readonly junctionKey?: string;
  /** The referencing table as a `workspace_scope.ts` path. */
  readonly source: string;
}

export interface ReferenceConflict {
  /** The columns a replacement may not collide on. */
  readonly keyColumns: readonly string[];
  /** Only rows whose boolean column is true can collide. */
  readonly whenTrue?: string;
}

export interface ReferenceSection {
  readonly conflict?: ReferenceConflict;
  readonly sites: readonly ReferenceSite[];
}

export interface ReferenceCommand {
  readonly id: string;
  readonly replacementId?: string;
  readonly section?: string;
  readonly transaction: { readonly opaque: unknown };
  readonly workspaceId: string;
}

interface ParsedSite extends ReferenceSite {
  readonly scope: WorkspaceScope;
}

interface ParsedSection {
  readonly conflict?: ReferenceConflict;
  readonly sites: readonly ParsedSite[];
}

interface ConflictRow {
  readonly groupKey: string;
  readonly included: boolean;
  readonly value: string;
}

export interface ReferenceCounter {
  count(command: ReferenceCommand): Promise<number>;
  replace(
    command: ReferenceCommand & { readonly replacementId: string },
  ): Promise<"conflict" | "replaced">;
}

/**
 * The module's reference repository, built from its sections. A module with a
 * single section is asked without one, so the only section answers then.
 */
export function referenceCounter(
  sections: Readonly<Record<string, ReferenceSection>>,
): ReferenceCounter {
  const parsed = new Map<string, ParsedSection>(
    Object.entries(sections).map(([name, section]) => [name, {
      ...(section.conflict === undefined ? {} : { conflict: section.conflict }),
      sites: section.sites.map((site) => ({
        ...site,
        scope: parseWorkspaceScope(site.source),
      })),
    }]),
  );
  const only = parsed.size === 1 ? [...parsed.values()][0] : undefined;
  const sectionOf = (name: string | undefined) =>
    (name === undefined ? undefined : parsed.get(name)) ?? only;

  const detect = async (
    command: ReferenceCommand & { readonly replacementId: string },
    site: ParsedSite,
    conflict: ReferenceConflict,
  ): Promise<boolean> => {
    const key = sql.join(
      conflict.keyColumns.map((name) => sql`${scopedColumn(name)}::text`),
      sql.raw(", "),
    );
    const order = sql.join(
      [...conflict.keyColumns, "id"].map(scopedColumn),
      sql.raw(", "),
    );
    const column = scopedColumn(site.column);
    const rows = await sql<ConflictRow>`
      select concat_ws(':', ${key}) as "groupKey", ${column}::text as "value",
        ${
      conflict.whenTrue === undefined
        ? sql.lit(true)
        : scopedColumn(conflict.whenTrue)
    } as "included"
      ${scopedFrom(site.scope, command.workspaceId)}
        and ${column} in (${command.id}::uuid, ${command.replacementId}::uuid)
      order by ${order} for update of ${sql.id(SCOPED_ROW)}
    `.execute(databaseFromSession(command.transaction));
    const groups = new Map<string, Set<string>>();
    for (const row of rows.rows) {
      if (!row.included) continue;
      const values = groups.get(row.groupKey) ?? new Set<string>();
      values.add(row.value);
      groups.set(row.groupKey, values);
    }
    return [...groups.values()].some((values) =>
      values.has(command.id) && values.has(command.replacementId)
    );
  };

  const rewrite = async (
    command: ReferenceCommand & { readonly replacementId: string },
    site: ParsedSite,
  ): Promise<void> => {
    const database = databaseFromSession(command.transaction);
    const owners = ownerTables(site.scope);
    const table = sql`${sql.table(site.scope.table)} as ${sql.id(SCOPED_ROW)}`;
    const where = sql`where ${
      scopedWhere(site.scope, command.workspaceId)
    } and ${scopedColumn(site.column)} = ${command.id}::uuid`;
    if (site.junctionKey === undefined) {
      const assignment = sql`set ${
        sql.id(site.column)
      } = ${command.replacementId}::uuid, ${sql.id("updated_at")} = now()`;
      await (owners === undefined
        ? sql`update ${table} ${assignment} ${where}`
        : sql`update ${table} ${assignment} from ${owners} ${where}`)
        .execute(database);
      return;
    }
    await sql`insert into ${sql.table(site.scope.table)} (${
      sql.id(site.junctionKey)
    }, ${sql.id(site.column)}) select ${
      scopedColumn(site.junctionKey)
    }, ${command.replacementId}::uuid from ${
      scopedTables(site.scope)
    } ${where} on conflict do nothing`
      .execute(database);
    await (owners === undefined
      ? sql`delete from ${table} ${where}`
      : sql`delete from ${table} using ${owners} ${where}`).execute(database);
  };

  return {
    async count(command: ReferenceCommand): Promise<number> {
      const section = sectionOf(command.section);
      if (section === undefined) return 0;
      const counted = section.sites.map((site) =>
        sql`(select count(*) ${
          scopedFrom(site.scope, command.workspaceId)
        } and ${scopedColumn(site.column)} = ${command.id}::uuid)`
      );
      const result = await sql<{ readonly count: number }>`
        select (${sql.join(counted, sql.raw(" + "))})::int as "count"
      `.execute(databaseFromSession(command.transaction));
      return result.rows[0]?.count ?? 0;
    },

    async replace(
      command: ReferenceCommand & { readonly replacementId: string },
    ): Promise<"conflict" | "replaced"> {
      const section = sectionOf(command.section);
      if (section === undefined) return "replaced";
      const rewritten = section.sites.filter((site) => site.countOnly !== true);
      const [first] = rewritten;
      if (section.conflict !== undefined && first !== undefined) {
        if (await detect(command, first, section.conflict)) return "conflict";
      }
      for (const site of rewritten) await rewrite(command, site);
      return "replaced";
    },
  };
}
