import { sql } from "kysely";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PersonMergeParticipant } from "../../../people/public.ts";

const IDENTITY = "crm.data_import_entities.target_key";

/**
 * The import identity map's side of a person merge (GAP-049).
 *
 * A Monica contact is mapped to the person it became by a text key, not a
 * foreign key, and a later import of the same export reuses that person when
 * it still exists. Pointing the duplicate's mappings at the primary is what
 * keeps a re-import idempotent after a merge: it lands on the primary and
 * never recreates the duplicate.
 */
export class PostgresImportPersonMergeParticipant
  implements PersonMergeParticipant {
  readonly module = "import-export";
  readonly references = [IDENTITY];

  async countReferences(
    command: Parameters<PersonMergeParticipant["countReferences"]>[0],
  ) {
    const result = await sql<{ readonly count: number }>`
      select count(*)::int as count
      from crm.data_import_entities entity
      join crm.data_imports run on run.id = entity.import_id
      where run.workspace_id = ${command.workspaceId}::uuid
        and entity.target_table = 'people'
        and entity.target_key = ${command.personId}
    `.execute(databaseFromSession(command.transaction));
    return { [IDENTITY]: result.rows[0]?.count ?? 0 };
  }

  async relinkPerson(
    command: Parameters<PersonMergeParticipant["relinkPerson"]>[0],
  ) {
    const result = await sql`
      update crm.data_import_entities entity
      set target_key = ${command.primaryId}
      from crm.data_imports run
      where run.id = entity.import_id
        and run.workspace_id = ${command.workspaceId}::uuid
        and entity.target_table = 'people'
        and entity.target_key = ${command.duplicateId}
      returning 1
    `.execute(databaseFromSession(command.transaction));
    return { relinked: { [IDENTITY]: result.rows.length }, removed: {} };
  }
}
