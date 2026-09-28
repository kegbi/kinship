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

/**
 * The most connections one `connectDatabase` pool opens. Exported so a check
 * that must reserve every connection of the pool at once holds exactly this
 * many: fewer would miss some, more would wait forever for a free one.
 */
export const DATABASE_POOL_MAX = 8;

export function connectDatabase(url: string): DatabaseConnection {
  const client = postgres(url, {
    connect_timeout: 5,
    idle_timeout: 10,
    max: DATABASE_POOL_MAX,
    prepare: true,
  });
  const db = new Kysely<ApplicationDatabase>({
    dialect: new PostgresJSDialect({ postgres: client }),
  });
  return { db, destroy: () => db.destroy() };
}
