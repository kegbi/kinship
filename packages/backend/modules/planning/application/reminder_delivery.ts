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
 *
 * Each occurrence is one job run (GAP-039). When the composition root supplies
 * telemetry, the run gets its own correlation identifier, which the delivery
 * audit stores and one `worker.job` line reports with the attempt, the
 * outcome code, and the duration — never the occurrence, its person, its
 * workspace, or an error message.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type { Logger } from "../../../shared-kernel/telemetry.ts";
import {
  type ClaimedReminderOccurrence,
  deliveryAuditAction,
  type DeliveryLimits,
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

/**
 * What the worker's composition root supplies to log and correlate each run:
 * where a fresh identifier comes from, and where the `worker.job` line goes.
 */
export interface ReminderDeliveryTelemetry {
  readonly correlation: IdGenerator;
  readonly logger: Logger;
}

export interface ReminderDeliveryDependencies {
  readonly audit: ReminderDeliveryAudit;
  readonly clock: Clock;
  readonly provider: ReminderDeliveryProvider;
  readonly repository: ReminderDeliveryRepository;
  /** Absent in a composition that neither logs nor correlates its runs. */
  readonly telemetry?: ReminderDeliveryTelemetry;
  readonly transaction: PlanningTransactionRunner;
}

/** The job name every delivery run is logged under. */
export const REMINDER_DELIVERY_JOB = "reminder-delivery";

export function createReminderDeliveryWorker(
  dependencies: ReminderDeliveryDependencies,
) {
  /** Delivers or reconciles one leased occurrence and says how it ended. */
  const run = async (
    occurrence: ClaimedReminderOccurrence,
    limits: DeliveryLimits,
    requestId: string | undefined,
  ): Promise<string> => {
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
            ...(requestId ? { requestId } : {}),
            transaction,
          });
        }
        return updated;
      });
    } catch {
      return "processing-error";
    }
    return saved ? terminal.status : "stale-claim";
  };

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
        const telemetry = dependencies.telemetry;
        const requestId = telemetry?.correlation.create();
        const started = performance.now();
        const status = await run(occurrence, limits, requestId);
        results.push({ id: occurrence.id, status });
        if (telemetry && requestId) {
          telemetry.logger.log({
            event: "worker.job",
            job: REMINDER_DELIVERY_JOB,
            request_id: requestId,
            attempt: occurrence.attemptCount,
            outcome: status,
            duration_ms: Math.round(performance.now() - started),
          });
        }
      }
      return { claimed: claims.length, results };
    },
  };
}

export type ReminderDeliveryWorker = ReturnType<
  typeof createReminderDeliveryWorker
>;
