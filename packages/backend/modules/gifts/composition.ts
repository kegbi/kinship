import { PostgresGiftBusinessImportBoundary } from "./adapters/postgres/import_business_boundary.ts";
/**
 * Gifts composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresGiftPersonMergeParticipant } from "./adapters/postgres/person_merge_participant.ts";
import { PostgresGiftAttachmentTarget } from "./adapters/postgres/gift_attachment_target.ts";
import { PostgresGiftRepository } from "./adapters/postgres/gift_repository.ts";
import { PostgresRecurringDebtRepository } from "./adapters/postgres/recurring_debt_repository.ts";
import { PostgresGiftWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import {
  createGiftManagement,
  createRecurringDebtCharging,
  giftAuditFrom,
} from "./public.ts";
import type { GiftAttachmentBoundary } from "../files/public.ts";
import type {
  WorkspaceCalendarBoundary,
  WorkspaceCurrencyBoundary,
} from "../workspaces/public.ts";

/**
 * The gift a file may be attached to, as files sees it. Files wraps this into
 * the attachment boundary gifts then consumes, so a root builds it first and
 * hands the finished boundary back in `GiftPorts`.
 */
export function giftAttachmentTarget(): PostgresGiftAttachmentTarget {
  return new PostgresGiftAttachmentTarget();
}

export interface GiftPorts {
  readonly importPeople: ConstructorParameters<
    typeof PostgresGiftBusinessImportBoundary
  >[0];
  readonly attachments: GiftAttachmentBoundary;
  readonly calendar: WorkspaceCalendarBoundary;
  readonly currencies: WorkspaceCurrencyBoundary;
}

export function composeGifts(shared: SharedComposition, ports: GiftPorts) {
  return {
    businessImportBoundary: new PostgresGiftBusinessImportBoundary(
      ports.importPeople,
    ),
    gifts: createGiftManagement({
      actors: shared.actors,
      attachments: ports.attachments,
      audit: giftAuditFrom(shared.audit),
      calendar: ports.calendar,
      clock: shared.clock,
      currencies: ports.currencies,
      ids: { next: () => shared.ids.create() },
      recurringDebts: new PostgresRecurringDebtRepository(),
      repository: new PostgresGiftRepository(),
      transaction: shared.peopleTransaction,
    }),
    lifecycleImpact: PostgresGiftWorkspaceLifecycleImpact,
  };
}

/**
 * The worker's half of recurring debts: charging every rule that has fallen
 * due. It needs no attachment or currency boundary, so the worker root builds
 * it without composing the rest of the module.
 */
export function composeRecurringDebtCharging(
  shared: SharedComposition,
  ports: { readonly calendar: WorkspaceCalendarBoundary },
) {
  return createRecurringDebtCharging({
    audit: giftAuditFrom(shared.audit),
    calendar: ports.calendar,
    clock: shared.clock,
    ids: { next: () => shared.ids.create() },
    recurringDebts: new PostgresRecurringDebtRepository(),
    transaction: shared.peopleTransaction,
  });
}

/**
 * This module's rows in a person merge (gifts and debts, GAP-049). It depends on
 * nothing the module composes, so the root registers it before composing
 * people.
 */
export function giftPersonMergeParticipant(): PostgresGiftPersonMergeParticipant {
  return new PostgresGiftPersonMergeParticipant();
}
