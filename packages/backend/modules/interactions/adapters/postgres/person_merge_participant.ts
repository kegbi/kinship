import { sql } from "kysely";
import {
  countPersonReferences,
  type PersonReferenceSite,
  referenceName,
  relinkPersonReferences,
} from "../../../../platform/postgres/person_references.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PersonMergeParticipant } from "../../../people/public.ts";

const PARTICIPANTS: PersonReferenceSite = {
  column: "person_id",
  table: "crm.activity_participants",
};

const RECORDS: readonly PersonReferenceSite[] = [
  {
    column: "person_id",
    table: "crm.calls",
    touches: true,
    workspaceScoped: true,
  },
  {
    column: "person_id",
    table: "crm.conversation_threads",
    touches: true,
    workspaceScoped: true,
  },
  {
    column: "person_id",
    table: "crm.notes",
    touches: true,
    workspaceScoped: true,
  },
];

/**
 * The interactions side of a person merge (GAP-049). The duplicate's notes,
 * calls, and conversations become the primary's. An activity is keyed by its
 * participants, so an activity both people took part in keeps the primary's
 * participation and drops the duplicate's; every other participation moves.
 */
export class PostgresInteractionPersonMergeParticipant
  implements PersonMergeParticipant {
  readonly module = "interactions";
  readonly references = [PARTICIPANTS, ...RECORDS].map(referenceName);

  countReferences(
    command: Parameters<PersonMergeParticipant["countReferences"]>[0],
  ) {
    return countPersonReferences([PARTICIPANTS, ...RECORDS], command);
  }

  async relinkPerson(
    command: Parameters<PersonMergeParticipant["relinkPerson"]>[0],
  ) {
    const dropped = await sql<{ readonly dropped: number }>`
      delete from crm.activity_participants duplicate
      where duplicate.person_id = ${command.duplicateId}::uuid
        and exists (
          select 1 from crm.activity_participants primary_row
          where primary_row.activity_id = duplicate.activity_id
            and primary_row.person_id = ${command.primaryId}::uuid
        )
      returning 1 as dropped
    `.execute(databaseFromSession(command.transaction));
    return {
      relinked: {
        ...(await relinkPersonReferences([PARTICIPANTS], command)),
        ...(await relinkPersonReferences(RECORDS, command)),
      },
      removed: { [referenceName(PARTICIPANTS)]: dropped.rows.length },
    };
  }
}
