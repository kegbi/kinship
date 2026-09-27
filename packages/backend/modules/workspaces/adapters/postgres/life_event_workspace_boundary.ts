import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { LifeEventWorkspaceBoundary } from "../../public.ts";

/** The life-events module switch and type vocabulary, read in PostgreSQL. */
export class PostgresLifeEventWorkspaceBoundary
  implements LifeEventWorkspaceBoundary {
  async inspect(
    command: Parameters<LifeEventWorkspaceBoundary["inspect"]>[0],
  ): Promise<Awaited<ReturnType<LifeEventWorkspaceBoundary["inspect"]>>> {
    const database = databaseFromSession(command.transaction);
    const context = await sql<{ readonly hidden: boolean }>`
      select exists (
        select 1 from crm.workspace_profile_modules module
        where module.workspace_id = ${command.workspaceId}::uuid
          and module.key = 'life-events' and module.is_active = false
      ) as hidden
    `.execute(database);
    if (context.rows[0]?.hidden) return { status: "hidden" };
    if (!command.typeId) return { status: "ready" };
    const type = (await sql<{
      readonly id: string;
      readonly is_archived: boolean;
      readonly name: string;
    }>`
      select id::text, coalesce(nullif(name, ''), 'Life event') as name,
        is_archived
      from crm.life_event_types
      where id = ${command.typeId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
      ${command.lock ? sql`for key share` : sql``}
    `.execute(database)).rows[0];
    if (!type) return { status: "not-found" };
    return {
      status: "ready",
      type: { archived: type.is_archived, id: type.id, name: type.name },
    };
  }
}
