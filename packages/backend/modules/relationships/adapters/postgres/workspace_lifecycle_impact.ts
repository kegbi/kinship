import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/** What a workspace cascade destroys in relationships, table by table. */
export const PostgresRelationshipWorkspaceLifecycleImpact =
  workspaceLifecycleImpact({
    counts: { relationships: "crm.relationships" },
    revision: {
      relationships: "crm.relationships@id",
      romantic:
        "crm.romantic_relationship_details@relationship_id via crm.relationships.relationship_id",
    },
  });
