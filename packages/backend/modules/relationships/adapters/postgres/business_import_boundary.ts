import type { ImportedPersonReference } from "../../../people/public.ts";
import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { RelationshipBusinessImportBoundary } from "../../application/business_import_boundary.ts";
export class PostgresRelationshipBusinessImportBoundary
  implements RelationshipBusinessImportBoundary {
  constructor(
    private readonly people: ImportedPersonReference,
    private readonly vocabulary: (
      c: {
        kind: "relationship_type";
        id: string;
        workspaceId: string;
        transaction: { readonly opaque: unknown };
      },
    ) => Promise<boolean>,
  ) {}
  async importRecords(
    c: Parameters<RelationshipBusinessImportBoundary["importRecords"]>[0],
  ) {
    const db = databaseFromSession(c.transaction),
      retarget: Record<string, string> = {};
    for (const r of c.records) {
      const d = r.data, p = r.references;
      const personIds = [p.personId, p.fromPersonId, p.toPersonId].filter((
        id,
      ): id is string => !!id);
      if (
        personIds.length &&
        (await this.people.existsForImport({
            ...c.actor,
            personIds,
            transaction: c.transaction,
          })) === false
      ) throw new Error("Imported person reference is outside the workspace.");
      if (d.kind === "relationship_alias") {
        const alias =
          await sql`select id from crm.relationships where id=${p.relationshipId}::uuid and workspace_id=${c.actor.workspaceId}::uuid for key share`
            .execute(db);
        if (!alias.rows.length) {
          throw new Error(
            "Imported relationship reference is outside the workspace.",
          );
        }
      } else if (
        !await this.vocabulary({
          kind: "relationship_type",
          id: p.typeId!,
          workspaceId: c.actor.workspaceId,
          transaction: c.transaction,
        })
      ) throw new Error("Imported relationship type is outside the workspace.");

      if (d.kind === "relationship_alias") {
        retarget[r.id] = p.relationshipId!;
        continue;
      }
      await sql`insert into crm.relationships(id,workspace_id,from_person_id,to_person_id,relationship_type_id,status,created_at,updated_at)
   values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${p.fromPersonId}::uuid,${p.toPersonId}::uuid,${p.typeId}::uuid,${d.status},coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing`
        .execute(db);
    }
    return retarget;
  }
}
