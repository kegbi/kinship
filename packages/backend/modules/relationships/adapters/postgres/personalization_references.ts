import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { RelationshipPersonalizationReferences } from "../../application/personalization_references.ts";

export class PostgresRelationshipPersonalizationReferences
  implements RelationshipPersonalizationReferences {
  async count(
    command: Parameters<RelationshipPersonalizationReferences["count"]>[0],
  ): Promise<number> {
    const result = await sql<
      { readonly count: number }
    >`select count(*)::int as count
      from crm.relationships where workspace_id = ${command.workspaceId}::uuid
        and relationship_type_id = ${command.id}::uuid`
      .execute(databaseFromSession(command.transaction));
    return result.rows[0]?.count ?? 0;
  }

  async replace(
    command: Parameters<RelationshipPersonalizationReferences["replace"]>[0],
  ): Promise<"conflict" | "replaced"> {
    const database = databaseFromSession(command.transaction);
    const rows = await sql<{
      readonly fromPersonId: string;
      readonly relationshipTypeId: string;
      readonly toPersonId: string;
    }>`select from_person_id::text as "fromPersonId",
        to_person_id::text as "toPersonId",
        relationship_type_id::text as "relationshipTypeId"
      from crm.relationships
      where workspace_id = ${command.workspaceId}::uuid
        and relationship_type_id in (${command.id}::uuid, ${command.replacementId}::uuid)
      order by from_person_id, to_person_id, id
      for update`
      .execute(database);
    const targetPairs = new Set(
      rows.rows
        .filter((row) => row.relationshipTypeId === command.replacementId)
        .map((row) => `${row.fromPersonId}:${row.toPersonId}`),
    );
    if (
      rows.rows.some((row) =>
        row.relationshipTypeId === command.id &&
        targetPairs.has(`${row.fromPersonId}:${row.toPersonId}`)
      )
    ) return "conflict";
    await sql`update crm.relationships set relationship_type_id = ${command.replacementId}::uuid,
      updated_at = now() where workspace_id = ${command.workspaceId}::uuid
        and relationship_type_id = ${command.id}::uuid`
      .execute(database);
    return "replaced";
  }
}
