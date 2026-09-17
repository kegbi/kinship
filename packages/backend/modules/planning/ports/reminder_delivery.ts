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
 */

import type {
  ClaimedReminderOccurrence,
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
