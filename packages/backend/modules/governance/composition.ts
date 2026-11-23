/**
 * Governance composition.
 *
 * Only a declared composition root imports this file; `public.ts` stays the
 * facade every other unit reads.
 */

import type { AuditEventRecorder } from "../../shared-kernel/audit_event.ts";
import type { RequestTombstones } from "../../shared-kernel/request_tombstone.ts";
import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresConnectionRunner } from "../../platform/postgres/transactions.ts";
import { PostgresAuditPersonMergeParticipant } from "./adapters/postgres/person_merge_participant.ts";
import { PostgresAuditEventRecorder } from "./adapters/postgres/audit_event_recorder.ts";
import { PostgresRequestTombstones } from "./adapters/postgres/request_tombstones.ts";
import { PostgresGovernanceWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import { PostgresLegalAcceptanceRepository } from "./adapters/postgres/legal_acceptance_repository.ts";
import {
  createHistoricalAuditImport,
  createLegalAcceptance,
} from "./public.ts";

/**
 * The one writer of `crm.audit_events`.
 *
 * Every module describes its own events and hands them to this recorder, so a
 * root builds it before the shared context and shares it with all of them.
 */
export function governanceAuditRecorder(): AuditEventRecorder {
  return new PostgresAuditEventRecorder();
}

/**
 * The one reader and writer of `crm.request_tombstones` (MCP-E3). A delete of
 * a keyed record leaves its tombstone through it and a keyed create asks it,
 * so a root builds it before the shared context, as it builds the recorder.
 */
export function governanceRequestTombstones(): RequestTombstones {
  return new PostgresRequestTombstones();
}

export function composeGovernance(shared: SharedComposition) {
  return {
    legal: createLegalAcceptance({
      actors: shared.actors,
      clock: shared.clock,
      connection: new PostgresConnectionRunner(shared.database),
      ids: { next: () => shared.ids.create() },
      repository: new PostgresLegalAcceptanceRepository(shared.database),
      transaction: shared.peopleTransaction,
    }),
    lifecycleImpact: PostgresGovernanceWorkspaceLifecycleImpact,
  };
}

/**
 * This module's rows in a person merge (the audit history, GAP-049). It depends on
 * nothing the module composes, so the root registers it before composing
 * people.
 */
export function auditPersonMergeParticipant(): PostgresAuditPersonMergeParticipant {
  return new PostgresAuditPersonMergeParticipant();
}

/** Built after the public people and planning reference boundaries exist. */
export function historicalAuditImportBoundary(
  shared: SharedComposition,
  references: import("./public.ts").HistoricalAuditReferences,
) {
  return createHistoricalAuditImport({
    actors: shared.actors,
    recorder: new PostgresAuditEventRecorder(),
    references,
  });
}
