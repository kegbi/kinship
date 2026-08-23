import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresRelationshipWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<{ relationships: number; revision: string }>`
      select count(*)::int as relationships,
        md5(jsonb_build_object(
          'relationships', coalesce(jsonb_agg(to_jsonb(r) order by r.id), '[]'::jsonb),
          'romantic', coalesce((select jsonb_agg(to_jsonb(d) order by d.relationship_id)
            from crm.romantic_relationship_details d join crm.relationships owned on owned.id = d.relationship_id
            where owned.workspace_id = ${command.workspaceId}::uuid), '[]'::jsonb)
        )::text) as revision
      from crm.relationships r where r.workspace_id = ${command.workspaceId}::uuid
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return {
      counts: { relationships: row.relationships },
      revision: row.revision,
    };
  }
}
