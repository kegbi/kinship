/**
 * The person display-name rule, rendered as SQL.
 *
 * Eight adapters project a person's name inside the query rather than in
 * TypeScript — a read model orders and paginates by it, so it has to exist in
 * the database — and each of the sixteen projections spelled the same
 * `coalesce/nullif/concat_ws` out again.
 *
 * The rule itself belongs to the people module, not here:
 * `modules/people/domain/person_name.ts` states it, and this function only
 * says how PostgreSQL evaluates it. That is why the fallback is a parameter —
 * the caller passes people's `UNNAMED_PERSON`, and this module never learns
 * what a person without a name is called.
 */

/**
 * The display-name rule as a SQL expression.
 *
 * `fallback` is the name to use when a person has none; callers pass
 * `UNNAMED_PERSON` from the people module. `alias` qualifies the three name
 * columns, for the many queries that join `crm.people` under a name; omit it
 * where the columns are already unambiguous.
 *
 * The result is raw SQL text, so embed it with `sql.raw`. The column names are
 * written by this repository; `fallback` is escaped as a SQL string literal.
 */
export function personDisplayNameSql(
  fallback: string,
  alias?: string,
): string {
  const column = (name: string) =>
    alias === undefined ? name : `${alias}.${name}`;
  const literal = `'${fallback.replaceAll("'", "''")}'`;
  return `coalesce(nullif(trim(concat_ws(' ', nullif(${
    column("given_name")
  }, ''), ${column("family_name")})), ''), nullif(${
    column("nickname")
  }, ''), ${literal})`;
}
