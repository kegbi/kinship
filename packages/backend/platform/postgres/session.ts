import type { Kysely, Transaction } from "kysely";
import type { ApplicationDatabase, Database } from "./database.ts";

export interface PostgresSession {
  readonly opaque:
    | Kysely<ApplicationDatabase>
    | Transaction<ApplicationDatabase>;
}

export function databaseFromSession(
  transaction: { readonly opaque: unknown },
): Kysely<ApplicationDatabase> | Transaction<ApplicationDatabase> {
  return transaction.opaque as
    | Kysely<ApplicationDatabase>
    | Transaction<ApplicationDatabase>;
}

/**
 * The same session typed by the generated schema, for an adapter whose queries
 * the type checker should hold to the canonical DDL. The object is the one
 * `databaseFromSession` returns; only its static type differs.
 */
export function schemaDatabaseFromSession(
  transaction: { readonly opaque: unknown },
): Kysely<Database> {
  // A `Transaction` is a `Kysely`, so one type covers both.
  return transaction.opaque as Kysely<Database>;
}
