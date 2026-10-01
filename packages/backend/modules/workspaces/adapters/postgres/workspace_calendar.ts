import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { WorkspaceCalendarBoundary } from "../../ports/workspace_calendar.ts";

export class PostgresWorkspaceCalendarBoundary
  implements WorkspaceCalendarBoundary {
  async timezones(
    command: Parameters<WorkspaceCalendarBoundary["timezones"]>[0],
  ): Promise<ReadonlyMap<string, string>> {
    if (command.workspaceIds.length === 0) return new Map();
    const result = await sql<
      { readonly timezone: string; readonly workspace_id: string }
    >`
      select workspace_id::text, default_timezone as timezone
      from crm.workspace_settings
      where workspace_id = any(${[...command.workspaceIds]}::uuid[])
        and default_timezone is not null
    `.execute(databaseFromSession(command.transaction));
    return new Map(result.rows.map((row) => [row.workspace_id, row.timezone]));
  }
}
