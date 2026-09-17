/**
 * What recording or reading an interaction needs before it may proceed.
 *
 * Both halves of the use case start the same way — open the caller's
 * transaction and ask the workspace whether the actor still stands — and the
 * only difference between them is the lock. That step and the dependency set
 * both halves share are written once here, so `interaction_listing.ts` and
 * `interaction_writes.ts` carry orchestration and nothing else.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { InteractionAudit } from "../ports/audit.ts";
import type {
  InteractionActor,
  InteractionTransaction,
  InteractionTransactionRunner,
} from "../ports/context.ts";
import type {
  InteractionRecordedPublisher,
  InteractionRepository,
  InteractionWorkspaceBoundary,
} from "../ports/interaction_repository.ts";
import type { InteractionPersonBoundary } from "../../people/public.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface InteractionDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: InteractionAudit;
  readonly clock: Clock;
  readonly people: InteractionPersonBoundary;
  readonly publisher?: InteractionRecordedPublisher;
  readonly repository: InteractionRepository;
  readonly transaction: InteractionTransactionRunner;
  readonly workspace: InteractionWorkspaceBoundary;
}

/**
 * The actor's standing, asked first inside the caller's transaction. Write
 * paths lock the actor's rows; read paths keep their lock-free concurrency.
 */
export async function active(
  dependencies: Pick<InteractionDependencies, "actors">,
  actor: InteractionActor,
  transaction: InteractionTransaction,
  lock: boolean,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock,
    transaction,
  }) === "active";
}

/** The actor with every identifier in the case the module stores them in. */
export function canonicalActor(actor: InteractionActor): InteractionActor {
  return {
    ...actor,
    memberId: actor.memberId.toLowerCase(),
    userId: actor.userId.toLowerCase(),
    workspaceId: actor.workspaceId.toLowerCase(),
  };
}
