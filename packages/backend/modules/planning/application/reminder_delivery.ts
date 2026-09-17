/**
 * The loop that delivers due reminder occurrences.
 *
 * One tick replenishes the rolling occurrence window, leases a bounded batch,
 * and works through it one occurrence at a time. An occurrence that has
 * already been attempted is reconciled rather than delivered again, so an
 * ambiguous provider answer never becomes a duplicate notification, and a
 * provider that throws is treated as ambiguous rather than as a failure.
 *
 * The decision about what each answer means lives in `domain/delivery_rules`;
 * what is left here is the orchestration nobody else can do: leasing, calling
 * the provider, and finalizing the claim and its audit inside one transaction.
 * A transaction that fails is reported against that one occurrence and the
 * batch continues, because one poisoned row must not stop the others.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import {
  deliveryAuditAction,
  deliveryLimits,
  deliveryOutcome,
  type ProviderDeliveryResult,
  type ReminderWorkerOptions,
} from "../domain/delivery_rules.ts";
import type { ReminderDeliveryAudit } from "../ports/audit.ts";
import type { PlanningTransactionRunner } from "../ports/context.ts";
import type {
  ReminderDeliveryProvider,
  ReminderDeliveryRepository,
} from "../ports/reminder_delivery.ts";

export interface ReminderDeliveryDependencies {
  readonly audit: ReminderDeliveryAudit;
  readonly clock: Clock;
  readonly provider: ReminderDeliveryProvider;
  readonly repository: ReminderDeliveryRepository;
  readonly transaction: PlanningTransactionRunner;
}

export function createReminderDeliveryWorker(
  dependencies: ReminderDeliveryDependencies,
) {
  return {
    tick: async (options: ReminderWorkerOptions) => {
      const now = dependencies.clock.now();
      const limits = deliveryLimits(options);
      await dependencies.repository.replenish({ now });
      const claims = await dependencies.repository.claimDue({
        leaseExpiresAt: new Date(now.getTime() + limits.leaseMilliseconds),
        limit: limits.limit,
        now,
        owner: limits.owner,
      });
      const results: Array<{ readonly id: string; readonly status: string }> =
        [];
      for (const occurrence of claims) {
        const reconciling = occurrence.providerResultState !== "unattempted";
        let result: ProviderDeliveryResult;
        try {
          result = reconciling
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
          result = { code: "provider-timeout", status: "ambiguous" };
        }
        const finalizedAt = dependencies.clock.now();
        const terminal = deliveryOutcome({
          attemptCount: occurrence.attemptCount,
          finalizedAt,
          maxAttempts: limits.maxAttempts,
          reconciling,
          result,
          retryBaseMilliseconds: limits.retryBaseMilliseconds,
        });
        const action = deliveryAuditAction(terminal.status);
        let saved: boolean;
        try {
          saved = await dependencies.transaction.run(async (transaction) => {
            const updated = await dependencies.repository.finalize({
              claimToken: occurrence.claimToken,
              id: occurrence.id,
              now: finalizedAt,
              transaction,
              ...terminal,
            });
            if (updated && action) {
              await dependencies.audit.record({
                action,
                occurrence,
                occurredAt: finalizedAt,
                transaction,
              });
            }
            return updated;
          });
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

export type ReminderDeliveryWorker = ReturnType<
  typeof createReminderDeliveryWorker
>;
