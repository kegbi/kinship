import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { VocabularyBusinessImportBoundary } from "../../application/business_vocabulary_import.ts";
export class PostgresVocabularyBusinessImportBoundary
  implements VocabularyBusinessImportBoundary {
  async importRecords(
    c: Parameters<VocabularyBusinessImportBoundary["importRecords"]>[0],
  ) {
    const db = databaseFromSession(c.transaction),
      retarget: Record<string, string> = {};
    for (const r of c.records) {
      const d = r.data, p = r.references;
      if (d.kind === "emotion") {
        await sql`select pg_advisory_xact_lock(hashtextextended(${
          "import-emotion:" + String(d.name)
        },0))`.execute(db);
        const existing = await sql<
          { id: string }
        >`select id::text from crm.emotion_options where lower(name)=lower(${d.name}::text) order by id limit 1`
          .execute(db);
        if (existing.rows[0]) retarget[r.id] = existing.rows[0].id;
        else {await sql`insert into crm.emotion_options(id,name) values(${r.id}::uuid,${d.name}) on conflict do nothing`
            .execute(db);}
      } else if (d.kind === "relationship_group") {
        const existing = await sql<
          { id: string }
        >`select id::text from crm.relationship_type_groups where workspace_id=${c.actor.workspaceId}::uuid and lower(name)=lower(${d.name}::text) order by id`
          .execute(db);
        if (existing.rows.length === 1) {
          retarget[r.id] = existing.rows[0]!.id;
          continue;
        }
        await sql`insert into crm.relationship_type_groups(id,workspace_id,name,can_delete,created_at,updated_at) values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${d.name},${d.canDelete},coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else if (d.kind === "relationship_type") {
        if (p.groupId) {
          const group =
            await sql`select id from crm.relationship_type_groups where id=${p.groupId}::uuid and workspace_id=${c.actor.workspaceId}::uuid`
              .execute(db);
          if (!group.rows.length) {
            throw new Error(
              "Imported relationship group is outside the workspace.",
            );
          }
        }
        const existing = await sql<
          { id: string }
        >`select id::text from crm.relationship_types where workspace_id=${c.actor.workspaceId}::uuid and group_id is not distinct from ${
          p.groupId ?? null
        }::uuid and lower(forward_label)=lower(${d.forwardLabel}::text) and lower(reverse_label)=lower(${d.reverseLabel}::text) and not is_archived order by id`
          .execute(db);
        if (existing.rows.length === 1) {
          retarget[r.id] = existing.rows[0]!.id;
          continue;
        }
        await sql`insert into crm.relationship_types(id,workspace_id,group_id,forward_label,reverse_label,can_delete,created_at,updated_at) values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${
          p.groupId ?? null
        }::uuid,${d.forwardLabel},${d.reverseLabel},${d.canDelete},coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else if (d.kind === "activity_category") {
        await sql`insert into crm.activity_type_categories(id,workspace_id,name,translation_key,created_at,updated_at) values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${d.name},${d.translationKey},coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else if (d.kind === "activity_type") {
        if (p.categoryId) {
          const category =
            await sql`select id from crm.activity_type_categories where id=${p.categoryId}::uuid and workspace_id=${c.actor.workspaceId}::uuid`
              .execute(db);
          if (!category.rows.length) {
            throw new Error(
              "Imported activity category is outside the workspace.",
            );
          }
        }
        await sql`insert into crm.activity_types(id,workspace_id,category_id,name,translation_key,location_behavior,created_at,updated_at) values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${
          p.categoryId ?? null
        }::uuid,${d.name},${d.translationKey},${d.locationBehavior},coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      }
    }
    return retarget;
  }
}
