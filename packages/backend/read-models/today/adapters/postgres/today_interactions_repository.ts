import { readWithinWorkspace } from "../../../../platform/postgres/transactions.ts";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { personDisplayNameSql } from "../../../../platform/postgres/person_display.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import { UNNAMED_PERSON } from "../../../../modules/people/public.ts";
import type { ActivityReportItem } from "../../../activity-report/public.ts";
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
  readonly updated_at: string;
}

function item(row: TodayRow): ActivityReportItem | undefined {
  if (row.kind === "activity" && row.summary) {
    return {
      ...pickDefined({ activityType: row.activity_type }),
      emotions: [],
      happenedAt: row.happened_at,
      id: row.id,
      kind: "activity",
      participants: row.participants,
      summary: row.summary,
      updatedAt: row.updated_at,
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
      updatedAt: row.updated_at,
    }
    : undefined;
}

export class PostgresTodayInteractionsRepository
  implements TodayInteractionsRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async getRecentActivity(
    command: Parameters<TodayInteractionsRepository["getRecentActivity"]>[0],
  ): Promise<
    Awaited<ReturnType<TodayInteractionsRepository["getRecentActivity"]>>
  > {
    return await readWithinWorkspace(
      this.database,
      command.workspaceId,
      async (database) => {
        // Each kind takes its own most recent page first, on the real
        // `timestamptz` the activities index is ordered by, so the history behind
        // the page is never read; only those survivors gather participants and
        // names, and the final sort sees at most two pages.
        const rows = await sql<TodayRow>`
      with recent_activity as (
        select activity.id, activity.activity_type_id, activity.summary,
          activity.happened_at, activity.updated_at
        from crm.activities activity
        where activity.workspace_id = ${command.workspaceId}::uuid
        order by activity.happened_at desc, activity.id desc
        limit ${command.recentLimit}
      ), recent_note as (
        select note.id, note.person_id, note.body, note.is_favorited,
          note.created_at, note.updated_at
        from crm.notes note
        where note.workspace_id = ${command.workspaceId}::uuid
          and exists (select 1 from crm.people person
            where person.id = note.person_id
              and person.workspace_id = note.workspace_id
              and person.deleted_at is null)
        order by note.created_at desc, note.id desc
        limit ${command.recentLimit}
      ), projection as (
        select activity.id, 'activity'::text as kind, activity.summary,
          coalesce(
            nullif(activity_type.name, ''), activity_type.translation_key
          ) as activity_type,
          null::text as body, null::boolean as is_favorited,
          activity.happened_at, activity.updated_at,
          coalesce(participants.value, '[]'::jsonb) as participants
        from recent_activity activity
        left join crm.activity_types activity_type
          on activity_type.id = activity.activity_type_id
          and activity_type.workspace_id = ${command.workspaceId}::uuid
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'id', person.id::text,
            'name', ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))}
          ) order by lower(coalesce(person.given_name, person.nickname, '')), person.id) as value
          from crm.activity_participants link
          join crm.people person on person.id = link.person_id
            and person.workspace_id = ${command.workspaceId}::uuid
            and person.deleted_at is null
          where link.activity_id = activity.id
        ) participants on true
        union all
        select note.id, 'note'::text, null::text, null::text, note.body,
          note.is_favorited, note.created_at, note.updated_at,
          jsonb_build_array(jsonb_build_object(
            'id', person.id::text,
            'name', ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))}
          ))
        from recent_note note
        join crm.people person on person.id = note.person_id
          and person.workspace_id = ${command.workspaceId}::uuid
      )
      select id::text, kind, summary, activity_type, body, is_favorited,
        participants,
        ${instantColumn("projection.happened_at")} as happened_at,
        ${instantColumn("projection.updated_at")} as updated_at
      from projection
      order by projection.happened_at desc, projection.id desc
      limit ${command.recentLimit}
    `.execute(database);
        return {
          items: rows.rows.flatMap((row) => {
            const mapped = item(row);
            return mapped ? [mapped] : [];
          }),
          status: "ready",
        };
      },
    );
  }

  async getFavoriteNotes(
    command: Parameters<TodayInteractionsRepository["getFavoriteNotes"]>[0],
  ): Promise<
    Awaited<ReturnType<TodayInteractionsRepository["getFavoriteNotes"]>>
  > {
    return await readWithinWorkspace(
      this.database,
      command.workspaceId,
      async (database) => {
        const favoriteRows = await sql<TodayRow>`
      select note.id::text, 'note'::text as kind, null::text as summary,
        null::text as activity_type, note.body, note.is_favorited,
        jsonb_build_array(jsonb_build_object(
          'id', person.id::text,
          'name', ${sql.raw(personDisplayNameSql(UNNAMED_PERSON, "person"))}
        )) as participants,
        ${instantColumn("note.created_at")} as happened_at,
        ${instantColumn("note.updated_at")} as updated_at
      from crm.notes note
      join crm.people person on person.id = note.person_id
        and person.workspace_id = note.workspace_id
        and person.deleted_at is null
      where note.workspace_id = ${command.workspaceId}::uuid
        and note.is_favorited = true
      order by note.created_at desc, note.id desc
      limit ${command.favoriteLimit}
    `.execute(database);
        return {
          items: favoriteRows.rows.flatMap((row) => {
            const mapped = item(row);
            return mapped?.kind === "note" ? [mapped] : [];
          }),
          status: "ready",
        };
      },
    );
  }
}
