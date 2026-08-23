import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresImportExportWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<
      { exports: number; imports: number; revision: string }
    >`
      select
        (select count(*)::int from crm.data_imports where workspace_id=${command.workspaceId}::uuid) imports,
        (select count(*)::int from crm.data_exports where workspace_id=${command.workspaceId}::uuid) exports,
        md5(jsonb_build_object(
          'imports', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.data_imports t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'entities', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.data_import_entities t join crm.data_imports owned on owned.id=t.import_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'reports', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.data_import_reports t join crm.data_imports owned on owned.id=t.import_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'exports', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.data_exports t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb)
        )::text) revision
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return {
      counts: { exports: row.exports, imports: row.imports },
      revision: row.revision,
    };
  }
}
