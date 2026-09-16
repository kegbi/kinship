import type { Clock } from "../../../shared-kernel/clock.ts";
import type { PeopleTransaction } from "../../people/public.ts";

export interface ClaimedReminderOccurrence {
  readonly attemptCount: number;
  readonly body: string;
  readonly claimToken: string;
  readonly id: string;
  readonly memberId: string;
  readonly providerIdempotencyKey: string;
  readonly providerResultState:
    | "ambiguous"
    | "confirmed"
    | "rejected"
    | "unattempted";
  readonly title: string;
  readonly workspaceId: string;
}

export type ProviderDeliveryResult =
  | { readonly receipt: string; readonly status: "confirmed" }
  | {
    readonly code: string;
    readonly status: "ambiguous" | "rejected" | "transient";
  };

export interface ReminderDeliveryProvider {
  deliver(command: {
    readonly body: string;
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
    readonly recipientMemberId: string;
    readonly title: string;
  }): Promise<ProviderDeliveryResult>;
  reconcile(command: {
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
  }): Promise<ProviderDeliveryResult>;
}

export interface InAppReminderEffectStore {
  record(command: {
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
  }): Promise<ProviderDeliveryResult>;
  reconcile(command: {
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
  }): Promise<ProviderDeliveryResult>;
}

export interface ReminderDeliveryRepository {
  replenish(command: { readonly now: Date }): Promise<void>;
  claimDue(command: {
    readonly leaseExpiresAt: Date;
    readonly limit: number;
    readonly now: Date;
    readonly owner: string;
  }): Promise<readonly ClaimedReminderOccurrence[]>;
  finalize(command: {
    readonly claimToken: string;
    readonly error?: string;
    readonly id: string;
    readonly nextAttemptAt?: Date;
    readonly now: Date;
    readonly providerResultState:
      | "ambiguous"
      | "confirmed"
      | "rejected"
      | "unattempted";
    readonly receipt?: string;
    readonly status: "failed" | "manual_attention" | "retry" | "sent";
    readonly transaction: PeopleTransaction;
  }): Promise<boolean>;
}

export interface ReminderDeliveryAudit {
  record(command: {
    readonly action: "delivered" | "failed";
    readonly occurrence: ClaimedReminderOccurrence;
    readonly occurredAt: Date;
    readonly transaction: PeopleTransaction;
  }): Promise<void>;
}

export interface ReminderDeliveryDependencies {
  readonly audit: ReminderDeliveryAudit;
  readonly clock: Clock;
  readonly provider: ReminderDeliveryProvider;
  readonly repository: ReminderDeliveryRepository;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

export interface ReminderWorkerOptions {
  readonly leaseMilliseconds?: number;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly owner: string;
  readonly retryBaseMilliseconds?: number;
}

function safeCode(
  result: Exclude<ProviderDeliveryResult, { status: "confirmed" }>,
): string {
  return result.code.replaceAll(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) ||
    "provider-error";
}

export function createReminderDeliveryWorker(
  dependencies: ReminderDeliveryDependencies,
) {
  return {
    tick: async (options: ReminderWorkerOptions) => {
      const now = dependencies.clock.now();
      const leaseMilliseconds = Math.max(
        1_000,
        Math.min(300_000, options.leaseMilliseconds ?? 30_000),
      );
      const maxAttempts = Math.max(1, Math.min(20, options.maxAttempts ?? 4));
      const retryBaseMilliseconds = Math.max(
        1_000,
        Math.min(3_600_000, options.retryBaseMilliseconds ?? 30_000),
      );
      await dependencies.repository.replenish({ now });
      const claims = await dependencies.repository.claimDue({
        leaseExpiresAt: new Date(now.getTime() + leaseMilliseconds),
        limit: Math.max(1, Math.min(100, Math.trunc(options.limit ?? 20))),
        now,
        owner: options.owner.slice(0, 120),
      });
      const results: Array<{ readonly id: string; readonly status: string }> =
        [];
      for (const occurrence of claims) {
        const reconciling = occurrence.providerResultState !== "unattempted";
        let outcome: ProviderDeliveryResult;
        try {
          outcome = reconciling
            ? await dependencies.provider.reconcile({
              idempotencyKey: occurrence.providerIdempotencyKey,
              occurrenceId: occurrence.id,
            })
            : await dependencies.provider.deliver({
              body: occurrence.body,
              idempotencyKey: occurrence.providerIdempotencyKey,
              occurrenceId: occurrence.id,
              recipientMemberId: occurrence.memberId,
              title: occurrence.title,
            });
        } catch {
          outcome = { code: "provider-timeout", status: "ambiguous" };
        }
        const finalizedAt = dependencies.clock.now();
        const terminal = outcome.status === "confirmed"
          ? {
            providerResultState: "confirmed" as const,
            receipt: outcome.receipt,
            status: "sent" as const,
          }
          : outcome.status === "ambiguous" &&
              occurrence.attemptCount >= maxAttempts
          ? {
            error: safeCode(outcome),
            providerResultState: "ambiguous" as const,
            status: "manual_attention" as const,
          }
          : outcome.status === "rejected"
          ? {
            error: safeCode(outcome),
            providerResultState: "rejected" as const,
            status: "failed" as const,
          }
          : reconciling && occurrence.attemptCount >= maxAttempts
          ? {
            error: safeCode(outcome),
            providerResultState: "ambiguous" as const,
            status: "manual_attention" as const,
          }
          : occurrence.attemptCount >= maxAttempts
          ? {
            error: safeCode(outcome),
            providerResultState: "rejected" as const,
            status: "failed" as const,
          }
          : {
            error: safeCode(outcome),
            nextAttemptAt: new Date(
              finalizedAt.getTime() + retryBaseMilliseconds *
                  2 ** Math.min(10, Math.max(0, occurrence.attemptCount - 1)),
            ),
            providerResultState: outcome.status === "ambiguous" || reconciling
              ? "ambiguous" as const
              : "unattempted" as const,
            status: "retry" as const,
          };
        let saved: boolean;
        try {
          saved = await dependencies.transaction.run(
            async (transaction) => {
              const updated = await dependencies.repository.finalize({
                claimToken: occurrence.claimToken,
                id: occurrence.id,
                now: finalizedAt,
                transaction,
                ...terminal,
              });
              if (
                updated &&
                (terminal.status === "sent" ||
                  terminal.status === "failed" ||
                  terminal.status === "manual_attention")
              ) {
                await dependencies.audit.record({
                  action: terminal.status === "sent" ? "delivered" : "failed",
                  occurrence,
                  occurredAt: finalizedAt,
                  transaction,
                });
              }
              return updated;
            },
          );
        } catch {
          results.push({ id: occurrence.id, status: "processing-error" });
          continue;
        }
        results.push({
          id: occurrence.id,
          status: saved ? terminal.status : "stale-claim",
        });
      }
      return { claimed: claims.length, results };
    },
  };
}

export class InAppReminderDelivery implements ReminderDeliveryProvider {
  constructor(private readonly effects: InAppReminderEffectStore) {}

  deliver(command: {
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
  }): Promise<ProviderDeliveryResult> {
    return this.effects.record(command);
  }

  reconcile(command: {
    readonly idempotencyKey: string;
    readonly occurrenceId: string;
  }): Promise<ProviderDeliveryResult> {
    return this.effects.reconcile(command);
  }
}

export type ReminderDeliveryWorker = ReturnType<
  typeof createReminderDeliveryWorker
>;
