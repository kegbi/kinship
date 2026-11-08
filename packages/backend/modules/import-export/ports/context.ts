import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
/**
 * The context every import-export port is invoked in.
 *
 * A repository is always asked a question on behalf of somebody, inside
 * somebody's unit of work. The module keeps two names for the same pair rather
 * than one shared pair, because the two halves are two public surfaces: an
 * adapter, an app route, and a test each says which side of the module it is
 * talking to, and collapsing the names would make an export repository look
 * like it could be handed an import's transaction.
 */

/**
 * The unit of work a port runs inside.
 *
 * The handle is opaque on purpose: the application layer passes it from the
 * runner to the port and never looks inside, so no use case learns what
 * database session an adapter hides in there.
 */
export interface ImportTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface ImportActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** The transaction an import use case runs its work in. */
export interface ImportTransactionRunner {
  run<T>(
    work: (transaction: ImportTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}

/** The unit of work an export port runs inside. */
export interface ExportTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface ExportActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** The transaction an export use case runs its work in. */
export interface ExportTransactionRunner {
  run<T>(
    work: (transaction: ExportTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}
