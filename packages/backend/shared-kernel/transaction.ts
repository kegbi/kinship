/**
 * The transaction boundary as application code sees it.
 *
 * A use case never opens a connection: it takes a runner and hands it the work
 * to perform inside one transaction. Twenty-seven files spelled that runner's
 * shape out by hand, and fourteen of them wrapped every call in the same
 * `try { transaction.run(...) } catch { return { status: "unavailable" } }`,
 * so both live here now.
 *
 * This module is still pure: `run` is a shape, not a driver, so the kernel
 * stays a leaf and the concrete runner is built at a composition root.
 */

import type { Failure } from "./result.ts";

/**
 * The workspace a transaction works in (ADR 0008). Every statement of a
 * transaction run with a scope sees and writes only that workspace's tenant
 * rows; one run without a scope sees none, so only account-level work and the
 * few narrow cross-workspace paths run unscoped.
 */
export interface TransactionScope {
  readonly workspaceId: string;
}

/** The transaction runner a use case depends on. */
export interface TransactionRunner<Transaction> {
  run<Result>(
    work: (transaction: Transaction) => Promise<Result>,
    scope?: TransactionScope,
  ): Promise<Result>;
}

/**
 * Runs `work` inside one transaction and turns a thrown error into the shared
 * `unavailable` failure.
 *
 * Only an infrastructure fault throws here — a dropped connection, a
 * serialization failure, a statement the database refused. A use case's own
 * outcome, success or failure, is a returned value and passes through
 * untouched.
 */
export async function runOrUnavailable<Transaction, Result>(
  transaction: TransactionRunner<Transaction>,
  work: (transaction: Transaction) => Promise<Result>,
  scope?: TransactionScope,
): Promise<Result | Failure<"unavailable">> {
  try {
    return await transaction.run(work, scope);
  } catch {
    return { status: "unavailable" };
  }
}
