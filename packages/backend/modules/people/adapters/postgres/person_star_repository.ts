import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PersonStarRepository } from "../../ports/star.ts";

/**
 * `people.is_starred` (GAP-053). The flag is set without touching
 * `updated_at`, so starring never makes an open identity editor stale and
 * never reads as an edit to the person's own facts.
 */
export class PostgresPersonStarRepository implements PersonStarRepository {
  async lock(
    command: Parameters<PersonStarRepository["lock"]>[0],
  ): Promise<Awaited<ReturnType<PersonStarRepository["lock"]>>> {
    const result = await sql<{
      readonly archived: boolean;
      readonly starred: boolean;
    }>`
      select person.archived_at is not null as archived,
        person.is_starred as starred
      from crm.people person
      where person.id = ${command.personId}::uuid
        and person.workspace_id = ${command.workspaceId}::uuid
        and person.deleted_at is null
      for update
    `.execute(databaseFromSession(command.transaction));
    const row = result.rows[0];
    return row
      ? { archived: row.archived, starred: row.starred, status: "ready" }
      : { status: "not-found" };
  }

  async save(command: Parameters<PersonStarRepository["save"]>[0]) {
    const result = await sql<{ readonly id: string }>`
      update crm.people set is_starred = ${command.starred}
      where id = ${command.personId}::uuid
        and workspace_id = ${command.workspaceId}::uuid
        and deleted_at is null
      returning id::text
    `.execute(databaseFromSession(command.transaction));
    if (result.rows.length !== 1) {
      throw new Error("Person star update failed.");
    }
  }
}
