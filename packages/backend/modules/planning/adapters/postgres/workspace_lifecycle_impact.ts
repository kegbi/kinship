import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresPlanningWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<
      { reminders: number; revision: string; tasks: number }
    >`
      select
        (select count(*)::int from crm.tasks where workspace_id=${command.workspaceId}::uuid) tasks,
        (select count(*)::int from crm.reminders where workspace_id=${command.workspaceId}::uuid) reminders,
        md5(jsonb_build_object(
          'tasks', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.tasks t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'rules', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.reminder_rules t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'reminders', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.reminders t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'occurrences', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.reminder_occurrences t join crm.reminders owned on owned.id=t.reminder_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'cadences', coalesce((select jsonb_agg(to_jsonb(t) order by t.id) from crm.stay_in_touch_cadences t join crm.people owned on owned.id=t.person_id where owned.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb),
          'requests', coalesce((select jsonb_agg(to_jsonb(t) order by t.request_id) from crm.stay_in_touch_cadence_requests t where t.workspace_id=${command.workspaceId}::uuid), '[]'::jsonb)
        )::text) revision
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return {
      counts: { reminders: row.reminders, tasks: row.tasks },
      revision: row.revision,
    };
  }
}
