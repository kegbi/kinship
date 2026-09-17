/**
 * Operations composition. The module owns no use case yet: its only
 * infrastructure is the share of a workspace cascade it contributes.
 */

import { PostgresOperationsWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";

export function composeOperations() {
  return { lifecycleImpact: PostgresOperationsWorkspaceLifecycleImpact };
}
