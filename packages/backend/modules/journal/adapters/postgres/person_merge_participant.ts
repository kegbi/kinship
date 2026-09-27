import {
  countPersonReferences,
  type PersonReferenceSite,
  referenceName,
  relinkPersonReferences,
} from "../../../../platform/postgres/person_references.ts";
import type { PersonMergeParticipant } from "../../../people/public.ts";

const SITES: readonly PersonReferenceSite[] = [
  {
    column: "person_id",
    table: "crm.life_events",
    touches: true,
    workspaceScoped: true,
  },
];

/**
 * The journal's side of a person merge (GAP-049): a duplicate's life events
 * become the primary's. Journal posts and day ratings name no person.
 */
export class PostgresJournalPersonMergeParticipant
  implements PersonMergeParticipant {
  readonly module = "journal";
  readonly references = SITES.map(referenceName);

  countReferences(
    command: Parameters<PersonMergeParticipant["countReferences"]>[0],
  ) {
    return countPersonReferences(SITES, command);
  }

  async relinkPerson(
    command: Parameters<PersonMergeParticipant["relinkPerson"]>[0],
  ) {
    return {
      relinked: await relinkPersonReferences(SITES, command),
      removed: {},
    };
  }
}
