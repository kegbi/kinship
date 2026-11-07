import type { ImportedPersonReference } from "../../../people/public.ts";
import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { InteractionBusinessImportBoundary } from "../../application/business_import_boundary.ts";
export class PostgresInteractionBusinessImportBoundary
  implements InteractionBusinessImportBoundary {
  constructor(
    private readonly people: ImportedPersonReference,
    private readonly vocabulary: (
      c: {
        kind: "activity_type" | "emotion";
        id: string;
        workspaceId: string;
        transaction: { readonly opaque: unknown };
      },
    ) => Promise<boolean>,
  ) {}
  async importRecords(
    c: Parameters<InteractionBusinessImportBoundary["importRecords"]>[0],
  ) {
    const db = databaseFromSession(c.transaction),
      retarget: Record<string, string> = {};
    for (const r of c.records) {
      const d = r.data, p = r.references;
      const personIds = [p.personId, p.fromPersonId, p.toPersonId].filter((
        id,
      ): id is string => !!id);
      if (
        personIds.length &&
        (await this.people.existsForImport({
            ...c.actor,
            personIds,
            transaction: c.transaction,
          })) === false
      ) throw new Error("Imported person reference is outside the workspace.");
      if (
        p.typeId &&
        !await this.vocabulary({
          kind: "activity_type",
          id: p.typeId,
          workspaceId: c.actor.workspaceId,
          transaction: c.transaction,
        })
      ) throw new Error("Imported activity type is outside the workspace.");
      if (
        p.emotionId &&
        !await this.vocabulary({
          kind: "emotion",
          id: p.emotionId,
          workspaceId: c.actor.workspaceId,
          transaction: c.transaction,
        })
      ) throw new Error("Imported emotion does not exist.");
      // The activity a participant or an emotion is inserted under is the
      // very id checked here (SECT-09): a participant names it `activityId`,
      // an emotion `parentId`, and neither falls back to the other.
      const activityId = d.kind === "participant" ? p.activityId : p.parentId;
      if (d.kind === "participant" || d.kind === "activity_emotion") {
        const parent = await sql`select id from crm.activities where id=${
          activityId ?? null
        }::uuid and workspace_id=${c.actor.workspaceId}::uuid for key share`
          .execute(db);
        if (!parent.rows.length) {
          throw new Error(
            "Imported activity reference is outside the workspace.",
          );
        }
      }
      if (d.kind === "call_emotion") {
        const parent =
          await sql`select id from crm.calls where id=${p.parentId}::uuid and workspace_id=${c.actor.workspaceId}::uuid for key share`
            .execute(db);
        if (!parent.rows.length) {
          throw new Error("Imported call reference is outside the workspace.");
        }
      }

      if (d.kind === "note" && d.legacyStartedAt && d.legacyCompletedAt) {
        const legacy = await sql<
          { id: string }
        >`select id::text from crm.notes where workspace_id=${c.actor.workspaceId}::uuid and person_id=${p.personId}::uuid and body=${d.body} and id<>all(${
          d.excludedLegacyIds ?? []
        }::uuid[]) and created_at>=${d.legacyStartedAt}::timestamptz and created_at<=${d.legacyCompletedAt}::timestamptz order by created_at,id limit 1 for update`
          .execute(db);
        if (legacy.rows[0]) {
          const id = legacy.rows[0].id;
          await sql`update crm.notes set is_favorited=${d.isFavorited},favorited_at=case when ${d.isFavorited}::boolean then coalesce(${d.favoritedAt}::timestamptz,${d.updatedAt}::timestamptz,${d.createdAt}::timestamptz,created_at) else ${d.favoritedAt}::timestamptz end,created_at=coalesce(${d.createdAt}::timestamptz,created_at),updated_at=coalesce(${d.updatedAt}::timestamptz,updated_at),created_by_member_id=null where id=${id}::uuid`
            .execute(db);
          retarget[r.id] = id;
          continue;
        }
      }
      if (d.kind === "activity") {
        await sql`insert into crm.activities(id,workspace_id,activity_type_id,summary,description,happened_at,created_by_member_id,created_at,updated_at) values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${
          p.typeId ?? null
        }::uuid,${d.summary},${d.description},${d.happenedAt}::timestamptz,null,coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else if (d.kind === "participant") {
        await sql`insert into crm.activity_participants(activity_id,person_id,role,created_at) values(${activityId}::uuid,${p.personId}::uuid,${d.role},coalesce(${d.createdAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else if (d.kind === "call") {
        await sql`insert into crm.calls(id,workspace_id,person_id,called_at,contact_was_caller,content,created_by_member_id,created_at,updated_at) values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${p.personId}::uuid,${d.calledAt}::timestamptz,${d.contactWasCaller},${d.content},null,coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else if (d.kind === "call_emotion") {
        await sql`insert into crm.call_emotions(call_id,emotion_id,created_at) values(${p.parentId}::uuid,${p.emotionId}::uuid,coalesce(${d.createdAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else if (d.kind === "activity_emotion") {
        await sql`insert into crm.activity_emotions(activity_id,emotion_id,created_at) values(${activityId}::uuid,${p.emotionId}::uuid,coalesce(${d.createdAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      } else if (d.kind === "note") {
        await sql`insert into crm.notes(id,workspace_id,person_id,body,is_favorited,favorited_at,created_by_member_id,created_at,updated_at) values(${r.id}::uuid,${c.actor.workspaceId}::uuid,${p.personId}::uuid,${d.body},${d.isFavorited},case when ${d.isFavorited}::boolean then coalesce(${d.favoritedAt}::timestamptz,${d.updatedAt}::timestamptz,${d.createdAt}::timestamptz,now()) else ${d.favoritedAt}::timestamptz end,null,coalesce(${d.createdAt}::timestamptz,now()),coalesce(${d.updatedAt}::timestamptz,now())) on conflict do nothing`
          .execute(db);
      }
    }
    return retarget;
  }
}
