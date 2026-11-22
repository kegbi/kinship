import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import { instantColumn } from "../../../../platform/postgres/timestamps.ts";
import type {
  StoredDayRating,
  StoredJournalPost,
} from "../../domain/journal_rules.ts";
import type { JournalRepository } from "../../ports/journal_repository.ts";

interface PostRow {
  body: string;
  created_at: string;
  id: string;
  occurred_at: string;
  title: string | null;
  updated_at: string;
}
interface RatingRow {
  comment: string | null;
  created_at: string;
  id: string;
  rated_on: string;
  rating: number;
  updated_at: string;
}

const postColumns = sql`post.id::text, post.title, post.body,
  ${instantColumn("post.occurred_at")} as occurred_at,
  ${instantColumn("post.created_at")} as created_at,
  ${instantColumn("post.updated_at")} as updated_at`;
const ratingColumns =
  sql`rating.id::text, rating.rated_on::text, rating.rating, rating.comment,
  ${instantColumn("rating.created_at")} as created_at,
  ${instantColumn("rating.updated_at")} as updated_at`;

function post(row: PostRow): StoredJournalPost {
  return {
    body: row.body,
    createdAt: row.created_at,
    id: row.id,
    occurredAt: row.occurred_at,
    ...pickDefined({ title: row.title }),
    updatedAt: row.updated_at,
  };
}
function rating(row: RatingRow): StoredDayRating {
  return {
    ...pickDefined({ comment: row.comment }),
    createdAt: row.created_at,
    id: row.id,
    ratedOn: row.rated_on,
    rating: row.rating,
    updatedAt: row.updated_at,
  };
}

export class PostgresJournalRepository implements JournalRepository {
  async createPost(
    command: Parameters<JournalRepository["createPost"]>[0],
  ): Promise<Awaited<ReturnType<JournalRepository["createPost"]>>> {
    const result = await sql<PostRow>`with inserted as (
      insert into crm.journal_posts (id, workspace_id, title, body, occurred_at, created_by_member_id, created_at, updated_at)
      values (${command.id}::uuid, ${command.workspaceId}::uuid, ${
      command.title ?? null
    }, ${command.body}, ${command.occurredAt}, ${command.memberId}::uuid, ${command.now}, ${command.now}) returning *
    ), indexed as (
      insert into crm.journal_items (id, workspace_id, occurred_at, journal_post_id, created_by_member_id, created_at, updated_at)
      select id, workspace_id, occurred_at, id, ${command.memberId}::uuid, ${command.now}, ${command.now} from inserted
    ) select ${postColumns} from inserted post
    `.execute(databaseFromSession(command.transaction));
    return { post: post(result.rows[0]!), status: "created" };
  }

  async deleteItem(
    command: Parameters<JournalRepository["deleteItem"]>[0],
  ): Promise<Awaited<ReturnType<JournalRepository["deleteItem"]>>> {
    const database = databaseFromSession(command.transaction);
    const found = await sql<
      {
        activity_id: string | null;
        day_rating_id: string | null;
        journal_post_id: string | null;
      }
    >`
      select activity_id::text, day_rating_id::text, journal_post_id::text from crm.journal_items
      where id = ${command.itemId}::uuid and workspace_id = ${command.workspaceId}::uuid for update
    `.execute(database);
    const item = found.rows[0];
    if (!item) return { status: "not-found" };
    const itemType = item.journal_post_id
      ? "post" as const
      : item.day_rating_id
      ? "day-rating" as const
      : "activity" as const;
    if (item.journal_post_id) {
      await sql`delete from crm.journal_posts where id = ${item.journal_post_id}::uuid and workspace_id = ${command.workspaceId}::uuid`
        .execute(database);
    } else if (item.day_rating_id) {
      await sql`delete from crm.journal_day_ratings where id = ${item.day_rating_id}::uuid and workspace_id = ${command.workspaceId}::uuid`
        .execute(database);
    } else {await sql`delete from crm.journal_items where id = ${command.itemId}::uuid and workspace_id = ${command.workspaceId}::uuid`
        .execute(database);}
    return { itemType, status: "deleted" };
  }

  async findPost(
    command: Parameters<JournalRepository["findPost"]>[0],
  ): Promise<Awaited<ReturnType<JournalRepository["findPost"]>>> {
    const result = await sql<PostRow>`
      select ${postColumns} from crm.journal_posts post
      where post.id = ${command.id}::uuid
        and post.workspace_id = ${command.workspaceId}::uuid
      ${command.lock ? sql`for update` : sql``}
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0] ? post(result.rows[0]) : undefined;
  }

  async lockRequest(
    command: Parameters<JournalRepository["lockRequest"]>[0],
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.id}, 0))`
      .execute(databaseFromSession(command.transaction));
  }

  async linkActivity(
    command: Parameters<JournalRepository["linkActivity"]>[0],
  ): Promise<Awaited<ReturnType<JournalRepository["linkActivity"]>>> {
    const result = await sql<{ id: string; occurred_at: string }>`
      insert into crm.journal_items (id, workspace_id, occurred_at, activity_id, created_by_member_id)
      values (${command.id}::uuid, ${command.workspaceId}::uuid, ${command.occurredAt}, ${command.activityId}::uuid, ${command.memberId}::uuid)
      on conflict (activity_id) where activity_id is not null do nothing
      returning id::text, ${instantColumn("occurred_at")} as occurred_at
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? {
        activityId: command.activityId,
        id: result.rows[0].id,
        occurredAt: result.rows[0].occurred_at,
        status: "created",
      }
      : { status: "not-found" };
  }

  async saveDayRating(
    command: Parameters<JournalRepository["saveDayRating"]>[0],
  ): Promise<Awaited<ReturnType<JournalRepository["saveDayRating"]>>> {
    const result = await sql<RatingRow & { inserted: boolean }>`with saved as (
      insert into crm.journal_day_ratings (id, workspace_id, rated_on, rating, comment, created_by_member_id, created_at, updated_at)
      values (${command.id}::uuid, ${command.workspaceId}::uuid, ${command.ratedOn}::date, ${command.rating}, ${
      command.comment ?? null
    }, ${command.memberId}::uuid, ${command.now}, ${command.now})
      on conflict (workspace_id, rated_on) do update set rating = excluded.rating, comment = excluded.comment, updated_at = excluded.updated_at
      returning *, (xmax = 0) as inserted
    ), indexed as (
      insert into crm.journal_items (id, workspace_id, occurred_at, day_rating_id, created_by_member_id, created_at, updated_at)
      select id, workspace_id, rated_on::timestamptz, id, ${command.memberId}::uuid, ${command.now}, ${command.now} from saved where inserted
    ) select ${ratingColumns}, rating.inserted from saved rating
    `.execute(databaseFromSession(command.transaction));
    const saved = result.rows[0]!;
    return {
      rating: rating(saved),
      status: saved.inserted ? "created" : "updated",
    };
  }

  async updatePost(
    command: Parameters<JournalRepository["updatePost"]>[0],
  ): Promise<Awaited<ReturnType<JournalRepository["updatePost"]>>> {
    const result = await sql<PostRow>`with updated as (
      update crm.journal_posts set title = ${
      command.title ?? null
    }, body = ${command.body}, occurred_at = ${command.occurredAt},
        -- Strictly later than the revision it replaces, so two edits inside one
        -- clock tick still leave expectedUpdatedAt something to tell apart.
        updated_at = greatest(${command.now}::timestamptz, updated_at + interval '1 microsecond')
      where id = ${command.postId}::uuid and workspace_id = ${command.workspaceId}::uuid returning *
    ), indexed as (
      update crm.journal_items set occurred_at = ${command.occurredAt}, updated_at = ${command.now}
      where journal_post_id = ${command.postId}::uuid and workspace_id = ${command.workspaceId}::uuid
    ) select ${postColumns} from updated post
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]
      ? { post: post(result.rows[0]), status: "updated" }
      : { status: "not-found" };
  }
}
