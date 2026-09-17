/**
 * Relationships composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresRelationshipPersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
import { PostgresRelationshipRepository } from "./adapters/postgres/relationship_repository.ts";
import { PostgresRelationshipWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import {
  createRelationshipManagement,
  relationshipAuditFrom,
} from "./public.ts";
import type {
  RelationshipPersonBoundary,
  TransactionalPeopleCreation,
} from "../people/public.ts";
import type { RelationshipWorkspaceBoundary } from "../workspaces/public.ts";

export interface RelationshipPorts {
  readonly people: RelationshipPersonBoundary;
  /** Creating the other side of a relationship creates a person. */
  readonly peopleCreation: TransactionalPeopleCreation;
  readonly workspace: RelationshipWorkspaceBoundary;
}

export function composeRelationships(
  shared: SharedComposition,
  ports: RelationshipPorts,
) {
  return {
    lifecycleImpact: PostgresRelationshipWorkspaceLifecycleImpact,
    personalizationReferences: PostgresRelationshipPersonalizationReferences,
    relationships: createRelationshipManagement({
      actors: shared.actors,
      audit: relationshipAuditFrom(shared.audit),
      clock: shared.clock,
      ids: shared.ids,
      people: ports.people,
      peopleCreation: ports.peopleCreation,
      repository: new PostgresRelationshipRepository(),
      transaction: shared.peopleTransaction,
      workspace: ports.workspace,
    }),
  };
}
