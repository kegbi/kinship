/**
 * The context every api-access port is invoked in.
 *
 * A repository or audit port is always asked a question on behalf of somebody,
 * inside somebody's unit of work. Both shapes are declared here rather than
 * borrowed from the workspaces facade, so the ports in this directory depend
 * on nothing outside api-access.
 */

import type { ApiTokenRole } from "../domain/token_rules.ts";
import type { Correlation } from "../../../shared-kernel/telemetry.ts";

/**
 * The unit of work a port runs inside.
 *
 * The handle is opaque on purpose: the application layer passes it from the
 * runner to the port and never looks inside, so no use case learns what
 * database session an adapter hides in there.
 */
export interface ApiTokenTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface ApiTokenActor extends Correlation {
  readonly memberId: string;
  readonly role: ApiTokenRole;
  readonly userId: string;
  readonly workspaceId: string;
}

/** The transaction an api-access use case runs its work in. */
export interface ApiTokenTransactionRunner {
  run<T>(work: (transaction: ApiTokenTransaction) => Promise<T>): Promise<T>;
}
