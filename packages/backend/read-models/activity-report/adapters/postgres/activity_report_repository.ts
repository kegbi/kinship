import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import type {
  ActivityReportItem,
  ActivityReportRepository,
} from "../../application/list_activity_report.ts";

interface ContextRow {
  readonly archived_at: Date | null;
  readonly id: string | null;
  readonly name: string | null;
}

interface ProjectionRow {
  readonly activity_type: string | null;
  readonly body: string | null;
  readonly description: string | null;
  readonly emotions: readonly { readonly id: string; readonly name: string }[];
  readonly timestamp_at: string;
  readonly id: string;
  readonly is_favorited: boolean | null;
  readonly kind: "activity" | "note";
  readonly participants: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly summary: string | null;
}

function item(row: ProjectionRow): ActivityReportItem | undefined {
  if (row.kind === "activity" && row.summary !== null) {
    return {
      ...(row.activity_type ? { activityType: row.activity_type } : {}),
      ...(row.description ? { description: row.description } : {}),
      emotions: row.emotions,
      happenedAt: row.timestamp_at,
      id: row.id,
      kind: "activity",
      participants: row.participants,
      summary: row.summary,
    };
  }
  const participant = row.participants[0];
  return row.kind === "note" && row.body !== null && participant
    ? {
      body: row.body,
      createdAt: row.timestamp_at,
      id: row.id,
      isFavorited: row.is_favorited === true,
      kind: "note",
      participants: [participant],
    }
    : undefined;
}

export class PostgresActivityReportRepository
  implements ActivityReportRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async list(
    command: Parameters<ActivityReportRepository["list"]>[0],
  ): Promise<Awaited<ReturnType<ActivityReportRepository["list"]>>> {
    const context = await sql<ContextRow>`
      select person.id::text,
        coalesce(
          nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''),
          nullif(person.nickname, ''), 'Unnamed person'
        ) as name,
        person.archived_at
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
    if (!resolved.id || !resolved.name) return { status: "not-found" };
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
          where activity.id = ${command.after.id}::uuid
            and activity.workspace_id = ${command.workspaceId}::uuid
            and (${command.kind ?? null}::text is null or ${
        command.kind ?? null
      }::text = 'activity')
            and activity.happened_at = ${command.after.timestamp}::timestamptz
            and (${
        command.year ?? null
      }::integer is null or extract(year from activity.happened_at at time zone 'UTC') = ${
        command.year ?? null
      })
          union all
          select 1 from crm.notes note
          join crm.people note_person on note_person.id = note.person_id
            and note_person.workspace_id = note.workspace_id
          where note.id = ${command.after.id}::uuid
            and note.workspace_id = ${command.workspaceId}::uuid
            and (${command.kind ?? null}::text is null or ${
        command.kind ?? null
      }::text = 'note')
            and note.person_id = ${command.personId}::uuid
            and note.created_at = ${command.after.timestamp}::timestamptz
            and (${
        command.year ?? null
      }::integer is null or extract(year from note.created_at at time zone 'UTC') = ${
        command.year ?? null
      })
        ) as valid
      `.execute(this.database);
      if (!anchor.rows[0]?.valid) return { status: "stale-cursor" };
    }
    const result = await sql<ProjectionRow>`
      with projection as (
        select activity.id, 'activity'::text as kind, activity.summary,
          activity.description, null::text as body,
          null::boolean as is_favorited, activity.happened_at as timestamp_at,
          activity.activity_type_id, activity.workspace_id
        from crm.activities activity
        join crm.activity_participants subject
          on subject.activity_id = activity.id
          and subject.person_id = ${command.personId}::uuid
        join crm.people subject_person on subject_person.id = subject.person_id
          and subject_person.workspace_id = activity.workspace_id
        where activity.workspace_id = ${command.workspaceId}::uuid
          and (${command.kind ?? null}::text is null or ${
      command.kind ?? null
    }::text = 'activity')
        union all
        select note.id, 'note'::text, null::text, null::text, note.body,
          note.is_favorited, note.created_at, null::uuid, note.workspace_id
        from crm.notes note
        join crm.people note_person on note_person.id = note.person_id
          and note_person.workspace_id = note.workspace_id
        where note.workspace_id = ${command.workspaceId}::uuid
          and (${command.kind ?? null}::text is null or ${
      command.kind ?? null
    }::text = 'note')
          and note.person_id = ${command.personId}::uuid
      ), page as (
        select * from projection
        where (${command.year ?? null}::integer is null
          or extract(year from timestamp_at at time zone 'UTC') = ${
      command.year ?? null
    })
          ${
      command.after
        ? sql`and (timestamp_at, id) < (${command.after.timestamp}::timestamptz, ${command.after.id}::uuid)`
        : sql``
    }
        order by timestamp_at desc, id desc
        limit ${command.limit + 1}
      )
      select page.id::text, page.kind, page.summary, page.description,
        page.body, page.is_favorited,
        coalesce(nullif(activity_type.name, ''), activity_type.translation_key) as activity_type,
        coalesce(participants.value, '[]'::jsonb) as participants,
        coalesce(emotions.value, '[]'::jsonb) as emotions,
        to_char(page.timestamp_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as timestamp_at
      from page
      left join crm.activity_types activity_type
        on activity_type.id = page.activity_type_id
        and activity_type.workspace_id = page.workspace_id
      left join lateral (
        select jsonb_agg(jsonb_build_object('id', selected.id::text,
          'name', selected.name) order by lower(selected.name), selected.id) as value
        from (
          select person.id, coalesce(
            nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''),
            nullif(person.nickname, ''), 'Unnamed person') as name
          from crm.activity_participants link
          join crm.people person on person.id = link.person_id
            and person.workspace_id = page.workspace_id
            and person.deleted_at is null
          where page.kind = 'activity' and link.activity_id = page.id
          union all
          select person.id, coalesce(
            nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''),
            nullif(person.nickname, ''), 'Unnamed person')
          from crm.notes note
          join crm.people person on person.id = note.person_id
            and person.workspace_id = note.workspace_id
            and person.workspace_id = page.workspace_id
            and person.deleted_at is null
          where page.kind = 'note' and note.id = page.id
            and note.workspace_id = page.workspace_id
        ) selected
      ) participants on true
      left join lateral (
        select jsonb_agg(jsonb_build_object('id', emotion.id::text,
          'name', emotion.name) order by emotion.sort_order, lower(emotion.name), emotion.id) as value
        from crm.activity_emotions link
        join crm.emotion_options emotion on emotion.id = link.emotion_id
        where page.kind = 'activity' and link.activity_id = page.id
      ) emotions on true
      order by page.timestamp_at desc, page.id desc
    `.execute(this.database);
    const visible = result.rows.slice(0, command.limit);
    const final = visible.at(-1);
    return {
      items: visible.flatMap((row) => {
        const mapped = item(row);
        return mapped ? [mapped] : [];
      }),
      ...(result.rows.length > command.limit && final
        ? { next: { id: final.id, timestamp: final.timestamp_at } }
        : {}),
      person: { id: resolved.id, name: resolved.name },
      status: resolved.archived_at ? "archived" : "ready",
    };
  }
}
