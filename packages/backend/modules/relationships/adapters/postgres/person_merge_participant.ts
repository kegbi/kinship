import { sql } from "kysely";
import {
  countPersonReferences,
  type PersonReferenceSite,
  referenceName,
  relinkPersonReferences,
} from "../../../../platform/postgres/person_references.ts";
import { databaseFromSession } from "../../../../platform/postgres/session.ts";
import type { PersonMergeParticipant } from "../../../people/public.ts";

const FROM: PersonReferenceSite = {
  column: "from_person_id",
  table: "crm.relationships",
  touches: true,
  workspaceScoped: true,
};
const TO: PersonReferenceSite = {
  column: "to_person_id",
  table: "crm.relationships",
  touches: true,
  workspaceScoped: true,
};

/**
 * The relationship graph's side of a person merge (GAP-049).
 *
 * An edge between the two people would become a person related to
 * themselves, so it is dropped. An edge the duplicate has to a third person
 * that the primary already has under the same type is dropped too, since the
 * graph holds one edge per pair and type. Every other edge moves to the
 * primary; its romantic details move with it, and a dropped edge's go with it.
 */
export class PostgresRelationshipPersonMergeParticipant
  implements PersonMergeParticipant {
  readonly module = "relationships";
  readonly references = [FROM, TO].map(referenceName);

  countReferences(
    command: Parameters<PersonMergeParticipant["countReferences"]>[0],
  ) {
    return countPersonReferences([FROM, TO], command);
  }

  async relinkPerson(
    command: Parameters<PersonMergeParticipant["relinkPerson"]>[0],
  ) {
    const database = databaseFromSession(command.transaction);
    const { duplicateId, primaryId, workspaceId } = command;
    // Between the pair: the duplicate is `from` in one and `to` in the other.
    const betweenFrom = await sql`
      delete from crm.relationships
      where workspace_id = ${workspaceId}::uuid
        and from_person_id = ${duplicateId}::uuid
        and to_person_id = ${primaryId}::uuid
      returning 1
    `.execute(database);
    const betweenTo = await sql`
      delete from crm.relationships
      where workspace_id = ${workspaceId}::uuid
        and from_person_id = ${primaryId}::uuid
        and to_person_id = ${duplicateId}::uuid
      returning 1
    `.execute(database);
    const sameFrom = await sql`
      delete from crm.relationships duplicate
      where duplicate.workspace_id = ${workspaceId}::uuid
        and duplicate.from_person_id = ${duplicateId}::uuid
        and exists (
          select 1 from crm.relationships kept
          where kept.from_person_id = ${primaryId}::uuid
            and kept.to_person_id = duplicate.to_person_id
            and kept.relationship_type_id = duplicate.relationship_type_id
        )
      returning 1
    `.execute(database);
    const sameTo = await sql`
      delete from crm.relationships duplicate
      where duplicate.workspace_id = ${workspaceId}::uuid
        and duplicate.to_person_id = ${duplicateId}::uuid
        and exists (
          select 1 from crm.relationships kept
          where kept.to_person_id = ${primaryId}::uuid
            and kept.from_person_id = duplicate.from_person_id
            and kept.relationship_type_id = duplicate.relationship_type_id
        )
      returning 1
    `.execute(database);
    return {
      relinked: await relinkPersonReferences([FROM, TO], command),
      removed: {
        [referenceName(FROM)]: betweenFrom.rows.length + sameFrom.rows.length,
        [referenceName(TO)]: betweenTo.rows.length + sameTo.rows.length,
      },
    };
  }
}
