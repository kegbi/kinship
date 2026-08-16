import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { InteractionPersonalizationReferences } from "../../application/personalization_references.ts";

export class PostgresInteractionPersonalizationReferences
  implements InteractionPersonalizationReferences {
  async count(
    command: Parameters<InteractionPersonalizationReferences["count"]>[0],
  ): Promise<number> {
    const database = databaseFromSession(command.transaction);
    if (command.section === "activity-types") {
      const result = await sql<
        { readonly count: number }
      >`select count(*)::int as count
        from crm.activities where workspace_id = ${command.workspaceId}::uuid
          and activity_type_id = ${command.id}::uuid`.execute(database);
      return result.rows[0]?.count ?? 0;
    }
    if (command.section === "contact-method-types") {
      const result = await sql<
        { readonly count: number }
      >`select count(*)::int as count
        from crm.conversation_threads where workspace_id = ${command.workspaceId}::uuid
          and channel_type_id = ${command.id}::uuid`.execute(database);
      return result.rows[0]?.count ?? 0;
    }
    const result = await sql<
      { readonly count: number }
    >`select count(*)::int as count from (
      select ae.activity_id::text from crm.activity_emotions ae join crm.activities a on a.id = ae.activity_id
        where a.workspace_id = ${command.workspaceId}::uuid and ae.emotion_id = ${command.id}::uuid
      union all
      select ce.call_id::text from crm.call_emotions ce join crm.calls c on c.id = ce.call_id
        where c.workspace_id = ${command.workspaceId}::uuid and ce.emotion_id = ${command.id}::uuid
    ) refs`.execute(database);
    return result.rows[0]?.count ?? 0;
  }

  async replace(
    command: Parameters<InteractionPersonalizationReferences["replace"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    if (command.section === "activity-types") {
      await sql`update crm.activities set activity_type_id = ${command.replacementId}::uuid,
        updated_at = now() where workspace_id = ${command.workspaceId}::uuid
          and activity_type_id = ${command.id}::uuid`.execute(database);
    } else if (command.section === "contact-method-types") {
      await sql`update crm.conversation_threads set channel_type_id = ${command.replacementId}::uuid,
        updated_at = now() where workspace_id = ${command.workspaceId}::uuid
          and channel_type_id = ${command.id}::uuid`.execute(database);
    }
  }
}
