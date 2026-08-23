import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import {
  PERSON_PROFILE_TAG_PREVIEW_LIMIT,
  type PersonLifeEvent,
  type PersonProfileIdentity,
  type PersonProfileRepository,
  type PersonProfileSection,
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
  readonly last_contact_at: string | null;
  readonly middle_name: string | null;
  readonly next_reminder_at: string | null;
  readonly nickname: string | null;
  readonly open_task_count: number;
  readonly profile_sections: readonly PersonProfileSection[];
  readonly tag_count: number;
  readonly tags: readonly PersonProfileTag[];
  readonly stay_in_touch_at: string | null;
  readonly updated_at: string | null;
}

interface PersonLifeEventsRow {
  readonly events: readonly PersonLifeEvent[];
  readonly module_is_active: boolean;
  readonly person_id: string | null;
}

function identity(row: PersonProfileRow): PersonProfileIdentity | undefined {
  if (
    !row.id || row.given_name === null || row.is_deceased === null ||
    row.is_partial === null || row.is_self === null ||
    row.is_starred === null ||
    row.updated_at === null
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
    ...(row.last_contact_at ? { lastContactAt: row.last_contact_at } : {}),
    ...(row.middle_name ? { middleName: row.middle_name } : {}),
    ...(row.nickname ? { nickname: row.nickname } : {}),
    profileSections: row.profile_sections,
    tagCount: row.tag_count,
    tags: row.tags,
    updatedAt: row.updated_at,
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
        to_char(person.updated_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
        coalesce(member.self_person_id = person.id, false) as is_self,
        coalesce(tag_summary.tag_count, 0)::int as tag_count,
        coalesce(tag_preview.tags, '[]'::jsonb) as tags
        , coalesce(profile_sections.sections, '[]'::jsonb) as profile_sections,
        last_contact.last_contact_at,
        coalesce(due.open_task_count, 0)::int as open_task_count,
        due.next_reminder_at, due.stay_in_touch_at
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
        select to_char(max(contacted_at) at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as last_contact_at
        from (
          select called_at as contacted_at from crm.calls
          where workspace_id = workspace.id and person_id = person.id
          union all
          select greatest(thread.happened_at, coalesce(max(message.written_at), thread.happened_at))
          from crm.conversation_threads thread
          left join crm.messages message on message.conversation_id = thread.id
          where thread.workspace_id = workspace.id and thread.person_id = person.id
          group by thread.id, thread.happened_at
        ) contact
      ) last_contact on true
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
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'id', available.id,
          'status', case when module.is_active = false then 'hidden' else 'ready' end
        ) order by available.sort_order) as sections
        from (values
          ('contact-methods', 1), ('addresses', 2), ('first-meeting', 3),
          ('relationships', 4), ('work', 5), ('food-preferences', 6),
          ('pets', 7), ('tags', 8), ('notes', 9), ('activities', 10),
          ('conversations', 11), ('calls', 12), ('tasks', 13),
          ('life-events', 14)
        ) available(id, sort_order)
        left join crm.workspace_profile_modules module
          on module.workspace_id = workspace.id and module.key = available.id
      ) profile_sections on true
      left join lateral (
        select
          (select count(*)::int from crm.tasks task
            where task.workspace_id = workspace.id
              and task.person_id = person.id and task.status = 'open'
              and task.deleted_at is null) as open_task_count,
          (select to_char(occurrence.deliver_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
            from crm.reminder_occurrences occurrence
            join crm.reminders reminder on reminder.id = occurrence.reminder_id
              and reminder.workspace_id = workspace.id
            where reminder.person_id = person.id and reminder.is_active
              and reminder.deleted_at is null
              and occurrence.member_id = member.id
              and occurrence.status in ('pending', 'retry')
            order by occurrence.deliver_at, occurrence.id limit 1
          ) as next_reminder_at,
          (select to_char(cadence.next_due_at at time zone 'UTC',
              'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
            from crm.stay_in_touch_cadences cadence
            where cadence.person_id = person.id and cadence.is_active
            order by cadence.next_due_at nulls last, cadence.id limit 1
          ) as stay_in_touch_at
      ) due on true
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
      dueInformation: {
        ...(row.next_reminder_at
          ? { nextReminderAt: row.next_reminder_at }
          : {}),
        openTaskCount: row.open_task_count,
        ...(row.stay_in_touch_at
          ? { stayInTouchAt: row.stay_in_touch_at }
          : {}),
      },
      person,
      status: row.archived_at ? "archived" : "ready",
    };
  }

  async listLifeEvents(
    command: Parameters<PersonProfileRepository["listLifeEvents"]>[0],
  ): Promise<Awaited<ReturnType<PersonProfileRepository["listLifeEvents"]>>> {
    const result = await sql<PersonLifeEventsRow>`
      select person.id::text as person_id,
        coalesce(profile_module.is_active, true) as module_is_active,
        coalesce(history.events, '[]'::jsonb) as events
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      left join crm.people person
        on person.id = ${command.personId}::uuid
        and person.workspace_id = workspace.id and person.deleted_at is null
      left join crm.workspace_profile_modules profile_module
        on profile_module.workspace_id = workspace.id
        and profile_module.key = 'life-events'
      left join lateral (
        select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'id', event.id::text,
          'name', event.name,
          'note', event.note,
          'typeName', event_type.name,
          'date', jsonb_strip_nulls(jsonb_build_object(
            'precision', event.precision,
            'year', event.year,
            'month', event.month,
            'day', event.day,
            'happenedAt', case when event.happened_at is not null then
              to_char(event.happened_at at time zone 'UTC',
                'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end
          ))
        )) order by event.year desc nulls last, event.month desc nulls last,
          event.day desc nulls last, event.happened_at desc nulls last,
          event.updated_at desc, event.id desc) as events
        from (
          select stored.* from crm.life_events stored
          where stored.workspace_id = workspace.id
            and stored.person_id = person.id
            and coalesce(profile_module.is_active, true)
          order by stored.year desc nulls last,
            stored.month desc nulls last, stored.day desc nulls last,
            stored.happened_at desc nulls last, stored.updated_at desc,
            stored.id desc
          limit 100
        ) event
        left join crm.life_event_types event_type
          on event_type.id = event.life_event_type_id
          and event_type.workspace_id = workspace.id
      ) history on true
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role} and member.status = 'active'
        and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active' and workspace.deleted_at is null
    `.execute(this.database);
    const row = result.rows[0];
    if (!row) return { status: "forbidden" };
    if (!row.person_id) return { status: "not-found" };
    if (!row.module_is_active) return { events: [], status: "hidden" };
    return { events: row.events, status: "ready" };
  }
}
