import {
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from "kysely";
import type { ApplicationDatabase } from "./database.ts";
import { databaseFromSession } from "./session.ts";
import {
  inWorkspace,
  lockWorkspaceLifecycle,
  PostgresTransactionRunner,
  readOnlyWithin,
  sharingWorkspaceLifecycle,
  workspaceScopeStatement,
} from "./transactions.ts";
import type { TransactionScope } from "../../shared-kernel/transaction.ts";
import { assert } from "../../testing/assert.ts";

/** A module's opaque handle, declared the way every module declares one. */
interface PeopleTransaction {
  readonly opaque: unknown;
}

function database(
  record: (handle: unknown) => void,
): Kysely<ApplicationDatabase> {
  const handle = { marker: "kysely-transaction" };
  return {
    transaction: () => ({
      execute: <Result>(work: (transaction: unknown) => Promise<Result>) => {
        record(handle);
        return work(handle);
      },
    }),
  } as unknown as Kysely<ApplicationDatabase>;
}

Deno.test("[GAP-010] one runner produces any module's opaque handle", async () => {
  const opened: unknown[] = [];
  const runner = new PostgresTransactionRunner<PeopleTransaction>(
    database((handle) => opened.push(handle)),
  );
  const seen: PeopleTransaction[] = [];
  const result = await runner.run((transaction) => {
    seen.push(transaction);
    return Promise.resolve({ personId: "8d2c" });
  });
  assert(
    result.personId === "8d2c",
    "the work's own result passes through untouched",
  );
  assert(
    opened.length === 1 && seen.length === 1,
    `exactly one transaction is opened, received ${opened.length}`,
  );
  assert(
    databaseFromSession(seen[0]!) === opened[0],
    "the handle carries the Kysely transaction the session helper unwraps",
  );
});

Deno.test("[GAP-010] a failing unit of work keeps its own error", async () => {
  const runner = new PostgresTransactionRunner<PeopleTransaction>(
    database(() => {}),
  );
  const failure = await runner.run(() =>
    Promise.reject(new Error("rolled back"))
  )
    .catch((error: unknown) => error);
  assert(
    failure instanceof Error && failure.message === "rolled back",
    `the runner never swallows a fault, received ${failure}`,
  );
});

Deno.test("[AUD-V2] a transaction scope is exactly one workspace UUID, written lowercase", () => {
  assert(
    workspaceScopeStatement("8D2C1B3A-0000-4000-8000-00000000AAAA") ===
      "set local app.workspace_id = '8d2c1b3a-0000-4000-8000-00000000aaaa'",
    "the scope is a transaction-local setting of the lowercased id",
  );
  for (
    const forged of [
      "",
      "not-a-uuid",
      "8d2c1b3a-0000-4000-8000-00000000aaaa'; reset role; --",
      " 8d2c1b3a-0000-4000-8000-00000000aaaa",
    ]
  ) {
    let refused = false;
    try {
      workspaceScopeStatement(forged);
    } catch (error) {
      refused = error instanceof RangeError;
    }
    assert(refused, `the scope ${JSON.stringify(forged)} is refused`);
  }
});

Deno.test("[AUD-V2] a bounded read refuses a forged workspace before it connects", async () => {
  let connected = false;
  const pool = {
    connection: () => {
      connected = true;
      throw new Error("no connection expected");
    },
  } as unknown as Kysely<ApplicationDatabase>;
  let refused = false;
  try {
    await readOnlyWithin(pool, 1_000, () => Promise.resolve(1), "x'--");
  } catch (error) {
    refused = error instanceof RangeError;
  }
  assert(refused && !connected, "the forged scope is refused first");
});

/**
 * A Kysely whose one connection keeps `app.workspace_id` the way PostgreSQL's
 * `set_config(…, true)` does inside a transaction, for `inWorkspace`.
 */
function scopedDatabase(
  initial: string,
  options: { readonly restoreFails?: Error } = {},
): {
  readonly database: Kysely<ApplicationDatabase>;
  readonly scope: () => string;
} {
  let scope = initial;
  const connection: DatabaseConnection = {
    executeQuery<Row>(query: CompiledQuery) {
      const [value] = query.parameters as string[];
      if (query.sql.includes("as previous")) {
        const previous = scope;
        scope = value ?? "";
        return Promise.resolve({ rows: [{ previous } as Row] });
      }
      if (query.sql.includes("set_config")) {
        // As in a transaction PostgreSQL aborted: every statement fails.
        if (options.restoreFails) return Promise.reject(options.restoreFails);
        scope = value ?? "";
      }
      return Promise.resolve({ rows: [] });
    },
    streamQuery() {
      throw new Error("not streamed");
    },
  };
  const driver: Driver = {
    acquireConnection: () => Promise.resolve(connection),
    beginTransaction: () => Promise.resolve(),
    commitTransaction: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
    init: () => Promise.resolve(),
    releaseConnection: () => Promise.resolve(),
    rollbackTransaction: () => Promise.resolve(),
  };
  const database = new Kysely<ApplicationDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { database, scope: () => scope };
}

Deno.test("[AUD-V2] inWorkspace returns to the scope it came with, also when the work fails", async () => {
  const home = "00000000-0000-4000-8000-00000000000a";
  const visited = "00000000-0000-4000-8000-00000000000b";
  const { database, scope } = scopedDatabase(home);
  const handle = database as unknown as ReturnType<typeof databaseFromSession>;

  let inside = "";
  const answer = await inWorkspace(handle, visited, () => {
    inside = scope();
    return Promise.resolve("done");
  });
  assert(
    answer === "done" && inside === visited && scope() === home,
    `inWorkspace did not visit and return: ${
      JSON.stringify({ answer, inside, after: scope() })
    }`,
  );

  const failure = new Error("the visit failed");
  let thrown: unknown;
  try {
    await inWorkspace(handle, visited, () => Promise.reject(failure));
  } catch (error) {
    thrown = error;
  }
  assert(thrown === failure, "inWorkspace kept the work's own error");
  assert(
    scope() === home,
    `a failed visit left the transaction in ${scope()}, not ${home}`,
  );
  await database.destroy();
});

Deno.test("[AUD-V2] a failed visit keeps the work's error when the restore fails too", async () => {
  // A database error aborts the transaction, so the restore that follows is
  // refused (25P02); that refusal must not replace the error that caused it.
  const aborted = Object.assign(
    new Error("current transaction is aborted"),
    { code: "25P02" },
  );
  const { database } = scopedDatabase("00000000-0000-4000-8000-00000000000a", {
    restoreFails: aborted,
  });
  const handle = database as unknown as ReturnType<typeof databaseFromSession>;
  const failure = Object.assign(new Error("duplicate key"), { code: "23505" });
  let thrown: unknown;
  try {
    await inWorkspace(
      handle,
      "00000000-0000-4000-8000-00000000000b",
      () => Promise.reject(failure),
    );
  } catch (error) {
    thrown = error;
  }
  assert(
    thrown === failure,
    `the restore's refusal replaced the work's error: ${String(thrown)}`,
  );

  // When the work succeeds, a failed restore is the error to report.
  let restoreError: unknown;
  try {
    await inWorkspace(
      handle,
      "00000000-0000-4000-8000-00000000000b",
      () => Promise.resolve("done"),
    );
  } catch (error) {
    restoreError = error;
  }
  assert(
    restoreError === aborted,
    "a failed restore after successful work went unreported",
  );
  await database.destroy();
});

/** A Kysely that records each statement it is sent and answers no rows. */
function recordingDatabase(): {
  readonly database: Kysely<ApplicationDatabase>;
  readonly statements: {
    readonly parameters: unknown[];
    readonly sql: string;
  }[];
} {
  const statements: { parameters: unknown[]; sql: string }[] = [];
  const connection: DatabaseConnection = {
    executeQuery<Row>(query: CompiledQuery) {
      statements.push({ parameters: [...query.parameters], sql: query.sql });
      return Promise.resolve({ rows: [] as Row[] });
    },
    streamQuery() {
      throw new Error("not streamed");
    },
  };
  const driver: Driver = {
    acquireConnection: () => Promise.resolve(connection),
    beginTransaction: () => Promise.resolve(),
    commitTransaction: () => Promise.resolve(),
    destroy: () => Promise.resolve(),
    init: () => Promise.resolve(),
    releaseConnection: () => Promise.resolve(),
    rollbackTransaction: () => Promise.resolve(),
  };
  const database = new Kysely<ApplicationDatabase>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { database, statements };
}

Deno.test("[MCP-F3] a workspace's lifecycle lock is one advisory key, exclusive or shared", async () => {
  const { database, statements } = recordingDatabase();
  const workspaceId = "00000000-0000-4000-8000-00000000000a";
  await lockWorkspaceLifecycle(database, workspaceId, "exclusive");
  await lockWorkspaceLifecycle(database, workspaceId, "shared");
  assert(
    statements.length === 2 &&
      statements[0]!.sql ===
        "select pg_advisory_xact_lock(hashtextextended($1, 7))" &&
      statements[1]!.sql ===
        "select pg_advisory_xact_lock_shared(hashtextextended($1, 7))" &&
      statements.every((statement) =>
        statement.parameters.length === 1 &&
        statement.parameters[0] === workspaceId
      ),
    `the lifecycle lock statements: ${JSON.stringify(statements)}`,
  );
  await database.destroy();
});

Deno.test("[MCP-F3] a sharing runner holds the lifecycle lock first in a workspace, and takes none outside one", async () => {
  const { database, statements } = recordingDatabase();
  const workspaceId = "00000000-0000-4000-8000-00000000000b";
  const scopes: (TransactionScope | undefined)[] = [];
  const runner = sharingWorkspaceLifecycle<PeopleTransaction>({
    run: (work, scope) => {
      scopes.push(scope);
      return work({ opaque: database });
    },
  });
  const seen: number[] = [];
  const scoped = await runner.run((transaction) => {
    seen.push(statements.length);
    return Promise.resolve(transaction.opaque === database);
  }, { workspaceId });
  const unscoped = await runner.run(() => {
    seen.push(statements.length);
    return Promise.resolve("account-level");
  });
  assert(
    scoped && unscoped === "account-level" &&
      JSON.stringify(scopes) === JSON.stringify([{ workspaceId }, undefined]),
    `the runner passed its work and scope through: ${JSON.stringify(scopes)}`,
  );
  assert(
    JSON.stringify(seen) === "[1,1]" &&
      statements[0]!.sql ===
        "select pg_advisory_xact_lock_shared(hashtextextended($1, 7))" &&
      statements[0]!.parameters[0] === workspaceId,
    `the scoped work ran after the shared lock alone: ${
      JSON.stringify({ seen, statements })
    }`,
  );
  await database.destroy();
});
