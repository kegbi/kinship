import { sql } from "kysely";
import { pickDefined } from "../../../../platform/postgres/rows.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { AvatarSource } from "../../domain/avatar.ts";
import type {
  PersonAvatarRepository,
  PersonAvatarState,
} from "../../ports/avatar.ts";

interface AvatarRow {
  readonly background_color: string | null;
  readonly file_id: string | null;
  readonly source: AvatarSource | null;
}

function state(row: AvatarRow): PersonAvatarState {
  return {
    ...pickDefined({
      backgroundColor: row.background_color,
      fileId: row.file_id,
    }),
    source: row.source ?? "default",
  };
}

/**
 * The `person_avatars` row, one per person. A person without a row is drawn
 * the default way, so a first avatar inserts the row and every later change
 * updates it; the stored colour and precomputed initials are never touched.
 * Changing an avatar does not move the person's own revision, so an open
 * identity editor stays current.
 */
export class PostgresPersonAvatarRepository implements PersonAvatarRepository {
  async lock(
    command: Parameters<PersonAvatarRepository["lock"]>[0],
  ): Promise<Awaited<ReturnType<PersonAvatarRepository["lock"]>>> {
    const result = await sql<AvatarRow & { readonly archived: boolean }>`
      select person.archived_at is not null as archived,
        avatar.source, avatar.file_id::text, avatar.background_color
      from crm.people person
      left join crm.person_avatars avatar on avatar.person_id = person.id
      where person.id = ${command.personId}::uuid
        and person.workspace_id = ${command.workspaceId}::uuid
        and person.deleted_at is null
      for update of person
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? { archived: row.archived, avatar: state(row), status: "ready" }
      : { status: "not-found" };
  }

  async save(
    command: Parameters<PersonAvatarRepository["save"]>[0],
  ): Promise<PersonAvatarState> {
    const source: AvatarSource = command.fileId ? "file" : "default";
    const result = await sql<AvatarRow>`
      insert into crm.person_avatars (person_id, source, file_id, updated_at)
      select person.id, ${source}, ${command.fileId ?? null}::uuid,
        ${command.occurredAt}
      from crm.people person
      where person.id = ${command.personId}::uuid
        and person.workspace_id = ${command.workspaceId}::uuid
      on conflict (person_id) do update set
        source = excluded.source,
        file_id = excluded.file_id,
        external_url = null,
        updated_at = excluded.updated_at
      returning source, file_id::text, background_color
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    if (!row) throw new Error("Person avatar context is invalid.");
    return state(row);
  }
}
