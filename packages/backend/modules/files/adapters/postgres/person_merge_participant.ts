import { sql } from "kysely";
import {
  countPersonReferences,
  type PersonReferenceSite,
  referenceName,
  relinkPersonReferences,
} from "../../../../platform/postgres/person_references.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PersonMergeParticipant } from "../../../people/public.ts";

const LINKS: PersonReferenceSite = {
  column: "person_id",
  table: "crm.person_file_links",
  touches: true,
};

/**
 * The files side of a person merge (GAP-049). The duplicate's documents,
 * photos, and avatar images become the primary's. A file already linked to
 * the primary the same way keeps that link and drops the duplicate's, since a
 * person holds one link per file and kind. The bytes never move: only the
 * link row does, so nothing in the object store has to join the transaction.
 * A duplicate's avatar image the primary does not use is discarded through
 * the files facade once the merge commits (REL-063).
 */
export class PostgresFilePersonMergeParticipant
  implements PersonMergeParticipant {
  readonly module = "files";
  readonly references = [referenceName(LINKS)];

  countReferences(
    command: Parameters<PersonMergeParticipant["countReferences"]>[0],
  ) {
    return countPersonReferences([LINKS], command);
  }

  async relinkPerson(
    command: Parameters<PersonMergeParticipant["relinkPerson"]>[0],
  ) {
    const dropped = await sql<{ readonly dropped: number }>`
      delete from crm.person_file_links duplicate
      where duplicate.person_id = ${command.duplicateId}::uuid
        and exists (
          select 1 from crm.person_file_links primary_link
          where primary_link.person_id = ${command.primaryId}::uuid
            and primary_link.file_id = duplicate.file_id
            and primary_link.kind = duplicate.kind
        )
      returning 1 as dropped
    `.execute(databaseFromSession(command.transaction));
    return {
      relinked: await relinkPersonReferences([LINKS], command),
      removed: { [referenceName(LINKS)]: dropped.rows.length },
    };
  }
}
