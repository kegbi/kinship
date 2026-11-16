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

/** Where a reminder occurrence is delivered. */
export type DeliveryChannel = "email" | "in_app";

/** What a member chose for every occurrence of theirs not yet sent. */
export type ReminderDeliveryPreference = "both" | "email" | "in_app";

/** Whether the provider is known to have had an effect for an occurrence. */
export type ProviderResultState =
  | "ambiguous"
  | "confirmed"
  | "rejected"
  | "unattempted";

/** One occurrence the worker has leased and is responsible for. */
export interface ClaimedReminderOccurrence {
  /**
   * The key an earlier email attempt was actually sent under, when it was a
   * digest's rather than the occurrence's own. A reconciliation asks with it.
   */
  readonly attemptKey?: string;
  readonly attemptCount: number;
  readonly body: string;
  readonly channel: DeliveryChannel;
  readonly claimToken: string;
  /**
   * The local date of the digest an email occurrence is delivered in, present
   * only when its member has a digest time.
   */
  readonly digestDate?: string;
  readonly id: string;
  /**
   * How many days before its date this notice is delivered: a lead rule's
   * advance notice, or 0 or absent for the date itself.
   */
  readonly leadTimeDays?: number;
  readonly memberId: string;
  /** The date the reminder is for, which a lead notice precedes. */
  readonly occursOn?: string;
  /** The reminder's person, when the reminder names one. */
  readonly personId?: string;
  /** That person's display name, as an email names them. */
  readonly personName?: string;
  readonly providerIdempotencyKey: string;
  readonly providerResultState: ProviderResultState;
  /** The member's verified address, absent when they have none. */
  readonly recipientEmail?: string;
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

/**
 * The channels a member's occurrences not yet sent use.
 *
 * Email needs somewhere to go: a member without a verified address keeps
 * in-app reminders whatever they chose, so no reminder is lost. Waiting
 * occurrences move onto these channels when the member saves a new choice,
 * and on the worker's next hourly replenishment after an address stops or
 * starts being verified; one already attempted, sent, or due keeps its
 * channel.
 */
export function deliveryChannels(input: {
  readonly hasVerifiedEmail: boolean;
  readonly preference: ReminderDeliveryPreference;
}): readonly DeliveryChannel[] {
  if (!input.hasVerifiedEmail || input.preference === "in_app") {
    return ["in_app"];
  }
  return input.preference === "email" ? ["email"] : ["in_app", "email"];
}

/**
 * The latest daily digest instant at or before `now`, and its local date.
 *
 * A digest member's email occurrences are due once this cutoff has passed
 * their own delivery time, so everything due since the previous digest goes
 * out together. The time is read in the member's own zone, or UTC when they
 * chose none, or when theirs is a zone the runtime cannot resolve; a local
 * time a clock change skips moves forward to the next instant that exists.
 */
export function digestWindow(input: {
  readonly digestTime: string;
  readonly now: Date;
  readonly timezone?: string;
}): { readonly cutoff: Date; readonly localDate: string } {
  const timeZone = input.timezone && schedulableZone(input.timezone)
    ? input.timezone
    : "UTC";
  const local = Temporal.Instant.fromEpochMilliseconds(input.now.getTime())
    .toZonedDateTimeISO(timeZone);
  const plainTime = Temporal.PlainTime.from(input.digestTime);
  let date = local.toPlainDate();
  let candidate = date.toZonedDateTime({ plainTime, timeZone });
  if (Temporal.ZonedDateTime.compare(candidate, local) > 0) {
    date = date.subtract({ days: 1 });
    candidate = date.toZonedDateTime({ plainTime, timeZone });
  }
  return {
    cutoff: new Date(candidate.epochMilliseconds),
    localDate: date.toString(),
  };
}

function schedulableZone(timeZone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

/** What one delivery attempt covers: one occurrence, or one member's digest. */
export type DeliveryUnit =
  | {
    readonly kind: "single";
    readonly occurrence: ClaimedReminderOccurrence;
  }
  | {
    readonly kind: "digest";
    readonly localDate: string;
    readonly memberId: string;
    readonly occurrences: readonly ClaimedReminderOccurrence[];
  };

/**
 * How a leased batch is delivered.
 *
 * A member's fresh digest claims share one email, placed where the first of
 * them was claimed. Everything else is delivered on its own, including a
 * digest claim being reconciled: an earlier attempt may already have sent it,
 * so it is only ever asked about, never folded into a new email.
 */
export function planDeliveryUnits(
  claims: readonly ClaimedReminderOccurrence[],
): readonly DeliveryUnit[] {
  const units: DeliveryUnit[] = [];
  const digests = new Map<string, ClaimedReminderOccurrence[]>();
  for (const occurrence of claims) {
    if (
      occurrence.channel !== "email" || occurrence.digestDate === undefined ||
      occurrence.providerResultState !== "unattempted"
    ) {
      units.push({ kind: "single", occurrence });
      continue;
    }
    const key = `${occurrence.memberId}|${occurrence.digestDate}`;
    const members = digests.get(key);
    if (members) {
      members.push(occurrence);
      continue;
    }
    const occurrences = [occurrence];
    digests.set(key, occurrences);
    units.push({
      kind: "digest",
      localDate: occurrence.digestDate,
      memberId: occurrence.memberId,
      occurrences,
    });
  }
  return units;
}

/**
 * A digest's idempotency key: the member, the local digest date, and the
 * included occurrences in a stable order, hashed to a bounded token. The
 * same digest always carries the same key whatever order it was claimed in.
 */
export async function digestIdempotencyKey(input: {
  readonly localDate: string;
  readonly memberId: string;
  readonly occurrenceIds: readonly string[];
}): Promise<string> {
  const ids = [...input.occurrenceIds].sort();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      [input.memberId, input.localDate, ...ids].join("\n"),
    ),
  );
  return `digest:${
    Array.from(
      new Uint8Array(digest),
      (byte) => byte.toString(16).padStart(2, "0"),
    ).join("")
  }`;
}

/** How many dates ahead the rolling occurrence window keeps per reminder. */
export const REMINDER_WINDOW_OCCURRENCES = 8;

/** About how many occurrence rows one replenishment inserts per channel. */
export const TOP_UP_CHUNK_ROWS = 500;

/** One member's window of one recurring reminder that fell short. */
export interface ShortReminderWindow {
  readonly memberId: string;
  readonly reminderId: string;
  /** The most rows refilling it may insert per channel: dates × notices. */
  readonly rows: number;
  readonly workspaceId: string;
}

/**
 * Splits short windows, ordered by workspace, into batches that each stay in
 * one workspace and insert at most `limit` rows, so every replenishment
 * transaction is short and locks one workspace's settings only. A window
 * that alone is larger than the limit is a batch of its own.
 */
export function topUpBatches<
  Window extends Pick<ShortReminderWindow, "rows" | "workspaceId">,
>(
  windows: readonly Window[],
  limit = TOP_UP_CHUNK_ROWS,
): readonly (readonly Window[])[] {
  const batches: Window[][] = [];
  let size = 0;
  for (const window of windows) {
    const current = batches.at(-1);
    if (
      current?.[0]?.workspaceId === window.workspaceId &&
      size + window.rows <= limit
    ) {
      current.push(window);
      size += window.rows;
    } else {
      batches.push([window]);
      size = window.rows;
    }
  }
  return batches;
}
