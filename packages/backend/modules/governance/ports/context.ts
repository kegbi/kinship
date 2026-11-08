import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
/**
 * The context every governance port is invoked in.
 *
 * A repository is always asked a question on behalf of somebody, inside
 * somebody's unit of work. Both shapes are declared here rather than borrowed
 * from another module's facade, so the ports in this directory depend on
 * nothing outside governance.
 */

/**
 * The unit of work a port runs inside.
 *
 * The handle is opaque on purpose: the application layer passes it from the
 * runner to the port and never looks inside, so no use case learns what
 * database session an adapter hides in there.
 */
export interface LegalTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface LegalActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** The transaction a governance use case runs its work in. */
export interface LegalTransactionRunner {
  run<T>(
    work: (transaction: LegalTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}
