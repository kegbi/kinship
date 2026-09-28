import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PeopleBulkTagLookup } from "../../public.ts";

/**
 * Whether a bulk action's tag is the workspace's own (GAP-051): one scoped
 * existence check by id, inside the caller's transaction.
 */
export class PostgresBulkTagLookup implements PeopleBulkTagLookup {
  async exists(
    command: Parameters<PeopleBulkTagLookup["exists"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly found: boolean }>`
      select exists(
        select 1 from crm.tags
        where id = ${command.tagId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
      ) as found
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.found === true;
  }
}
