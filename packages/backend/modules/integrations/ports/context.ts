/**
 * The context every integrations port is invoked in.
 *
 * A repository, a remote, or a boundary is always asked a question on behalf
 * of somebody, inside somebody's unit of work. Both shapes are declared here
 * rather than borrowed from the workspaces facade, so the ports in this
 * directory depend on nothing outside integrations.
 */

import type { DavRole } from "../domain/dav_rules.ts";

/**
 * The unit of work a port runs inside.
 *
 * The handle is opaque on purpose: the application layer passes it from the
 * repository to the boundary and never looks inside, so no use case learns
 * what database session an adapter hides in there.
 */
export interface DavTransaction {
  readonly opaque: unknown;
}

/** Who is acting, as the workspace already established them. */
export interface DavActor {
  readonly memberId: string;
  readonly role: DavRole;
  readonly userId: string;
  readonly workspaceId: string;
}

/**
 * The actor-standing question this module asks `workspaces`.
 *
 * It is declared here so the repository adapter, which may not import another
 * module, can be given the one approved implementation at the composition
 * root.
 */
export interface DavActorRevalidation {
  revalidate(
    command: DavActor & {
      readonly lock: boolean;
      readonly transaction: { readonly opaque: unknown };
    },
  ): Promise<"active" | "revoked">;
}
