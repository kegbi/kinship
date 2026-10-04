import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PeopleBusinessImportBoundary } from "../../application/import_business_boundary.ts";

/** The importer resolves identities first; every reference is rechecked here. */
export class PostgresPeopleBusinessImportBoundary
  implements PeopleBusinessImportBoundary {
  constructor(
    private readonly references: {
      vocabulary(
        c: {
          kind: "gender" | "pet_category";
          id: string;
          workspaceId: string;
          transaction: { readonly opaque: unknown };
        },
      ): Promise<boolean>;
      file(
        c: {
          id: string;
          workspaceId: string;
          transaction: { readonly opaque: unknown };
        },
      ): Promise<boolean>;
    },
  ) {}
  async dateBelongsToPerson(
    c: {
      id: string;
      personId: string;
      workspaceId: string;
      transaction: { readonly opaque: unknown };
    },
  ): Promise<boolean> {
    const result =
      await sql`select d.id from crm.person_dates d join crm.people p on p.id=d.person_id where d.id=${c.id}::uuid and d.person_id=${c.personId}::uuid and p.workspace_id=${c.workspaceId}::uuid for key share of d,p`
        .execute(databaseFromSession(c.transaction));
    return result.rows.length === 1;
  }
  async importRecords(
    command: Parameters<PeopleBusinessImportBoundary["importRecords"]>[0],
  ): Promise<Readonly<Record<string, string>>> {
    const db = databaseFromSession(command.transaction),
      workspace = command.actor.workspaceId;
    const identities: Record<string, string> = {};
    for (const { id, data: d, references: r } of command.records) {
      for (const personId of [r.personId, r.introducedById].filter(Boolean)) {
        const person =
          await sql`select id from crm.people where id=${personId}::uuid and workspace_id=${workspace}::uuid`
            .execute(db);
        if (!person.rows.length) {
          throw new Error(
            "Imported person reference is outside the workspace.",
          );
        }
      }
      const created = d.createdAt ?? null,
        updated = d.updatedAt ?? d.createdAt ?? null;
      switch (d.kind) {
        case "existing_date": {
          const date = await sql<
            { id: string }
          >`select id::text from crm.person_dates where person_id=${r.personId}::uuid and kind=${d.dateKind} order by created_at,id limit 1`
            .execute(db);
          if (!date.rows[0]) {
            identities[id] = "";
            break;
          }
          if (d.preserveTimestamps === true) {
            await sql`update crm.person_dates set created_at=coalesce(${created}::timestamptz,created_at),updated_at=coalesce(${updated}::timestamptz,updated_at) where id=${
              date.rows[0].id
            }::uuid`.execute(db);
          }
          identities[id] = date.rows[0].id;
          break;
        }
        case "profile": {
          if (r.genderId) {
            if (
              !await this.references.vocabulary({
                kind: "gender",
                id: r.genderId,
                workspaceId: workspace,
                transaction: command.transaction,
              })
            ) {
              throw new Error(
                "Imported gender reference is outside the workspace.",
              );
            }
          }
          await sql`update crm.people set gender_option_id=coalesce(gender_option_id,${
            r.genderId ?? null
          }::uuid), created_at=coalesce(${
            d.preserveTimestamps === true ? created : null
          }::timestamptz,created_at), updated_at=coalesce(${
            d.preserveTimestamps === true ? updated : null
          }::timestamptz,updated_at) where id=${r.personId}::uuid and workspace_id=${workspace}::uuid`
            .execute(db);
          identities[id] = r.personId!;
          break;
        }
        case "first_meeting":
          await sql`insert into crm.person_first_meetings (person_id,introduced_by_person_id,place_text,notes,updated_at) values (${r.personId}::uuid,${
            r.introducedById ?? null
          }::uuid,${d.placeText ?? null},${
            d.notes ?? null
          },coalesce(${updated}::timestamptz,now())) on conflict (person_id) do nothing`
            .execute(db);
          identities[id] = r.personId!;
          break;
        case "tag": {
          const saved = await sql<
            { id: string }
          >`insert into crm.tags (id,workspace_id,name,slug,description,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${d.name},${d.slug},${
            d.description ?? null
          },coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (workspace_id,slug) do update set slug=excluded.slug returning id::text`
            .execute(db);
          identities[id] = saved.rows[0]!.id;
          break;
        }
        case "person_tag": {
          const tag =
            await sql`select id from crm.tags where id=${r.tagId}::uuid and workspace_id=${workspace}::uuid`
              .execute(db);
          if (!tag.rows.length) {
            throw new Error("Imported tag reference is outside the workspace.");
          }
          await sql`insert into crm.person_tags (person_id,tag_id,created_at) values (${r.personId}::uuid,${r.tagId}::uuid,coalesce(${created}::timestamptz,now())) on conflict do nothing`
            .execute(db);
          break;
        }
        case "avatar": {
          if (
            !await this.references.file({
              id: r.fileId!,
              workspaceId: workspace,
              transaction: command.transaction,
            })
          ) {
            throw new Error(
              "Imported avatar reference is outside the workspace.",
            );
          }
          await sql`insert into crm.person_avatars (person_id,source,file_id) values (${r.personId}::uuid,'file',${r.fileId}::uuid) on conflict (person_id) do update set source='file',file_id=excluded.file_id where ${
            d.preserveTimestamps === true
          }`
            .execute(db);
          identities[id] = r.personId!;
          break;
        }
        case "pet": {
          if (r.categoryId) {
            if (
              !await this.references.vocabulary({
                kind: "pet_category",
                id: r.categoryId,
                workspaceId: workspace,
                transaction: command.transaction,
              })
            ) {
              throw new Error("Imported pet category does not exist.");
            }
          }
          await sql`insert into crm.pets (id,person_id,category_id,name,created_at,updated_at) values (${id}::uuid,${r.personId}::uuid,${
            r.categoryId ?? null
          }::uuid,${
            d.name ?? null
          },coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (id) do nothing`
            .execute(db);
          break;
        }
        case "location":
          await sql`insert into crm.locations (id,workspace_id,street,city,region,postal_code,country,latitude,longitude,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${
            d.street ?? null
          },${d.city ?? null},${d.region ?? null},${d.postalCode ?? null},${
            d.country ?? null
          },${d.latitude ?? null}::numeric,${
            d.longitude ?? null
          }::numeric,coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (id) do nothing`
            .execute(db);
          break;
        case "address": {
          const location =
            await sql`select id from crm.locations where id=${r.locationId}::uuid and workspace_id=${workspace}::uuid`
              .execute(db);
          if (!location.rows.length) {
            throw new Error(
              "Imported location reference is outside the workspace.",
            );
          }
          if (d.reconcileLegacy === true) {
            const existing = await sql<
              { id: string }
            >`select a.id::text from crm.person_addresses a join crm.locations old on old.id=a.location_id join crm.locations incoming on incoming.id=${r.locationId}::uuid where a.person_id=${r.personId}::uuid and old.workspace_id=${workspace}::uuid and incoming.workspace_id=${workspace}::uuid and old.street is not distinct from incoming.street and old.city is not distinct from incoming.city and old.region is not distinct from incoming.region and old.postal_code is not distinct from incoming.postal_code and old.country is not distinct from incoming.country order by a.created_at,a.id offset ${
              Number(d.duplicateOrdinal ?? 0)
            } limit 1`.execute(db);
            if (existing.rows[0]) {
              identities[id] = existing.rows[0].id;
              await sql`update crm.person_addresses set display_name=coalesce(display_name,${
                d.displayName ?? null
              }) where id=${existing.rows[0].id}::uuid`.execute(db);
              break;
            }
          }
          await sql`insert into crm.person_addresses (id,person_id,location_id,display_name,created_at,updated_at) values (${id}::uuid,${r.personId}::uuid,${r.locationId}::uuid,${
            d.displayName ?? null
          },coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (id) do nothing`
            .execute(db);
          break;
        }
        default:
          throw new Error("Unsupported people import record.");
      }
    }
    return identities;
  }
}
