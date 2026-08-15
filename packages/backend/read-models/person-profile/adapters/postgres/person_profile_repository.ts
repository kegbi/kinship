import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import {
  PERSON_PROFILE_TAG_PREVIEW_LIMIT,
  type PersonProfileIdentity,
  type PersonProfileRepository,
  type PersonProfileTag,
} from "../../application/get_person_profile.ts";

interface PersonProfileRow {
  readonly archived_at: Date | null;
  readonly description: string | null;
  readonly family_name: string | null;
  readonly gender: string | null;
  readonly given_name: string | null;
  readonly id: string | null;
  readonly is_deceased: boolean | null;
  readonly is_partial: boolean | null;
  readonly is_self: boolean | null;
  readonly is_starred: boolean | null;
  readonly middle_name: string | null;
  readonly nickname: string | null;
  readonly tag_count: number;
  readonly tags: readonly PersonProfileTag[];
}

function identity(row: PersonProfileRow): PersonProfileIdentity | undefined {
  if (
    !row.id || row.given_name === null || row.is_deceased === null ||
    row.is_partial === null || row.is_self === null || row.is_starred === null
  ) {
    return undefined;
  }
  return {
    ...(row.description ? { description: row.description } : {}),
    ...(row.family_name ? { familyName: row.family_name } : {}),
    ...(row.gender ? { gender: row.gender } : {}),
    givenName: row.given_name,
    id: row.id,
    isDeceased: row.is_deceased,
    isPartial: row.is_partial,
    isSelf: row.is_self,
    isStarred: row.is_starred,
    ...(row.middle_name ? { middleName: row.middle_name } : {}),
    ...(row.nickname ? { nickname: row.nickname } : {}),
    tagCount: row.tag_count,
    tags: row.tags,
  };
}

export class PostgresPersonProfileRepository
  implements PersonProfileRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async get(
    command: Parameters<PersonProfileRepository["get"]>[0],
  ): Promise<Awaited<ReturnType<PersonProfileRepository["get"]>>> {
    const result = await sql<PersonProfileRow>`
      select person.id::text, person.given_name, person.middle_name,
        person.family_name, person.nickname, person.description,
        gender.name as gender, person.is_partial, person.is_starred,
        person.is_deceased, person.archived_at,
        coalesce(member.self_person_id = person.id, false) as is_self,
        coalesce(tag_summary.tag_count, 0)::int as tag_count,
        coalesce(tag_preview.tags, '[]'::jsonb) as tags
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      left join crm.people person
        on person.id = ${command.personId}::uuid
        and person.workspace_id = workspace.id
        and person.deleted_at is null
      left join crm.gender_options gender
        on gender.id = person.gender_option_id
        and gender.workspace_id = workspace.id
      left join lateral (
        select count(*)::int as tag_count
        from crm.person_tags counted_link
        join crm.tags counted_tag on counted_tag.id = counted_link.tag_id
          and counted_tag.workspace_id = workspace.id
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
            and preview_tag.workspace_id = workspace.id
          where preview_link.person_id = person.id
          order by lower(preview_tag.name), preview_tag.id
          limit ${PERSON_PROFILE_TAG_PREVIEW_LIMIT}
        ) preview
      ) tag_preview on true
      where account.id = ${command.userId}::uuid
        and account.status = 'active'
        and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.status = 'active'
        and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active'
        and workspace.deleted_at is null
    `.execute(this.database);
    const row = result.rows[0];
    if (!row) return { status: "forbidden" };
    const person = identity(row);
    if (!person) return { status: "not-found" };
    return {
      person,
      status: row.archived_at ? "archived" : "ready",
    };
  }
}
