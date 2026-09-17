import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/**
 * What a workspace cascade destroys in governance. One table, so the digest
 * hashes that array on its own rather than a labelled object.
 */
export const PostgresGovernanceWorkspaceLifecycleImpact =
  workspaceLifecycleImpact({
    counts: { auditEvents: "crm.audit_events" },
    revision: "crm.audit_events@id",
  });
