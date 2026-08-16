import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  PeoplePersonalizationReferences,
  PeopleReferenceCommand,
} from "../../application/personalization_references.ts";

export class PostgresPeoplePersonalizationReferences
  implements PeoplePersonalizationReferences {
  async count(command: PeopleReferenceCommand): Promise<number> {
    const database = databaseFromSession(command.transaction);
    if (command.section === "gender-options") {
      const result = await sql<
        { readonly count: number }
      >`select count(*)::int as count
        from crm.people where workspace_id = ${command.workspaceId}::uuid
          and gender_option_id = ${command.id}::uuid`.execute(database);
      return result.rows[0]?.count ?? 0;
    }
    if (command.section === "contact-method-types") {
      const result = await sql<
        { readonly count: number }
      >`select count(*)::int as count
        from crm.person_contact_methods pcm join crm.people p on p.id = pcm.person_id
        where p.workspace_id = ${command.workspaceId}::uuid and pcm.type_id = ${command.id}::uuid`
        .execute(database);
      return result.rows[0]?.count ?? 0;
    }
    if (command.section === "contact-labels") {
      const result = await sql<
        { readonly count: number }
      >`select count(*)::int as count from (
        select pcml.contact_method_id::text from crm.person_contact_method_labels pcml
          join crm.person_contact_methods pcm on pcm.id = pcml.contact_method_id
          join crm.people p on p.id = pcm.person_id
          where p.workspace_id = ${command.workspaceId}::uuid and pcml.label_id = ${command.id}::uuid
        union all
        select pal.address_id::text from crm.person_address_labels pal
          join crm.person_addresses pa on pa.id = pal.address_id
          join crm.people p on p.id = pa.person_id
          where p.workspace_id = ${command.workspaceId}::uuid and pal.label_id = ${command.id}::uuid
      ) refs`.execute(database);
      return result.rows[0]?.count ?? 0;
    }
    const result = await sql<
      { readonly count: number }
    >`select count(*)::int as count
      from crm.pets pet join crm.people p on p.id = pet.person_id
      where p.workspace_id = ${command.workspaceId}::uuid and pet.category_id = ${command.id}::uuid`
      .execute(database);
    return result.rows[0]?.count ?? 0;
  }

  async replace(
    command: PeopleReferenceCommand & { readonly replacementId: string },
  ): Promise<"conflict" | "replaced"> {
    const database = databaseFromSession(command.transaction);
    if (command.section === "gender-options") {
      await sql`update crm.people set gender_option_id = ${command.replacementId}::uuid,
        updated_at = now() where workspace_id = ${command.workspaceId}::uuid
          and gender_option_id = ${command.id}::uuid`.execute(database);
      return "replaced";
    }
    if (command.section === "contact-method-types") {
      const locked = await sql<{
        readonly isPrimary: boolean;
        readonly personId: string;
        readonly typeId: string;
      }>`select pcm.person_id::text as "personId",
          pcm.type_id::text as "typeId", pcm.is_primary as "isPrimary"
        from crm.person_contact_methods pcm join crm.people p on p.id = pcm.person_id
        where p.workspace_id = ${command.workspaceId}::uuid
          and pcm.type_id in (${command.id}::uuid, ${command.replacementId}::uuid)
        order by pcm.person_id, pcm.id for update of pcm`.execute(database);
      const primaryTypes = new Map<string, Set<string>>();
      for (const row of locked.rows) {
        if (!row.isPrimary) continue;
        const types = primaryTypes.get(row.personId) ?? new Set<string>();
        types.add(row.typeId);
        primaryTypes.set(row.personId, types);
      }
      if (
        [...primaryTypes.values()].some((types) =>
          types.has(command.id) && types.has(command.replacementId)
        )
      ) return "conflict";
      await sql`update crm.person_contact_methods pcm set type_id = ${command.replacementId}::uuid,
        updated_at = now() from crm.people p where p.id = pcm.person_id
          and p.workspace_id = ${command.workspaceId}::uuid and pcm.type_id = ${command.id}::uuid`
        .execute(database);
      return "replaced";
    }
    if (command.section === "contact-labels") {
      await sql`insert into crm.person_contact_method_labels (contact_method_id, label_id)
        select pcml.contact_method_id, ${command.replacementId}::uuid
        from crm.person_contact_method_labels pcml
          join crm.person_contact_methods pcm on pcm.id = pcml.contact_method_id
          join crm.people p on p.id = pcm.person_id
        where p.workspace_id = ${command.workspaceId}::uuid and pcml.label_id = ${command.id}::uuid
        on conflict do nothing`.execute(database);
      await sql`delete from crm.person_contact_method_labels pcml using crm.person_contact_methods pcm,
        crm.people p where pcm.id = pcml.contact_method_id and p.id = pcm.person_id
          and p.workspace_id = ${command.workspaceId}::uuid and pcml.label_id = ${command.id}::uuid`
        .execute(database);
      await sql`insert into crm.person_address_labels (address_id, label_id)
        select pal.address_id, ${command.replacementId}::uuid
        from crm.person_address_labels pal join crm.person_addresses pa on pa.id = pal.address_id
          join crm.people p on p.id = pa.person_id
        where p.workspace_id = ${command.workspaceId}::uuid and pal.label_id = ${command.id}::uuid
        on conflict do nothing`.execute(database);
      await sql`delete from crm.person_address_labels pal using crm.person_addresses pa, crm.people p
        where pa.id = pal.address_id and p.id = pa.person_id
          and p.workspace_id = ${command.workspaceId}::uuid and pal.label_id = ${command.id}::uuid`
        .execute(database);
      return "replaced";
    }
    await sql`update crm.pets pet set category_id = ${command.replacementId}::uuid,
      updated_at = now() from crm.people p where p.id = pet.person_id
        and p.workspace_id = ${command.workspaceId}::uuid and pet.category_id = ${command.id}::uuid`
      .execute(database);
    return "replaced";
  }
}
