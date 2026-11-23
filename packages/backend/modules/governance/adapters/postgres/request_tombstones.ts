import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { isRequestDerivedId } from "../../../../shared-kernel/ids.ts";
import type {
  RequestTombstoneQuery,
  RequestTombstones,
  RequestTombstoneWrite,
} from "../../../../shared-kernel/request_tombstone.ts";

/**
 * The one reader and writer of `crm.request_tombstones` (schema v16, MCP-E3).
 *
 * Both statements run in the caller's transaction, which a workspace scope
 * already binds, so the table's forced row-level security admits only that
 * workspace's rows; the explicit `workspace_id` predicate is the application's
 * own check beside it. The lookup is a point read on the primary key
 * `(workspace_id, record_id)`.
 */
export class PostgresRequestTombstones implements RequestTombstones {
  /**
   * Keeps a tombstone only for an id a retry key could have derived: a random
   * id is never reached by a keyed create, so its tombstone would be dead
   * weight. `on conflict do nothing` keeps a second delete of the same id —
   * which no path makes, since the create is refused once the tombstone
   * exists — from failing the delete it belongs to.
   */
  async record(command: RequestTombstoneWrite): Promise<void> {
    if (!isRequestDerivedId(command.recordId)) return;
    await sql`
      insert into crm.request_tombstones (
        workspace_id, record_id, record_type, deleted_at
      ) values (
        ${command.workspaceId}::uuid, ${command.recordId}::uuid,
        ${command.kind}, ${command.deletedAt}
      )
      on conflict (workspace_id, record_id) do nothing
    `.execute(databaseFromSession(command.transaction));
  }

  async recorded(command: RequestTombstoneQuery): Promise<boolean> {
    const result = await sql<{ readonly found: boolean }>`
      select exists (
        select 1 from crm.request_tombstones tombstone
        where tombstone.workspace_id = ${command.workspaceId}::uuid
          and tombstone.record_id = ${command.recordId}::uuid
      ) as found
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.found === true;
  }
}
