import {
  countPersonReferences,
  type PersonReferenceSite,
  referenceName,
  relinkPersonReferences,
} from "../../../../platform/postgres/person_references.ts";
import type { PersonMergeParticipant } from "../../../people/public.ts";

const SITES: readonly PersonReferenceSite[] = [
  { column: "person_id", table: "crm.audit_events", workspaceScoped: true },
];

/**
 * The audit history's side of a person merge (GAP-049). Only the pointer to
 * the person an event is about moves, so the duplicate's history is read on
 * the surviving person's audit page; the event itself — its action, actor,
 * payload, and time — is never rewritten.
 */
export class PostgresAuditPersonMergeParticipant
  implements PersonMergeParticipant {
  readonly module = "governance";
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
