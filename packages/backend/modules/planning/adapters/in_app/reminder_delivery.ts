/**
 * The provider this deployment delivers reminders through.
 *
 * In-app delivery has no external service to call: the effect is a durable row
 * the store writes under the occurrence's idempotency key, so delivering and
 * reconciling are the same two questions asked of storage. The class is the
 * thinnest possible adapter over that store, which is why it lives here rather
 * than beside the worker it serves.
 */

import type { ProviderDeliveryResult } from "../../domain/delivery_rules.ts";
import type {
  InAppReminderEffectStore,
  ReminderDeliveryProvider,
} from "../../ports/reminder_delivery.ts";

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
