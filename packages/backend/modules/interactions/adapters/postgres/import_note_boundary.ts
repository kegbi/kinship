import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { InteractionImportBoundary } from "../../application/import_note_boundary.ts";

export class PostgresInteractionImportBoundary
  implements InteractionImportBoundary {
  async addNote(
    command: Parameters<InteractionImportBoundary["addNote"]>[0],
  ): Promise<void> {
    const body = command.body.trim();
    if (!body) throw new Error("Imported note is empty.");
    const result = await sql<{ readonly id: string }>`
      insert into crm.notes (
        id, workspace_id, person_id, body, created_by_member_id,
        created_at, updated_at
      ) values (
        ${command.noteId}::uuid, ${command.actor.workspaceId}::uuid,
        ${command.personId}::uuid, ${body}, ${command.actor.memberId}::uuid,
        ${command.occurredAt}, ${command.occurredAt}
      )
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Imported note context is invalid.");
  }
}
