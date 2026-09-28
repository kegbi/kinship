import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PersonDuplicateDismissalRepository } from "../../ports/duplicate_dismissal.ts";

/**
 * `crm.person_duplicate_dismissals` (REL-064). Both people are share-locked
 * in id order, so a dismissal waits for a merge that holds either of them and
 * a merge that starts later sees the row it has to relink.
 */
export class PostgresPersonDuplicateDismissalRepository
  implements PersonDuplicateDismissalRepository {
  async lockPair(
    command: Parameters<PersonDuplicateDismissalRepository["lockPair"]>[0],
  ): Promise<number> {
    const result = await sql<{ readonly id: string }>`
      select person.id::text
      from crm.people person
      where person.workspace_id = ${command.workspaceId}::uuid
        and person.id in (
          ${command.personLowId}::uuid, ${command.personHighId}::uuid
        )
        and person.deleted_at is null
      order by person.id
      for share
    `.execute(databaseFromSession(command.transaction));
    return result.rows.length;
  }

  async dismiss(
    command: Parameters<PersonDuplicateDismissalRepository["dismiss"]>[0],
  ): Promise<boolean> {
    const result = await sql<{ readonly workspace_id: string }>`
      insert into crm.person_duplicate_dismissals (
        workspace_id, person_low_id, person_high_id, dismissed_by_member_id
      ) values (
        ${command.workspaceId}::uuid, ${command.personLowId}::uuid,
        ${command.personHighId}::uuid, ${command.memberId}::uuid
      )
      on conflict (workspace_id, person_low_id, person_high_id) do nothing
      returning workspace_id::text
    `.execute(databaseFromSession(command.transaction));
    return result.rows.length === 1;
  }
}
