/**
 * The context every journal port is invoked in.
 *
 * A repository or audit port is always asked a question on behalf of somebody,
 * inside somebody's unit of work. Both shapes used to be borrowed from the
 * people module's facade, which made a port file depend on another module just
 * to say who was calling. They are declared here instead, the way `workspaces`
 * already declares the actor its own boundaries take, so the ports in this
 * directory depend on nothing outside journal.
 */

/**
 * The unit of work a port runs inside.
 *
 * The handle is opaque on purpose: the application layer passes it from the
 * runner to the port and never looks inside, so no use case learns what
 * database session an adapter hides in there.
 */
export interface JournalTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface JournalActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** The transaction a journal use case runs its work in. */
export interface JournalTransactionRunner {
  run<T>(work: (transaction: JournalTransaction) => Promise<T>): Promise<T>;
}
