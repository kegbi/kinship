/**
 * What a gift and a debt are, and how each one is allowed to move.
 *
 * Both are small records with a status, and the status is the whole of the
 * rule: an idea may become a plan, a plan may be given or received, and
 * anything may be archived, but nothing comes back out of `archived`, and a
 * debt that was settled or cancelled is finished. Those two tables are the
 * reason this file exists — they used to sit above a use case that was already
 * three hundred lines of orchestration, where nothing could reach them.
 *
 * The money rule is here for the same reason. An amount is text all the way to
 * the column so no float ever rounds it, and the ceiling below it says what a
 * workspace's debts can still be summed to without losing a cent. The kernel's
 * fifteen-digit limit is the tighter of the two today, so the ceiling never
 * fires; it is kept because it states the arithmetic this module relies on
 * rather than the one the column happens to enforce.
 */

import {
  boundedText,
  currencyCode as canonicalCurrency,
  instant,
  moneyAmount,
} from "../../../shared-kernel/validation.ts";

export type GiftStatus = "archived" | "given" | "idea" | "planned" | "received";
export type DebtStatus = "cancelled" | "open" | "settled";
export type DebtDirection = "i_owe" | "they_owe";

export interface GiftRecord {
  readonly amount?: string;
  readonly attachmentFileId?: string;
  readonly comment?: string;
  readonly createdAt: string;
  readonly currencyCode?: string;
  readonly eventAt?: string;
  readonly id: string;
  readonly name: string;
  readonly personId: string;
  readonly recipientPersonId?: string;
  readonly status: GiftStatus;
  readonly updatedAt: string;
  readonly url?: string;
}

export type StoredGift = GiftRecord;

export interface DebtRecord {
  readonly amount: string;
  readonly createdAt: string;
  readonly currencyCode?: string;
  readonly direction: DebtDirection;
  readonly id: string;
  /** The due date of the period a recurring rule charged this debt for. */
  readonly occurrenceOn?: string;
  readonly personId: string;
  readonly reason?: string;
  /** The recurring rule that charged this debt, while the rule exists. */
  readonly recurringDebtId?: string;
  readonly settledAt?: string;
  readonly status: DebtStatus;
  readonly updatedAt: string;
}

export type StoredDebt = DebtRecord;

export interface CreateGiftInput {
  readonly amount?: string;
  readonly attachmentFileId?: string;
  readonly comment?: string;
  readonly currencyCode?: string;
  readonly eventAt?: string;
  readonly name: string;
  readonly recipientPersonId?: string;
  readonly status: GiftStatus;
  readonly url?: string;
}

export interface CreateDebtInput {
  readonly amount: string;
  readonly currencyCode: string;
  readonly direction: DebtDirection;
  readonly reason?: string;
  readonly status: DebtStatus;
}

/** The canonical gift a write proceeds with, before it has an identifier. */
export interface GiftValues {
  readonly amount?: string;
  readonly comment?: string;
  readonly currencyCode?: string;
  readonly eventAt?: string;
  readonly name: string;
  readonly recipientPersonId?: string;
  readonly status: GiftStatus;
  readonly url?: string;
}

/** The canonical debt a write proceeds with. */
export interface DebtValues {
  readonly amount: string;
  readonly currencyCode: string;
  readonly direction: DebtDirection;
  readonly reason?: string;
  readonly status: DebtStatus;
}

/** Where a gift in each status may go next. */
const GIFT_TRANSITIONS: Readonly<Record<GiftStatus, ReadonlySet<GiftStatus>>> =
  {
    archived: new Set(),
    given: new Set(["archived"]),
    idea: new Set(["archived", "given", "planned", "received"]),
    planned: new Set(["archived", "given", "received"]),
    received: new Set(["archived"]),
  };

/** Where a debt in each status may go next. */
const DEBT_TRANSITIONS: Readonly<Record<DebtStatus, ReadonlySet<DebtStatus>>> =
  {
    cancelled: new Set(),
    open: new Set(["cancelled", "settled"]),
    settled: new Set(),
  };

/** Whether a gift may move from one status to another. */
export function canTransitionGift(from: GiftStatus, to: GiftStatus): boolean {
  return GIFT_TRANSITIONS[from].has(to);
}

/** Whether a debt may move from one status to another. */
export function canTransitionDebt(from: DebtStatus, to: DebtStatus): boolean {
  return DEBT_TRANSITIONS[from].has(to);
}

/**
 * An amount the money columns hold and a debt total can still sum.
 *
 * The kernel's `moneyAmount` decides what the column accepts; the ceiling here
 * is what keeps a workspace's running total exact in a double.
 */
export function money(value: string | undefined): string | undefined {
  const amount = moneyAmount(value);
  return amount !== undefined && Number(amount) <= 9_999_999_999_999_999
    ? amount
    : undefined;
}

/**
 * The gifts with each one's attachment named on it.
 *
 * The link rows come from the files module, which owns them, so joining the
 * two is a rule rather than a query: a gift with no link is handed back
 * untouched rather than gaining an empty field.
 */
export function hydrateGifts(
  gifts: readonly StoredGift[],
  links: readonly { readonly fileId: string; readonly giftId: string }[],
): readonly StoredGift[] {
  const byGift = new Map(links.map((link) => [link.giftId, link.fileId]));
  return gifts.map((gift) => {
    const attachmentFileId = byGift.get(gift.id);
    return attachmentFileId ? { ...gift, attachmentFileId } : gift;
  });
}

/**
 * The canonical gift, or nothing when the member has to fix something.
 *
 * An amount without a currency is the rule worth naming: a bare number is not
 * a price, so it is refused rather than stored as one. A comment or a link
 * that will not fit is dropped instead of refused, because neither is what the
 * member was recording.
 */
export function normalizeGift(input: CreateGiftInput): GiftValues | undefined {
  const name = boundedText(input.name, 500);
  const amount = money(input.amount);
  const currencyCode = canonicalCurrency(input.currencyCode);
  const eventAt = instant(input.eventAt);
  if (
    !name || (input.amount !== undefined && !amount) ||
    (input.currencyCode !== undefined && !currencyCode) ||
    (input.eventAt !== undefined && !eventAt) ||
    (amount !== undefined && currencyCode === undefined)
  ) return undefined;
  const comment = boundedText(input.comment, 10_000);
  const url = boundedText(input.url, 2_000);
  return {
    ...(amount ? { amount } : {}),
    ...(comment ? { comment } : {}),
    ...(currencyCode ? { currencyCode } : {}),
    ...(eventAt ? { eventAt } : {}),
    name,
    ...(input.recipientPersonId
      ? { recipientPersonId: input.recipientPersonId }
      : {}),
    status: input.status,
    ...(url ? { url } : {}),
  };
}

/**
 * The canonical debt, or nothing when the member has to fix something.
 *
 * A debt is always an amount of something, so unlike a gift it names its
 * currency or it is not a debt.
 */
export function normalizeDebt(input: CreateDebtInput): DebtValues | undefined {
  const amount = money(input.amount);
  const currencyCode = canonicalCurrency(input.currencyCode);
  if (!amount || !currencyCode) return undefined;
  const reason = boundedText(input.reason, 10_000);
  return {
    amount,
    currencyCode,
    direction: input.direction,
    ...(reason ? { reason } : {}),
    status: input.status,
  };
}
