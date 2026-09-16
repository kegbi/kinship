import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import {
  instantColumn,
  millisecondInstantColumn,
} from "../../../../platform/postgres/timestamps.ts";
import type {
  ActivityRecord,
  InteractionRepository,
  NoteRecord,
} from "../../application/record_interaction.ts";

export class PostgresInteractionRepository implements InteractionRepository {
  async lockRequest(
    command: Parameters<InteractionRepository["lockRequest"]>[0],
  ): Promise<void> {
    await sql`select pg_advisory_xact_lock(hashtextextended(${command.id}, 0))`
      .execute(databaseFromSession(command.transaction));
  }

  async findRequest(
    command: Parameters<InteractionRepository["findRequest"]>[0],
  ): Promise<Awaited<ReturnType<InteractionRepository["findRequest"]>>> {
    const database = databaseFromSession(command.transaction);
    const activity = await sql<{
      readonly activity_type_id: string | null;
      readonly created_at: string;
      readonly created_by_member_id: string | null;
      readonly description: string | null;
      readonly emotion_ids: readonly string[];
      readonly happened_at: string;
      readonly participant_ids: readonly string[];
      readonly summary: string;
    }>`
      select activity.created_by_member_id::text, activity.activity_type_id::text,
        activity.summary, activity.description,
        ${millisecondInstantColumn("activity.happened_at")} as happened_at,
        ${instantColumn("activity.created_at")} as created_at,
        coalesce(participant_ids.value, array[]::text[]) as participant_ids,
        coalesce(emotions.value, array[]::text[]) as emotion_ids
      from crm.activities activity
      left join lateral (
        select array_agg(link.person_id::text order by link.person_id) as value
        from crm.activity_participants link
        where link.activity_id = activity.id
      ) participant_ids on true
      left join lateral (
        select array_agg(link.emotion_id::text order by link.emotion_id) as value
        from crm.activity_emotions link
        where link.activity_id = activity.id
      ) emotions on true
      where activity.id = ${command.id}::uuid
        and activity.workspace_id = ${command.workspaceId}::uuid
    `.execute(database);
    const activityRow = activity.rows[0];
    if (activityRow) {
      return {
        interaction: {
          ...pickDefined({ activityTypeId: activityRow.activity_type_id }),
          createdAt: activityRow.created_at,
          ...pickDefined({
            createdByMemberId: activityRow.created_by_member_id,
            description: activityRow.description,
          }),
          emotionIds: activityRow.emotion_ids,
          happenedAt: activityRow.happened_at,
          id: command.id,
          kind: "activity",
          participantIds: activityRow.participant_ids,
          summary: activityRow.summary,
        },
        status: "found",
      };
    }
    const note = await sql<{
      readonly body: string;
      readonly created_at: string;
      readonly created_by_member_id: string | null;
      readonly is_favorited: boolean;
      readonly person_id: string;
    }>`
      select note.created_by_member_id::text,
        note.person_id::text, note.body, note.is_favorited,
        ${instantColumn("note.created_at")} as created_at
      from crm.notes note
      where note.id = ${command.id}::uuid
        and note.workspace_id = ${command.workspaceId}::uuid
    `.execute(database);
    const noteRow = note.rows[0];
    if (!noteRow) return { status: "absent" };
    return {
      interaction: {
        body: noteRow.body,
        createdAt: noteRow.created_at,
        ...pickDefined({ createdByMemberId: noteRow.created_by_member_id }),
        id: command.id,
        isFavorited: noteRow.is_favorited,
        kind: "note",
        personId: noteRow.person_id,
      },
      status: "found",
    };
  }

  async createActivity(
    command: Parameters<InteractionRepository["createActivity"]>[0],
  ): Promise<ActivityRecord | undefined> {
    const database = databaseFromSession(command.transaction);
    const inserted = await sql<{ readonly created_at: string }>`
      insert into crm.activities (
        id, workspace_id, activity_type_id, summary, description, happened_at,
        created_by_member_id, created_at, updated_at
      ) values (
        ${command.id}::uuid, ${command.workspaceId}::uuid,
        ${command.activityType?.id ?? null}::uuid, ${command.summary},
        ${command.description ?? null}, ${command.happenedAt},
        ${command.memberId}::uuid, ${command.occurredAt}, ${command.occurredAt}
      )
      returning ${instantColumn("created_at")} as created_at
    `.execute(database);
    const row = inserted.rows[0];
    if (!row) return undefined;
    await sql`
      insert into crm.activity_participants (activity_id, person_id, created_at)
      values ${
      sql.join(command.participantIds.map((personId) =>
        sql`(${command.id}::uuid, ${personId}::uuid, ${command.occurredAt})`
      ))
    }
    `.execute(database);
    if (command.emotions.length > 0) {
      await sql`
        insert into crm.activity_emotions (activity_id, emotion_id, created_at)
        values ${
        sql.join(command.emotions.map((emotion) =>
          sql`(${command.id}::uuid, ${emotion.id}::uuid, ${command.occurredAt})`
        ))
      }
      `.execute(database);
    }
    return {
      ...(command.activityType
        ? { activityType: command.activityType.name }
        : {}),
      createdAt: row.created_at,
      ...pickDefined({ description: command.description }),
      emotions: command.emotions,
      happenedAt: command.happenedAt.toISOString(),
      id: command.id,
      kind: "activity",
      participants: command.participants,
      summary: command.summary,
    };
  }

  async createNote(
    command: Parameters<InteractionRepository["createNote"]>[0],
  ): Promise<NoteRecord | undefined> {
    const result = await sql<{ readonly created_at: string }>`
      insert into crm.notes (
        id, workspace_id, person_id, body, is_favorited, favorited_at,
        created_by_member_id, created_at, updated_at
      ) values (
        ${command.id}::uuid, ${command.workspaceId}::uuid,
        ${command.personId}::uuid, ${command.body}, ${command.isFavorited},
        ${command.isFavorited ? command.occurredAt : null},
        ${command.memberId}::uuid, ${command.occurredAt}, ${command.occurredAt}
      )
      returning ${instantColumn("created_at")} as created_at
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? {
        body: command.body,
        createdAt: row.created_at,
        id: command.id,
        isFavorited: command.isFavorited,
        kind: "note",
        person: command.person,
      }
      : undefined;
  }

  async assertPostcondition(
    command: Parameters<InteractionRepository["assertPostcondition"]>[0],
  ): Promise<void> {
    const database = databaseFromSession(command.transaction);
    const result = command.record.kind === "activity"
      ? await sql<{ readonly valid: boolean }>`
        select exists (
          select 1 from crm.activities activity
          where activity.id = ${command.record.id}::uuid
            and activity.workspace_id = ${command.workspaceId}::uuid
            and activity.created_by_member_id = ${command.memberId}::uuid
          )
          and (select count(*) from crm.activity_participants participant
            where participant.activity_id = ${command.record.id}::uuid
          ) = ${command.record.participants.length}
          and (select count(*) from crm.activity_emotions
            where activity_id = ${command.record.id}::uuid) = ${command.record.emotions.length}
          as valid
      `.execute(database)
      : await sql<{ readonly valid: boolean }>`
        select count(*) = 1 as valid from crm.notes note
        where note.id = ${command.record.id}::uuid
          and note.workspace_id = ${command.workspaceId}::uuid
          and note.person_id = ${command.record.person.id}::uuid
          and note.created_by_member_id = ${command.memberId}::uuid
          and note.is_favorited = ${command.record.isFavorited}
          and (not ${command.record.isFavorited} or note.favorited_at is not null)
      `.execute(database);
    if (result.rows[0]?.valid !== true) {
      throw new Error("Interaction persistence postcondition failed.");
    }
  }
}
