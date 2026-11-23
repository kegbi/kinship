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
import { deterministicId } from "../../../shared-kernel/ids.ts";
import type {
  RequestTombstoneKind,
  RequestTombstones,
} from "../../../shared-kernel/request_tombstone.ts";
import { uuid } from "../../../shared-kernel/validation.ts";
import {
  hydrateGifts,
  sameRevision,
  type StoredGift,
} from "../domain/gift_rules.ts";
import type { GiftAudit } from "../ports/audit.ts";
import type {
  GiftActor,
  GiftTransaction,
  GiftTransactionRunner,
} from "../ports/context.ts";
import type { GiftRepository } from "../ports/gift_repository.ts";
import type { RecurringDebtRepository } from "../ports/recurring_debt_repository.ts";
import type { GiftAttachmentBoundary } from "../../files/public.ts";
import type {
  ActorRevalidation,
  WorkspaceCalendarBoundary,
  WorkspaceCurrencyBoundary,
} from "../../workspaces/public.ts";

export interface GiftManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly attachments: GiftAttachmentBoundary;
  readonly audit: GiftAudit;
  /** Each workspace's time zone, which decides the day a period is due. */
  readonly calendar: WorkspaceCalendarBoundary;
  readonly clock: Clock;
  readonly currencies: WorkspaceCurrencyBoundary;
  readonly ids: { next(): string };
  readonly recurringDebts: RecurringDebtRepository;
  readonly repository: GiftRepository;
  /** Governance's request tombstones, for a deleted keyed record (MCP-E3). */
  readonly tombstones: RequestTombstones;
  readonly transaction: GiftTransactionRunner;
}

/**
 * Every failure a gift or debt mutation reports. A rejected amount, currency,
 * or event time names no field, so this module's `validation-error` is the
 * bare one rather than the kernel's payload-carrying `ValidationFailure`.
 */
export type GiftMutationFailure = Failure<
  "archived-write-rejected" | "forbidden" | "not-found" | "unavailable",
  | "debt-values-locked"
  | "idempotency-conflict"
  | "invalid-transition"
  | "limit-reached"
  | "request-deleted"
  | "stale"
  | "validation-error"
>;

/** The revision a write was read at, when the client sent one (MCP-D3). */
export interface Revision {
  readonly expectedUpdatedAt?: string | undefined;
}

/**
 * Whether a supplied revision no longer names the record's current one. An
 * omitted revision is never stale, which is how every write behaved before a
 * client could send one.
 */
export function staleRevision(updatedAt: string, revision: Revision): boolean {
  return revision.expectedUpdatedAt !== undefined &&
    !sameRevision(updatedAt, revision.expectedUpdatedAt);
}

/**
 * The canonical retry key, nothing when none was sent, or `false` when the
 * one sent is not a request identifier.
 */
export function requestKey(
  value: string | undefined,
): string | false | undefined {
  if (value === undefined) return undefined;
  return uuid(value) ?? false;
}

/**
 * The identifier a create writes: derived from the retry key inside the
 * workspace, so every retry of one request names the same row, or fresh.
 */
export async function recordId(
  dependencies: Pick<GiftManagementDependencies, "ids">,
  namespace: string,
  actor: GiftActor,
  requestId: string | undefined,
): Promise<string> {
  return requestId
    ? await deterministicId(namespace, [actor.workspaceId, requestId])
    : dependencies.ids.next();
}

/** The request tombstone kind of each record this module deletes. */
export const TOMBSTONE_KIND: Readonly<
  Record<"debt" | "gift" | "recurring-debt", RequestTombstoneKind>
> = { debt: "debt", gift: "gift", "recurring-debt": "recurring_debt" };

/**
 * Why a retried create whose record is not under this person cannot proceed,
 * or nothing when it is the first attempt.
 *
 * A row with the derived id elsewhere in the workspace — under another
 * person, or moved by a merge — is the key reused for something else. No row
 * but a request tombstone under the id means the record was created and then
 * deleted (MCP-E3): rows here are deleted permanently, each delete leaves its
 * tombstone in the same transaction, and recreating the record would bring
 * back what a member removed. The rows are read before the tombstone, so a
 * delete that commits between the two reads is seen by the second.
 */
export async function unreplayable(
  dependencies: Pick<GiftManagementDependencies, "tombstones">,
  actor: GiftActor,
  id: string,
  exists: () => Promise<boolean>,
  transaction: GiftTransaction,
): Promise<
  Failure<never, "idempotency-conflict" | "request-deleted"> | undefined
> {
  if (await exists()) return { status: "idempotency-conflict" };
  return await dependencies.tombstones.recorded({
      recordId: id,
      transaction,
      workspaceId: actor.workspaceId,
    })
    ? { status: "request-deleted" }
    : undefined;
}

/** Leaves a permanently deleted record's request tombstone (MCP-E3). */
export async function leaveTombstone(
  dependencies: Pick<GiftManagementDependencies, "tombstones">,
  actor: GiftActor,
  recordType: "debt" | "gift" | "recurring-debt",
  id: string,
  deletedAt: Date,
  transaction: GiftTransaction,
): Promise<void> {
  await dependencies.tombstones.record({
    deletedAt,
    kind: TOMBSTONE_KIND[recordType],
    recordId: id,
    transaction,
    workspaceId: actor.workspaceId,
  });
}

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
