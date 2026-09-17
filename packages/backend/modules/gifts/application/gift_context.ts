/**
 * What reading or writing a gift needs before it may proceed.
 *
 * Two things are shared by every path and were written out four times inside
 * one file. The first is the actor's standing, asked inside the caller's
 * transaction. The second is the attachment: the files module owns the link
 * between a gift and its file, so a gift that has just been written or moved
 * has to be asked about again before it can be handed back or audited, and a
 * boundary that refuses has to travel out of the transaction it refused
 * inside. `AttachmentFailure` is how it travels — a thrown failure unwinds the
 * transaction rather than committing a write whose attachment never landed.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { hydrateGifts, type StoredGift } from "../domain/gift_rules.ts";
import type { GiftAudit } from "../ports/audit.ts";
import type {
  GiftActor,
  GiftTransaction,
  GiftTransactionRunner,
} from "../ports/context.ts";
import type { GiftRepository } from "../ports/gift_repository.ts";
import type { GiftAttachmentBoundary } from "../../files/public.ts";
import type {
  ActorRevalidation,
  WorkspaceCurrencyBoundary,
} from "../../workspaces/public.ts";

export interface GiftManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly attachments: GiftAttachmentBoundary;
  readonly audit: GiftAudit;
  readonly clock: Clock;
  readonly currencies: WorkspaceCurrencyBoundary;
  readonly ids: { next(): string };
  readonly repository: GiftRepository;
  readonly transaction: GiftTransactionRunner;
}

/**
 * Every failure a gift or debt mutation reports. A rejected amount, currency,
 * or event time names no field, so this module's `validation-error` is the
 * bare one rather than the kernel's payload-carrying `ValidationFailure`.
 */
export type GiftMutationFailure = Failure<
  "archived-write-rejected" | "forbidden" | "not-found" | "unavailable",
  "invalid-transition" | "validation-error"
>;

/** The failure an attachment boundary reports, carried out of a transaction. */
type AttachmentFailureStatus = Failure<"forbidden" | "not-found">["status"];

export class AttachmentFailure extends Error {
  constructor(readonly status: AttachmentFailureStatus) {
    super(status);
  }
}

/**
 * The failure an unwound transaction reports, as a result the caller returns.
 *
 * Only an attachment refusal is a decision; anything else that reached here is
 * an infrastructure fault, which is the same `unavailable` a runner reports.
 */
export function mutationFailure(error: unknown): GiftMutationFailure {
  return error instanceof AttachmentFailure
    ? { status: error.status }
    : { status: "unavailable" };
}

/**
 * The actor's standing, asked first inside the caller's transaction. Write
 * paths lock the actor's rows; the list keeps its lock-free concurrency.
 */
export async function active(
  dependencies: Pick<GiftManagementDependencies, "actors">,
  actor: GiftActor,
  transaction: GiftTransaction,
  lock: boolean,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock,
    transaction,
  }) === "active";
}

/**
 * The gift as it will be handed back, with its attachment named on it.
 *
 * A boundary that refuses leaves the write unfinished rather than reporting a
 * gift with no attachment, so the refusal is thrown and the transaction it was
 * refused inside unwinds.
 */
export async function represent(
  dependencies: Pick<GiftManagementDependencies, "attachments">,
  actor: GiftActor,
  gift: StoredGift,
  transaction: GiftTransaction,
): Promise<StoredGift> {
  const links = await dependencies.attachments.listForGifts({
    ...actor,
    giftIds: [gift.id],
    transaction,
  });
  if (links.status !== "ready") throw new AttachmentFailure("forbidden");
  const [represented] = hydrateGifts([gift], links.links);
  if (!represented) throw new Error("Saved gift missing.");
  return represented;
}
