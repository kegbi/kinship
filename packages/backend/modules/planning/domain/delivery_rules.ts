/**
 * What the worker does with a provider's answer.
 *
 * Delivering a reminder is I/O, but deciding what the answer means is not. A
 * confirmation is a send; a rejection is a permanent failure; an ambiguous
 * answer from an attempt that has already been retried to exhaustion becomes a
 * human's problem rather than another attempt; anything else is retried with
 * exponential backoff. The one subtle rule is that a reconciliation — a second
 * look at an attempt that may already have had an effect — never falls back to
 * a fresh delivery, so its exhausted state is `ambiguous`, not `rejected`.
 *
 * The bounds on a tick are here too, because they are policy: a lease, a batch
 * size, an attempt ceiling, and a backoff base, each clamped rather than
 * rejected so an operator cannot ask the worker for something unsafe.
 */

/** Whether the provider is known to have had an effect for an occurrence. */
export type ProviderResultState =
  | "ambiguous"
  | "confirmed"
  | "rejected"
  | "unattempted";

/** One occurrence the worker has leased and is responsible for. */
export interface ClaimedReminderOccurrence {
  readonly attemptCount: number;
  readonly body: string;
  readonly claimToken: string;
  readonly id: string;
  readonly memberId: string;
  /** The reminder's person, when the reminder names one. */
  readonly personId?: string;
  readonly providerIdempotencyKey: string;
  readonly providerResultState: ProviderResultState;
  readonly title: string;
  readonly workspaceId: string;
}

/** What a provider says about one delivery or reconciliation. */
export type ProviderDeliveryResult =
  | { readonly receipt: string; readonly status: "confirmed" }
  | {
    readonly code: string;
    readonly status: "ambiguous" | "rejected" | "transient";
  };

/** What one tick of the worker is allowed to do. */
export interface ReminderWorkerOptions {
  readonly leaseMilliseconds?: number;
  readonly limit?: number;
  readonly maxAttempts?: number;
  readonly owner: string;
  readonly retryBaseMilliseconds?: number;
}

/** The bounds of one tick, after clamping what the caller asked for. */
export interface DeliveryLimits {
  readonly leaseMilliseconds: number;
  readonly limit: number;
  readonly maxAttempts: number;
  readonly owner: string;
  readonly retryBaseMilliseconds: number;
}

/** How one attempt ends, and what the repository is told to record. */
export type DeliveryOutcome =
  | {
    readonly providerResultState: "confirmed";
    readonly receipt: string;
    readonly status: "sent";
  }
  | {
    readonly error: string;
    readonly providerResultState: "ambiguous";
    readonly status: "manual_attention";
  }
  | {
    readonly error: string;
    readonly providerResultState: "rejected";
    readonly status: "failed";
  }
  | {
    readonly error: string;
    readonly nextAttemptAt: Date;
    readonly providerResultState: "ambiguous" | "unattempted";
    readonly status: "retry";
  };

/**
 * A provider's error code, reduced to something safe to store and show.
 *
 * A provider may return anything; the occurrence row keeps a short, bounded
 * token, and a code that reduces to nothing still names something.
 */
export function safeCode(
  result: Exclude<ProviderDeliveryResult, { status: "confirmed" }>,
): string {
  return result.code.replaceAll(/[^a-zA-Z0-9_.:-]/g, "_").slice(0, 120) ||
    "provider-error";
}

/** The bounds one tick runs under, clamped to what the worker will serve. */
export function deliveryLimits(
  options: ReminderWorkerOptions,
): DeliveryLimits {
  return {
    leaseMilliseconds: Math.max(
      1_000,
      Math.min(300_000, options.leaseMilliseconds ?? 30_000),
    ),
    limit: Math.max(1, Math.min(100, Math.trunc(options.limit ?? 20))),
    maxAttempts: Math.max(1, Math.min(20, options.maxAttempts ?? 4)),
    owner: options.owner.slice(0, 120),
    retryBaseMilliseconds: Math.max(
      1_000,
      Math.min(3_600_000, options.retryBaseMilliseconds ?? 30_000),
    ),
  };
}

/** When the next attempt is due, backing off exponentially but boundedly. */
export function nextAttemptAt(
  finalizedAt: Date,
  attemptCount: number,
  retryBaseMilliseconds: number,
): Date {
  return new Date(
    finalizedAt.getTime() +
      retryBaseMilliseconds * 2 ** Math.min(10, Math.max(0, attemptCount - 1)),
  );
}

/** What one provider answer means for the occurrence that produced it. */
export function deliveryOutcome(input: {
  readonly attemptCount: number;
  readonly finalizedAt: Date;
  readonly maxAttempts: number;
  readonly reconciling: boolean;
  readonly result: ProviderDeliveryResult;
  readonly retryBaseMilliseconds: number;
}): DeliveryOutcome {
  const { result } = input;
  if (result.status === "confirmed") {
    return {
      providerResultState: "confirmed",
      receipt: result.receipt,
      status: "sent",
    };
  }
  const error = safeCode(result);
  const exhausted = input.attemptCount >= input.maxAttempts;
  if (result.status === "ambiguous" && exhausted) {
    return {
      error,
      providerResultState: "ambiguous",
      status: "manual_attention",
    };
  }
  if (result.status === "rejected") {
    return { error, providerResultState: "rejected", status: "failed" };
  }
  if (input.reconciling && exhausted) {
    return {
      error,
      providerResultState: "ambiguous",
      status: "manual_attention",
    };
  }
  if (exhausted) {
    return { error, providerResultState: "rejected", status: "failed" };
  }
  return {
    error,
    nextAttemptAt: nextAttemptAt(
      input.finalizedAt,
      input.attemptCount,
      input.retryBaseMilliseconds,
    ),
    providerResultState: result.status === "ambiguous" || input.reconciling
      ? "ambiguous"
      : "unattempted",
    status: "retry",
  };
}

/**
 * The audit action a finished attempt writes, or `undefined` when it wrote
 * nothing final — a retry is not yet news.
 */
export function deliveryAuditAction(
  status: DeliveryOutcome["status"],
): "delivered" | "failed" | undefined {
  if (status === "sent") return "delivered";
  if (status === "failed" || status === "manual_attention") return "failed";
  return undefined;
}
