import type {
  ActiveWorkspaceContext,
  AuthenticationAttemptBudget,
  AuthenticationAudit,
} from "./protected_session.ts";

export interface WorkspaceLifecycleTransaction {
  readonly opaque: unknown;
}

export interface WorkspaceLifecycleActor extends ActiveWorkspaceContext {}

export interface WorkspaceLifecycleCounts {
  readonly activities: number;
  readonly auditEvents: number;
  readonly calls: number;
  readonly debts: number;
  readonly exports: number;
  readonly files: number;
  readonly imports: number;
  readonly integrations: number;
  readonly journalPosts: number;
  readonly gifts: number;
  readonly lifeEvents: number;
  readonly members: number;
  readonly people: number;
  readonly messages: number;
  readonly notes: number;
  readonly operations: number;
  readonly relationships: number;
  readonly reminders: number;
  readonly tasks: number;
}

export interface WorkspaceLifecycleImpactContribution {
  readonly counts: Readonly<Record<string, number>>;
  readonly objectKeys?: readonly string[];
  readonly revision: string;
}

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

export type WorkspaceLifecycleOutcome =
  | "confirmation-invalid"
  | "forbidden"
  | "rate-limited"
  | "reauthentication-required"
  | "stale-impact"
  | "transactional-failure";

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

export interface WorkspaceLifecycleSnapshot {
  readonly activeSessionCount: number;
  readonly counts: WorkspaceLifecycleCounts;
  readonly impactToken: string;
  readonly objectKeys: readonly string[];
  readonly workspaceName: string;
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

export interface WorkspaceLifecycleDependencies {
  readonly attemptBudget: AuthenticationAttemptBudget;
  readonly audit: WorkspaceLifecycleSecurityAudit;
  readonly authenticationAudit: AuthenticationAudit;
  readonly clock: { now(): Date };
  readonly identity: {
    verifyPassword(command: {
      readonly password: string;
      readonly transaction: WorkspaceLifecycleTransaction;
      readonly userId: string;
    }): Promise<boolean>;
  };
  readonly impact: WorkspaceLifecycleCascadeParticipants;
  readonly repository: WorkspaceLifecycleRepository;
  readonly storage: {
    remove(command: { readonly key: string }): Promise<void>;
  };
  readonly transaction: {
    run<T>(
      work: (transaction: WorkspaceLifecycleTransaction) => Promise<T>,
    ): Promise<T>;
  };
}

export function createWorkspaceCleanupReconciler(
  dependencies: Pick<
    WorkspaceLifecycleDependencies,
    "clock" | "repository" | "storage"
  >,
) {
  const cleanup = async (recordId: string, objectKeys: readonly string[]) => {
    let failed = false;
    for (const key of objectKeys) {
      try {
        await dependencies.storage.remove({ key });
      } catch {
        failed = true;
      }
    }
    if (!failed) {
      try {
        await dependencies.repository.completeCleanup({
          completedAt: dependencies.clock.now(),
          recordId,
        });
      } catch {
        failed = true;
      }
    }
    return failed ? "pending" as const : "complete" as const;
  };
  return {
    cleanup,
    reconcilePendingCleanup: async (limit = 20) => {
      const pending = await dependencies.repository.listPendingCleanups({
        limit,
      });
      let completed = 0;
      for (const item of pending) {
        if (await cleanup(item.recordId, item.objectKeys) === "complete") {
          completed++;
        }
      }
      return { completed, inspected: pending.length };
    },
  };
}

type LifecycleInput = {
  readonly confirmation: string;
  readonly impactToken: string;
  readonly password: string;
};

type WorkspaceLifecycleMutationResult =
  | {
    readonly cleanupStatus: "complete" | "pending";
    readonly status: "deleted" | "reset";
  }
  | { readonly retryAfterSeconds: number; readonly status: "rate-limited" }
  | {
    readonly status: Exclude<WorkspaceLifecycleOutcome, "rate-limited">;
  };

type WorkspaceLifecycleTransactionResult =
  | WorkspaceLifecycleMutationResult
  | {
    readonly objectKeys: readonly string[];
    readonly recordId: string;
    readonly status: "deleted" | "reset";
  };

async function hashImpact(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createWorkspaceLifecycle(
  dependencies: WorkspaceLifecycleDependencies,
) {
  const reconciler = createWorkspaceCleanupReconciler(dependencies);
  const inspect = async (
    actor: WorkspaceLifecycleActor,
    transaction: WorkspaceLifecycleTransaction,
    lock = false,
  ): Promise<WorkspaceLifecycleSnapshot | undefined> => {
    const snapshot = await dependencies.repository.inspect({
      ...actor,
      lock,
      transaction,
    });
    if (!snapshot) return undefined;
    const command = { transaction, workspaceId: actor.workspaceId };
    const contributions = [
      await dependencies.impact.people.inspectBeforeCascade(command),
      await dependencies.impact.relationships.inspectBeforeCascade(command),
      await dependencies.impact.interactions.inspectBeforeCascade(command),
      await dependencies.impact.journal.inspectBeforeCascade(command),
      await dependencies.impact.planning.inspectBeforeCascade(command),
      await dependencies.impact.files.inspectBeforeCascade(command),
      await dependencies.impact.gifts.inspectBeforeCascade(command),
      await dependencies.impact.integrations.inspectBeforeCascade(command),
      await dependencies.impact.importExport.inspectBeforeCascade(command),
      await dependencies.impact.governance.inspectBeforeCascade(command),
      await dependencies.impact.operations.inspectBeforeCascade(command),
    ];
    const counts = Object.assign(
      {},
      snapshot.counts,
      ...contributions.map((item) => item.counts),
    ) as WorkspaceLifecycleCounts;
    const objectKeys = [
      ...new Set([
        ...snapshot.objectKeys,
        ...contributions.flatMap((item) => item.objectKeys ?? []),
      ]),
    ].sort();
    return {
      ...snapshot,
      counts,
      impactToken: await hashImpact({
        base: snapshot.impactToken,
        contributions: contributions.map((item) => item.revision),
        counts,
        objectKeys,
      }),
      objectKeys,
    };
  };

  const mutate = async (
    action: "delete" | "reset",
    actor: WorkspaceLifecycleActor,
    input: LifecycleInput,
    request: { readonly clientAddress: string },
  ): Promise<WorkspaceLifecycleMutationResult> => {
    let reservationId: string | undefined;
    let authenticated = false;
    let primaryCommitted = false;
    const record = (
      outcome: WorkspaceLifecycleOutcome,
      occurredAt: Date,
      transaction: WorkspaceLifecycleTransaction,
    ) =>
      dependencies.audit.record({
        ...actor,
        action,
        occurredAt,
        outcome,
        transaction,
      });
    try {
      const result = await dependencies.transaction.run<
        WorkspaceLifecycleTransactionResult
      >(async (transaction) => {
        const occurredAt = dependencies.clock.now();
        if (actor.role !== "owner") {
          await record("forbidden", occurredAt, transaction);
          return { status: "forbidden" as const };
        }
        const admission = await dependencies.attemptBudget.reserve({
          clientAddress: request.clientAddress,
          occurredAt,
          scope: "password",
          subject: actor.userId,
        });
        reservationId = admission.reservationId;
        if (admission.status === "rate-limited") {
          const auditEventId = await dependencies.authenticationAudit
            .recordFailure({
              actorMemberId: null,
              context: actor,
              occurredAt,
              transaction,
            });
          await dependencies.authenticationAudit.assertFailurePostcondition({
            actorMemberId: null,
            ...(auditEventId ? { auditEventId } : {}),
            context: actor,
            occurredAt,
            transaction,
          });
          await record("rate-limited", occurredAt, transaction);
          await dependencies.attemptBudget.finalize({
            reservationId: admission.reservationId,
            statusCode: 429,
            transaction,
          });
          return {
            retryAfterSeconds: admission.retryAfterSeconds,
            status: "rate-limited" as const,
          };
        }
        if (
          !await dependencies.identity.verifyPassword({
            password: input.password,
            transaction,
            userId: actor.userId,
          })
        ) {
          const auditEventId = await dependencies.authenticationAudit
            .recordFailure({
              actorMemberId: null,
              context: actor,
              occurredAt,
              transaction,
            });
          await dependencies.authenticationAudit.assertFailurePostcondition({
            actorMemberId: null,
            ...(auditEventId ? { auditEventId } : {}),
            context: actor,
            occurredAt,
            transaction,
          });
          await record("reauthentication-required", occurredAt, transaction);
          await dependencies.attemptBudget.finalize({
            reservationId: admission.reservationId,
            statusCode: 401,
            transaction,
          });
          return { status: "reauthentication-required" as const };
        }
        authenticated = true;
        await dependencies.attemptBudget.finalize({
          reservationId: admission.reservationId,
          statusCode: 200,
          transaction,
          userId: actor.userId,
        });
        const current = await inspect(actor, transaction, true);
        if (!current) {
          await record("forbidden", occurredAt, transaction);
          return { status: "forbidden" as const };
        }
        const confirmation = `${
          action === "reset" ? "RESET" : "DELETE"
        } ${current.workspaceName}`;
        if (input.confirmation !== confirmation) {
          await record("confirmation-invalid", occurredAt, transaction);
          return { status: "confirmation-invalid" as const };
        }
        if (input.impactToken !== current.impactToken) {
          await record("stale-impact", occurredAt, transaction);
          return { status: "stale-impact" as const };
        }
        const recordId = crypto.randomUUID();
        const command = {
          ...actor,
          counts: current.counts,
          objectKeys: current.objectKeys,
          occurredAt,
          recordId,
          transaction,
        };
        if (action === "reset") {
          await dependencies.repository.resetWorkspace(command);
        } else await dependencies.repository.deleteWorkspace(command);
        return {
          objectKeys: current.objectKeys,
          recordId,
          status: action === "reset" ? "reset" as const : "deleted" as const,
        };
      });
      primaryCommitted = true;
      if (!("recordId" in result)) {
        return result;
      }
      return {
        cleanupStatus: await reconciler.cleanup(
          result.recordId,
          result.objectKeys,
        ),
        status: result.status,
      };
    } catch (error) {
      if (reservationId) {
        try {
          await dependencies.attemptBudget.finalize({
            reservationId,
            statusCode: 503,
          });
        } catch {
          // Preserve the primary database failure.
        }
      }
      if (authenticated && !primaryCommitted) {
        try {
          await dependencies.transaction.run((transaction) =>
            record(
              "transactional-failure",
              dependencies.clock.now(),
              transaction,
            )
          );
        } catch {
          // The redacted fallback is best-effort when the database is unavailable.
        }
      }
      throw error;
    }
  };

  return {
    preview: async (actor: WorkspaceLifecycleActor) => {
      if (actor.role !== "owner") return { status: "forbidden" as const };
      return await dependencies.transaction.run(async (transaction) => {
        const snapshot = await inspect(actor, transaction);
        return snapshot
          ? {
            ...snapshot,
            deleteConfirmation: `DELETE ${snapshot.workspaceName}`,
            resetConfirmation: `RESET ${snapshot.workspaceName}`,
            status: "ready" as const,
          }
          : { status: "forbidden" as const };
      });
    },

    resetWorkspace: (
      actor: WorkspaceLifecycleActor,
      input: LifecycleInput,
      request = { clientAddress: "127.0.0.1" },
    ) => mutate("reset", actor, input, request),

    deleteWorkspace: (
      actor: WorkspaceLifecycleActor,
      input: LifecycleInput,
      request = { clientAddress: "127.0.0.1" },
    ) => mutate("delete", actor, input, request),

    reconcilePendingCleanup: reconciler.reconcilePendingCleanup,
  };
}

export type WorkspaceLifecycle = ReturnType<typeof createWorkspaceLifecycle>;
