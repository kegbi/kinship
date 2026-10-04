import type { JournalActivityReference } from "../../../interactions/public.ts";
import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { JournalBusinessImportBoundary } from "../../application/import_business_boundary.ts";

export class PostgresJournalBusinessImportBoundary
  implements JournalBusinessImportBoundary {
  constructor(private readonly activities: JournalActivityReference) {}
  async importRecords(
    command: Parameters<JournalBusinessImportBoundary["importRecords"]>[0],
  ): Promise<Readonly<Record<string, string>>> {
    const db = databaseFromSession(command.transaction),
      workspace = command.actor.workspaceId;
    const identities: Record<string, string> = {};
    for (const { id, data: d, references: r } of command.records) {
      const created = d.createdAt ?? null,
        updated = d.updatedAt ?? d.createdAt ?? null;
      if (d.kind === "journal_post") {
        await sql`insert into crm.journal_posts (id,workspace_id,title,body,occurred_at,created_by_member_id,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${
          d.title ?? null
        },${d.body},coalesce(${
          d.occurredAt ?? null
        }::timestamptz,now()),${command.actor.memberId}::uuid,coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (id) do nothing`
          .execute(db);
      } else if (d.kind === "journal_day") {
        const saved = await sql<
          { id: string }
        >`insert into crm.journal_day_ratings (id,workspace_id,rated_on,rating,comment,created_by_member_id,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${d.ratedOn}::date,${d.rating},${
          d.comment ?? null
        },${command.actor.memberId}::uuid,coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict (workspace_id,rated_on) do update set rated_on=excluded.rated_on returning id::text`
          .execute(db);
        identities[id] = saved.rows[0]!.id;
      } else if (d.kind === "journal_item") {
        const target = r.activityId
          ? {
            rows: (await this.activities.inspect({
                ...command.actor,
                activityId: r.activityId,
                transaction: command.transaction,
              })).status === "ready"
              ? [{}]
              : [],
          }
          : r.postId
          ? await sql`select id from crm.journal_posts where id=${r.postId}::uuid and workspace_id=${workspace}::uuid`
            .execute(db)
          : await sql`select id from crm.journal_day_ratings where id=${r.dayId}::uuid and workspace_id=${workspace}::uuid`
            .execute(db);
        if (!target.rows.length) {
          throw new Error(
            "Imported journal reference is outside the workspace.",
          );
        }
        await sql`insert into crm.journal_items (id,workspace_id,occurred_at,activity_id,journal_post_id,day_rating_id,created_by_member_id,created_at,updated_at) values (${id}::uuid,${workspace}::uuid,${d.occurredAt}::timestamptz,${
          r.activityId ?? null
        }::uuid,${r.postId ?? null}::uuid,${
          r.dayId ?? null
        }::uuid,${command.actor.memberId}::uuid,coalesce(${created}::timestamptz,now()),coalesce(${updated}::timestamptz,now())) on conflict do nothing`
          .execute(db);
        if (r.postId) {
          await sql`update crm.journal_posts set occurred_at=${d.occurredAt}::timestamptz where id=${r.postId}::uuid and workspace_id=${workspace}::uuid`
            .execute(db);
        }
      } else throw new Error("Unsupported journal import record.");
    }
    return identities;
  }
}
