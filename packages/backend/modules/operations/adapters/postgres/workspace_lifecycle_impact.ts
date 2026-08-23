import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresOperationsWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<{ operations: number; revision: string }>`
      select count(*)::int as operations,
        md5(coalesce(jsonb_agg(to_jsonb(snapshot) order by snapshot.id), '[]'::jsonb)::text) as revision
      from crm.statistics_snapshots snapshot
      where snapshot.workspace_id = ${command.workspaceId}::uuid
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return {
      counts: { operations: row.operations },
      revision: row.revision,
    };
  }
}
