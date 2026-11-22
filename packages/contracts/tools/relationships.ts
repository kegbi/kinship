/**
 * Relationship tools: who a person is related to, the vocabulary, and the
 * writes. One stored edge supplies both directions, so an agent creates it
 * once, from either person.
 */

import {
  createRelationship,
  deleteRelationship,
  listRelationships,
  listRelationshipTypes,
  updateRelationship,
} from "../routes/relationships.ts";
import { type AgentTool, defineTool } from "./define.ts";

export const RELATIONSHIP_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_relationships",
    title: "List a person's relationships",
    description:
      "Lists one person's relationships in both directions (for example parent of, or child of), archived people included: each has its id, updatedAt, relationship type and labels, and the two people's ids with the related person's name. Pages with limit and nextCursor; a workspace that hides relationships returns none. Use the id and updatedAt with update_relationship and delete_relationship.",
    route: listRelationships,
  }),
  defineTool({
    name: "list_relationship_types",
    title: "List relationship types",
    description:
      "Lists the workspace's relationship types with their ids and their forward and reverse labels (parent of / child of), for create_relationship and update_relationship. search filters by name, nextCursor pages, and selected (up to 20 ids) resolves types you already hold.",
    route: listRelationshipTypes,
  }),
  defineTool({
    name: "create_relationship",
    title: "Relate two people",
    description:
      "Relates personId to targetPersonId with a relationship type (relationshipTypeId from list_relationship_types). personId is the edge's from person, so the type's forward label reads from personId to targetPersonId and its reverse label back. Both people must be active. One edge supplies both directions, so never create the reverse as well. Safe to repeat: an edge that already exists is answered as existing rather than duplicated.",
    route: createRelationship,
    annotations: { idempotentHint: true },
  }),
  defineTool({
    name: "update_relationship",
    title: "Change a relationship's type",
    description:
      "Changes only the relationship type of one edge (relationshipTypeId from list_relationship_types). relationshipId and expectedUpdatedAt are the edge's id and updatedAt from list_relationships for personId, either person of the edge; a stale revision is refused as a conflict. Both people must be active.",
    route: updateRelationship,
  }),
  defineTool({
    name: "delete_relationship",
    title: "Remove a relationship",
    description:
      "Permanently removes one relationship between two people, in both directions, without deleting either person. relationshipId and expectedUpdatedAt are the edge's id and updatedAt from list_relationships; a stale revision is refused as a conflict. Both people must be active.",
    route: deleteRelationship,
  }),
];
