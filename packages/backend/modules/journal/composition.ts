import { PostgresJournalBusinessImportBoundary } from "./adapters/postgres/import_business_boundary.ts";
/**
 * Journal composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresJournalPersonMergeParticipant } from "./adapters/postgres/person_merge_participant.ts";
import { PostgresJournalPersonalizationReferences } from "./adapters/postgres/personalization_references.ts";
import { PostgresJournalRepository } from "./adapters/postgres/journal_repository.ts";
import { PostgresLifeEventRepository } from "./adapters/postgres/life_event_repository.ts";
import { PostgresJournalWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import {
  createJournalManagement,
  createLifeEventManagement,
  journalAuditFrom,
  lifeEventAuditFrom,
  type LifeEventManagementDependencies,
} from "./public.ts";
import type { JournalActivityReference } from "../interactions/public.ts";

export interface JournalPorts {
  /** The activity a journal item may point at. */
  readonly activities: JournalActivityReference;
  /** The person a life event belongs to, as the people module sees them. */
  readonly people: LifeEventManagementDependencies["people"];
  /** The life-events module switch and type vocabulary of the workspace. */
  readonly workspace: LifeEventManagementDependencies["workspace"];
}

export function composeJournal(
  shared: SharedComposition,
  ports: JournalPorts,
) {
  return {
    businessImportBoundary: new PostgresJournalBusinessImportBoundary(
      ports.activities,
    ),
    journal: createJournalManagement({
      activities: ports.activities,
      actors: shared.actors,
      audit: journalAuditFrom(shared.audit),
      clock: shared.clock,
      ids: { next: () => shared.ids.create() },
      repository: new PostgresJournalRepository(),
      tombstones: shared.tombstones,
      transaction: shared.peopleTransaction,
    }),
    lifeEvents: createLifeEventManagement({
      actors: shared.actors,
      audit: lifeEventAuditFrom(shared.audit),
      clock: shared.clock,
      ids: shared.ids,
      people: ports.people,
      repository: new PostgresLifeEventRepository(),
      transaction: shared.peopleTransaction,
      workspace: ports.workspace,
    }),
    lifecycleImpact: PostgresJournalWorkspaceLifecycleImpact,
    personalizationReferences: PostgresJournalPersonalizationReferences,
  };
}

/**
 * This module's rows in a person merge (life events, GAP-049). It depends on
 * nothing the module composes, so the root registers it before composing
 * people.
 */
export function journalPersonMergeParticipant(): PostgresJournalPersonMergeParticipant {
  return new PostgresJournalPersonMergeParticipant();
}
