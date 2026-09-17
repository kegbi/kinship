/**
 * The relationship facade.
 *
 * The graph is read two ways — the workspace's vocabulary and one person's
 * edges — and written four, and the two halves share only the context they
 * both establish first. They are assembled here so a composition root still
 * builds a single object with `listTypes`, `list`, `create`,
 * `createRelatedPerson`, `update`, and `delete` on it, and so the split
 * between `relationship_listing.ts` and `relationship_writes.ts` stays an
 * internal matter rather than something every caller has to know about.
 */

import { createRelationshipListing } from "./relationship_listing.ts";
import { createRelationshipWrites } from "./relationship_writes.ts";
import type { RelationshipDependencies } from "./relationship_context.ts";

export function createRelationshipManagement(
  dependencies: RelationshipDependencies,
) {
  const listing = createRelationshipListing(dependencies);
  const writes = createRelationshipWrites(dependencies);
  return {
    listTypes: listing.listTypes,
    list: listing.list,
    create: writes.create,
    createRelatedPerson: writes.createRelatedPerson,
    update: writes.update,
    delete: writes.delete,
  };
}

export type RelationshipManagement = ReturnType<
  typeof createRelationshipManagement
>;
