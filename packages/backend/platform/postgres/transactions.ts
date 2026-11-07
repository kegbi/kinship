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
 */

import { type Kysely, sql } from "kysely";
import type { TransactionRunner } from "../../shared-kernel/transaction.ts";
import type { ApplicationDatabase } from "./database.ts";
import { isUniqueViolation } from "./errors.ts";
import type { databaseFromSession } from "./session.ts";

/**
 * Runs work inside one PostgreSQL transaction.
 *
 * `Session` is the opaque handle the owning module declares. The cast is the
 * one place the wrapper is asserted to produce that module's handle, and it is
 * sound because every such handle is `{ readonly opaque: unknown }` — the
 * module names the type so its own code cannot reach through it, not to add
 * structure the runner would have to know about.
 */
export class PostgresTransactionRunner<
  Session extends { readonly opaque: unknown },
> implements TransactionRunner<Session> {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  run<Result>(
    work: (transaction: Session) => Promise<Result>,
  ): Promise<Result> {
    return this.database.transaction().execute((transaction) =>
      work({ opaque: transaction } as Session)
    );
  }
}

/**
 * Runs work on one pooled connection, without a transaction around it.
 *
 * It hands the work the same opaque handle a transaction runner does, so an
 * adapter cannot tell them apart, but it sends no `begin` and no `commit`: a
 * read whose statements need no common snapshot — each statement already
 * sees committed data at READ COMMITTED, inside a transaction or not — costs
 * only its own round trips (BEQ-04). Every statement still runs on the one
 * connection the work was given.
 */
export class PostgresConnectionRunner<
  Session extends { readonly opaque: unknown },
> implements TransactionRunner<Session> {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  run<Result>(
    work: (connection: Session) => Promise<Result>,
  ): Promise<Result> {
    return this.database.connection().execute((connection) =>
      work({ opaque: connection } as Session)
    );
  }
}

/**
 * Runs `work` in a read-only transaction whose statements PostgreSQL cancels
 * past `timeoutMs`, opened in one round trip.
 *
 * `begin read only` and `set local statement_timeout` go as one simple-protocol
 * message, so the bracket costs one round trip in front of the work and one
 * `commit` behind it, where `begin`, `set transaction`, and
 * `set_config(…, true)` cost three (BEQ-04). `set local` ends with the
 * transaction and never stays on a pooled connection. The timeout is an
 * integer this code chose, never a caller's text, so it is written into the
 * message rather than bound. Further transaction-local settings — the
 * workspace ADR 0008 will set — belong in the same message.
 */
export async function readOnlyWithin<Result>(
  database: Kysely<ApplicationDatabase>,
  timeoutMs: number,
  work: (transaction: Kysely<ApplicationDatabase>) => Promise<Result>,
): Promise<Result> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`${timeoutMs} is no statement timeout`);
  }
  return await database.connection().execute(async (connection) => {
    await sql.raw(
      `begin read only; set local statement_timeout = ${timeoutMs}`,
    ).execute(connection);
    let result: Result;
    try {
      result = await work(connection);
    } catch (error) {
      await sql.raw("rollback").execute(connection);
      throw error;
    }
    await sql.raw("commit").execute(connection);
    return result;
  });
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
