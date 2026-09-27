/**
 * Gifts composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresGiftPersonMergeParticipant } from "./adapters/postgres/person_merge_participant.ts";
import { PostgresGiftAttachmentTarget } from "./adapters/postgres/gift_attachment_target.ts";
import { PostgresGiftRepository } from "./adapters/postgres/gift_repository.ts";
import { PostgresGiftWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import { createGiftManagement, giftAuditFrom } from "./public.ts";
import type { GiftAttachmentBoundary } from "../files/public.ts";
import type { WorkspaceCurrencyBoundary } from "../workspaces/public.ts";

/**
 * The gift a file may be attached to, as files sees it. Files wraps this into
 * the attachment boundary gifts then consumes, so a root builds it first and
 * hands the finished boundary back in `GiftPorts`.
 */
export function giftAttachmentTarget(): PostgresGiftAttachmentTarget {
  return new PostgresGiftAttachmentTarget();
}

export interface GiftPorts {
  readonly attachments: GiftAttachmentBoundary;
  readonly currencies: WorkspaceCurrencyBoundary;
}

export function composeGifts(shared: SharedComposition, ports: GiftPorts) {
  return {
    gifts: createGiftManagement({
      actors: shared.actors,
      attachments: ports.attachments,
      audit: giftAuditFrom(shared.audit),
      clock: shared.clock,
      currencies: ports.currencies,
      ids: { next: () => shared.ids.create() },
      repository: new PostgresGiftRepository(),
      transaction: shared.peopleTransaction,
    }),
    lifecycleImpact: PostgresGiftWorkspaceLifecycleImpact,
  };
}

/**
 * This module's rows in a person merge (gifts and debts, GAP-049). It depends on
 * nothing the module composes, so the root registers it before composing
 * people.
 */
export function giftPersonMergeParticipant(): PostgresGiftPersonMergeParticipant {
  return new PostgresGiftPersonMergeParticipant();
}
