/**
 * Journal composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresJournalPersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
import { PostgresJournalRepository } from "./adapters/postgres/journal_repository.ts";
import { PostgresJournalWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import { createJournalManagement, journalAuditFrom } from "./public.ts";
import type { JournalActivityReference } from "../interactions/public.ts";

export interface JournalPorts {
  /** The activity a journal item may point at. */
  readonly activities: JournalActivityReference;
}

export function composeJournal(
  shared: SharedComposition,
  ports: JournalPorts,
) {
  return {
    journal: createJournalManagement({
      activities: ports.activities,
      actors: shared.actors,
      audit: journalAuditFrom(shared.audit),
      clock: shared.clock,
      ids: { next: () => shared.ids.create() },
      repository: new PostgresJournalRepository(),
      transaction: shared.peopleTransaction,
    }),
    lifecycleImpact: PostgresJournalWorkspaceLifecycleImpact,
    personalizationReferences: PostgresJournalPersonalizationReferences,
  };
}
