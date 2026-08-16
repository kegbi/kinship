import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type {
  AddressFact,
  ContactMethodFact,
  FirstMeetingFact,
  FoodPreferencesFact,
  OccupationFact,
  PetFact,
  ProfileFactRecord,
  ProfileFactRepository,
  ProfileFactSection,
  ProfileFactValue,
  TagsFact,
} from "../../public.ts";

interface FactRow {
  readonly id: string;
  readonly updated_at: string;
  readonly value: ProfileFactValue;
}

const timestamp = sql.raw(`to_char(updated_at at time zone 'UTC',
  'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);

function record(section: ProfileFactSection, row: FactRow): ProfileFactRecord {
  return { id: row.id, section, updatedAt: row.updated_at, value: row.value };
}

function rows(
  repository: PostgresProfileFactRepository,
  command: Omit<
    Parameters<ProfileFactRepository["list"]>[0],
    "after" | "limit"
  >,
  factId?: string,
): Promise<readonly ProfileFactRecord[]> {
  return repository.list({
    ...command,
    ...(factId ? { factId } : {}),
    limit: 1,
  });
}

export class PostgresProfileFactRepository implements ProfileFactRepository {
  private async context(
    command: Parameters<ProfileFactRepository["lockContext"]>[0],
    lock: boolean,
  ): Promise<Awaited<ReturnType<ProfileFactRepository["lockContext"]>>> {
    const database = databaseFromSession(command.transaction);
    const authorizationLock = lock
      ? sql`for update of account, member, workspace`
      : sql``;
    const personLock = lock ? sql`for update` : sql``;
    const authorization = await sql<{ readonly authorized: boolean }>`
      select true as authorized
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.role in ('owner', 'admin', 'member')
        and member.status = 'active' and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active' and workspace.deleted_at is null
      ${authorizationLock}
    `.execute(database);
    if (authorization.rows[0]?.authorized !== true) {
      return { status: "forbidden" };
    }
    const person = await sql<{
      readonly archived_at: Date | null;
      readonly updated_at: string;
    }>`
      select archived_at, to_char(updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
      from crm.people
      where id = ${command.personId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and deleted_at is null
      ${personLock}
    `.execute(database);
    const row = person.rows[0];
    if (!row) return { status: "not-found" };
    return {
      personUpdatedAt: row.updated_at,
      status: row.archived_at ? "archived" : "ready",
    };
  }

  inspectContext(
    command: Parameters<ProfileFactRepository["inspectContext"]>[0],
  ): Promise<Awaited<ReturnType<ProfileFactRepository["inspectContext"]>>> {
    return this.context(command, false);
  }

  async lockContext(
    command: Parameters<ProfileFactRepository["lockContext"]>[0],
  ): Promise<Awaited<ReturnType<ProfileFactRepository["lockContext"]>>> {
    return await this.context(command, true);
  }

  async inspectPersonReference(
    command: Parameters<
      NonNullable<ProfileFactRepository["inspectPersonReference"]>
    >[0],
  ): Promise<boolean> {
    const database = databaseFromSession(command.transaction);
    const target = await sql<{ readonly valid: boolean }>`
      select true as valid from crm.people
      where id = ${command.referencedPersonId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and id <> ${command.personId}::uuid
        and archived_at is null and deleted_at is null
    `.execute(database);
    return target.rows[0]?.valid === true;
  }

  private async bumpRevision(command: {
    readonly occurredAt: Date;
    readonly personId: string;
    readonly transaction: Parameters<
      ProfileFactRepository["lockContext"]
    >[0]["transaction"];
    readonly workspaceId: string;
  }): Promise<string> {
    const database = databaseFromSession(command.transaction);
    const updated = await sql<{ readonly updated_at: string }>`
      update crm.people set updated_at = greatest(
        ${command.occurredAt}::timestamptz, updated_at + interval '1 microsecond')
      where id = ${command.personId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and archived_at is null and deleted_at is null
      returning to_char(updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at
    `.execute(database);
    const revision = updated.rows[0]?.updated_at;
    if (!revision) throw new Error("Locked person revision could not advance.");
    return revision;
  }

  async list(
    command: Parameters<ProfileFactRepository["list"]>[0],
  ): Promise<readonly ProfileFactRecord[]> {
    const database = databaseFromSession(command.transaction);
    const limit = Math.min(command.limit ?? 51, 51);
    const afterId = command.after?.id ?? null;
    const afterUpdatedAt = command.after?.updatedAt ?? null;
    let result: { readonly rows: readonly FactRow[] };
    if (command.section === "contact-methods") {
      result = await sql<FactRow>`
        select method.id::text,
          to_char(method.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
          jsonb_build_object(
            'typeId', method.type_id::text, 'value', method.value,
            'isPrimary', method.is_primary, 'notes', method.notes,
            'labelIds', coalesce(labels.ids, '[]'::jsonb)
          ) - 'notes' || case when method.notes is null then '{}'::jsonb
            else jsonb_build_object('notes', method.notes) end as value
        from crm.person_contact_methods method
        join crm.contact_method_types method_type
          on method_type.id = method.type_id
          and method_type.workspace_id = ${command.workspaceId}::uuid
        left join lateral (
          select jsonb_agg(link.label_id::text order by link.label_id) as ids
          from crm.person_contact_method_labels link
          join crm.contact_labels label on label.id = link.label_id
            and label.workspace_id = ${command.workspaceId}::uuid
          where link.contact_method_id = method.id
        ) labels on true
        where method.person_id = ${command.personId}::uuid
          and (${command.factId ?? null}::uuid is null or method.id = ${
        command.factId ?? null
      }::uuid)
          and (${afterId}::uuid is null or
            (method.updated_at, method.id) >
              (${afterUpdatedAt}::timestamptz, ${afterId}::uuid))
        order by method.updated_at, method.id
        limit ${limit}
      `.execute(database);
    } else if (command.section === "addresses") {
      result = await sql<FactRow>`
        select address.id::text, to_char(address.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
          jsonb_strip_nulls(jsonb_build_object(
            'displayName', address.display_name, 'isPrimary', address.is_primary,
            'street', location.street, 'city', location.city,
            'region', location.region, 'postalCode', location.postal_code,
            'country', location.country,
            'labelIds', coalesce(labels.ids, '[]'::jsonb)
          )) as value
        from crm.person_addresses address
        left join crm.locations location on location.id = address.location_id
          and location.workspace_id = ${command.workspaceId}::uuid
        left join lateral (
          select jsonb_agg(link.label_id::text order by link.label_id) as ids
          from crm.person_address_labels link
          join crm.contact_labels label on label.id = link.label_id
            and label.workspace_id = ${command.workspaceId}::uuid
          where link.address_id = address.id
        ) labels on true
        where address.person_id = ${command.personId}::uuid
          and (${command.factId ?? null}::uuid is null or address.id = ${
        command.factId ?? null
      }::uuid)
          and (${afterId}::uuid is null or
            (address.updated_at, address.id) >
              (${afterUpdatedAt}::timestamptz, ${afterId}::uuid))
        order by address.updated_at, address.id
        limit ${limit}
      `.execute(database);
    } else if (command.section === "first-meeting") {
      result = await sql<FactRow>`
        select meeting.person_id::text as id,
          to_char(meeting.updated_at at time zone 'UTC',
            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
          jsonb_strip_nulls(jsonb_build_object(
            'introducedByPersonId', introducer.id::text,
            'placeText', meeting.place_text, 'notes', meeting.notes
          )) as value
        from crm.person_first_meetings meeting
        left join crm.people introducer
          on introducer.id = meeting.introduced_by_person_id
          and introducer.workspace_id = ${command.workspaceId}::uuid
          and introducer.archived_at is null and introducer.deleted_at is null
        where meeting.person_id = ${command.personId}::uuid
          and (${command.factId ?? null}::uuid is null or meeting.person_id = ${
        command.factId ?? null
      }::uuid)
          and (${afterId}::uuid is null or
            (meeting.updated_at, meeting.person_id) >
              (${afterUpdatedAt}::timestamptz, ${afterId}::uuid))
        order by meeting.updated_at, meeting.person_id
        limit ${limit}
      `.execute(database);
    } else if (command.section === "food-preferences") {
      result = await sql<FactRow>`
        select person.id::text, ${timestamp} as updated_at,
          jsonb_strip_nulls(jsonb_build_object(
            'foodPreferences', person.food_preferences
          )) as value
        from crm.people person where person.id = ${command.personId}::uuid
          and person.food_preferences is not null
          and (${command.factId ?? null}::uuid is null or person.id = ${
        command.factId ?? null
      }::uuid)
          and (${afterId}::uuid is null or
            (person.updated_at, person.id) >
              (${afterUpdatedAt}::timestamptz, ${afterId}::uuid))
        order by person.updated_at, person.id
        limit ${limit}
      `.execute(database);
    } else if (command.section === "work") {
      result = await sql<FactRow>`
        select occupation.id::text, to_char(occupation.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
          jsonb_strip_nulls(jsonb_build_object(
            'title', occupation.title, 'description', occupation.description,
            'organizationId', organization.id::text,
            'organizationName', organization.name,
            'isCurrent', occupation.is_current,
            'startOn', occupation.start_on::text, 'endOn', occupation.end_on::text
          )) as value
        from crm.person_occupations occupation
        left join crm.organizations organization
          on organization.id = occupation.organization_id
          and organization.workspace_id = ${command.workspaceId}::uuid
        where occupation.person_id = ${command.personId}::uuid
          and (${command.factId ?? null}::uuid is null or occupation.id = ${
        command.factId ?? null
      }::uuid)
          and (${afterId}::uuid is null or
            (occupation.updated_at, occupation.id) >
              (${afterUpdatedAt}::timestamptz, ${afterId}::uuid))
        order by occupation.updated_at, occupation.id
        limit ${limit}
      `.execute(database);
    } else if (command.section === "pets") {
      result = await sql<FactRow>`
        select pet.id::text, ${timestamp} as updated_at,
          jsonb_strip_nulls(jsonb_build_object(
            'categoryId', pet.category_id::text, 'name', pet.name,
            'notes', pet.notes
          )) as value
        from crm.pets pet where pet.person_id = ${command.personId}::uuid
          and (${command.factId ?? null}::uuid is null or pet.id = ${
        command.factId ?? null
      }::uuid)
          and (${afterId}::uuid is null or
            (pet.updated_at, pet.id) >
              (${afterUpdatedAt}::timestamptz, ${afterId}::uuid))
        order by pet.updated_at, pet.id
        limit ${limit}
      `.execute(database);
    } else {
      result = await sql<FactRow>`
        select person.id::text, to_char(person.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
          jsonb_build_object(
            'tagIds', coalesce(tags.ids, '[]'::jsonb)
          ) as value
        from crm.people person
        left join lateral (
          select jsonb_agg(link.tag_id::text order by link.tag_id) as ids
          from crm.person_tags link join crm.tags tag on tag.id = link.tag_id
          where link.person_id = person.id
            and tag.workspace_id = ${command.workspaceId}::uuid
        ) tags on true
        where person.id = ${command.personId}::uuid
          and (${command.factId ?? null}::uuid is null or person.id = ${
        command.factId ?? null
      }::uuid)
          and (${afterId}::uuid is null or
            (person.updated_at, person.id) >
              (${afterUpdatedAt}::timestamptz, ${afterId}::uuid))
        order by person.updated_at, person.id
        limit ${limit}
      `.execute(database);
    }
    return result.rows.map((row) => record(command.section, row));
  }

  async inspectPageAnchor(
    command: Parameters<
      NonNullable<ProfileFactRepository["inspectPageAnchor"]>
    >[0],
  ): Promise<boolean> {
    const { after, ...context } = command;
    const records = await this.list({
      ...context,
      factId: after.id,
      limit: 1,
    });
    return records[0]?.id === after.id &&
      records[0]?.updatedAt === after.updatedAt;
  }

  async listTagDescriptors(
    command: Parameters<
      NonNullable<ProfileFactRepository["listTagDescriptors"]>
    >[0],
  ): Promise<readonly { readonly id: string; readonly name: string }[]> {
    if (command.tagIds.length === 0) return [];
    const database = databaseFromSession(command.transaction);
    const result = await sql<{ readonly id: string; readonly name: string }>`
      select tag.id::text, tag.name
      from unnest(${command.tagIds}::uuid[]) with ordinality requested(id, position)
      join crm.tags tag on tag.id = requested.id
        and tag.workspace_id = ${command.workspaceId}::uuid
      order by requested.position
    `.execute(database);
    return result.rows;
  }

  async lockFact(
    command: Parameters<ProfileFactRepository["lockFact"]>[0],
  ): Promise<ProfileFactRecord | undefined> {
    const database = databaseFromSession(command.transaction);
    const locked = command.section === "contact-methods"
      ? await sql<{ readonly id: string }>`select method.id::text
          from crm.person_contact_methods method
          join crm.people person on person.id = method.person_id
            and person.workspace_id = ${command.workspaceId}::uuid
          where method.id = ${command.factId}::uuid
            and method.person_id = ${command.personId}::uuid for update of method`
        .execute(database)
      : command.section === "addresses"
      ? await sql<{ readonly id: string }>`select address.id::text
          from crm.person_addresses address
          join crm.people person on person.id = address.person_id
            and person.workspace_id = ${command.workspaceId}::uuid
          where address.id = ${command.factId}::uuid
            and address.person_id = ${command.personId}::uuid for update of address`
        .execute(database)
      : command.section === "work"
      ? await sql<{ readonly id: string }>`select occupation.id::text
          from crm.person_occupations occupation
          join crm.people person on person.id = occupation.person_id
            and person.workspace_id = ${command.workspaceId}::uuid
          where occupation.id = ${command.factId}::uuid
            and occupation.person_id = ${command.personId}::uuid for update of occupation`
        .execute(database)
      : command.section === "pets"
      ? await sql<{ readonly id: string }>`select pet.id::text
          from crm.pets pet join crm.people person on person.id = pet.person_id
            and person.workspace_id = ${command.workspaceId}::uuid
          where pet.id = ${command.factId}::uuid
            and pet.person_id = ${command.personId}::uuid for update of pet`
        .execute(database)
      : await sql<{ readonly id: string }>`select person.id::text
          from crm.people person
          where person.id = ${command.factId}::uuid
            and person.id = ${command.personId}::uuid
            and person.workspace_id = ${command.workspaceId}::uuid
            and person.deleted_at is null for update of person`
        .execute(database);
    if (!locked.rows[0]) return undefined;
    return (await rows(this, command, command.factId)).find((record) =>
      record.id === command.factId
    );
  }

  async save(
    command: Parameters<ProfileFactRepository["save"]>[0],
  ): Promise<
    {
      readonly personUpdatedAt: string;
      readonly record: ProfileFactRecord;
    } | undefined
  > {
    const database = databaseFromSession(command.transaction);
    const expected = command.expectedUpdatedAt ?? null;
    if (command.expectedUpdatedAt) {
      const targetId =
        ["first-meeting", "food-preferences", "tags"].includes(command.section)
          ? command.personId
          : command.id;
      const current = (await rows(this, command, targetId)).find((candidate) =>
        candidate.id === targetId
      );
      if (current?.updatedAt !== command.expectedUpdatedAt) return undefined;
    }
    if (command.section === "contact-methods") {
      const value = command.value as ContactMethodFact;
      if (value.isPrimary) {
        await sql`update crm.person_contact_methods set is_primary = false,
          updated_at = greatest(${command.occurredAt}::timestamptz, updated_at + interval '1 microsecond')
          where person_id = ${command.personId}::uuid and type_id = ${value.typeId}::uuid
            and id <> ${command.id}::uuid and is_primary`.execute(database);
      }
      const saved = await sql<{ readonly id: string }>`
        insert into crm.person_contact_methods (
          id, person_id, type_id, value, is_primary, notes, created_at, updated_at
        ) values (${command.id}::uuid, ${command.personId}::uuid,
          ${value.typeId}::uuid, ${value.value}, ${value.isPrimary},
          ${value.notes ?? null}, ${command.occurredAt}, ${command.occurredAt})
        on conflict (id) do update set type_id = excluded.type_id,
          value = excluded.value, is_primary = excluded.is_primary,
          notes = excluded.notes, updated_at = greatest(
            excluded.updated_at, person_contact_methods.updated_at + interval '1 microsecond')
        where person_contact_methods.person_id = ${command.personId}::uuid
          and (${expected}::timestamptz is null or person_contact_methods.updated_at = ${expected}::timestamptz)
        returning id::text
      `.execute(database);
      if (!saved.rows[0]) {
        throw new Error("Contact method target conflicts with another person.");
      }
      await sql`delete from crm.person_contact_method_labels where contact_method_id = ${command.id}::uuid`
        .execute(database);
      for (const labelId of value.labelIds) {
        await sql`insert into crm.person_contact_method_labels (contact_method_id, label_id)
          values (${command.id}::uuid, ${labelId}::uuid)`.execute(database);
      }
    } else if (command.section === "addresses") {
      const value = command.value as AddressFact;
      const locationId = crypto.randomUUID();
      const existing = await sql<{ readonly location_id: string | null }>`
        select location_id::text from crm.person_addresses
        where id = ${command.id}::uuid and person_id = ${command.personId}::uuid
      `.execute(database);
      const selectedLocationId = existing.rows[0]?.location_id ?? locationId;
      await sql`insert into crm.locations (
          id, workspace_id, street, city, region, postal_code, country,
          created_at, updated_at
        ) values (${selectedLocationId}::uuid, ${command.workspaceId}::uuid,
          ${value.street ?? null}, ${value.city ?? null}, ${
        value.region ?? null
      },
          ${value.postalCode ?? null}, ${value.country ?? null},
          ${command.occurredAt}, ${command.occurredAt})
        on conflict (id) do update set street = excluded.street,
          city = excluded.city, region = excluded.region,
          postal_code = excluded.postal_code, country = excluded.country,
          updated_at = greatest(excluded.updated_at, crm.locations.updated_at + interval '1 microsecond')
        where crm.locations.workspace_id = ${command.workspaceId}::uuid
      `.execute(database);
      if (value.isPrimary) {
        await sql`update crm.person_addresses set is_primary = false,
          updated_at = greatest(${command.occurredAt}::timestamptz, updated_at + interval '1 microsecond')
          where person_id = ${command.personId}::uuid and id <> ${command.id}::uuid and is_primary`
          .execute(database);
      }
      const saved = await sql<{ readonly id: string }>`
        insert into crm.person_addresses (
          id, person_id, location_id, display_name, is_primary, created_at, updated_at
        ) values (${command.id}::uuid, ${command.personId}::uuid,
          ${selectedLocationId}::uuid, ${value.displayName ?? null},
          ${value.isPrimary}, ${command.occurredAt}, ${command.occurredAt})
        on conflict (id) do update set location_id = excluded.location_id,
          display_name = excluded.display_name, is_primary = excluded.is_primary,
          updated_at = greatest(excluded.updated_at, person_addresses.updated_at + interval '1 microsecond')
        where person_addresses.person_id = ${command.personId}::uuid
          and (${expected}::timestamptz is null or person_addresses.updated_at = ${expected}::timestamptz)
        returning id::text
      `.execute(database);
      if (!saved.rows[0]) {
        throw new Error("Address target conflicts with another person.");
      }
      await sql`delete from crm.person_address_labels where address_id = ${command.id}::uuid`
        .execute(database);
      for (const labelId of value.labelIds) {
        await sql`insert into crm.person_address_labels (address_id, label_id)
          values (${command.id}::uuid, ${labelId}::uuid)`.execute(database);
      }
    } else if (command.section === "first-meeting") {
      const value = command.value as FirstMeetingFact;
      const saved = await sql<{ readonly id: string }>`
        insert into crm.person_first_meetings (
          person_id, introduced_by_person_id, place_text, notes, updated_at
        ) values (${command.personId}::uuid,
          ${value.introducedByPersonId ?? null}::uuid,
          ${value.placeText ?? null}, ${
        value.notes ?? null
      }, ${command.occurredAt})
        on conflict (person_id) do update set
          introduced_by_person_id = excluded.introduced_by_person_id,
          place_text = excluded.place_text,
          notes = excluded.notes, updated_at = greatest(
            excluded.updated_at, person_first_meetings.updated_at + interval '1 microsecond')
        where ${expected}::timestamptz is null or person_first_meetings.updated_at = ${expected}::timestamptz
        returning person_id::text as id
      `.execute(database);
      if (!saved.rows[0]) {
        throw new Error("First-meeting save failed after version validation.");
      }
    } else if (command.section === "food-preferences") {
      const value = command.value as FoodPreferencesFact;
      const saved = await sql<{ readonly id: string }>`
        update crm.people set food_preferences = ${
        value.foodPreferences ?? null
      }
        where id = ${command.personId}::uuid
          and (${expected}::timestamptz is null or updated_at = ${expected}::timestamptz)
        returning id::text
      `.execute(database);
      if (!saved.rows[0]) {
        throw new Error(
          "Food-preference save failed after version validation.",
        );
      }
    } else if (command.section === "tags") {
      const value = command.value as TagsFact;
      const valid = await sql<{ readonly id: string }>`
        select id::text from crm.tags
        where workspace_id = ${command.workspaceId}::uuid
          and id = any(${value.tagIds}::uuid[])
        order by id for key share
      `.execute(database);
      if (valid.rows.length !== value.tagIds.length) return undefined;
      await sql`delete from crm.person_tags where person_id = ${command.personId}::uuid`
        .execute(database);
      await sql`insert into crm.person_tags (person_id, tag_id)
        select ${command.personId}::uuid, requested.tag_id
        from unnest(${value.tagIds}::uuid[]) requested(tag_id)`
        .execute(database);
    } else if (command.section === "work") {
      const value = command.value as OccupationFact;
      let organizationId = value.organizationId;
      if (organizationId) {
        const valid = await sql<
          { readonly id: string }
        >`select id::text from crm.organizations
          where id = ${organizationId}::uuid and workspace_id = ${command.workspaceId}::uuid`
          .execute(database);
        if (!valid.rows[0]) return undefined;
      } else if (value.organizationName) {
        const created = await sql<{ readonly id: string }>`
          insert into crm.organizations (workspace_id, name, created_at, updated_at)
          values (${command.workspaceId}::uuid, ${value.organizationName}, ${command.occurredAt}, ${command.occurredAt})
          on conflict (workspace_id, (lower(name))) do update set name = excluded.name
          returning id::text
        `.execute(database);
        organizationId = created.rows[0]?.id;
      }
      const saved = await sql<{ readonly id: string }>`
        insert into crm.person_occupations (
          id, person_id, organization_id, title, description, is_current,
          start_on, end_on, created_at, updated_at
        ) values (${command.id}::uuid, ${command.personId}::uuid,
          ${organizationId ?? null}::uuid, ${value.title},
          ${value.description ?? null}, ${value.isCurrent},
          ${value.startOn ?? null}::date, ${value.endOn ?? null}::date,
          ${command.occurredAt}, ${command.occurredAt})
        on conflict (id) do update set organization_id = excluded.organization_id,
          title = excluded.title, description = excluded.description,
          is_current = excluded.is_current, start_on = excluded.start_on,
          end_on = excluded.end_on, updated_at = greatest(
            excluded.updated_at, person_occupations.updated_at + interval '1 microsecond')
        where person_occupations.person_id = ${command.personId}::uuid
          and (${expected}::timestamptz is null or person_occupations.updated_at = ${expected}::timestamptz)
        returning id::text
      `.execute(database);
      if (!saved.rows[0]) {
        throw new Error("Occupation target conflicts with another person.");
      }
    } else {
      const value = command.value as PetFact;
      const saved = await sql<{ readonly id: string }>`
        insert into crm.pets (
          id, person_id, category_id, name, notes, created_at, updated_at
        ) values (${command.id}::uuid, ${command.personId}::uuid,
          ${value.categoryId ?? null}::uuid, ${value.name ?? null},
          ${value.notes ?? null}, ${command.occurredAt}, ${command.occurredAt})
        on conflict (id) do update set category_id = excluded.category_id,
          name = excluded.name, notes = excluded.notes,
          updated_at = greatest(excluded.updated_at, pets.updated_at + interval '1 microsecond')
        where pets.person_id = ${command.personId}::uuid
          and (${expected}::timestamptz is null or pets.updated_at = ${expected}::timestamptz)
        returning id::text
      `.execute(database);
      if (!saved.rows[0]) {
        throw new Error("Pet target conflicts with another person.");
      }
    }
    const savedTargetId = command.section === "first-meeting" ||
        command.section === "food-preferences" || command.section === "tags"
      ? command.personId
      : command.id;
    const savedRows = await rows(this, command, savedTargetId);
    let savedRecord = savedRows.find((candidate) =>
      candidate.id ===
        (command.section === "first-meeting" ||
            command.section === "food-preferences" || command.section === "tags"
          ? command.personId
          : command.id)
    );
    if (!savedRecord) {
      throw new Error("Saved profile fact could not be read back.");
    }
    const personUpdatedAt = await this.bumpRevision(command);
    if (["food-preferences", "tags"].includes(command.section)) {
      savedRecord = { ...savedRecord, updatedAt: personUpdatedAt };
    }
    return { personUpdatedAt, record: savedRecord };
  }

  async delete(
    command: Parameters<ProfileFactRepository["delete"]>[0],
  ): Promise<
    {
      readonly before: ProfileFactRecord;
      readonly personUpdatedAt: string;
    } | undefined
  > {
    const before = (await rows(this, command, command.factId)).find((
      candidate,
    ) => candidate.id === command.factId);
    if (!before || before.updatedAt !== command.expectedUpdatedAt) {
      return undefined;
    }
    const database = databaseFromSession(command.transaction);
    if (command.section === "contact-methods") {
      await sql`delete from crm.person_contact_methods where id = ${command.factId}::uuid and person_id = ${command.personId}::uuid`
        .execute(database);
    } else if (command.section === "addresses") {
      await sql`delete from crm.person_addresses where id = ${command.factId}::uuid and person_id = ${command.personId}::uuid`
        .execute(database);
    } else if (command.section === "first-meeting") {
      await sql`delete from crm.person_first_meetings where person_id = ${command.personId}::uuid`
        .execute(database);
    } else if (command.section === "work") {
      await sql`delete from crm.person_occupations where id = ${command.factId}::uuid and person_id = ${command.personId}::uuid`
        .execute(database);
    } else if (command.section === "food-preferences") {
      await sql`update crm.people set food_preferences = null
        where id = ${command.personId}::uuid
          and workspace_id = ${command.workspaceId}::uuid
          and food_preferences is not null`.execute(database);
    } else if (command.section === "pets") {
      await sql`delete from crm.pets where id = ${command.factId}::uuid and person_id = ${command.personId}::uuid`
        .execute(database);
    } else {
      return undefined;
    }
    const personUpdatedAt = await this.bumpRevision(command);
    return { before, personUpdatedAt };
  }

  async assertPostcondition(
    command: Parameters<ProfileFactRepository["assertPostcondition"]>[0],
  ): Promise<void> {
    const {
      after: mutationAfter,
      before: mutationBefore,
      ...readContext
    } = command;
    const target = mutationAfter ?? mutationBefore;
    if (!target) throw new Error("Profile-fact postcondition has no target.");
    const current = (await this.list({
      ...readContext,
      factId: target.id,
      limit: 1,
      section: target.section,
    })).find((candidate) => candidate.id === target.id);
    const valid = command.action === "delete"
      ? current === undefined
      : JSON.stringify(current) === JSON.stringify(command.after);
    if (!valid) {
      throw new Error(`Profile-fact ${command.action} postcondition failed.`);
    }
  }
}
