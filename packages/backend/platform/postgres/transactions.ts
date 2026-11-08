/**
 * The one PostgreSQL transaction runner.
 *
 * A use case declares its own opaque transaction type — `PeopleTransaction`,
 * `ExportTransaction`, and so on — so that nothing in the application layer can
 * look inside the handle. Five modules each wrote the same nine-line class to
 * produce one: open a Kysely transaction, wrap it as `{ opaque }`, hand it to
 * the work. The five bodies were identical apart from the type they named.
 *
 * `PostgresTransactionRunner` is that body, generic over the handle. A module
 * that must keep a public class name keeps it as a one-line subclass.
 *
 * Schema v14 forces row-level security on every tenant table (ADR 0008): a
 * statement sees and writes only the rows of the workspace its transaction
 * set with `set local app.workspace_id`. Every runner here therefore takes the
 * workspace as a scope and opens the transaction with it.
 */

import { type Kysely, sql } from "kysely";
import type {
  TransactionRunner,
  TransactionScope,
} from "../../shared-kernel/transaction.ts";
import type { ApplicationDatabase } from "./database.ts";
import { isUniqueViolation } from "./errors.ts";
import type { databaseFromSession } from "./session.ts";

const WORKSPACE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkedWorkspaceId(workspaceId: string): string {
  if (!WORKSPACE_ID.test(workspaceId)) {
    throw new RangeError("A transaction scope needs a workspace UUID.");
  }
  return workspaceId.toLowerCase();
}

/**
 * The transaction-local statement that scopes every following statement to
 * one workspace (ADR 0008). `set local` ends with the transaction, so a pooled
 * connection never carries it into the next one. The id is checked to be
 * exactly a UUID before it is written into the message, so the scope travels
 * with `begin` in one round trip, where a bound parameter cannot.
 */
export function workspaceScopeStatement(workspaceId: string): string {
  return `set local app.workspace_id = '${checkedWorkspaceId(workspaceId)}'`;
}

/**
 * Runs `work` on one connection inside a transaction that `opening`, one
 * simple-protocol message, begins; commits it, or rolls it back and rethrows
 * when the work fails.
 */
async function withinOpened<Result>(
  database: Kysely<ApplicationDatabase>,
  opening: string,
  work: (connection: Kysely<ApplicationDatabase>) => Promise<Result>,
): Promise<Result> {
  return await database.connection().execute(async (connection) => {
    await sql.raw(opening).execute(connection);
    let result: Result;
    try {
      result = await work(connection);
    } catch (error) {
      await sql.raw("rollback").execute(connection).catch(() => undefined);
      throw error;
    }
    await sql.raw("commit").execute(connection);
    return result;
  });
}

/**
 * Runs work inside one PostgreSQL transaction.
 *
 * `Session` is the opaque handle the owning module declares. The cast is the
 * one place the wrapper is asserted to produce that module's handle, and it is
 * sound because every such handle is `{ readonly opaque: unknown }` — the
 * module names the type so its own code cannot reach through it, not to add
 * structure the runner would have to know about.
 *
 * With a scope, `begin` and the workspace's `set local` go as one message, so
 * a scoped transaction costs the round trips an unscoped one does. Without
 * one, the transaction sees no tenant row: only account-level work and the
 * narrow cross-workspace functions run that way.
 */
export class PostgresTransactionRunner<
  Session extends { readonly opaque: unknown },
> implements TransactionRunner<Session> {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  run<Result>(
    work: (transaction: Session) => Promise<Result>,
    scope?: TransactionScope,
  ): Promise<Result> {
    if (scope === undefined) {
      return this.database.transaction().execute((transaction) =>
        work({ opaque: transaction } as Session)
      );
    }
    return withinOpened(
      this.database,
      `begin; ${workspaceScopeStatement(scope.workspaceId)}`,
      (connection) => work({ opaque: connection } as Session),
    );
  }
}

/**
 * Runs read work on one pooled connection.
 *
 * It hands the work the same opaque handle a transaction runner does, so an
 * adapter cannot tell them apart. Without a scope it sends no `begin` and no
 * `commit`: such a read touches only account-level tables or the narrow
 * cross-workspace functions, and each statement already sees committed data
 * at READ COMMITTED (BEQ-04). A read scoped to a workspace runs in a read-only
 * transaction instead, because the workspace is set with `set local`
 * (ADR 0008); `begin` and the scope travel as one message.
 */
export class PostgresConnectionRunner<
  Session extends { readonly opaque: unknown },
> implements TransactionRunner<Session> {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  run<Result>(
    work: (connection: Session) => Promise<Result>,
    scope?: TransactionScope,
  ): Promise<Result> {
    if (scope === undefined) {
      return this.database.connection().execute((connection) =>
        work({ opaque: connection } as Session)
      );
    }
    return withinOpened(
      this.database,
      `begin read only; ${workspaceScopeStatement(scope.workspaceId)}`,
      (connection) => work({ opaque: connection } as Session),
    );
  }
}

/**
 * Runs `work` in a read-only transaction whose statements PostgreSQL cancels
 * past `timeoutMs`, opened in one round trip.
 *
 * `begin read only`, `set local statement_timeout`, and — given a workspace —
 * its `set local` go as one simple-protocol message, so the bracket costs one
 * round trip in front of the work and one `commit` behind it, where `begin`,
 * `set transaction`, and `set_config(…, true)` cost three (BEQ-04). `set local`
 * ends with the transaction and never stays on a pooled connection. The
 * timeout is an integer this code chose, never a caller's text, so it is
 * written into the message rather than bound.
 */
export async function readOnlyWithin<Result>(
  database: Kysely<ApplicationDatabase>,
  timeoutMs: number,
  work: (transaction: Kysely<ApplicationDatabase>) => Promise<Result>,
  workspaceId?: string,
): Promise<Result> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`${timeoutMs} is no statement timeout`);
  }
  const scope = workspaceId === undefined
    ? ""
    : `; ${workspaceScopeStatement(workspaceId)}`;
  return await withinOpened(
    database,
    `begin read only; set local statement_timeout = ${timeoutMs}${scope}`,
    work,
  );
}

/**
 * Runs `work` in a read-only transaction scoped to one workspace, for a read
 * model that holds the pool rather than a runner. One message opens it. A
 * read whose statements must share one snapshot asks for `repeatable read`.
 */
export async function readWithinWorkspace<Result>(
  database: Kysely<ApplicationDatabase>,
  workspaceId: string,
  work: (transaction: Kysely<ApplicationDatabase>) => Promise<Result>,
  options: { readonly isolation?: "repeatable read" } = {},
): Promise<Result> {
  const isolation = options.isolation === "repeatable read"
    ? " isolation level repeatable read"
    : "";
  return await withinOpened(
    database,
    `begin${isolation} read only; ${workspaceScopeStatement(workspaceId)}`,
    work,
  );
}

/**
 * Runs `work` in a read-write transaction scoped to one workspace, for an
 * adapter that holds the pool rather than a runner. One message opens it.
 */
export async function writeWithinWorkspace<Result>(
  database: Kysely<ApplicationDatabase>,
  workspaceId: string,
  work: (transaction: Kysely<ApplicationDatabase>) => Promise<Result>,
): Promise<Result> {
  return await withinOpened(
    database,
    `begin; ${workspaceScopeStatement(workspaceId)}`,
    work,
  );
}

/**
 * Moves an open transaction into `workspaceId` for the statements that
 * follow, and answers the scope it had before (empty when none). A path that
 * learns its workspace only inside the transaction — registration creating
 * one, account lifecycle visiting each membership — uses this; `set_config`
 * with `true` is the bound form of `set local`.
 */
export async function enterWorkspace(
  database: ReturnType<typeof databaseFromSession>,
  workspaceId: string,
): Promise<string> {
  const result = await sql<{ readonly previous: string | null }>`
    select coalesce(current_setting('app.workspace_id', true), '') as previous,
      set_config('app.workspace_id', ${checkedWorkspaceId(workspaceId)}, true)
  `.execute(database);
  return result.rows[0]?.previous ?? "";
}

/** Restores the scope `enterWorkspace` answered, or clears it. */
export async function restoreWorkspace(
  database: ReturnType<typeof databaseFromSession>,
  previous: string,
): Promise<void> {
  await sql`select set_config('app.workspace_id', ${previous}, true)`
    .execute(database);
}

/**
 * Runs `work` with the open transaction moved into `workspaceId`, then puts
 * back the scope it had, so one transaction can act in each workspace of an
 * account in turn. The scope is restored when the work fails too, so a
 * caller that recovers from the failure is never left in the visited
 * workspace. A database error aborts the transaction, and then the restore
 * is refused as well (25P02); the work's own error is the one rethrown, and a
 * restore error surfaces only after work that succeeded.
 */
export async function inWorkspace<Result>(
  database: ReturnType<typeof databaseFromSession>,
  workspaceId: string,
  work: () => Promise<Result>,
): Promise<Result> {
  const previous = await enterWorkspace(database, workspaceId);
  let result: Result;
  try {
    result = await work();
  } catch (failure) {
    try {
      await restoreWorkspace(database, previous);
    } catch {
      // The transaction is already failing for the work's reason.
    }
    throw failure;
  }
  await restoreWorkspace(database, previous);
  return result;
}

/** The answer a conflicting write gives instead of throwing. */
export const UNIQUE_CONFLICT: unique symbol = Symbol(
  "postgres-unique-conflict",
);

/**
 * Attempts a write that may lose a uniqueness race, without losing the
 * transaction.
 *
 * PostgreSQL aborts the whole transaction on a failed statement, so a
 * repository that wants to answer "someone else got there first" and carry on
 * has to bracket the write in a savepoint. Three personalization repositories
 * had each written this, differing only in the savepoint's name.
 *
 * `name` is the savepoint identifier, raw SQL written by this repository and
 * never a caller's value. Any error that is not a unique violation is rethrown
 * after the rollback, so a real fault still reaches the transaction boundary.
 */
export async function writeWithUniqueConflict<Result>(
  database: ReturnType<typeof databaseFromSession>,
  name: string,
  write: () => Promise<Result>,
): Promise<Result | typeof UNIQUE_CONFLICT> {
  await sql.raw(`savepoint ${name}`).execute(database);
  try {
    const result = await write();
    await sql.raw(`release savepoint ${name}`).execute(database);
    return result;
  } catch (error) {
    await sql.raw(`rollback to savepoint ${name}`).execute(database);
    await sql.raw(`release savepoint ${name}`).execute(database);
    if (isUniqueViolation(error)) return UNIQUE_CONFLICT;
    throw error;
  }
}
