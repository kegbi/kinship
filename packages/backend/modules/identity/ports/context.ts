import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
/**
 * The context every identity port is invoked in.
 *
 * Identity has no actor of its own: a caller who has not signed in yet has no
 * membership, and a caller who has is described by `workspaces`, not here. So
 * the context is the unit of work and nothing else, and every port that writes
 * takes it.
 */

/**
 * The unit of work a port runs inside.
 *
 * The handle is opaque on purpose: the application layer passes it from the
 * runner to the port and never looks inside, so no use case learns what
 * database session an adapter hides in there.
 */
export interface IdentityTransaction {
  readonly opaque: unknown;
}

/** The transaction an identity use case runs its work in. */
export interface IdentityTransactionRunner {
  run<T>(
    work: (transaction: IdentityTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}
