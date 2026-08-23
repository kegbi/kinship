import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresJournalWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<
      { journalPosts: number; lifeEvents: number; revision: string }
    >`
      select
        (select count(*)::int from crm.journal_posts where workspace_id=${command.workspaceId}::uuid) as "journalPosts",
        (select count(*)::int from crm.life_events where workspace_id=${command.workspaceId}::uuid) as "lifeEvents",
        md5(jsonb_build_object(
          'posts', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.journal_posts t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'ratings', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.journal_day_ratings t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'items', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.journal_items t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'events', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.life_events t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb)
        )::text) revision
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return {
      counts: { journalPosts: row.journalPosts, lifeEvents: row.lifeEvents },
      revision: row.revision,
    };
  }
}
