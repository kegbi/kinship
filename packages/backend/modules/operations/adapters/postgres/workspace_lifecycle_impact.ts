import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/**
 * What a workspace cascade destroys in operations. One table, so the digest
 * hashes that array on its own rather than a labelled object.
 */
export const PostgresOperationsWorkspaceLifecycleImpact =
  workspaceLifecycleImpact({
    counts: { operations: "crm.statistics_snapshots" },
    revision: "crm.statistics_snapshots@id",
  });
