/**
 * The context every people port is invoked in.
 *
 * A repository, boundary, publisher, or audit port is always asked a question
 * on behalf of somebody, inside somebody's unit of work. Both of those were
 * declared beside the person-creation use case, which made every other port
 * file import a use case to say who was calling. They live here instead, and
 * the ports in this directory are the only files that need them.
 */

/**
 * The unit of work a port runs inside.
 *
 * The handle is opaque on purpose: the application layer passes it from the
 * runner to the port and never looks inside, so no use case learns what
 * database session an adapter hides in there.
 */
export interface PeopleTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface PeopleActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** The transaction a people use case runs its work in. */
export interface PeopleTransactionRunner {
  run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
}
