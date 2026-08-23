import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresInteractionWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<
      {
        activities: number;
        calls: number;
        messages: number;
        notes: number;
        revision: string;
      }
    >`
      select
        (select count(*)::int from crm.activities where workspace_id = ${command.workspaceId}::uuid) activities,
        (select count(*)::int from crm.calls where workspace_id = ${command.workspaceId}::uuid) calls,
        (select count(*)::int from crm.messages item join crm.conversation_threads owned on owned.id=item.conversation_id where owned.workspace_id = ${command.workspaceId}::uuid) messages,
        (select count(*)::int from crm.notes where workspace_id = ${command.workspaceId}::uuid) notes,
        md5(jsonb_build_object(
          'activities', coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from crm.activities a where a.workspace_id = ${command.workspaceId}::uuid), '[]'::jsonb),
          'participants', coalesce((select jsonb_agg(to_jsonb(p) order by p.activity_id, p.person_id) from crm.activity_participants p join crm.activities a on a.id=p.activity_id where a.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'activityEmotions', coalesce((select jsonb_agg(to_jsonb(e) order by e.activity_id, e.emotion_id) from crm.activity_emotions e join crm.activities a on a.id=e.activity_id where a.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'calls', coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from crm.calls c where c.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'callEmotions', coalesce((select jsonb_agg(to_jsonb(e) order by e.call_id, e.emotion_id) from crm.call_emotions e join crm.calls c on c.id=e.call_id where c.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'threads', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.conversation_threads t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'messages', coalesce((select jsonb_agg(to_jsonb(m) order by m.id) from crm.messages m join crm.conversation_threads owned on owned.id=m.conversation_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'notes', coalesce((select jsonb_agg(to_jsonb(n) order by n.id) from crm.notes n where n.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb)
        )::text) revision
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return {
      counts: {
        activities: row.activities,
        calls: row.calls,
        messages: row.messages,
        notes: row.notes,
      },
      revision: row.revision,
    };
  }
}
