import type { Kysely, Transaction } from "kysely";
import type { ApplicationDatabase } from "./database.ts";

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
