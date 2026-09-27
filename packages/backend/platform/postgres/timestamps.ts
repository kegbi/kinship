/**
 * The one way a timestamp column leaves PostgreSQL.
 *
 * `Instant` is an RFC 3339 string in UTC with six fractional digits, and the
 * only reliable way to get exactly that out of a `timestamptz` is to render it
 * in SQL rather than let the driver hand back a `Date`. Twenty-four adapters
 * agreed on that and each pasted the same `to_char(... at time zone 'UTC',
 * 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` into ninety-three places, two of them
 * hiding it behind a private one-line helper of their own.
 *
 * The format literals live here now, and the two builders below are the only
 * places that spell them. Both return a `RawBuilder`, so embed one in a `sql`
 * tagged template, where Kysely composes it — inside a plain template literal
 * it would stringify instead.
 */

import { type Expression, type RawBuilder, sql } from "kysely";

/**
 * Six fractional digits, matching the precision the canonical schema stores
 * and the precision optimistic concurrency compares.
 */
export const INSTANT_FORMAT = `YYYY-MM-DD"T"HH24:MI:SS.US"Z"`;

/**
 * Three fractional digits.
 *
 * A few columns are read back as a value the API echoes to a client that
 * supplied milliseconds, so rendering microseconds there would change a
 * round-tripped payload. Those columns keep this narrower format.
 */
export const MILLISECOND_INSTANT_FORMAT = `YYYY-MM-DD"T"HH24:MI:SS.MS"Z"`;

/**
 * One timestamp column, or any timestamp expression, as an `Instant`.
 *
 * `expression` is raw SQL written by this repository — a column reference such
 * as `task.due_at` or a call such as `max(contacted_at)` — never a value a
 * caller supplied at runtime. A NULL timestamp renders as NULL, which is what
 * `to_char` already does.
 */
export function instantColumn(expression: string): RawBuilder<string> {
  return sql.raw(
    `to_char(${expression} at time zone 'UTC', '${INSTANT_FORMAT}')`,
  );
}

/** The same projection at millisecond precision. */
export function millisecondInstantColumn(
  expression: string,
): RawBuilder<string> {
  return sql.raw(
    `to_char(${expression} at time zone 'UTC', '${MILLISECOND_INSTANT_FORMAT}')`,
  );
}

/**
 * `instantColumn` for a query built with Kysely's query builder: the same
 * projection around a typed expression, such as `eb.ref("gift.created_at")`,
 * so the type checker holds the column to the generated schema.
 */
export function instantOf(expression: Expression<Date>): RawBuilder<string> {
  return sql<string>`to_char(${expression} at time zone 'UTC', '${
    sql.raw(INSTANT_FORMAT)
  }')`;
}
