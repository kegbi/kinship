import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "./database.ts";
import { databaseFromSession } from "./session.ts";
import { PostgresTransactionRunner } from "./transactions.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

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
