import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import type {
  ActivityReportActor,
  ActivityReportItem,
} from "../../../activity-report/public.ts";
import type { TodayInteractionsRepository } from "../../application/get_today_interactions.ts";

interface TodayRow {
  readonly activity_type: string | null;
  readonly body: string | null;
  readonly happened_at: string;
  readonly id: string;
  readonly is_favorited: boolean | null;
  readonly kind: "activity" | "note";
  readonly participants: readonly {
    readonly id: string;
    readonly name: string;
  }[];
  readonly summary: string | null;
}

function item(row: TodayRow): ActivityReportItem | undefined {
  if (row.kind === "activity" && row.summary) {
    return {
      ...(row.activity_type ? { activityType: row.activity_type } : {}),
      emotions: [],
      happenedAt: row.happened_at,
      id: row.id,
      kind: "activity",
      participants: row.participants,
      summary: row.summary,
    };
  }
  const participant = row.participants[0];
  return row.kind === "note" && row.body && participant
    ? {
      body: row.body,
      createdAt: row.happened_at,
      id: row.id,
      isFavorited: row.is_favorited === true,
      kind: "note",
      participants: [participant],
    }
    : undefined;
}

export class PostgresTodayInteractionsRepository
  implements TodayInteractionsRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  private async authorized(command: ActivityReportActor): Promise<boolean> {
    const authorized = await sql<{ readonly valid: boolean }>`
      select true as valid from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where account.id = ${command.userId}::uuid
        and account.status = 'active' and account.deleted_at is null
        and member.id = ${command.memberId}::uuid
        and member.workspace_id = ${command.workspaceId}::uuid
        and member.role = ${command.role}
        and member.status = 'active' and member.left_at is null
        and workspace.id = ${command.workspaceId}::uuid
        and workspace.status = 'active' and workspace.deleted_at is null
    `.execute(this.database);
    return authorized.rows[0]?.valid === true;
  }

  async getRecentActivity(
    command: Parameters<TodayInteractionsRepository["getRecentActivity"]>[0],
  ): Promise<
    Awaited<ReturnType<TodayInteractionsRepository["getRecentActivity"]>>
  > {
    if (!await this.authorized(command)) return { status: "forbidden" };
    const rows = await sql<TodayRow>`
      with projection as (
        select activity.id, 'activity'::text as kind, activity.summary,
          coalesce(
            nullif(activity_type.name, ''), activity_type.translation_key
          ) as activity_type,
          null::text as body, null::boolean as is_favorited,
          activity.happened_at,
          coalesce(participants.value, '[]'::jsonb) as participants
        from crm.activities activity
        left join crm.activity_types activity_type
          on activity_type.id = activity.activity_type_id
          and activity_type.workspace_id = activity.workspace_id
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'id', person.id::text,
            'name', coalesce(
              nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''),
              nullif(person.nickname, ''), 'Unnamed person'
            )
          ) order by lower(coalesce(person.given_name, person.nickname, '')), person.id) as value
          from crm.activity_participants link
          join crm.people person on person.id = link.person_id
            and person.workspace_id = activity.workspace_id
            and person.deleted_at is null
          where link.activity_id = activity.id
        ) participants on true
        where activity.workspace_id = ${command.workspaceId}::uuid
        union all
        select note.id, 'note'::text, null::text, null::text, note.body,
          note.is_favorited, note.created_at,
          jsonb_build_array(jsonb_build_object(
            'id', person.id::text,
            'name', coalesce(
              nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''),
              nullif(person.nickname, ''), 'Unnamed person'
            )
          ))
        from crm.notes note
        join crm.people person on person.id = note.person_id
          and person.workspace_id = note.workspace_id and person.deleted_at is null
        where note.workspace_id = ${command.workspaceId}::uuid
      )
      select id::text, kind, summary, activity_type, body, is_favorited,
        participants,
        to_char(happened_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as happened_at
      from projection order by happened_at desc, id desc
      limit ${command.recentLimit}
    `.execute(this.database);
    return {
      items: rows.rows.flatMap((row) => {
        const mapped = item(row);
        return mapped ? [mapped] : [];
      }),
      status: "ready",
    };
  }

  async getFavoriteNotes(
    command: Parameters<TodayInteractionsRepository["getFavoriteNotes"]>[0],
  ): Promise<
    Awaited<ReturnType<TodayInteractionsRepository["getFavoriteNotes"]>>
  > {
    if (!await this.authorized(command)) return { status: "forbidden" };
    const favoriteRows = await sql<TodayRow>`
      select note.id::text, 'note'::text as kind, null::text as summary,
        null::text as activity_type, note.body, note.is_favorited,
        jsonb_build_array(jsonb_build_object(
          'id', person.id::text,
          'name', coalesce(
            nullif(trim(concat_ws(' ', nullif(person.given_name, ''), person.family_name)), ''),
            nullif(person.nickname, ''), 'Unnamed person'
          )
        )) as participants,
        to_char(note.created_at at time zone 'UTC',
          'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as happened_at
      from crm.notes note
      join crm.people person on person.id = note.person_id
        and person.workspace_id = note.workspace_id
        and person.deleted_at is null
      where note.workspace_id = ${command.workspaceId}::uuid
        and note.is_favorited = true
      order by note.created_at desc, note.id desc
      limit ${command.favoriteLimit}
    `.execute(this.database);
    return {
      items: favoriteRows.rows.flatMap((row) => {
        const mapped = item(row);
        return mapped?.kind === "note" ? [mapped] : [];
      }),
      status: "ready",
    };
  }
}
