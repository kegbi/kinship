import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { WorkspaceLifecycleDependentErasure } from "../../../workspaces/public.ts";

/**
 * Deletes a workspace's relationships before the workspace row goes
 * (SECT-03), so their `RESTRICT` key on the relationship type never decides
 * whether the cascade succeeds.
 */
export const PostgresRelationshipWorkspaceLifecycleErasure:
  WorkspaceLifecycleDependentErasure = {
    async eraseBeforeCascade({ transaction, workspaceId }) {
      await sql`delete from crm.relationships
        where workspace_id = ${workspaceId}::uuid`
        .execute(databaseFromSession(transaction));
    },
  };
