/**
 * Relationship tools: who a person is related to, and the vocabulary.
 */

import {
  listRelationships,
  listRelationshipTypes,
} from "../routes/relationships.ts";
import { type AgentTool, defineTool } from "./define.ts";

export const RELATIONSHIP_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_relationships",
    title: "List a person's relationships",
    description:
      "Reads one person's relationships in both directions (for example parent of, or child of), with the related person's id and name, archived people included. Pages with limit and nextCursor; a workspace that hides relationships returns none.",
    route: listRelationships,
  }),
  defineTool({
    name: "list_relationship_types",
    title: "List relationship types",
    description:
      "Reads the workspace's relationship types and their ids. search filters by name; selected (up to 20 ids) resolves types you already hold.",
    route: listRelationshipTypes,
  }),
];
