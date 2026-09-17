/**
 * The context every files port is invoked in.
 *
 * A repository, boundary, or audit port is always asked a question on behalf
 * of somebody, inside somebody's unit of work. The actor was already declared
 * beside the use case, so the name it has always had is kept; the transaction
 * used to be borrowed from the people module's facade, which made every port
 * file import another module just to say which unit of work it ran in. Both
 * live here now, and the ports in this directory depend on nothing outside
 * files.
 */

/**
 * The unit of work a port runs inside.
 *
 * The handle is opaque on purpose: the application layer passes it from the
 * runner to the port and never looks inside, so no use case learns what
 * database session an adapter hides in there.
 */
export interface PersonFileTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface PersonFileActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** The transaction a files use case runs its work in. */
export interface PersonFileTransactionRunner {
  run<T>(work: (transaction: PersonFileTransaction) => Promise<T>): Promise<T>;
}
