import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresFileWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<
      { files: number; objectKeys: unknown; revision: string }
    >`
      select count(*)::int files,
        coalesce(jsonb_agg(f.storage_key order by f.storage_key) filter (where f.storage_key is not null), '[]'::jsonb) as "objectKeys",
        md5(jsonb_build_object(
          'files', coalesce(jsonb_agg(to_jsonb(f) order by f.id), '[]'::jsonb),
          'personLinks', coalesce((select jsonb_agg(to_jsonb(t) order by t.person_id, t.file_id) from crm.person_file_links t join crm.files owned on owned.id=t.file_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'giftLinks', coalesce((select jsonb_agg(to_jsonb(t) order by t.gift_id, t.file_id) from crm.gift_file_links t join crm.files owned on owned.id=t.file_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb)
        )::text) revision
      from crm.files f where f.workspace_id=${command.workspaceId}::uuid
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return {
      counts: { files: row.files },
      objectKeys: Array.isArray(row.objectKeys)
        ? row.objectKeys.filter((key): key is string => typeof key === "string")
        : [],
      revision: row.revision,
    };
  }
}
