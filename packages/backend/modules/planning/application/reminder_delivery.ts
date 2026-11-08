/**
 * The loop that delivers due reminder occurrences.
 *
 * One tick leases a bounded batch and works through it one occurrence at a
 * time, so how soon a due reminder goes out never depends on how many
 * reminders exist. Then, at most once a clock hour, it replenishes the
 * rolling occurrence window (AUD-W1). An occurrence that has
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
 * Email (PLANNING-003) is the second channel. It is claimed only when the
 * composition root supplies it, and an email attempt is written down as
 * possibly effective before it leaves, so a worker that dies mid-send leaves
 * an occurrence to reconcile rather than to send again. A member with a digest
 * time gets their due email occurrences as one digest: one send, one receipt
 * shared by every occurrence it carried, and one transaction finalizing them.
 * The digest's idempotency key is the member, the local digest date, and the
 * included occurrences, so the same digest always carries the same key.
 *
 * Each delivery — one occurrence, or one digest — is one job run (GAP-039).
 * When the composition root supplies telemetry, the run gets its own
 * correlation identifier, which the delivery audit stores and one `worker.job`
 * line reports with the attempt, the outcome code, and the duration — never
 * the occurrence, its person, its workspace, or an error message.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type { Logger } from "../../../shared-kernel/telemetry.ts";
import {
  type ClaimedReminderOccurrence,
  deliveryAuditAction,
  type DeliveryChannel,
  type DeliveryLimits,
  deliveryLimits,
  deliveryOutcome,
  type DeliveryUnit,
  planDeliveryUnits,
  type ProviderDeliveryResult,
  type ReminderWorkerOptions,
} from "../domain/delivery_rules.ts";
import type { ReminderDeliveryAudit } from "../ports/audit.ts";
import type { PlanningTransactionRunner } from "../ports/context.ts";
import type {
  ReminderAttemptLedger,
  ReminderDeliveryChannel,
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

/** The email half of delivery: where it is sent, and where it is recorded. */
export interface ReminderEmailDelivery {
  readonly channel: ReminderDeliveryChannel;
  readonly ledger: ReminderAttemptLedger;
}

export interface ReminderDeliveryDependencies {
  readonly audit: ReminderDeliveryAudit;
  readonly clock: Clock;
  /** Absent in a composition that delivers in-app reminders only. */
  readonly email?: ReminderEmailDelivery;
  readonly provider: ReminderDeliveryProvider;
  readonly repository: ReminderDeliveryRepository;
  /** Absent in a composition that neither logs nor correlates its runs. */
  readonly telemetry?: ReminderDeliveryTelemetry;
  readonly transaction: PlanningTransactionRunner;
}

/** How often a running worker replenishes the rolling occurrence window. */
export const REPLENISH_INTERVAL_MILLISECONDS = 3_600_000;

/** The job name every delivery run is logged under. */
export const REMINDER_DELIVERY_JOB = "reminder-delivery";

/** Why an email occurrence reached a worker composed without email. */
const EMAIL_UNAVAILABLE: ProviderDeliveryResult = {
  code: "email-channel-unavailable",
  status: "transient",
};

/** Why an email occurrence was refused before anything was sent. */
const UNVERIFIED_RECIPIENT: ProviderDeliveryResult = {
  code: "recipient-unverified",
  status: "rejected",
};

/**
 * How long an email attempt keeps its claim once it is recorded.
 *
 * The lease a tick claims with covers the wait before an item's turn; an
 * email renews its own lease when its attempt is recorded, right before the
 * send, so a batch of slow SMTP sends never loses its later leases. The
 * budget is the SMTP transport's worst case at its default timeouts — a
 * five-second connect plus up to nine five-second writes and reads, with
 * authentication — rounded up, so a send outlives neither its lease nor a
 * worker that took over.
 */
export const EMAIL_ATTEMPT_LEASE_MILLISECONDS = 120_000;

/** An answer, or the fact that the claims it would cover were lost first. */
type Answer =
  | { readonly kind: "answered"; readonly result: ProviderDeliveryResult }
  | {
    /** The key a digest was sent under, when it was a digest. */
    readonly attemptKey?: string;
    readonly kind: "recorded";
    readonly recordedIds: ReadonlySet<string>;
    readonly result: ProviderDeliveryResult;
  };

function emailItem(occurrence: ClaimedReminderOccurrence) {
  return {
    body: occurrence.body,
    ...(occurrence.leadTimeDays !== undefined
      ? { leadDays: occurrence.leadTimeDays }
      : {}),
    ...(occurrence.occursOn ? { occursOn: occurrence.occursOn } : {}),
    ...(occurrence.personId ? { personId: occurrence.personId } : {}),
    title: occurrence.title,
  };
}

function occurrencesOf(
  unit: DeliveryUnit,
): readonly ClaimedReminderOccurrence[] {
  return unit.kind === "single" ? [unit.occurrence] : unit.occurrences;
}

/** A unit without the claims already lost, or nothing when none are left. */
function withoutLost(
  unit: DeliveryUnit,
  lost: ReadonlySet<string>,
): DeliveryUnit | undefined {
  if (unit.kind === "single") {
    return lost.has(unit.occurrence.id) ? undefined : unit;
  }
  const occurrences = unit.occurrences.filter((item) => !lost.has(item.id));
  return occurrences.length === 0 ? undefined : { ...unit, occurrences };
}

export function createReminderDeliveryWorker(
  dependencies: ReminderDeliveryDependencies,
) {
  const email = dependencies.email;

  /** Asks a provider or channel, treating a throw as an ambiguous answer. */
  const ask = async (
    question: () => Promise<ProviderDeliveryResult>,
  ): Promise<ProviderDeliveryResult> => {
    try {
      return await question();
    } catch {
      return { code: "provider-timeout", status: "ambiguous" };
    }
  };

  /** What the provider or channel says about one occurrence on its own. */
  const answerFor = async (
    occurrence: ClaimedReminderOccurrence,
    reconciling: boolean,
  ): Promise<ProviderDeliveryResult> => {
    if (occurrence.channel === "in_app") {
      return await ask(() =>
        reconciling
          ? dependencies.provider.reconcile({
            idempotencyKey: occurrence.providerIdempotencyKey,
            occurrenceId: occurrence.id,
          })
          : dependencies.provider.deliver({
            body: occurrence.body,
            idempotencyKey: occurrence.providerIdempotencyKey,
            occurrenceId: occurrence.id,
            recipientMemberId: occurrence.memberId,
            title: occurrence.title,
          })
      );
    }
    // An email reaching here is being reconciled; a fresh one is sent by
    // `sendEmail`. It is asked about under the key it was really sent with.
    if (!email) return EMAIL_UNAVAILABLE;
    return await ask(() =>
      email.channel.reconcile({
        idempotencyKey: occurrence.attemptKey ??
          occurrence.providerIdempotencyKey,
      })
    );
  };

  /** Records an email attempt; only what it recorded may be sent. */
  const record = async (
    delivery: ReminderEmailDelivery,
    occurrences: readonly ClaimedReminderOccurrence[],
    digest?: { readonly localDate: string; readonly memberId: string },
  ) => {
    const now = dependencies.clock.now();
    return await delivery.ledger.markAttempted({
      claims: occurrences,
      ...(digest ? { digest } : {}),
      leaseExpiresAt: new Date(
        now.getTime() + EMAIL_ATTEMPT_LEASE_MILLISECONDS,
      ),
      now,
    });
  };

  /** Sends one fresh email: a single reminder, or a member's digest. */
  const sendEmail = async (unit: DeliveryUnit): Promise<Answer> => {
    const occurrences = unit.kind === "single"
      ? [unit.occurrence]
      : unit.occurrences;
    const to = occurrences[0]?.recipientEmail;
    if (!email) return { kind: "answered", result: EMAIL_UNAVAILABLE };
    if (!to) return { kind: "answered", result: UNVERIFIED_RECIPIENT };
    const marked = await record(
      email,
      occurrences,
      unit.kind === "digest"
        ? { localDate: unit.localDate, memberId: unit.memberId }
        : undefined,
    );
    const recordedIds = new Set(marked.recordedIds);
    const sending = occurrences.filter((item) => recordedIds.has(item.id));
    if (sending.length === 0) {
      return {
        kind: "recorded",
        recordedIds,
        result: { code: "claim-lost", status: "transient" },
      };
    }
    const result = await ask(() =>
      email.channel.send({
        ...(unit.kind === "digest" ? { digestDate: unit.localDate } : {}),
        idempotencyKey: unit.kind === "digest" && marked.attemptKey
          ? marked.attemptKey
          : sending[0]!.providerIdempotencyKey,
        items: sending.map(emailItem),
        to,
      })
    );
    return {
      ...(unit.kind === "digest" && marked.attemptKey
        ? { attemptKey: marked.attemptKey }
        : {}),
      kind: "recorded",
      recordedIds,
      result,
    };
  };

  /**
   * Delivers or reconciles one unit and says how each occurrence ended. A
   * unit's occurrences are finalized, with their audits, in one transaction.
   */
  const run = async (
    unit: DeliveryUnit,
    limits: DeliveryLimits,
    requestId: string | undefined,
  ): Promise<readonly string[]> => {
    const occurrences = unit.kind === "single"
      ? [unit.occurrence]
      : unit.occurrences;
    const reconciling = unit.kind === "single" &&
      unit.occurrence.providerResultState !== "unattempted";
    const fresh = !reconciling && occurrences[0]?.channel === "email";
    let answer: Answer;
    try {
      answer = fresh ? await sendEmail(unit) : {
        kind: "answered",
        result: await answerFor(occurrences[0]!, reconciling),
      };
    } catch {
      // Recording the attempt failed, so nothing was sent.
      return occurrences.map(() => "processing-error");
    }
    const result = answer.result;
    // A claim the ledger did not record was lost to another worker before
    // anything was sent; that worker owns it now.
    const owned = (occurrence: ClaimedReminderOccurrence) =>
      answer.kind === "answered" || answer.recordedIds.has(occurrence.id);
    const finalizedAt = dependencies.clock.now();
    try {
      // One unit is one member's, so one workspace's: its outcome and audit
      // are written there (ADR 0008).
      return await dependencies.transaction.run(async (transaction) => {
        const statuses: string[] = [];
        for (const occurrence of occurrences) {
          if (!owned(occurrence)) {
            statuses.push("stale-claim");
            continue;
          }
          const terminal = deliveryOutcome({
            attemptCount: occurrence.attemptCount,
            finalizedAt,
            maxAttempts: limits.maxAttempts,
            reconciling,
            result,
            retryBaseMilliseconds: limits.retryBaseMilliseconds,
          });
          const action = deliveryAuditAction(terminal.status);
          // A digest that may have been delivered keeps, in its audit, the
          // key it went out under: `finalize` clears it from the occurrence.
          const attemptKey = terminal.status === "manual_attention"
            ? answer.kind === "recorded"
              ? answer.attemptKey
              : occurrence.attemptKey
            : undefined;
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
              ...(attemptKey ? { attemptKey } : {}),
              ...(unit.kind === "digest"
                ? { digestSize: occurrences.filter(owned).length }
                : {}),
              occurrence,
              occurredAt: finalizedAt,
              ...(requestId ? { requestId } : {}),
              transaction,
            });
          }
          statuses.push(updated ? terminal.status : "stale-claim");
        }
        return statuses;
      }, { workspaceId: occurrences[0]!.workspaceId });
    } catch {
      return occurrences.map(() => "processing-error");
    }
  };

  const channels: readonly DeliveryChannel[] = email
    ? ["in_app", "email"]
    : ["in_app"];

  /** The clock hour this worker last replenished in, once it has. */
  let replenishedHour: number | undefined;

  return {
    tick: async (options: ReminderWorkerOptions) => {
      const now = dependencies.clock.now();
      const limits = deliveryLimits(options);
      const claims = await dependencies.repository.claimDue({
        channels,
        leaseExpiresAt: new Date(now.getTime() + limits.leaseMilliseconds),
        limit: limits.limit,
        now,
        owner: limits.owner,
      });
      const results: Array<{ readonly id: string; readonly status: string }> =
        [];
      const units = planDeliveryUnits(claims);
      // Claims lost to another worker while an earlier email was sending.
      const lost = new Set<string>();
      for (const [index, planned] of units.entries()) {
        const unit = withoutLost(planned, lost);
        if (!unit) {
          for (const occurrence of occurrencesOf(planned)) {
            results.push({ id: occurrence.id, status: "stale-claim" });
          }
          continue;
        }
        const telemetry = dependencies.telemetry;
        const requestId = telemetry?.correlation.create();
        const started = performance.now();
        const statuses = await run(unit, limits, requestId);
        const occurrences = occurrencesOf(unit);
        const done = new Map(
          occurrences.map((occurrence, at) => [occurrence.id, statuses[at]!]),
        );
        for (const occurrence of occurrencesOf(planned)) {
          results.push({
            id: occurrence.id,
            status: done.get(occurrence.id) ?? "stale-claim",
          });
        }
        if (telemetry && requestId) {
          telemetry.logger.log({
            event: "worker.job",
            job: REMINDER_DELIVERY_JOB,
            request_id: requestId,
            attempt: Math.max(
              ...occurrences.map((occurrence) => occurrence.attemptCount),
            ),
            outcome: statuses[0]!,
            duration_ms: Math.round(performance.now() - started),
          });
        }
        // An email may have taken most of a lease; the rest of the batch
        // renews its own before its turn, and whatever was lost is skipped.
        const sent = occurrences[0]?.channel === "email" &&
          occurrences[0].providerResultState === "unattempted";
        if (email && sent) {
          const rest = units.slice(index + 1).flatMap(occurrencesOf)
            .filter((occurrence) => !lost.has(occurrence.id));
          if (rest.length > 0) {
            const renewedAt = dependencies.clock.now();
            const held = new Set(
              await email.ledger.renewLeases({
                claims: rest,
                leaseExpiresAt: new Date(
                  renewedAt.getTime() + EMAIL_ATTEMPT_LEASE_MILLISECONDS,
                ),
                now: renewedAt,
                // A renewal that fails leaves the claims to the attempt's own
                // guarded record, which still refuses any that were lost.
              }).catch(() => rest.map((occurrence) => occurrence.id)),
            );
            for (const occurrence of rest) {
              if (!held.has(occurrence.id)) lost.add(occurrence.id);
            }
          }
        }
      }
      // The window holds eight dates ahead, so it is looked at once per
      // clock hour — where every whole-hour zone's date turns over — and on
      // a worker's first tick, which cannot know what changed while it was
      // away. A definition that changes in between is regenerated by its own
      // use case. A replenishment that fails is tried on the next tick.
      const hour = Math.floor(now.getTime() / REPLENISH_INTERVAL_MILLISECONDS);
      if (hour !== replenishedHour) {
        await dependencies.repository.replenish({ now });
        replenishedHour = hour;
      }
      return { claimed: claims.length, results };
    },
  };
}

export type ReminderDeliveryWorker = ReturnType<
  typeof createReminderDeliveryWorker
>;
