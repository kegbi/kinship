import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PeopleImportBoundary } from "../../application/import_people_boundary.ts";

/**
 * The import use case revalidates the actor under lock and refuses anyone but
 * an owner or admin before it reaches this boundary (see the
 * `ActorRevalidation` port), so the statements below scope by workspace alone.
 */
export class PostgresPeopleImportBoundary implements PeopleImportBoundary {
  async create(
    command: Parameters<PeopleImportBoundary["create"]>[0],
  ): Promise<void> {
    if (!command.person.givenName.trim()) {
      throw new Error("Imported person needs a given name.");
    }
    const result = await sql<{ readonly id: string }>`
      insert into crm.people (
        id, workspace_id, created_by_member_id, given_name, middle_name,
        family_name, nickname, description, food_preferences, is_partial,
        is_starred, is_deceased, archived_at, created_at, updated_at,
        deleted_at
      )
      values (
        ${command.person.id}::uuid, ${command.actor.workspaceId}::uuid,
        ${command.actor.memberId}::uuid, ${command.person.givenName},
        ${command.person.middleName ?? null},
        ${command.person.familyName ?? null},
        ${command.person.nickname ?? null},
        ${command.person.description ?? null},
        ${command.person.foodPreferences ?? null},
        ${command.person.isPartial}, ${command.person.isStarred},
        ${command.person.isDeceased},
        ${command.person.archived ? command.occurredAt : null},
        ${command.occurredAt}, ${command.occurredAt},
        ${command.person.deletedAt ?? null}
      )
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Imported person context is invalid.");
  }

  async exists(
    command: Parameters<PeopleImportBoundary["exists"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly exists: boolean }>`
      select exists (
        select 1 from crm.people person
        where person.id = ${command.personId}::uuid
          and person.workspace_id = ${command.actor.workspaceId}::uuid
      ) as exists
    `.execute(databaseFromSession(command.transaction));
    return result.rows[0]?.exists === true;
  }

  async linkAvatar(
    command: Parameters<PeopleImportBoundary["linkAvatar"]>[0],
  ): Promise<void> {
    const result = await sql<{ readonly person_id: string }>`
      insert into crm.person_avatars (person_id, source, file_id)
      select person.id, 'file', ${command.fileId}::uuid
      from crm.people person
      where person.id = ${command.personId}::uuid
        and person.workspace_id = ${command.actor.workspaceId}::uuid
      returning person_id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Imported avatar context is invalid.");
  }
}
