import { sql } from "kysely";
import type { Kysely, RawBuilder } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import {
  PEOPLE_DIRECTORY_TAG_PREVIEW_LIMIT,
  type PeopleDirectoryCriteria,
  type PeopleDirectoryCursor,
  type PeopleDirectoryPersonRecord,
  type PeopleDirectoryRepository,
  type PeopleDirectoryTag,
} from "../../application/list_people.ts";
import type {
  PeopleTagOptionRecord,
  PeopleTagOptionsRepository,
} from "../../application/list_tag_options.ts";

interface PersonRow {
  readonly family_name: string | null;
  readonly given_name: string;
  readonly id: string;
  readonly is_partial: boolean;
  readonly is_starred: boolean;
  readonly middle_name: string | null;
  readonly nickname: string | null;
  readonly sort_primary: string;
  readonly sort_secondary: string;
  readonly tag_count: number;
  readonly tags: readonly PeopleDirectoryTag[];
}

interface TagOptionRow {
  readonly id: string;
  readonly name: string;
  readonly sort_primary: string;
}

function filters(
  command: PeopleDirectoryCriteria & { readonly workspaceId: string },
) {
  const lifecycle = command.lifecycle === "active"
    ? sql`person.archived_at is null`
    : sql`person.archived_at is not null`;
  const search = command.search
    ? sql`and strpos(
        lower(concat_ws(' ', person.given_name, person.middle_name,
          person.family_name, person.nickname)), lower(${command.search})
      ) > 0`
    : sql``;
  const tag = command.tagId
    ? sql`and exists (
        select 1
        from crm.person_tags filter_link
        join crm.tags filter_tag on filter_tag.id = filter_link.tag_id
        where filter_link.person_id = person.id
          and filter_tag.id = ${command.tagId}::uuid
          and filter_tag.workspace_id = ${command.workspaceId}::uuid
      )`
    : sql``;
  const excluded = command.excludePersonId
    ? sql`and person.id <> ${command.excludePersonId}::uuid`
    : sql``;
  return { excluded, lifecycle, search, tag };
}

function ordering(sort: PeopleDirectoryCriteria["sort"]): {
  readonly order: RawBuilder<unknown>;
  readonly primary: RawBuilder<string>;
  readonly secondary: RawBuilder<string>;
} {
  if (sort === "recently-added") {
    const primary = sql<string>`person.created_at::text`;
    const secondary = sql<string>`''::text`;
    return {
      order: sql`${sql`person.created_at`} desc, person.id asc`,
      primary,
      secondary,
    };
  }
  const primary = sort === "family-name"
    ? sql<string>`lower(coalesce(nullif(btrim(person.family_name), ''),
        nullif(btrim(person.nickname), ''),
        nullif(btrim(person.given_name), ''), ''))`
    : sql<string>`lower(coalesce(nullif(btrim(person.given_name), ''),
        nullif(btrim(person.nickname), ''),
        nullif(btrim(person.family_name), ''), ''))`;
  const secondary = sort === "family-name"
    ? sql<string>`lower(coalesce(person.given_name, ''))`
    : sql<string>`lower(coalesce(person.family_name, ''))`;
  return {
    order: sql`${primary} asc, ${secondary} asc, person.id asc`,
    primary,
    secondary,
  };
}

function seek(
  sort: PeopleDirectoryCriteria["sort"],
  after: PeopleDirectoryCursor | undefined,
  primary: RawBuilder<string>,
  secondary: RawBuilder<string>,
) {
  if (!after) return sql``;
  if (sort === "recently-added") {
    return sql`and (
      person.created_at < ${after.primary}::timestamptz or
      (person.created_at = ${after.primary}::timestamptz and
        person.id > ${after.id}::uuid)
    )`;
  }
  return sql`and (
    ${primary} > ${after.primary} or
    (${primary} = ${after.primary} and ${secondary} > ${after.secondary}) or
    (${primary} = ${after.primary} and ${secondary} = ${after.secondary}
      and person.id > ${after.id}::uuid)
  )`;
}

export class PostgresPeopleDirectoryRepository
  implements PeopleDirectoryRepository, PeopleTagOptionsRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async findSelected(
    command: Parameters<
      NonNullable<PeopleDirectoryRepository["findSelected"]>
    >[0],
  ): Promise<PeopleDirectoryPersonRecord | undefined> {
    const selected = await sql<{
      readonly family_name: string | null;
      readonly given_name: string;
      readonly id: string;
      readonly is_partial: boolean;
      readonly is_starred: boolean;
      readonly middle_name: string | null;
      readonly nickname: string | null;
    }>`
      select person.id::text, person.given_name, person.middle_name,
        person.family_name, person.nickname, person.is_partial,
        person.is_starred
      from crm.people person
      where person.id = ${command.personId}::uuid
        and person.workspace_id = ${command.workspaceId}::uuid
        and case when ${command.lifecycle} = 'archived'
          then person.archived_at is not null
          else person.archived_at is null
        end
        and person.deleted_at is null
      limit 1
    `.execute(this.database);
    const row = selected.rows[0];
    if (!row) return undefined;
    return {
      cursor: {
        id: row.id,
        primary: row.given_name.toLowerCase(),
        secondary: row.family_name?.toLowerCase() ?? "",
      },
      ...pickDefined({ familyName: row.family_name }),
      givenName: row.given_name,
      id: row.id,
      isPartial: row.is_partial,
      isStarred: row.is_starred,
      lifecycle: command.lifecycle,
      ...pickDefined({ middleName: row.middle_name, nickname: row.nickname }),
      tagCount: 0,
      tags: [],
    };
  }

  async list(
    command: Parameters<PeopleDirectoryRepository["list"]>[0],
  ): Promise<Awaited<ReturnType<PeopleDirectoryRepository["list"]>>> {
    const criteria = filters(command);
    const sort = ordering(command.sort);
    if (command.after) {
      const anchor = await sql<{
        readonly sort_primary: string;
        readonly sort_secondary: string;
      }>`
        select ${sort.primary} as sort_primary,
          ${sort.secondary} as sort_secondary
        from crm.people person
        where person.id = ${command.after.id}::uuid
          and person.workspace_id = ${command.workspaceId}::uuid
          and person.deleted_at is null
          ${criteria.excluded}
          and ${criteria.lifecycle}
          ${criteria.search}
          ${criteria.tag}
      `.execute(this.database);
      const row = anchor.rows[0];
      if (
        !row || row.sort_primary !== command.after.primary ||
        row.sort_secondary !== command.after.secondary
      ) {
        return { status: "stale-cursor" };
      }
    }

    const continuation = seek(
      command.sort,
      command.after,
      sort.primary,
      sort.secondary,
    );
    const people = await sql<PersonRow>`
      select person.id::text, person.given_name, person.middle_name,
        person.family_name, person.nickname, person.is_partial,
        person.is_starred, ${sort.primary} as sort_primary,
        ${sort.secondary} as sort_secondary,
        coalesce(tag_summary.tag_count, 0)::int as tag_count,
        coalesce(tag_preview.tags, '[]'::jsonb) as tags
      from crm.people person
      left join lateral (
        select count(*)::int as tag_count
        from crm.person_tags counted_link
        join crm.tags counted_tag on counted_tag.id = counted_link.tag_id
          and counted_tag.workspace_id = ${command.workspaceId}::uuid
        where counted_link.person_id = person.id
      ) tag_summary on true
      left join lateral (
        select jsonb_agg(
          jsonb_build_object('id', preview.id::text, 'name', preview.name)
          order by lower(preview.name), preview.id
        ) as tags
        from (
          select preview_tag.id, preview_tag.name
          from crm.person_tags preview_link
          join crm.tags preview_tag on preview_tag.id = preview_link.tag_id
            and preview_tag.workspace_id = ${command.workspaceId}::uuid
          where preview_link.person_id = person.id
          order by lower(preview_tag.name), preview_tag.id
          limit ${PEOPLE_DIRECTORY_TAG_PREVIEW_LIMIT}
        ) preview
      ) tag_preview on true
      where person.workspace_id = ${command.workspaceId}::uuid
        and person.deleted_at is null
        ${criteria.excluded}
        and ${criteria.lifecycle}
        ${criteria.search}
        ${criteria.tag}
        ${continuation}
      order by ${sort.order}
      limit ${command.limit + 1}
    `.execute(this.database);
    return {
      people: people.rows.map((row): PeopleDirectoryPersonRecord => ({
        cursor: {
          id: row.id,
          primary: row.sort_primary,
          secondary: row.sort_secondary,
        },
        ...pickDefined({ familyName: row.family_name }),
        givenName: row.given_name,
        id: row.id,
        isPartial: row.is_partial,
        isStarred: row.is_starred,
        lifecycle: command.lifecycle,
        ...pickDefined({ middleName: row.middle_name, nickname: row.nickname }),
        tagCount: row.tag_count,
        tags: row.tags,
      })),
      status: "ready",
    };
  }

  async listTagOptions(
    command: Parameters<PeopleTagOptionsRepository["listTagOptions"]>[0],
  ): Promise<
    Awaited<ReturnType<PeopleTagOptionsRepository["listTagOptions"]>>
  > {
    const search = command.search
      ? sql`and strpos(lower(tag.name), ${command.search}) > 0`
      : sql``;
    const continuation = command.after
      ? sql`and (
          lower(tag.name) > ${command.after.primary} or
          (lower(tag.name) = ${command.after.primary}
            and tag.id > ${command.after.id}::uuid)
        )`
      : sql``;
    const options = await sql<TagOptionRow>`
      select tag.id::text, tag.name, lower(tag.name) as sort_primary
      from crm.tags tag
      where tag.workspace_id = ${command.workspaceId}::uuid
        ${search}
        ${continuation}
      order by lower(tag.name), tag.id
      limit ${command.limit + 1}
    `.execute(this.database);
    let selected: PeopleDirectoryTag | undefined;
    if (command.selectedTagId) {
      const selectedResult = await sql<PeopleDirectoryTag>`
        select tag.id::text, tag.name
        from crm.tags tag
        where tag.id = ${command.selectedTagId}::uuid
          and tag.workspace_id = ${command.workspaceId}::uuid
      `.execute(this.database);
      selected = selectedResult.rows[0];
    }
    return {
      options: options.rows.map((row): PeopleTagOptionRecord => ({
        cursor: { id: row.id, primary: row.sort_primary },
        id: row.id,
        name: row.name,
      })),
      ...(selected ? { selected } : {}),
      status: "ready",
    };
  }
}
