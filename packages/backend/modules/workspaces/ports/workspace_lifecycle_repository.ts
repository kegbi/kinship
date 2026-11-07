/**
 * How a workspace is inspected, destroyed, and cleaned up afterwards.
 *
 * `WorkspaceLifecycleCascadeParticipant` is the contract every other module
 * implements so this one can say what would be lost without reading anybody
 * else's tables. It is read-only and takes only the workspace, because the
 * cascade itself happens in the database: a module says what it holds, and the
 * foreign keys do the rest. The one exception is
 * `WorkspaceLifecycleDependentErasure`: rows behind an `ON DELETE RESTRICT`
 * key are erased by their owning module first, so the cascade never meets one.
 *
 * The cleanup pair exists because stored objects are outside the transaction.
 * A reset or a delete commits the rows and records the keys it still has to
 * remove; `listPendingCleanups` and `completeCleanup` let a later run finish
 * the job, so a failure between the commit and the object store leaves
 * something to retry rather than something orphaned.
 *
 * `WorkspaceResetActivityAudit` is separate from the security audit on
 * purpose: one is the dashboard-visible record that a reset happened, the
 * other is the trail of every attempt including the refused ones. Governance
 * owns `audit_events` and workspaces may not read it, so both are ports the
 * composition root fills.
 */

import type {
  WorkspaceLifecycleCounts,
  WorkspaceLifecycleImpactContribution,
  WorkspaceLifecycleOutcome,
  WorkspaceLifecycleSnapshot,
} from "../domain/workspace_lifecycle_rules.ts";
import type {
  WorkspaceLifecycleActor,
  WorkspaceLifecycleTransaction,
} from "./context.ts";

export interface WorkspaceLifecycleCascadeParticipant {
  inspectBeforeCascade(command: {
    readonly transaction: WorkspaceLifecycleTransaction;
    readonly workspaceId: string;
  }): Promise<WorkspaceLifecycleImpactContribution>;
}

export interface WorkspaceLifecycleCascadeParticipants {
  readonly files: WorkspaceLifecycleCascadeParticipant;
  readonly gifts: WorkspaceLifecycleCascadeParticipant;
  readonly governance: WorkspaceLifecycleCascadeParticipant;
  readonly importExport: WorkspaceLifecycleCascadeParticipant;
  readonly integrations: WorkspaceLifecycleCascadeParticipant;
  readonly interactions: WorkspaceLifecycleCascadeParticipant;
  readonly journal: WorkspaceLifecycleCascadeParticipant;
  readonly operations: WorkspaceLifecycleCascadeParticipant;
  readonly people: WorkspaceLifecycleCascadeParticipant;
  readonly planning: WorkspaceLifecycleCascadeParticipant;
  readonly relationships: WorkspaceLifecycleCascadeParticipant;
}

/**
 * A module whose rows the workspace cascade cannot remove by itself. A row
 * that reaches both a person and a workspace vocabulary through an
 * `ON DELETE RESTRICT` key aborts the cascade when PostgreSQL reaches the
 * vocabulary first (SECT-03), so its owning module erases those rows in the
 * lifecycle transaction before the workspace row is deleted.
 */
export interface WorkspaceLifecycleDependentErasure {
  eraseBeforeCascade(command: {
    readonly transaction: WorkspaceLifecycleTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
}

/**
 * The erasures in the order they run: relationships reference
 * `relationship_types`, and people own the contact methods that reference
 * `contact_method_types`, so both go before the vocabularies the workspace
 * cascade removes.
 */
export interface WorkspaceLifecycleDependentErasures {
  readonly people: WorkspaceLifecycleDependentErasure;
  readonly relationships: WorkspaceLifecycleDependentErasure;
}

export interface WorkspaceLifecycleSecurityAudit {
  record(
    command: WorkspaceLifecycleActor & {
      readonly action: "delete" | "reset";
      readonly occurredAt: Date;
      readonly outcome: WorkspaceLifecycleOutcome;
      readonly transaction: WorkspaceLifecycleTransaction;
    },
  ): Promise<void>;
}

/**
 * The dashboard-visible record of a reset. `governance` owns `audit_events`
 * and `workspaces` may not read it, so the write is a port the composition
 * root fills with governance's adapter.
 */
export interface WorkspaceResetActivityAudit {
  recordReset(
    command: WorkspaceLifecycleActor & {
      readonly occurredAt: Date;
      readonly transaction: WorkspaceLifecycleTransaction;
    },
  ): Promise<void>;
}

/** The identity re-authentication a destructive action demands. */
export interface WorkspaceLifecycleIdentity {
  verifyPassword(command: {
    readonly password: string;
    readonly transaction: WorkspaceLifecycleTransaction;
    readonly userId: string;
  }): Promise<boolean>;
}

/** The stored objects a destroyed workspace leaves behind. */
export interface WorkspaceLifecycleObjectStorage {
  remove(command: { readonly key: string }): Promise<void>;
}

export interface WorkspaceLifecycleRepository {
  inspect(
    command: WorkspaceLifecycleActor & {
      readonly lock?: boolean;
      readonly transaction: WorkspaceLifecycleTransaction;
    },
  ): Promise<WorkspaceLifecycleSnapshot | undefined>;
  resetWorkspace(
    command: WorkspaceLifecycleActor & {
      readonly counts: WorkspaceLifecycleCounts;
      readonly objectKeys: readonly string[];
      readonly occurredAt: Date;
      readonly recordId: string;
      readonly transaction: WorkspaceLifecycleTransaction;
    },
  ): Promise<void>;
  deleteWorkspace(
    command: WorkspaceLifecycleActor & {
      readonly counts: WorkspaceLifecycleCounts;
      readonly objectKeys: readonly string[];
      readonly occurredAt: Date;
      readonly recordId: string;
      readonly transaction: WorkspaceLifecycleTransaction;
    },
  ): Promise<void>;
  listPendingCleanups(command: { readonly limit: number }): Promise<
    readonly {
      readonly objectKeys: readonly string[];
      readonly recordId: string;
    }[]
  >;
  completeCleanup(command: {
    readonly completedAt: Date;
    readonly recordId: string;
  }): Promise<void>;
}
