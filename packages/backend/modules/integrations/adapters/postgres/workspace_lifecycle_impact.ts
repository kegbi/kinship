import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresIntegrationWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<{ integrations: number; revision: string }>`
      select
        ((select count(*) from crm.dav_address_books where workspace_id=${command.workspaceId}::uuid) +
         (select count(*) from crm.dav_address_book_subscriptions where workspace_id=${command.workspaceId}::uuid))::int integrations,
        md5(jsonb_build_object(
          'books', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.dav_address_books t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'subscriptions', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.dav_address_book_subscriptions t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'objects', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.dav_objects t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'tokens', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.dav_sync_tokens t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'weather', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.location_weather_cache t join crm.locations owned on owned.id=t.location_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb)
        )::text) revision
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return {
      counts: { integrations: row.integrations },
      revision: row.revision,
    };
  }
}
