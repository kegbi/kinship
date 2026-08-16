import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { RelationshipPersonBoundary } from "../../public.ts";

export class PostgresRelationshipPersonBoundary
  implements RelationshipPersonBoundary {
  async inspect(
    command: Parameters<RelationshipPersonBoundary["inspect"]>[0],
  ): Promise<Awaited<ReturnType<RelationshipPersonBoundary["inspect"]>>> {
    const ids = [...new Set(command.personIds)].sort();
    if (ids.length === 0) return { status: "not-found" };
    const result = await sql<
      { readonly archived_at: Date | null; readonly id: string }
    >`
      select id::text, archived_at
      from crm.people
      where workspace_id = ${command.workspaceId}::uuid
        and id in (${sql.join(ids.map((id) => sql`${id}::uuid`))})
        and deleted_at is null
      order by id
      ${command.lock ? sql`for update` : sql``}
    `.execute(databaseFromSession(command.transaction));
    if (result.rows.length !== ids.length) return { status: "not-found" };
    return result.rows.some((row) => row.archived_at !== null)
      ? { status: "archived" }
      : { status: "ready" };
  }

  async summarize(
    command: Parameters<RelationshipPersonBoundary["summarize"]>[0],
  ): Promise<Awaited<ReturnType<RelationshipPersonBoundary["summarize"]>>> {
    const ids = [...new Set(command.personIds)].slice(0, 50);
    if (ids.length === 0) return [];
    const result = await sql<{
      readonly archived_at: Date | null;
      readonly id: string;
      readonly name: string;
    }>`
      select id::text, archived_at,
        coalesce(
          nullif(trim(concat_ws(' ', nullif(given_name, ''), family_name)), ''),
          nullif(nickname, ''), 'Unnamed person'
        ) as name
      from crm.people
      where workspace_id = ${command.workspaceId}::uuid
        and id in (${sql.join(ids.map((id) => sql`${id}::uuid`))})
        and deleted_at is null
      order by id
      limit 50
    `.execute(databaseFromSession(command.transaction));
    return result.rows.map((row) => ({
      archived: row.archived_at !== null,
      id: row.id,
      name: row.name,
    }));
  }
}
