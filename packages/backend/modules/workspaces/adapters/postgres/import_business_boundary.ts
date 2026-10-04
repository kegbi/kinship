import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { WorkspaceBusinessImportBoundary } from "../../application/import_business_boundary.ts";

export class PostgresWorkspaceBusinessImportBoundary
  implements WorkspaceBusinessImportBoundary {
  async referenceExists(
    c: {
      kind:
        | "gender"
        | "pet_category"
        | "relationship_type"
        | "activity_type"
        | "emotion";
      id: string;
      workspaceId: string;
      transaction: { readonly opaque: unknown };
    },
  ): Promise<boolean> {
    const db = databaseFromSession(c.transaction);
    const result = c.kind === "gender"
      ? await sql`select id from crm.gender_options where id=${c.id}::uuid and workspace_id=${c.workspaceId}::uuid for key share`
        .execute(db)
      : c.kind === "pet_category"
      ? await sql`select id from crm.pet_categories where id=${c.id}::uuid for key share`
        .execute(db)
      : c.kind === "relationship_type"
      ? await sql`select id from crm.relationship_types where id=${c.id}::uuid and workspace_id=${c.workspaceId}::uuid for key share`
        .execute(db)
      : c.kind === "activity_type"
      ? await sql`select id from crm.activity_types where id=${c.id}::uuid and workspace_id=${c.workspaceId}::uuid for key share`
        .execute(db)
      : await sql`select id from crm.emotion_options where id=${c.id}::uuid for key share`
        .execute(db);
    return result.rows.length === 1;
  }
  async importRecords(
    command: Parameters<WorkspaceBusinessImportBoundary["importRecords"]>[0],
  ): Promise<Readonly<Record<string, string>>> {
    const db = databaseFromSession(command.transaction),
      workspace = command.actor.workspaceId;
    const identities: Record<string, string> = {};
    for (const { id, data: d, references: r } of command.records) {
      const created = d.createdAt ?? null,
        updated = d.updatedAt ?? d.createdAt ?? null;
      if (d.kind === "gender") {
        const saved = await sql<
          { id: string }
        >`insert into crm.gender_options (id,workspace_id,name,code,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${d.name},${
          d.code ?? null
        },coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (workspace_id,lower(name)) do update set name=crm.gender_options.name returning id::text`
          .execute(db);
        identities[id] = saved.rows[0]!.id;
      } else if (d.kind === "pet_category") {
        const stock = [
          "reptile",
          "bird",
          "cat",
          "dog",
          "fish",
          "hamster",
          "horse",
          "rabbit",
          "rat",
          "small_animal",
          "other",
        ];
        if (typeof d.name !== "string" || !stock.includes(d.name)) {
          throw new Error(
            "Only stock pet categories can be imported into the global catalog.",
          );
        }
        const saved = await sql<
          { id: string }
        >`insert into crm.pet_categories (id,name,is_common) values (${id}::uuid,${d.name},${
          ["cat", "dog", "fish"].includes(d.name)
        }) on conflict (lower(name)) do update set name=crm.pet_categories.name returning id::text`
          .execute(db);
        identities[id] = saved.rows[0]!.id;
      } else if (d.kind === "profile_module") {
        const saved = await sql<
          { id: string }
        >`insert into crm.workspace_profile_modules (id,workspace_id,key,name,translation_key,is_active,can_delete,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${d.key},${
          d.name ?? null
        },${d.translationKey ?? null},${d.enabled ?? true},${
          d.canDelete ?? false
        },coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (workspace_id,key) do update set is_active=excluded.is_active returning id::text`
          .execute(db);
        identities[id] = saved.rows[0]!.id;
      } else if (d.kind === "life_event_category") {
        await sql`insert into crm.life_event_categories (id,workspace_id,name,seed_key,is_system,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${d.name},${
          d.seedKey ?? null
        },${
          d.isSystem ?? false
        },coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (id) do nothing`
          .execute(db);
      } else if (d.kind === "life_event_type") {
        if (r.categoryId) {
          const category =
            await sql`select id from crm.life_event_categories where id=${r.categoryId}::uuid and workspace_id=${workspace}::uuid`
              .execute(db);
          if (!category.rows.length) {
            throw new Error(
              "Imported life event category is outside the workspace.",
            );
          }
        }
        await sql`insert into crm.life_event_types (id,workspace_id,category_id,name,seed_key,information_schema,is_system,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${
          r.categoryId ?? null
        }::uuid,${d.name ?? null},${d.seedKey ?? null},${
          (d.informationSchema === null || d.informationSchema === undefined)
            ? null
            : JSON.stringify(d.informationSchema)
        }::jsonb,${
          d.isSystem ?? false
        },coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (id) do nothing`
          .execute(db);
      } else throw new Error("Unsupported workspace import record.");
    }
    return identities;
  }
}
