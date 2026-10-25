/**
 * Person-name matching across scripts and keyboard layouts (`SEARCH-001`),
 * rendered as SQL.
 *
 * The rules are not here. `packages/contracts/schemas/name_search.ts` states
 * them once, as data: the fold steps and the query's forms reach the
 * repository through its command, and this function only says how PostgreSQL
 * repeats them. Every step and form is a bound parameter, never SQL text.
 *
 * A name matches when it contains the query as typed, case-insensitively —
 * the directory's long-standing substring match, kept whole — or when its
 * lowercased text, folded by `replace()` once per step in order, contains any
 * of the forms.
 */

import { type RawBuilder, sql } from "kysely";

/** One `replace(text, from, to)` of the fold, applied to lowercased text. */
export type NameFoldStep = readonly [from: string, to: string];

/** `name` lowercased and folded by `steps`, in order. */
function folded(
  name: RawBuilder<unknown>,
  steps: readonly NameFoldStep[],
): RawBuilder<unknown> {
  return steps.reduce<RawBuilder<unknown>>(
    (text, [from, to]) => sql`replace(${text}, ${from}::text, ${to}::text)`,
    sql`lower(${name})`,
  );
}

/** Whether the person name `name` matches `query` or any of `forms`. */
export function nameMatchSql(
  name: RawBuilder<unknown>,
  query: string,
  forms: readonly string[],
  steps: readonly NameFoldStep[],
): RawBuilder<boolean> {
  const typed = sql<boolean>`strpos(lower(${name}), lower(${query}::text)) > 0`;
  if (forms.length === 0) return typed;
  const unnested = sql`unnest(${forms as string[]}::text[]) form`;
  const contains = sql`strpos(${folded(name, steps)}, form) > 0`;
  const folds = sql`exists (select 1 from ${unnested} where ${contains})`;
  return sql<boolean>`(${typed} or ${folds})`;
}
