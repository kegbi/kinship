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
 *
 * The fold is the costly part, so each name is folded once, however many
 * forms the query has: the forms are one `like any` array of patterns, which
 * PostgreSQL tests against a single evaluation of the folded name. A name
 * whose lowercased text is plain ASCII skips every step that rewrites a
 * non-ASCII letter — none of them could match it — so a Latin name pays for
 * the few Latin steps alone. Both shortcuts give exactly the full fold's
 * answer.
 */

import { type RawBuilder, sql } from "kysely";

/** One `replace(text, from, to)` of the fold, applied to lowercased text. */
export type NameFoldStep = readonly [from: string, to: string];

const ASCII = /^\p{ASCII}*$/u;

/** `text` lowercased and folded by `steps`, in order. */
function folded(
  lowered: RawBuilder<unknown>,
  steps: readonly NameFoldStep[],
): RawBuilder<unknown> {
  return steps.reduce<RawBuilder<unknown>>(
    (text, [from, to]) => sql`replace(${text}, ${from}::text, ${to}::text)`,
    lowered,
  );
}

/**
 * The lowercased name folded by `steps`. When no step writes a non-ASCII
 * letter, ASCII text stays ASCII through every step, so a step that reads a
 * non-ASCII letter can never apply to an ASCII name and is skipped for it.
 */
function foldedName(
  name: RawBuilder<unknown>,
  steps: readonly NameFoldStep[],
): RawBuilder<unknown> {
  const lowered = sql`lower(${name})`;
  const latin = steps.filter(([from]) => ASCII.test(from));
  if (
    latin.length === steps.length || !steps.every(([, to]) => ASCII.test(to))
  ) {
    return folded(lowered, steps);
  }
  return sql`case when octet_length(${lowered}) = char_length(${lowered}) then ${
    folded(lowered, latin)
  } else ${folded(lowered, steps)} end`;
}

/** A `like` pattern that matches text containing `form` literally. */
function containing(form: string): string {
  return `%${form.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
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
  const patterns = forms.map(containing);
  return sql<boolean>`(${typed} or ${
    foldedName(name, steps)
  } like any (${patterns}::text[]))`;
}
