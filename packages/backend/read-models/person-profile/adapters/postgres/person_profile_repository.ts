import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import {
  instantColumn,
  millisecondInstantColumn,
} from "../../../../platform/postgres/timestamps.ts";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import {
  PERSON_PROFILE_TAG_PREVIEW_LIMIT,
  type PersonGenderOption,
  type PersonLifeEvent,
  type PersonLifeEventPrecision,
  type PersonLifeEventType,
  type PersonPrimaryContactMethod,
  type PersonProfileIdentity,
  type PersonProfileRepository,
  type PersonProfileSection,
  type PersonProfileSectionRecordCount,
  type PersonProfileTag,
  type PersonRelationshipCount,
} from "../../application/get_person_profile.ts";
import type {
  PersonTimelineItem,
  PersonTimelineMessage,
} from "../../application/list_person_timeline.ts";
import type {
  InteractionOption,
  InteractionParticipant,
} from "../../../../modules/interactions/public.ts";

interface PersonProfileRow {
  readonly archived_at: Date | null;
  readonly avatar_background_color: string | null;
  readonly avatar_file_id: string | null;
  readonly description: string | null;
  readonly family_name: string | null;
  readonly gender: string | null;
  readonly gender_option_id: string | null;
  readonly gender_options: readonly PersonGenderOption[];
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
  readonly types: readonly PersonLifeEventType[];
}

interface PersonTimelineContextRow {
  readonly archived_at: Date | null;
  readonly id: string | null;
}

interface PersonTimelineRow {
  readonly calendar_date:
    | NonNullable<PersonTimelineItem["calendarDate"]>
    | null;
  readonly activity_type: string | null;
  readonly channel_type: string | null;
  readonly contact_method: string | null;
  readonly contact_was_caller: boolean | null;
  readonly date_precision: PersonLifeEventPrecision;
  readonly emotions: readonly InteractionOption[] | null;
  readonly excerpt: string | null;
  readonly id: string;
  readonly kind: PersonTimelineItem["kind"];
  readonly messages: readonly PersonTimelineMessage[] | null;
  readonly occurred_at: string;
  readonly participants: readonly InteractionParticipant[] | null;
  readonly title: string | null;
}

function timelineItem(row: PersonTimelineRow): PersonTimelineItem {
  return {
    ...(row.activity_type !== null ? { activityType: row.activity_type } : {}),
    ...(row.channel_type !== null ? { channelType: row.channel_type } : {}),
    ...(row.contact_method !== null
      ? { contactMethod: row.contact_method }
      : {}),
    ...(row.contact_was_caller !== null
      ? { contactWasCaller: row.contact_was_caller }
      : {}),
    ...(row.calendar_date !== null ? { calendarDate: row.calendar_date } : {}),
    datePrecision: row.date_precision,
    ...(row.emotions !== null ? { emotions: row.emotions } : {}),
    ...(row.excerpt !== null ? { excerpt: row.excerpt } : {}),
    id: row.id,
    kind: row.kind,
    ...(row.messages !== null ? { messages: row.messages } : {}),
    occurredAt: row.occurred_at,
    ...(row.participants !== null ? { participants: row.participants } : {}),
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
    avatar: pickDefined({
      backgroundColor: row.avatar_background_color,
      fileId: row.avatar_file_id,
    }),
    ...pickDefined({
      description: row.description,
      familyName: row.family_name,
      gender: row.gender,
      genderOptionId: row.gender_option_id,
    }),
    givenName: row.given_name,
    id: row.id,
    isDeceased: row.is_deceased,
    isPartial: row.is_partial,
    isSelf: row.is_self,
    isStarred: row.is_starred,
    ...pickDefined({
      lastContactAt: row.last_contact_at,
      middleName: row.middle_name,
      nickname: row.nickname,
    }),
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
        gender.name as gender, gender.id::text as gender_option_id,
        coalesce(gender_choices.options, '[]'::jsonb) as gender_options,
        person.is_partial, person.is_starred,
        person.is_deceased, person.archived_at,
        avatar.background_color as avatar_background_color,
        case when avatar.source = 'file' then avatar_file.id::text end
          as avatar_file_id,
        ${instantColumn("person.updated_at")} as updated_at,
        coalesce((select self.self_person_id from crm.workspace_members self
          where self.id = ${command.memberId}::uuid) = person.id,
          false) as is_self,
        coalesce(tag_summary.tag_count, 0)::int as tag_count,
        coalesce(tag_preview.tags, '[]'::jsonb) as tags
        , coalesce(profile_sections.sections, '[]'::jsonb) as profile_sections,
        last_contact.last_contact_at,
        coalesce(due.open_task_count, 0)::int as open_task_count,
        due.next_reminder_at, due.stay_in_touch_at
        ${summaryColumns}
      from (select ${command.workspaceId}::uuid as id) workspace
      left join crm.people person
        on person.id = ${command.personId}::uuid
        and person.workspace_id = workspace.id
        and person.deleted_at is null
      left join crm.gender_options gender
        on gender.id = person.gender_option_id
        and gender.workspace_id = workspace.id
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'archived', choice.is_archived, 'id', choice.id::text,
          'name', choice.name
        ) order by choice.is_archived, choice.sort_order, lower(choice.name),
          choice.id) as options
        from (
          (select current_option.* from crm.gender_options current_option
            where current_option.workspace_id = workspace.id
              and not current_option.is_archived
            order by current_option.sort_order, lower(current_option.name),
              current_option.id
            limit 100)
          union
          -- The person's own option is always offered, archived or past
          -- the cap, so the editor never falls back to "Not set" (GAP-047).
          select own.* from crm.gender_options own
          where own.id = gender.id
        ) choice
      ) gender_choices on person.id is not null
      left join crm.person_avatars avatar on avatar.person_id = person.id
      left join crm.files avatar_file on avatar_file.id = avatar.file_id
        and avatar_file.workspace_id = workspace.id
        and avatar_file.status = 'available'
        and avatar_file.deleted_at is null
      left join lateral (
        select ${
      millisecondInstantColumn("max(contacted_at)")
    } as last_contact_at
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
          (select ${instantColumn("occurrence.deliver_at")}
            from crm.reminder_occurrences occurrence
            join crm.reminders reminder on reminder.id = occurrence.reminder_id
              and reminder.workspace_id = workspace.id
            where reminder.person_id = person.id and reminder.is_active
              and reminder.deleted_at is null
              and occurrence.member_id = ${command.memberId}::uuid
              and occurrence.status in ('pending', 'retry')
            order by occurrence.deliver_at, occurrence.id limit 1
          ) as next_reminder_at,
          (select ${instantColumn("cadence.next_due_at")}
            from crm.stay_in_touch_cadences cadence
            where cadence.person_id = person.id and cadence.is_active
            order by cadence.next_due_at nulls last, cadence.id limit 1
          ) as stay_in_touch_at
      ) due on true
      ${summaryJoin}
    `.execute(this.database);
    const row = result.rows[0]!;
    const person = identity(row);
    if (!person) return { status: "not-found" };
    return {
      dueInformation: {
        ...pickDefined({ nextReminderAt: row.next_reminder_at }),
        openTaskCount: row.open_task_count,
        ...pickDefined({ stayInTouchAt: row.stay_in_touch_at }),
      },
      genderOptions: row.gender_options,
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
        coalesce(history.events, '[]'::jsonb) as events,
        coalesce(vocabulary.types, '[]'::jsonb) as types
      from (select ${command.workspaceId}::uuid as id) workspace
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
          'typeId', event.life_event_type_id::text,
          'typeName', event_type.name,
          'updatedAt', ${instantColumn("event.updated_at")},
          'date', jsonb_strip_nulls(jsonb_build_object(
            'precision', event.precision,
            'year', event.year,
            'month', event.month,
            'day', event.day,
            'happenedAt', case when event.happened_at is not null then
              ${instantColumn("event.happened_at")} end
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
      left join lateral (
        select jsonb_agg(jsonb_build_object(
          'id', choice.id::text, 'name', choice.name
        ) order by choice.sort_order, choice.name, choice.id) as types
        from (
          select candidate.id, candidate.sort_order,
            coalesce(nullif(candidate.name, ''), 'Life event') as name
          from crm.life_event_types candidate
          where candidate.workspace_id = workspace.id and not candidate.is_archived
            and person.id is not null
            and coalesce(profile_module.is_active, true)
          order by candidate.sort_order, name, candidate.id
          -- The contract bounds the vocabulary at 100 choices. An event whose
          -- type sorts past them is still named by typeName, and its editor
          -- offers that type as "(archived)"; the journal use case accepts it
          -- because the event already carries it.
          limit 100
        ) choice
      ) vocabulary on true
    `.execute(this.database);
    const row = result.rows[0]!;
    if (!row.person_id) return { status: "not-found" };
    if (!row.module_is_active) {
      return { events: [], status: "hidden", types: [] };
    }
    return { events: row.events, status: "ready", types: row.types };
  }

  async listTimeline(
    command: Parameters<PersonProfileRepository["listTimeline"]>[0],
  ): Promise<Awaited<ReturnType<PersonProfileRepository["listTimeline"]>>> {
    const context = await sql<PersonTimelineContextRow>`
      select person.id::text, person.archived_at
      from crm.people person
      where person.id = ${command.personId}::uuid
        and person.workspace_id = ${command.workspaceId}::uuid
        and person.deleted_at is null
    `.execute(this.database);
    const resolved = context.rows[0];
    if (!resolved) return { status: "not-found" };

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
            and event.month is null and event.day is null
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
        page.date_precision, activity_detail.activity_type,
        case when calendar_event.id is not null and calendar_event.happened_at is null
          then jsonb_strip_nulls(jsonb_build_object(
            'year', calendar_event.year, 'month', calendar_event.month, 'day', calendar_event.day))
          else null end as calendar_date,
        activity_participants.value as participants,
        coalesce(activity_emotions.value, call_emotions.value) as emotions,
        call_detail.contact_was_caller,
        conversation_detail.channel_type, conversation_detail.contact_method,
        conversation_messages.value as messages,
        ${instantColumn("page.occurred_at")} as occurred_at
      from page
      left join crm.life_events calendar_event on page.kind = 'life-event'
        and calendar_event.id = page.id and calendar_event.person_id = ${command.personId}::uuid
        and calendar_event.workspace_id = ${command.workspaceId}::uuid
      left join lateral (
        select coalesce(nullif(activity_type.name, ''),
          activity_type.translation_key) as activity_type
        from crm.activities activity
        left join crm.activity_types activity_type
          on activity_type.id = activity.activity_type_id
          and activity_type.workspace_id = ${command.workspaceId}::uuid
        where page.kind = 'activity' and activity.id = page.id
          and activity.workspace_id = ${command.workspaceId}::uuid
      ) activity_detail on true
      left join lateral (
        select jsonb_agg(jsonb_build_object('id', person.id::text,
          'name', ${
      sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))
    }) order by lower(${
      sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))
    }), person.id) as value
        from crm.activity_participants link
        join crm.activities activity on activity.id = link.activity_id
          and activity.workspace_id = ${command.workspaceId}::uuid
        join crm.people person on person.id = link.person_id
          and person.workspace_id = ${command.workspaceId}::uuid
          and person.deleted_at is null
        where page.kind = 'activity' and activity.id = page.id
      ) activity_participants on true
      left join lateral (
        select jsonb_agg(jsonb_build_object('id', emotion.id::text,
          'name', emotion.name) order by emotion.sort_order,
          lower(emotion.name), emotion.id) as value
        from crm.activity_emotions link
        join crm.activities activity on activity.id = link.activity_id
          and activity.workspace_id = ${command.workspaceId}::uuid
        join crm.emotion_options emotion on emotion.id = link.emotion_id
        where page.kind = 'activity' and activity.id = page.id
      ) activity_emotions on true
      left join lateral (
        select call.contact_was_caller
        from crm.calls call
        where page.kind = 'call' and call.id = page.id
          and call.workspace_id = ${command.workspaceId}::uuid
      ) call_detail on true
      left join lateral (
        select jsonb_agg(jsonb_build_object('id', emotion.id::text,
          'name', emotion.name) order by emotion.sort_order,
          lower(emotion.name), emotion.id) as value
        from crm.call_emotions link
        join crm.calls call on call.id = link.call_id
          and call.workspace_id = ${command.workspaceId}::uuid
        join crm.emotion_options emotion on emotion.id = link.emotion_id
        where page.kind = 'call' and call.id = page.id
      ) call_emotions on true
      left join lateral (
        select case when channel_type.id is not null
            then coalesce(nullif(channel_type.name, ''), 'Communication')
          end as channel_type,
          contact_method.value as contact_method
        from crm.conversation_threads thread
        join crm.people thread_person on thread_person.id = thread.person_id
          and thread_person.workspace_id = ${command.workspaceId}::uuid
          and thread_person.deleted_at is null
        left join crm.contact_method_types channel_type
          on channel_type.id = thread.channel_type_id
          and channel_type.workspace_id = ${command.workspaceId}::uuid
        left join crm.person_contact_methods contact_method
          on contact_method.id = thread.contact_method_id
          and contact_method.person_id = thread_person.id
        where page.kind = 'conversation' and thread.id = page.id
          and thread.workspace_id = ${command.workspaceId}::uuid
      ) conversation_detail on true
      left join lateral (
        select jsonb_agg(jsonb_build_object('content', message.content,
          'direction', message.direction,
          'writtenAt', ${instantColumn("message.written_at")})
          order by message.written_at, message.id) as value
        from crm.messages message
        join crm.conversation_threads thread
          on thread.id = message.conversation_id
          and thread.workspace_id = ${command.workspaceId}::uuid
        where page.kind = 'conversation' and thread.id = page.id
      ) conversation_messages on true
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
