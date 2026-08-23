import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PeopleImportBoundary } from "../../application/import_people_boundary.ts";

const activeImportActor = (command: {
  readonly actor: {
    readonly memberId: string;
    readonly role: string;
    readonly userId: string;
    readonly workspaceId: string;
  };
}) =>
  sql`
    account.id = ${command.actor.userId}::uuid
    and account.status = 'active' and account.deleted_at is null
    and member.id = ${command.actor.memberId}::uuid
    and member.user_id = account.id
    and member.workspace_id = ${command.actor.workspaceId}::uuid
    and member.role = ${command.actor.role}
    and member.role in ('owner', 'admin')
    and member.status = 'active' and member.left_at is null
    and workspace.id = ${command.actor.workspaceId}::uuid
    and workspace.status = 'active' and workspace.deleted_at is null
  `;

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
      select ${command.person.id}::uuid, workspace.id,
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
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      where ${activeImportActor(command)}
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Imported person context is invalid.");
  }

  async exists(
    command: Parameters<PeopleImportBoundary["exists"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly exists: boolean }>`
      select exists (
        select 1
        from crm.users account
        join crm.workspace_members member on member.user_id = account.id
        join crm.workspaces workspace on workspace.id = member.workspace_id
        join crm.people person on person.workspace_id = workspace.id
          and person.id = ${command.personId}::uuid
        where ${activeImportActor(command)}
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
      from crm.users account
      join crm.workspace_members member on member.user_id = account.id
      join crm.workspaces workspace on workspace.id = member.workspace_id
      join crm.people person on person.workspace_id = workspace.id
        and person.id = ${command.personId}::uuid
      where ${activeImportActor(command)}
      returning person_id::text
    `.execute(databaseFromSession(command.transaction));
    if (!result.rows[0]) throw new Error("Imported avatar context is invalid.");
  }
}
