import { type Kysely, sql } from "kysely";
import type { ApplicationDatabase } from "../../../../platform/postgres/database.ts";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type {
  JournalTimelineItem,
  JournalTimelineRepository,
} from "../../application/list_journal_timeline.ts";

interface Row {
  activity_id: string | null;
  activity_summary: string | null;
  body: string | null;
  comment: string | null;
  day_rating_id: string | null;
  id: string;
  journal_post_id: string | null;
  occurred_at: string;
  rated_on: string | null;
  rating: number | null;
  title: string | null;
  updated_at: string | null;
}

interface ActivityRow {
  happened_at: string;
  id: string;
  summary: string;
}

export class PostgresJournalTimelineRepository
  implements JournalTimelineRepository {
  constructor(private readonly database: Kysely<ApplicationDatabase>) {}

  async read(
    actor: Parameters<JournalTimelineRepository["read"]>[0],
    itemId?: string,
  ): Promise<Awaited<ReturnType<JournalTimelineRepository["read"]>>> {
    const result = await sql<Row>`
      select item.id::text,
        ${instantColumn("item.occurred_at")} as occurred_at,
        item.activity_id::text, activity.summary as activity_summary,
        item.journal_post_id::text, post.title, post.body,
        ${instantColumn("post.updated_at")} as updated_at,
        item.day_rating_id::text, rating.rated_on::text, rating.rating, rating.comment
      from crm.journal_items item
      left join crm.activities activity on activity.id = item.activity_id and activity.workspace_id = item.workspace_id
      left join crm.journal_posts post on post.id = item.journal_post_id and post.workspace_id = item.workspace_id
      left join crm.journal_day_ratings rating on rating.id = item.day_rating_id and rating.workspace_id = item.workspace_id
      where item.workspace_id = ${actor.workspaceId}::uuid
        and (${itemId ?? null}::uuid is null or item.id = ${
      itemId ?? null
    }::uuid)
      order by item.occurred_at desc, item.created_at desc, item.id desc
      limit ${itemId ? 1 : 200}
    `.execute(this.database);
    if (itemId && !result.rows[0]) return { status: "not-found" };
    const activities = itemId ? [] : (await sql<ActivityRow>`
        select activity.id::text, activity.summary,
          ${instantColumn("activity.happened_at")} as happened_at
        from crm.activities activity
        where activity.workspace_id = ${actor.workspaceId}::uuid
          and not exists (
            select 1 from crm.journal_items item
            where item.workspace_id = activity.workspace_id
              and item.activity_id = activity.id
          )
        order by activity.happened_at desc, activity.id desc
        limit 50
      `.execute(this.database)).rows.map((row) => ({
      happenedAt: row.happened_at,
      id: row.id,
      summary: row.summary,
    }));
    return {
      activities,
      items: result.rows.map((row): JournalTimelineItem => {
        if (row.journal_post_id && row.body && row.updated_at) {
          return {
            id: row.id,
            occurredAt: row.occurred_at,
            post: {
              body: row.body,
              id: row.journal_post_id,
              ...pickDefined({ title: row.title }),
              updatedAt: row.updated_at,
            },
            type: "post",
          };
        }
        if (row.day_rating_id && row.rated_on && row.rating !== null) {
          return {
            dayRating: {
              ...pickDefined({ comment: row.comment }),
              id: row.day_rating_id,
              ratedOn: row.rated_on,
              rating: row.rating,
            },
            id: row.id,
            occurredAt: row.occurred_at,
            type: "day-rating",
          };
        }
        return {
          activity: {
            id: row.activity_id!,
            summary: row.activity_summary ?? "Activity unavailable",
          },
          id: row.id,
          occurredAt: row.occurred_at,
          type: "activity",
        };
      }),
      status: "ready",
    };
  }
}
