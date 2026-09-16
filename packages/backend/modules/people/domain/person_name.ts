/**
 * What a person is called.
 *
 * The rule is the people module's own: a person is shown by their formal name
 * if they have one, else by their nickname, else by a fixed fallback, and a
 * blank-only part counts as no part at all. Nineteen places had each written
 * that rule out again — the duplicate finder, the delete confirmation, the
 * vCard export, and every read model's projection — and the copies had already
 * drifted: the TypeScript ones returned a whitespace-only given name verbatim
 * where the SQL trimmed it away and fell through to the nickname.
 *
 * This is the one statement of the rule. The PostgreSQL platform helper
 * `personDisplayNameSql` renders the same rule as a SQL fragment for the
 * adapters that must evaluate it inside a query, and it takes `UNNAMED_PERSON`
 * as an argument rather than knowing it: the words a person is shown by are
 * not the database driver's business.
 */

/** The name shown when a person carries no usable name at all. */
export const UNNAMED_PERSON = "Unnamed person";

/** The name parts the rule reads, however a caller spells them. */
export interface PersonNameParts {
  readonly familyName?: string | null;
  readonly givenName?: string | null;
  readonly nickname?: string | null;
}

/**
 * The formal name if there is one, else the nickname, else the fallback.
 *
 * Blank-only parts count as absent, which is what `nullif(..., '')` and
 * `trim(...)` do in the SQL rendering of the same rule.
 */
export function displayName(parts: PersonNameParts): string {
  const given = parts.givenName === "" ? null : parts.givenName;
  const formal = [given, parts.familyName].filter((part) =>
    part !== null && part !== undefined
  ).join(" ").trim();
  return formal || parts.nickname || UNNAMED_PERSON;
}
