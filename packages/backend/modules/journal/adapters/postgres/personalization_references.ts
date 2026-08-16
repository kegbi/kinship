import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { JournalPersonalizationReferences } from "../../application/personalization_references.ts";

export class PostgresJournalPersonalizationReferences
  implements JournalPersonalizationReferences {
  async count(
    command: Parameters<JournalPersonalizationReferences["count"]>[0],
  ): Promise<number> {
    const result = await sql<
      { readonly count: number }
    >`select count(*)::int as count
      from crm.life_events where workspace_id = ${command.workspaceId}::uuid
        and life_event_type_id = ${command.id}::uuid`
      .execute(databaseFromSession(command.transaction));
    return result.rows[0]?.count ?? 0;
  }

  async replace(
    command: Parameters<JournalPersonalizationReferences["replace"]>[0],
  ): Promise<void> {
    await sql`update crm.life_events set life_event_type_id = ${command.replacementId}::uuid,
      updated_at = now() where workspace_id = ${command.workspaceId}::uuid
        and life_event_type_id = ${command.id}::uuid`
      .execute(databaseFromSession(command.transaction));
  }
}
