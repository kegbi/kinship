import { PostgresRelationshipBusinessImportBoundary } from "./adapters/postgres/business_import_boundary.ts";
/**
 * Relationships composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresRelationshipPersonMergeParticipant } from "./adapters/postgres/person_merge_participant.ts";
import { PostgresRelationshipPersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
import { PostgresRelationshipRepository } from "./adapters/postgres/relationship_repository.ts";
import { PostgresRelationshipWorkspaceLifecycleErasure } from "./adapters/postgres/workspace_lifecycle_erasure.ts";
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
  readonly importPeople: ConstructorParameters<
    typeof PostgresRelationshipBusinessImportBoundary
  >[0];
  readonly importVocabulary: ConstructorParameters<
    typeof PostgresRelationshipBusinessImportBoundary
  >[1];
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
    businessImportBoundary: new PostgresRelationshipBusinessImportBoundary(
      ports.importPeople,
      ports.importVocabulary,
    ),
    lifecycleErasure: PostgresRelationshipWorkspaceLifecycleErasure,
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

/**
 * This module's rows in a person merge (the relationship graph, GAP-049). It depends on
 * nothing the module composes, so the root registers it before composing
 * people.
 */
export function relationshipPersonMergeParticipant(): PostgresRelationshipPersonMergeParticipant {
  return new PostgresRelationshipPersonMergeParticipant();
}
