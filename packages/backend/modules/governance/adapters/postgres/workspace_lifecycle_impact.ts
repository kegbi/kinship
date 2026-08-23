import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";

export class PostgresGovernanceWorkspaceLifecycleImpact {
  async inspectBeforeCascade(
    command: {
      readonly transaction: { readonly opaque: unknown };
      readonly workspaceId: string;
    },
  ) {
    const result = await sql<{ auditEvents: number; revision: string }>`
      select count(*)::int as "auditEvents",
        md5(coalesce(jsonb_agg(to_jsonb(t) order by t.id), '[]'::jsonb)::text) revision
      from crm.audit_events t where t.workspace_id=${command.workspaceId}::uuid
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0]!;
    return { counts: { auditEvents: row.auditEvents }, revision: row.revision };
  }
}
