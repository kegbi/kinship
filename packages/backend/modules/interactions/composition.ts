/**
 * Interactions composition. Only a declared composition root imports it.
 *
 * Activities and communications are one HTTP surface, so the two use cases are
 * merged here rather than at the root.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresCommunicationRepository } from "./adapters/postgres/communication_repository.ts";
import { PostgresInteractionRepository } from "./adapters/postgres/interaction_repository.ts";
import { PostgresJournalActivityBoundary } from "./adapters/postgres/journal_activity_boundary.ts";
import { PostgresInteractionPersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
import { PostgresInteractionWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import {
  communicationAuditFrom,
  createCommunicationManagement,
  createInteractionManagement,
  interactionAuditFrom,
  type InteractionRecordedPublisher,
  type InteractionWorkspaceBoundary,
} from "./public.ts";
import type { InteractionPersonBoundary } from "../people/public.ts";
import type { InteractionWorkspaceBoundary as CommunicationWorkspaceBoundary } from "../workspaces/public.ts";

/**
 * The activity a journal item may point at. Journal reads interactions through
 * it, and it needs nothing else, so a root can build it first.
 */
export function journalActivityBoundary(): PostgresJournalActivityBoundary {
  return new PostgresJournalActivityBoundary();
}

export interface InteractionPorts {
  readonly people: InteractionPersonBoundary;
  /** Planning's hook: recording an interaction settles a stay-in-touch. */
  readonly publisher: InteractionRecordedPublisher;
  readonly workspace:
    & CommunicationWorkspaceBoundary
    & InteractionWorkspaceBoundary;
}

export function composeInteractions(
  shared: SharedComposition,
  ports: InteractionPorts,
) {
  const common = {
    actors: shared.actors,
    clock: shared.clock,
    people: ports.people,
    publisher: ports.publisher,
    transaction: shared.peopleTransaction,
    workspace: ports.workspace,
  };
  return {
    interactions: {
      ...createInteractionManagement({
        ...common,
        audit: interactionAuditFrom(shared.audit),
        repository: new PostgresInteractionRepository(),
      }),
      ...createCommunicationManagement({
        ...common,
        audit: communicationAuditFrom(shared.audit),
        repository: new PostgresCommunicationRepository(),
      }),
    },
    lifecycleImpact: PostgresInteractionWorkspaceLifecycleImpact,
    personalizationReferences: PostgresInteractionPersonalizationReferences,
  };
}
