import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresGiftWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<
      { debts: number; gifts: number; revision: string }
    >`
      select
        (select count(*)::int from crm.gifts where workspace_id=${command.workspaceId}::uuid) gifts,
        (select count(*)::int from crm.debts where workspace_id=${command.workspaceId}::uuid) debts,
        md5(jsonb_build_object(
          'gifts', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.gifts t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'debts', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.debts t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb)
        )::text) revision
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return {
      counts: { debts: row.debts, gifts: row.gifts },
      revision: row.revision,
    };
  }
}
