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
import type {
  PeopleTagFacetEntry,
  PeopleTagFacetRepository,
} from "../../application/list_tag_facet.ts";
import type {
  PeopleDuplicatePairRecord,
  PeopleDuplicatePerson,
  PeopleDuplicateReason,
  PeopleDuplicatesRepository,
} from "../../application/list_duplicates.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import { lastContactByPerson } from "./last_contact.ts";

/** The avatar columns both directory reads select. */
interface AvatarColumns {
  readonly avatar_background_color: string | null;
  readonly avatar_file_id: string | null;
}

interface PersonRow extends AvatarColumns {
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

/**
 * The person's avatar (GAP-045): the stored colour, and the image file only
 * while it is available to be drawn, so a quarantined, missing, or removed
 * image is never offered.
 */
function avatarJoin(workspaceId: string) {
  return sql`
    left join crm.person_avatars avatar on avatar.person_id = person.id
    left join crm.files avatar_file on avatar_file.id = avatar.file_id
      and avatar_file.workspace_id = ${workspaceId}::uuid
      and avatar_file.status = 'available'
      and avatar_file.deleted_at is null
  `;
}

const avatarColumns = sql`
  avatar.background_color as avatar_background_color,
  case when avatar.source = 'file' then avatar_file.id::text end
    as avatar_file_id
`;

function avatar(row: AvatarColumns) {
  return pickDefined({
    backgroundColor: row.avatar_background_color,
    fileId: row.avatar_file_id,
  });
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
  const starred = command.starred ? sql`and person.is_starred` : sql``;
  return { excluded, lifecycle, search, starred, tag };
}

/**
 * When the person was last in contact (GAP-053), by the one rule the person
 * profile's hero also reads (`./last_contact.ts`, duplicated there): one
 * aggregate per person over the workspace's history, hash-joined to the
 * people, never a per-person subquery ahead of the limit. A cursor's anchor
 * names its one person. It is joined only for the `last-contacted` order.
 */
function lastContactJoin(
  sort: PeopleDirectoryCriteria["sort"],
  workspaceId: string,
  personId?: string,
) {
  if (sort !== "last-contacted") return sql``;
  return sql`
    left join ${lastContactByPerson(workspaceId, personId)} last_contact
      on last_contact.person_id = person.id
  `;
}

/**
 * A newest-first instant as a sort key: fixed-width UTC text compared
 * byte-wise, so text order is time order, and the empty key of a person with
 * no time sorts after everyone else.
 */
function newestKey(expression: string): RawBuilder<string> {
  return sql.raw(`coalesce(to_char(${expression} at time zone 'UTC',
    'YYYY-MM-DD"T"HH24:MI:SS.US'), '') collate "C"`);
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
  if (sort === "last-contacted" || sort === "recently-updated") {
    const primary = newestKey(
      sort === "last-contacted"
        ? "last_contact.contacted_at"
        : "person.updated_at",
    );
    return {
      order: sql`${primary} desc, person.id asc`,
      primary,
      secondary: sql<string>`''::text`,
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

/** The order a page is read in: starred people first when asked. */
function pageOrder(
  criteria: PeopleDirectoryCriteria,
  order: RawBuilder<unknown>,
) {
  return criteria.starredFirst ? sql`person.is_starred desc, ${order}` : order;
}

/** The people after `after` within one starred group, in the sort. */
function seekWithinGroup(
  sort: PeopleDirectoryCriteria["sort"],
  after: PeopleDirectoryCursor,
  primary: RawBuilder<string>,
  secondary: RawBuilder<string>,
) {
  if (sort === "recently-added") {
    return sql`(
      person.created_at < ${after.primary}::timestamptz or
      (person.created_at = ${after.primary}::timestamptz and
        person.id > ${after.id}::uuid)
    )`;
  }
  if (sort === "last-contacted" || sort === "recently-updated") {
    return sql`(
      ${primary} < ${after.primary} collate "C" or
      (${primary} = ${after.primary} collate "C" and
        person.id > ${after.id}::uuid)
    )`;
  }
  return sql`(
    ${primary} > ${after.primary} or
    (${primary} = ${after.primary} and ${secondary} > ${after.secondary}) or
    (${primary} = ${after.primary} and ${secondary} = ${after.secondary}
      and person.id > ${after.id}::uuid)
  )`;
}

function seek(
  criteria: PeopleDirectoryCriteria,
  after: PeopleDirectoryCursor | undefined,
  primary: RawBuilder<string>,
  secondary: RawBuilder<string>,
) {
  if (!after) return sql``;
  const within = seekWithinGroup(criteria.sort, after, primary, secondary);
  // With starred people first, the starred group ends before the rest, so a
  // page that ended among the starred continues with every unstarred person.
  return criteria.starredFirst
    ? sql`and (
      person.is_starred < ${after.starred}::boolean or
      (person.is_starred = ${after.starred}::boolean and ${within})
    )`
    : sql`and ${within}`;
}

interface DuplicatePairRow {
  readonly first_id: string;
  readonly reasons: readonly PeopleDuplicateReason[];
  readonly second_id: string;
}

interface DuplicatePersonRow extends AvatarColumns {
  readonly family_name: string | null;
  readonly given_name: string;
  readonly id: string;
  readonly middle_name: string | null;
  readonly nickname: string | null;
  readonly updated_at: string;
}

export class PostgresPeopleDirectoryRepository
  implements
    PeopleDirectoryRepository,
    PeopleDuplicatesRepository,
    PeopleTagFacetRepository,
    PeopleTagOptionsRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async findSelected(
    command: Parameters<
      NonNullable<PeopleDirectoryRepository["findSelected"]>
    >[0],
  ): Promise<PeopleDirectoryPersonRecord | undefined> {
    const selected = await sql<
      AvatarColumns & {
        readonly family_name: string | null;
        readonly given_name: string;
        readonly id: string;
        readonly is_partial: boolean;
        readonly is_starred: boolean;
        readonly middle_name: string | null;
        readonly nickname: string | null;
      }
    >`
      select person.id::text, person.given_name, person.middle_name,
        person.family_name, person.nickname, person.is_partial,
        person.is_starred, ${avatarColumns}
      from crm.people person
      ${avatarJoin(command.workspaceId)}
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
      avatar: avatar(row),
      cursor: {
        id: row.id,
        primary: row.given_name.toLowerCase(),
        secondary: row.family_name?.toLowerCase() ?? "",
        starred: row.is_starred,
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
        readonly is_starred: boolean;
        readonly sort_primary: string;
        readonly sort_secondary: string;
      }>`
        select ${sort.primary} as sort_primary,
          ${sort.secondary} as sort_secondary, person.is_starred
        from crm.people person
        ${lastContactJoin(command.sort, command.workspaceId, command.after.id)}
        where person.id = ${command.after.id}::uuid
          and person.workspace_id = ${command.workspaceId}::uuid
          and person.deleted_at is null
          ${criteria.excluded}
          and ${criteria.lifecycle}
          ${criteria.search}
          ${criteria.starred}
          ${criteria.tag}
      `.execute(this.database);
      const row = anchor.rows[0];
      if (
        !row || row.sort_primary !== command.after.primary ||
        row.sort_secondary !== command.after.secondary ||
        (command.starredFirst && row.is_starred !== command.after.starred)
      ) {
        return { status: "stale-cursor" };
      }
    }

    const continuation = seek(
      command,
      command.after,
      sort.primary,
      sort.secondary,
    );
    // The page is chosen first, on the sort keys alone, and only its rows
    // are then drawn with their avatar and tag preview, so a large workspace
    // pays for twenty rows' laterals rather than every person's (GAP-053).
    const people = await sql<PersonRow>`
      with page as (
        select person.id, ${sort.primary} as sort_primary,
          ${sort.secondary} as sort_secondary,
          row_number() over (order by ${pageOrder(command, sort.order)})
            as position
        from crm.people person
        ${lastContactJoin(command.sort, command.workspaceId)}
        where person.workspace_id = ${command.workspaceId}::uuid
          and person.deleted_at is null
          ${criteria.excluded}
          and ${criteria.lifecycle}
          ${criteria.search}
          ${criteria.starred}
          ${criteria.tag}
          ${continuation}
        order by ${pageOrder(command, sort.order)}
        limit ${command.limit + 1}
      )
      select person.id::text, person.given_name, person.middle_name,
        person.family_name, person.nickname, person.is_partial,
        person.is_starred, page.sort_primary, page.sort_secondary,
        coalesce(tag_summary.tag_count, 0)::int as tag_count,
        coalesce(tag_preview.tags, '[]'::jsonb) as tags, ${avatarColumns}
      from page
      join crm.people person on person.id = page.id
        and person.workspace_id = ${command.workspaceId}::uuid
      ${avatarJoin(command.workspaceId)}
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
      order by page.position
    `.execute(this.database);
    return {
      people: people.rows.map((row): PeopleDirectoryPersonRecord => ({
        avatar: avatar(row),
        cursor: {
          id: row.id,
          primary: row.sort_primary,
          secondary: row.sort_secondary,
          starred: row.is_starred,
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
  /**
   * The tag facet (GAP-053): each workspace tag with the non-deleted people
   * of the view who carry it, most carried first. A tag nobody in the view
   * carries is left out.
   */
  async listTagFacet(
    command: Parameters<PeopleTagFacetRepository["listTagFacet"]>[0],
  ): Promise<readonly PeopleTagFacetEntry[]> {
    const lifecycle = command.lifecycle === "active"
      ? sql`person.archived_at is null`
      : sql`person.archived_at is not null`;
    const result = await sql<PeopleTagFacetEntry>`
      select tag.id::text, tag.name, count(*)::int as count
      from crm.tags tag
      join crm.person_tags link on link.tag_id = tag.id
      join crm.people person on person.id = link.person_id
        and person.workspace_id = ${command.workspaceId}::uuid
        and person.deleted_at is null
        and ${lifecycle}
      where tag.workspace_id = ${command.workspaceId}::uuid
      group by tag.id, tag.name
      order by count(*) desc, lower(tag.name), tag.id
      limit ${command.limit}
    `.execute(this.database);
    return result.rows.map((row) => ({
      count: row.count,
      id: row.id,
      name: row.name,
    }));
  }

  /**
   * The possible duplicates (GAP-049): active people with the same full name
   * once case and spacing are ignored, or sharing an email address or phone
   * number. An email is compared lowercased and trimmed, a phone by its digits
   * alone, and a phone of fewer than seven digits is never a match. A name or
   * value more than `groupLimit` people share pairs nobody.
   */
  async listPairs(
    command: Parameters<PeopleDuplicatesRepository["listPairs"]>[0],
  ): Promise<readonly PeopleDuplicatePairRecord[]> {
    const pairs = await sql<DuplicatePairRow>`
      with candidate as (
        select person.id, person.created_at,
          lower(regexp_replace(btrim(concat_ws(' ',
            nullif(btrim(person.given_name), ''),
            nullif(btrim(person.middle_name), ''),
            nullif(btrim(person.family_name), ''))), '[[:space:]]+', ' ', 'g'))
            as full_name
        from crm.people person
        where person.workspace_id = ${command.workspaceId}::uuid
          and person.archived_at is null and person.deleted_at is null
      ), named as (
        select candidate.*,
          count(*) over (partition by candidate.full_name) as sharing
        from candidate
      ), contact_value as (
        select method.person_id, method_type.kind,
          case method_type.kind
            when 'email' then lower(btrim(method.value))
            else regexp_replace(method.value, '[^0-9]', '', 'g')
          end as value
        from crm.person_contact_methods method
        join candidate on candidate.id = method.person_id
        join crm.contact_method_types method_type
          on method_type.id = method.type_id
          and method_type.workspace_id = ${command.workspaceId}::uuid
        where method_type.kind in ('email', 'phone')
      ), contact as (
        select contact_value.*
        from contact_value
        join (
          select kind, value from contact_value
          group by kind, value
          having count(distinct person_id) <= ${command.groupLimit}
        ) bounded on bounded.kind = contact_value.kind
          and bounded.value = contact_value.value
      ), matched as (
        select first_person.id as first_id, second_person.id as second_id,
          'name' as reason
        from named first_person
        join named second_person
          on second_person.full_name = first_person.full_name
          and second_person.id <> first_person.id
          and (second_person.created_at, second_person.id)
            > (first_person.created_at, first_person.id)
        where first_person.full_name <> ''
          and first_person.sharing <= ${command.groupLimit}
        union
        select first_contact.person_id, second_contact.person_id,
          first_contact.kind
        from contact first_contact
        join contact second_contact
          on second_contact.kind = first_contact.kind
          and second_contact.value = first_contact.value
          and second_contact.person_id <> first_contact.person_id
        join candidate first_person on first_person.id = first_contact.person_id
        join candidate second_person
          on second_person.id = second_contact.person_id
          and (second_person.created_at, second_person.id)
            > (first_person.created_at, first_person.id)
        where (first_contact.kind = 'email' and first_contact.value like '%_@_%')
          or (first_contact.kind = 'phone' and length(first_contact.value) >= 7)
      )
      select matched.first_id::text, matched.second_id::text,
        array_agg(distinct matched.reason order by matched.reason) as reasons
      from matched
      join candidate first_person on first_person.id = matched.first_id
      join candidate second_person on second_person.id = matched.second_id
      group by matched.first_id, matched.second_id,
        first_person.created_at, second_person.created_at
      order by first_person.created_at, matched.first_id,
        second_person.created_at, matched.second_id
      limit ${command.limit}
    `.execute(this.database);
    if (pairs.rows.length === 0) return [];
    const ids = [
      ...new Set(pairs.rows.flatMap((row) => [row.first_id, row.second_id])),
    ];
    const people = await sql<DuplicatePersonRow>`
      select person.id::text, person.given_name, person.middle_name,
        person.family_name, person.nickname,
        ${instantColumn("person.updated_at")} as updated_at,
        ${avatarColumns}
      from crm.people person
      ${avatarJoin(command.workspaceId)}
      where person.workspace_id = ${command.workspaceId}::uuid
        and person.id = any(${ids}::uuid[])
    `.execute(this.database);
    const byId = new Map(
      people.rows.map((row): [string, PeopleDuplicatePerson] => [row.id, {
        ...(Object.keys(avatar(row)).length > 0 ? { avatar: avatar(row) } : {}),
        ...pickDefined({ familyName: row.family_name }),
        givenName: row.given_name,
        id: row.id,
        ...pickDefined({ middleName: row.middle_name, nickname: row.nickname }),
        updatedAt: row.updated_at,
      }]),
    );
    return pairs.rows.flatMap((row) => {
      const first = byId.get(row.first_id);
      const second = byId.get(row.second_id);
      return first && second
        ? [{ people: [first, second] as const, reasons: row.reasons }]
        : [];
    });
  }
}
