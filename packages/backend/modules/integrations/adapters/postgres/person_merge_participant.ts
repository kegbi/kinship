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
    table: "crm.dav_objects",
    touches: true,
    workspaceScoped: true,
  },
];

/**
 * The DAV side of a person merge (GAP-049): a remote card that described the
 * duplicate now describes the primary, so the next synchronization updates
 * the surviving person instead of creating the duplicate again.
 */
export class PostgresDavPersonMergeParticipant
  implements PersonMergeParticipant {
  readonly module = "integrations";
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
