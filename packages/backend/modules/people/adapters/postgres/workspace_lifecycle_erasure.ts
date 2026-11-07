import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { WorkspaceLifecycleDependentErasure } from "../../../workspaces/public.ts";

/**
 * Deletes a workspace's people before the workspace row goes (SECT-03). Each
 * person takes every row it owns with it, including the contact methods whose
 * `RESTRICT` key on their type would otherwise abort the workspace cascade.
 */
export const PostgresPeopleWorkspaceLifecycleErasure:
  WorkspaceLifecycleDependentErasure = {
    async eraseBeforeCascade({ transaction, workspaceId }) {
      await sql`delete from crm.people where workspace_id = ${workspaceId}::uuid`
        .execute(databaseFromSession(transaction));
    },
  };
