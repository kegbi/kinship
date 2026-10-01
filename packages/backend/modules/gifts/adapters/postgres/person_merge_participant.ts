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
    table: "crm.gifts",
    touches: true,
    workspaceScoped: true,
  },
  {
    column: "recipient_person_id",
    table: "crm.gifts",
    touches: true,
    workspaceScoped: true,
  },
  {
    column: "person_id",
    table: "crm.debts",
    touches: true,
    workspaceScoped: true,
  },
  {
    column: "person_id",
    table: "crm.recurring_debts",
    touches: true,
    workspaceScoped: true,
  },
];

/**
 * The gifts side of a person merge (GAP-049): the duplicate's gifts, the
 * gifts meant for the duplicate, and the duplicate's debts and recurring debt
 * rules all become the primary's. None of them can collide, so all of them
 * move.
 */
export class PostgresGiftPersonMergeParticipant
  implements PersonMergeParticipant {
  readonly module = "gifts";
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
