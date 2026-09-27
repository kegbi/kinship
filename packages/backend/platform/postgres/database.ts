import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";
import type { DB } from "./generated/database.ts";

/**
 * Every `crm` table as `crm.<table>`, generated from the migrated canonical
 * DDL by `tools/tasks/run.ts schema-types`. A query built with Kysely's query
 * builder against it is checked by `deno check`; raw `sql` templates are not.
 */
export type Database = DB;

/**
 * The untyped view modules that have not adopted `Database` yet still use.
 * Each module moves to `Database` in its own ticket, after which this goes.
 */
export type ApplicationDatabase = Record<string, never>;

export interface DatabaseConnection {
  readonly db: Kysely<ApplicationDatabase>;
  destroy(): Promise<void>;
}

export function connectDatabase(url: string): DatabaseConnection {
  const client = postgres(url, {
    connect_timeout: 5,
    idle_timeout: 10,
    max: 8,
    prepare: true,
  });
  const db = new Kysely<ApplicationDatabase>({
    dialect: new PostgresJSDialect({ postgres: client }),
  });
  return { db, destroy: () => db.destroy() };
}
