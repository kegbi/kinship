/**
 * How the worker leases a due occurrence, hands it to a provider, and writes
 * the answer back.
 *
 * `claimDue` leases work rather than reading it, so two workers never deliver
 * the same occurrence, and `finalize` takes the claim token back so a lease
 * that expired while an attempt was in flight loses the race instead of
 * overwriting whoever took over.
 *
 * The provider is asked two different questions on purpose. `deliver` starts a
 * new attempt; `reconcile` asks what became of one that may already have had
 * an effect, which is the only safe question after an ambiguous answer. The
 * in-app effect store is the durable side of the same pair for the provider
 * this deployment ships with.
 *
 * Email leaves the process, so it has its own channel port (PLANNING-003),
 * which `workspaces` implements over its SMTP transport. An email attempt is
 * written down as possibly effective before it is sent: a worker that dies
 * mid-send leaves an occurrence the next claim reconciles rather than sends
 * again.
 */

import type {
  ClaimedReminderOccurrence,
  DeliveryChannel,
  ProviderDeliveryResult,
  ProviderResultState,
} from "../domain/delivery_rules.ts";
import type { PlanningTransaction } from "./context.ts";

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

/** One reminder as an email carries it. */
export interface ReminderEmailItem {
  readonly body: string;
  /** Days ahead of `occursOn` this notice is sent; 0 or absent: on the day. */
  readonly leadDays?: number;
  /** The date the reminder is for. */
  readonly occursOn?: string;
  /** The reminder's person, whose workspace the email links to. */
  readonly personId?: string;
  /** The reminder's person by name, so the email says who it is about. */
  readonly personName?: string;
  readonly title: string;
}

/**
 * The outbound email channel.
 *
 * `send` delivers one email: a single reminder, or a member's digest when
 * `digestDate` is present. `reconcile` asks what became of an earlier attempt
 * that may already have been delivered; a channel that cannot tell answers
 * `ambiguous` and is never asked to send it again.
 */
export interface ReminderDeliveryChannel {
  send(message: {
    readonly digestDate?: string;
    readonly idempotencyKey: string;
    readonly items: readonly ReminderEmailItem[];
    readonly to: string;
  }): Promise<ProviderDeliveryResult>;
  reconcile(command: {
    readonly idempotencyKey: string;
  }): Promise<ProviderDeliveryResult>;
}

/**
 * Where an email attempt is recorded before it leaves the process.
 *
 * `markAttempted` is a compare-and-set: it records only the claims this
 * worker still holds — same claim token, still `claimed`, lease not yet
 * expired — marks them possibly effective, and renews their lease to
 * `leaseExpiresAt` so the send that follows keeps them. It answers with the
 * ids it recorded, and nothing else may be sent. For a digest it also derives
 * the digest's key from exactly those ids and stores it on each, so a later
 * reconciliation asks about the key that was really sent.
 *
 * `renewLeases` is the same compare-and-set without recording anything: it
 * extends the leases of claims still held, and answers with their ids, so the
 * rest of a batch outlives a slow send before its turn.
 */
export interface ReminderAttemptLedger {
  renewLeases(command: {
    readonly claims: readonly {
      readonly claimToken: string;
      readonly id: string;
    }[];
    readonly leaseExpiresAt: Date;
    readonly now: Date;
  }): Promise<readonly string[]>;
  markAttempted(command: {
    readonly claims: readonly {
      readonly claimToken: string;
      readonly id: string;
    }[];
    readonly digest?: {
      readonly localDate: string;
      readonly memberId: string;
    };
    readonly leaseExpiresAt: Date;
    readonly now: Date;
  }): Promise<{
    /** The digest's key, present for a digest with recorded claims. */
    readonly attemptKey?: string;
    readonly recordedIds: readonly string[];
  }>;
}

/** The durable record of what the in-app provider has already done. */
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
    /** The channels this worker can deliver; others stay unclaimed. */
    readonly channels?: readonly DeliveryChannel[];
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
    readonly providerResultState: ProviderResultState;
    readonly receipt?: string;
    readonly status: "failed" | "manual_attention" | "retry" | "sent";
    readonly transaction: PlanningTransaction;
  }): Promise<boolean>;
}
