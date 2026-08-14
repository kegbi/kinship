import { Kysely } from "kysely";
import { PostgresJSDialect } from "kysely-postgres-js";
import postgres from "postgres";

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
