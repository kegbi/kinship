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

/**
 * How long one statement of a request may run before PostgreSQL cancels it
 * (SECA-15). It sits below the gateway's 15 s, so a stalled database frees the
 * API's connection and answers 503 before the gateway gives up with a 504.
 * A read model that bounds its own statements more tightly (search, the
 * calendar feed) still does so with `SET LOCAL` inside its transaction.
 */
export const REQUEST_STATEMENT_TIMEOUT_MS = 10_000;

/**
 * How long a pooled connection may sit unused before it is closed. An
 * interactive pause between two clicks is shorter than this, so the next
 * request does not pay for a new backend and its SCRAM exchange (BEQ-04).
 */
export const DATABASE_IDLE_TIMEOUT_SECONDS = 120;

/**
 * How long a connection lives at most. It bounds the per-connection prepared
 * statement cache and lets a pool follow a failover or a changed setting.
 */
export const DATABASE_MAX_LIFETIME_SECONDS = 30 * 60;

/** What a caller may change about the pool. */
export interface DatabaseOptions {
  /**
   * Called with each statement's text as it is sent, so a suite can count
   * the statements one request costs. Production passes nothing.
   */
  readonly onStatement?: (text: string) => void;
  /**
   * The statement timeout, in milliseconds. The API keeps the request bound;
   * the worker, which no gateway waits on, passes its own.
   */
  readonly statementTimeoutMs?: number;
}

/**
 * The client as the Kysely dialect sees it, with every parameterized
 * statement prepared.
 *
 * The dialect sends each statement through `unsafe(sql, parameters)`, and
 * postgres.js prepares nothing sent that way unless asked, so the pool's
 * `prepare: true` alone had no effect: every statement was parsed and planned
 * afresh, and one with parameters cost an extra describe round trip before it
 * could be bound (BEQ-04). Asking for it here prepares each distinct statement
 * text once per connection; postgres.js re-prepares one a schema change has
 * invalidated. A statement without parameters keeps the simple protocol, so
 * `begin` and `commit` are unchanged.
 */
function preparedStatements(client: postgres.Sql) {
  return () => ({
    end: () => client.end(),
    async reserve() {
      const reserved = await client.reserve();
      return {
        release: () => reserved.release(),
        unsafe: (
          text: string,
          parameters: postgres.ParameterOrJSON<never>[] = [],
          queryOptions: postgres.UnsafeQueryOptions = {},
        ) =>
          reserved.unsafe(text, parameters, {
            ...queryOptions,
            prepare: true,
          }),
      };
    },
  });
}

export function connectDatabase(
  url: string,
  options: DatabaseOptions = {},
): DatabaseConnection {
  const { onStatement } = options;
  const client = postgres(url, {
    connect_timeout: 5,
    connection: {
      statement_timeout: options.statementTimeoutMs ??
        REQUEST_STATEMENT_TIMEOUT_MS,
    },
    ...(onStatement
      ? { debug: (_connection: number, text: string) => onStatement(text) }
      : {}),
    idle_timeout: DATABASE_IDLE_TIMEOUT_SECONDS,
    max: DATABASE_POOL_MAX,
    max_lifetime: DATABASE_MAX_LIFETIME_SECONDS,
    prepare: true,
  });
  const db = new Kysely<ApplicationDatabase>({
    dialect: new PostgresJSDialect({ postgres: preparedStatements(client) }),
  });
  return { db, destroy: () => db.destroy() };
}
