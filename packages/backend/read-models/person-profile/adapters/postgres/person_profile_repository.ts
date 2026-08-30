import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import {
  PERSON_PROFILE_TAG_PREVIEW_LIMIT,
  type PersonLifeEvent,
  type PersonLifeEventPrecision,
  type PersonPrimaryContactMethod,
  type PersonProfileIdentity,
  type PersonProfileRepository,
  type PersonProfileSection,
  type PersonProfileSectionRecordCount,
  type PersonProfileTag,
  type PersonRelationshipCount,
} from "../../application/get_person_profile.ts";
import type { PersonTimelineItem } from "../../application/list_person_timeline.ts";

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
  readonly primary_contact_methods:
    | readonly PersonPrimaryContactMethod[]
    | null;
  readonly profile_sections: readonly PersonProfileSection[];
  readonly relationship_counts: readonly PersonRelationshipCount[] | null;
  readonly section_counts: readonly PersonProfileSectionRecordCount[] | null;
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

interface PersonTimelineContextRow {
  readonly archived_at: Date | null;
  readonly id: string | null;
}

interface PersonTimelineRow {
  readonly date_precision: PersonLifeEventPrecision;
  readonly excerpt: string | null;
  readonly id: string;
  readonly kind: PersonTimelineItem["kind"];
  readonly occurred_at: string;
  readonly title: string | null;
}

function timelineItem(row: PersonTimelineRow): PersonTimelineItem {
  return {
    datePrecision: row.date_precision,
    ...(row.excerpt !== null ? { excerpt: row.excerpt } : {}),
    id: row.id,
    kind: row.kind,
    occurredAt: row.occurred_at,
    ...(row.title !== null ? { title: row.title } : {}),
  };
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
    const summaryColumns = command.includeSummary
      ? sql`,
        coalesce(profile_summary.primary_contact_methods, '[]'::jsonb)
          as primary_contact_methods,
        coalesce(profile_summary.relationship_counts, '[]'::jsonb)
          as relationship_counts,
        coalesce(profile_summary.section_counts, '[]'::jsonb)
          as section_counts`
      : sql`, null::jsonb as primary_contact_methods,
        null::jsonb as relationship_counts, null::jsonb as section_counts`;
    const summaryJoin = command.includeSummary
      ? sql`
      left join lateral (
        select
          (
            select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
              'id', primary_method.id::text,
              'kind', primary_method.kind,
              'label', primary_method.label,
              'value', primary_method.value,
              'href', case
                when primary_method.kind = 'email'
                  then 'mailto:' || primary_method.value
                when primary_method.kind = 'phone'
                  then 'tel:' || primary_method.value
              end
            )) order by primary_method.type_sort_order,
              primary_method.method_sort_order, primary_method.id)
            from (
              select method.id, method.value, method.sort_order as method_sort_order,
                method_type.kind, method_type.name as label,
                method_type.sort_order as type_sort_order
              from crm.person_contact_methods method
              join crm.contact_method_types method_type
                on method_type.id = method.type_id
                and method_type.workspace_id = workspace.id
              where method.person_id = person.id and method.is_primary
              order by method_type.sort_order, method.sort_order, method.id
              limit 3
            ) primary_method
          ) as primary_contact_methods,
          (
            select jsonb_agg(jsonb_build_object(
              'count', grouped.record_count,
              'label', grouped.label,
              'relationshipTypeId', grouped.relationship_type_id::text
            ) order by grouped.sort_order, lower(grouped.label),
              grouped.relationship_type_id)
            from (
              select relationship_type.id as relationship_type_id,
                relationship_type.sort_order,
                case when edge.from_person_id = person.id
                  then relationship_type.forward_label
                  else relationship_type.reverse_label end as label,
                count(*)::int as record_count
              from crm.relationships edge
              join crm.relationship_types relationship_type
                on relationship_type.id = edge.relationship_type_id
                and relationship_type.workspace_id = workspace.id
              where edge.workspace_id = workspace.id
                and person.id in (edge.from_person_id, edge.to_person_id)
              group by relationship_type.id, relationship_type.sort_order,
                case when edge.from_person_id = person.id
                  then relationship_type.forward_label
                  else relationship_type.reverse_label end
            ) grouped
          ) as relationship_counts,
          (
            select jsonb_agg(jsonb_build_object(
              'count', counted.record_count,
              'id', counted.section_id
            ) order by counted.section_id)
            from (
              select record.section_id, count(*)::int as record_count
              from (
                select 'activities'::text as section_id,
                  participant.activity_id as record_id
                from crm.activity_participants participant
                join crm.activities activity on activity.id = participant.activity_id
                  and activity.workspace_id = workspace.id
                where participant.person_id = person.id
                union all
                select 'addresses', address.id
                from crm.person_addresses address
                where address.person_id = person.id
                  and person.workspace_id = workspace.id
                union all
                select 'contact-methods', method.id
                from crm.person_contact_methods method
                join crm.contact_method_types method_type on method_type.id = method.type_id
                  and method_type.workspace_id = workspace.id
                where method.person_id = person.id
                union all
                select 'calls', call.id from crm.calls call
                where call.workspace_id = workspace.id and call.person_id = person.id
                union all
                select 'conversations', thread.id
                from crm.conversation_threads thread
                where thread.workspace_id = workspace.id and thread.person_id = person.id
                union all
                select 'first-meeting', meeting.person_id
                from crm.person_first_meetings meeting
                where meeting.person_id = person.id
                  and person.workspace_id = workspace.id
                union all
                select 'food-preferences', person.id
                where person.workspace_id = workspace.id
                  and person.food_preferences is not null
                union all
                select 'life-events', event.id from crm.life_events event
                where event.workspace_id = workspace.id and event.person_id = person.id
                union all
                select 'notes', note.id from crm.notes note
                where note.workspace_id = workspace.id and note.person_id = person.id
                union all
                select 'pets', pet.id from crm.pets pet
                where pet.person_id = person.id and person.workspace_id = workspace.id
                union all
                select 'relationships', edge.id from crm.relationships edge
                where edge.workspace_id = workspace.id
                  and person.id in (edge.from_person_id, edge.to_person_id)
                union all
                select 'tasks', task.id from crm.tasks task
                where task.workspace_id = workspace.id and task.person_id = person.id
                  and task.deleted_at is null
                union all
                select 'tags', person_tag.tag_id
                from crm.person_tags person_tag
                join crm.tags tag on tag.id = person_tag.tag_id
                  and tag.workspace_id = workspace.id
                where person_tag.person_id = person.id
                union all
                select 'work', occupation.id
                from crm.person_occupations occupation
                where occupation.person_id = person.id
                  and person.workspace_id = workspace.id
              ) record
              group by record.section_id
            ) counted
          ) as section_counts
      ) profile_summary on true`
      : sql``;
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
        ${summaryColumns}
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
      ${summaryJoin}
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
      ...(command.includeSummary
        ? {
          summary: {
            primaryContactMethods: row.primary_contact_methods ?? [],
            relationshipCounts: row.relationship_counts ?? [],
            sectionCounts: row.section_counts ?? [],
          },
        }
        : {}),
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

  async listTimeline(
    command: Parameters<PersonProfileRepository["listTimeline"]>[0],
  ): Promise<Awaited<ReturnType<PersonProfileRepository["listTimeline"]>>> {
    const context = await sql<PersonTimelineContextRow>`
      select person.id::text, person.archived_at
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      left join crm.people person
        on person.id = ${command.personId}::uuid
        and person.workspace_id = workspace.id and person.deleted_at is null
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.status = 'active' and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active' and workspace.deleted_at is null
    `.execute(this.database);
    const resolved = context.rows[0];
    if (!resolved) return { status: "forbidden" };
    if (!resolved.id) return { status: "not-found" };

    if (command.after) {
      const anchor = await sql<{ readonly valid: boolean }>`
        select exists (
          select 1 from crm.activities activity
          join crm.activity_participants participant
            on participant.activity_id = activity.id
            and participant.person_id = ${command.personId}::uuid
          join crm.people participant_person
            on participant_person.id = participant.person_id
            and participant_person.workspace_id = activity.workspace_id
          left join crm.workspace_profile_modules profile_module
            on profile_module.workspace_id = activity.workspace_id
            and profile_module.key = 'activities'
          where activity.id = ${command.after.id}::uuid
            and activity.workspace_id = ${command.workspaceId}::uuid
            and coalesce(profile_module.is_active, true)
            and (${command.kind ?? null}::text is null or ${
        command.kind ?? null
      }::text = 'activity')
            and activity.happened_at = ${command.after.timestamp}::timestamptz
          union all
          select 1 from crm.notes note
          join crm.people note_person on note_person.id = note.person_id
            and note_person.workspace_id = note.workspace_id
          left join crm.workspace_profile_modules profile_module
            on profile_module.workspace_id = note.workspace_id
            and profile_module.key = 'notes'
          where note.id = ${command.after.id}::uuid
            and note.workspace_id = ${command.workspaceId}::uuid
            and note.person_id = ${command.personId}::uuid
            and coalesce(profile_module.is_active, true)
            and (${command.kind ?? null}::text is null or ${
        command.kind ?? null
      }::text = 'note')
            and note.created_at = ${command.after.timestamp}::timestamptz
          union all
          select 1 from crm.calls call
          join crm.people call_person on call_person.id = call.person_id
            and call_person.workspace_id = call.workspace_id
          left join crm.workspace_profile_modules profile_module
            on profile_module.workspace_id = call.workspace_id
            and profile_module.key = 'calls'
          where call.id = ${command.after.id}::uuid
            and call.workspace_id = ${command.workspaceId}::uuid
            and call.person_id = ${command.personId}::uuid
            and coalesce(profile_module.is_active, true)
            and (${command.kind ?? null}::text is null or ${
        command.kind ?? null
      }::text = 'call')
            and call.called_at = ${command.after.timestamp}::timestamptz
          union all
          select 1 from crm.conversation_threads thread
          join crm.people thread_person on thread_person.id = thread.person_id
            and thread_person.workspace_id = thread.workspace_id
          left join crm.workspace_profile_modules profile_module
            on profile_module.workspace_id = thread.workspace_id
            and profile_module.key = 'conversations'
          where thread.id = ${command.after.id}::uuid
            and thread.workspace_id = ${command.workspaceId}::uuid
            and thread.person_id = ${command.personId}::uuid
            and coalesce(profile_module.is_active, true)
            and (${command.kind ?? null}::text is null or ${
        command.kind ?? null
      }::text = 'conversation')
            and thread.happened_at = ${command.after.timestamp}::timestamptz
          union all
          select 1 from crm.life_events event
          join crm.people event_person on event_person.id = event.person_id
            and event_person.workspace_id = event.workspace_id
          left join crm.workspace_profile_modules profile_module
            on profile_module.workspace_id = event.workspace_id
            and profile_module.key = 'life-events'
          cross join lateral (
            select case
              when event.happened_at is not null then event.happened_at
              when event.year is not null then make_timestamptz(
                event.year::integer, coalesce(event.month, 1)::integer,
                coalesce(event.day, 1)::integer, 0, 0, 0, 'UTC'
              )
              else event.created_at
            end as occurred_at
          ) resolved_event
          where event.id = ${command.after.id}::uuid
            and event.workspace_id = ${command.workspaceId}::uuid
            and event.person_id = ${command.personId}::uuid
            and coalesce(profile_module.is_active, true)
            and (${command.kind ?? null}::text is null or ${
        command.kind ?? null
      }::text = 'life-event')
            and resolved_event.occurred_at = ${command.after.timestamp}::timestamptz
        ) as valid
      `.execute(this.database);
      if (!anchor.rows[0]?.valid) return { status: "stale-cursor" };
    }

    const result = await sql<PersonTimelineRow>`
      with projection as (
        select activity.id, 'activity'::text as kind,
          activity.happened_at as occurred_at, activity.summary as title,
          activity.description as excerpt, 'full'::text as date_precision
        from crm.activities activity
        join crm.activity_participants participant
          on participant.activity_id = activity.id
          and participant.person_id = ${command.personId}::uuid
        join crm.people participant_person
          on participant_person.id = participant.person_id
          and participant_person.workspace_id = activity.workspace_id
        left join crm.workspace_profile_modules profile_module
          on profile_module.workspace_id = activity.workspace_id
          and profile_module.key = 'activities'
        where activity.workspace_id = ${command.workspaceId}::uuid
          and coalesce(profile_module.is_active, true)
          and (${command.kind ?? null}::text is null or ${
      command.kind ?? null
    }::text = 'activity')
        union all
        select note.id, 'note'::text, note.created_at, null::text, note.body,
          'full'::text
        from crm.notes note
        join crm.people note_person on note_person.id = note.person_id
          and note_person.workspace_id = note.workspace_id
        left join crm.workspace_profile_modules profile_module
          on profile_module.workspace_id = note.workspace_id
          and profile_module.key = 'notes'
        where note.workspace_id = ${command.workspaceId}::uuid
          and note.person_id = ${command.personId}::uuid
          and coalesce(profile_module.is_active, true)
          and (${command.kind ?? null}::text is null or ${
      command.kind ?? null
    }::text = 'note')
        union all
        select call.id, 'call'::text, call.called_at, null::text, call.content,
          'full'::text
        from crm.calls call
        join crm.people call_person on call_person.id = call.person_id
          and call_person.workspace_id = call.workspace_id
        left join crm.workspace_profile_modules profile_module
          on profile_module.workspace_id = call.workspace_id
          and profile_module.key = 'calls'
        where call.workspace_id = ${command.workspaceId}::uuid
          and call.person_id = ${command.personId}::uuid
          and coalesce(profile_module.is_active, true)
          and (${command.kind ?? null}::text is null or ${
      command.kind ?? null
    }::text = 'call')
        union all
        select thread.id, 'conversation'::text, thread.happened_at,
          thread.title, null::text, 'full'::text
        from crm.conversation_threads thread
        join crm.people thread_person on thread_person.id = thread.person_id
          and thread_person.workspace_id = thread.workspace_id
        left join crm.workspace_profile_modules profile_module
          on profile_module.workspace_id = thread.workspace_id
          and profile_module.key = 'conversations'
        where thread.workspace_id = ${command.workspaceId}::uuid
          and thread.person_id = ${command.personId}::uuid
          and coalesce(profile_module.is_active, true)
          and (${command.kind ?? null}::text is null or ${
      command.kind ?? null
    }::text = 'conversation')
        union all
        select event.id, 'life-event'::text, resolved_event.occurred_at,
          coalesce(event.name, event_type.name), event.note,
          resolved_event.date_precision
        from crm.life_events event
        join crm.people event_person on event_person.id = event.person_id
          and event_person.workspace_id = event.workspace_id
        left join crm.life_event_types event_type
          on event_type.id = event.life_event_type_id
          and event_type.workspace_id = event.workspace_id
        left join crm.workspace_profile_modules profile_module
          on profile_module.workspace_id = event.workspace_id
          and profile_module.key = 'life-events'
        cross join lateral (
          select case
            when event.happened_at is not null then event.happened_at
            when event.year is not null then make_timestamptz(
              event.year::integer, coalesce(event.month, 1)::integer,
              coalesce(event.day, 1)::integer, 0, 0, 0, 'UTC'
            )
            else event.created_at
          end as occurred_at,
          case when event.happened_at is null and event.year is null
            then 'unknown'::text else event.precision end as date_precision
        ) resolved_event
        where event.workspace_id = ${command.workspaceId}::uuid
          and event.person_id = ${command.personId}::uuid
          and coalesce(profile_module.is_active, true)
          and (${command.kind ?? null}::text is null or ${
      command.kind ?? null
    }::text = 'life-event')
      ), page as (
        select * from projection
        ${
      command.after
        ? sql`where (occurred_at, id) < (${command.after.timestamp}::timestamptz, ${command.after.id}::uuid)`
        : sql``
    }
        order by occurred_at desc, id desc
        limit ${command.limit + 1}
      )
      select page.id::text, page.kind, page.title, page.excerpt,
        page.date_precision,
        to_char(page.occurred_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as occurred_at
      from page
      order by page.occurred_at desc, page.id desc
    `.execute(this.database);
    const visible = result.rows.slice(0, command.limit);
    const final = visible.at(-1);
    return {
      items: visible.map(timelineItem),
      ...(result.rows.length > command.limit && final
        ? { next: { id: final.id, timestamp: final.occurred_at } }
        : {}),
      status: resolved.archived_at ? "archived" : "ready",
    };
  }
}
