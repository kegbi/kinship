/**
 * Governance composition.
 *
 * Only a declared composition root imports this file; `public.ts` stays the
 * facade every other unit reads.
 */

import type { AuditEventRecorder } from "../../shared-kernel/audit_event.ts";
import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresAuditEventRecorder } from "./adapters/postgres/audit_event_recorder.ts";
import { PostgresGovernanceWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import { PostgresLegalAcceptanceRepository } from "./adapters/postgres/legal_acceptance_repository.ts";
import { createLegalAcceptance } from "./public.ts";

/**
 * The one writer of `crm.audit_events`.
 *
 * Every module describes its own events and hands them to this recorder, so a
 * root builds it before the shared context and shares it with all of them.
 */
export function governanceAuditRecorder(): AuditEventRecorder {
  return new PostgresAuditEventRecorder();
}

export function composeGovernance(shared: SharedComposition) {
  return {
    legal: createLegalAcceptance({
      actors: shared.actors,
      clock: shared.clock,
      ids: { next: () => shared.ids.create() },
      repository: new PostgresLegalAcceptanceRepository(shared.database),
      transaction: shared.peopleTransaction,
    }),
    lifecycleImpact: PostgresGovernanceWorkspaceLifecycleImpact,
  };
}
