/**
 * The context every interactions port is invoked in.
 *
 * A repository, boundary, publisher, or audit port is always asked a question
 * on behalf of somebody, inside somebody's unit of work. Both shapes used to
 * be borrowed from the people module's facade, which made every port here
 * depend on another module just to say who was calling. They are declared in
 * this file instead, the way `workspaces` already declares the actor its own
 * boundaries take, so the ports in this directory depend on nothing outside
 * interactions.
 *
 * The shapes are deliberately the ones the rest of the backend already speaks:
 * the actor a workspace established and the opaque transaction handle a runner
 * hands out, so the application passes on what it was given without
 * translating it.
 */

import type { TransactionScope } from "../../../shared-kernel/transaction.ts";
import type { Correlation } from "../../../shared-kernel/telemetry.ts";

/**
 * The unit of work a port runs inside.
 *
 * The handle is opaque on purpose: the application layer passes it from the
 * runner to the port and never looks inside, so no use case learns what
 * database session an adapter hides in there.
 */
export interface InteractionTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface InteractionActor extends Correlation {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** The transaction an interactions use case runs its work in. */
export interface InteractionTransactionRunner {
  run<T>(
    work: (transaction: InteractionTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}
