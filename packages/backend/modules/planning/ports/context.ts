/**
 * The context every planning port is invoked in.
 *
 * A repository, boundary, or audit port is always asked a question on behalf
 * of somebody, inside somebody's unit of work. Planning used to borrow both
 * shapes from the people module's facade, which made a port file depend on
 * another module to say who was calling. They are declared here instead, the
 * way `workspaces` already declares the actor its own boundaries take, so the
 * ports in this directory depend on nothing outside planning.
 *
 * The shapes are deliberately the ones the rest of the backend already speaks:
 * the actor a workspace established and the opaque transaction handle a runner
 * hands out, so the application passes what it was given without translating.
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
export interface PlanningTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface PlanningActor extends Correlation {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

/** The transaction a planning use case runs its work in. */
export interface PlanningTransactionRunner {
  run<T>(
    work: (transaction: PlanningTransaction) => Promise<T>,
    scope?: TransactionScope,
  ): Promise<T>;
}
