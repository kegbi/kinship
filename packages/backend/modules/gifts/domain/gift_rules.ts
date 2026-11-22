/**
 * What a gift and a debt are, and how each one is allowed to move.
 *
 * Both are small records with a status, and the status is the whole of the
 * rule: an idea may become a plan, a plan may be given or received, and
 * anything may be archived, but nothing comes back out of `archived`, and a
 * settled debt may reopen, while a cancelled debt is finished. Those tables are the
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
  /**
   * The client's retry key (MCP-D3). A create retried with it returns the
   * record it already wrote instead of writing a second one.
   */
  readonly requestId?: string;
  readonly status: GiftStatus;
  readonly url?: string;
}

export interface CreateDebtInput {
  readonly settlementReason?: string;
  readonly settlementPhotoFileId?: string;
  readonly amount: string;
  readonly currencyCode: string;
  readonly direction: DebtDirection;
  readonly reason?: string;
  /** The client's retry key, as on a gift (MCP-D3). */
  readonly requestId?: string;
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
    settled: new Set(["open"]),
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

/*
 * Edits, retries, and revisions (MCP-D3).
 *
 * A retried create derives its record's identifier from the client's request
 * identifier, so the record it already wrote is found rather than written
 * again. Each record kind has its own namespace, so one request identifier
 * used for a gift and a debt names two different rows.
 */
export const GIFT_ID_NAMESPACE = "kinship.gifts.gift-id.v1";
export const DEBT_ID_NAMESPACE = "kinship.gifts.debt-id.v1";
export const RECURRING_DEBT_ID_NAMESPACE = "kinship.gifts.recurring-debt-id.v1";

/**
 * A change to a gift's values. A field left out keeps its value and `null`
 * clears an optional one; the name is never cleared. `amount` and
 * `currencyCode` are sent together or not at all, so a price never changes
 * its number without its currency being restated. Status keeps its own
 * operation and transition graph.
 */
export interface GiftChange {
  readonly amount?: string | null | undefined;
  readonly attachmentFileId?: string | null | undefined;
  readonly comment?: string | null | undefined;
  readonly currencyCode?: string | null | undefined;
  readonly eventAt?: string | null | undefined;
  readonly name?: string | undefined;
  readonly recipientPersonId?: string | null | undefined;
  readonly url?: string | null | undefined;
}

/** A change to a debt's values. `reason` alone may be cleared with `null`. */
export interface DebtChange {
  readonly amount?: string | undefined;
  readonly currencyCode?: string | undefined;
  readonly direction?: DebtDirection | undefined;
  readonly reason?: string | null | undefined;
}

/** The value a change names: kept when omitted, cleared by `null`. */
function changed<T>(
  next: T | null | undefined,
  current: T | undefined,
): T | undefined {
  return next === null ? undefined : next === undefined ? current : next;
}

/** Whether a change names nothing at all. */
function empty(change: object): boolean {
  return Object.values(change).every((value) => value === undefined);
}

/**
 * The gift a change leaves, with its attachment, or nothing when the member
 * has to fix something. Every value the create checks is checked again, and
 * a value the member sent that will not normalize is refused rather than
 * dropped, because an edit names exactly what it means to change.
 */
export function mergeGiftChange(
  current: StoredGift,
  change: GiftChange,
):
  | {
    readonly attachmentFileId: string | undefined;
    readonly values: GiftValues;
  }
  | undefined {
  if (
    empty(change) ||
    (change.amount === undefined) !== (change.currencyCode === undefined)
  ) return undefined;
  const name = change.name === undefined
    ? current.name
    : boundedText(change.name, 500);
  const comment = changed(change.comment, current.comment);
  const url = changed(change.url, current.url);
  const eventAt = change.eventAt === undefined
    ? current.eventAt
    : change.eventAt === null
    ? undefined
    : instant(change.eventAt);
  if (
    !name ||
    (typeof change.comment === "string" &&
      !boundedText(change.comment, 10_000)) ||
    (typeof change.url === "string" && !boundedText(change.url, 2_000)) ||
    (typeof change.eventAt === "string" && !eventAt)
  ) return undefined;
  const amount = changed(change.amount, current.amount);
  const currencyCode = changed(change.currencyCode, current.currencyCode);
  const recipientPersonId = changed(
    change.recipientPersonId,
    current.recipientPersonId,
  );
  const values = normalizeGift({
    ...(amount !== undefined ? { amount } : {}),
    ...(comment !== undefined ? { comment } : {}),
    ...(currencyCode !== undefined ? { currencyCode } : {}),
    name,
    ...(recipientPersonId !== undefined ? { recipientPersonId } : {}),
    status: current.status,
    ...(url !== undefined ? { url } : {}),
  });
  if (!values) return undefined;
  return {
    attachmentFileId: changed(
      change.attachmentFileId,
      current.attachmentFileId,
    ),
    // The stored event time is kept exactly as read, a new one canonical.
    values: {
      ...(values.amount !== undefined ? { amount: values.amount } : {}),
      ...(values.comment !== undefined ? { comment: values.comment } : {}),
      ...(values.currencyCode !== undefined
        ? { currencyCode: values.currencyCode }
        : {}),
      ...(eventAt !== undefined ? { eventAt } : {}),
      name: values.name,
      ...(values.recipientPersonId !== undefined
        ? { recipientPersonId: values.recipientPersonId }
        : {}),
      status: values.status,
      ...(values.url !== undefined ? { url: values.url } : {}),
    },
  };
}

/** The debt a change leaves, or nothing when the member has to fix something. */
export function mergeDebtChange(
  current: StoredDebt,
  change: DebtChange,
): DebtValues | undefined {
  if (
    empty(change) ||
    (typeof change.reason === "string" && !boundedText(change.reason, 10_000))
  ) return undefined;
  const reason = changed(change.reason, current.reason);
  return normalizeDebt({
    amount: change.amount ?? current.amount,
    currencyCode: change.currencyCode ?? current.currencyCode ?? "",
    direction: change.direction ?? current.direction,
    ...(reason !== undefined ? { reason } : {}),
    status: current.status,
  });
}

/**
 * Whether a debt's values may no longer move the way `next` moves them.
 *
 * Settlement history is append-only and records when, why, and with what
 * proof a debt was settled — never how much. Once a debt has been settled,
 * even if it was reopened since, its amount, currency, and direction are what
 * that history settled, so changing them would rewrite what was paid; they
 * may change only while the debt is open and has never been settled. The
 * reason describes the debt rather than the payment and stays editable. A
 * cancelled debt is finished, as its status graph already says, so nothing
 * on it changes.
 */
export function debtValuesLocked(
  current: StoredDebt,
  next: DebtValues,
  hasSettlementHistory: boolean,
): boolean {
  if (current.status === "cancelled") return true;
  const moneyChanged = !sameAmount(current.amount, next.amount) ||
    current.currencyCode !== next.currencyCode ||
    current.direction !== next.direction;
  return moneyChanged && (current.status !== "open" || hasSettlementHistory);
}

/** Whether two decimal strings name the same amount, however written. */
export function sameAmount(
  first: string | undefined,
  second: string | undefined,
): boolean {
  return canonicalAmount(first) === canonicalAmount(second);
}

function canonicalAmount(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const [whole = "", fraction = ""] = value.split(".");
  const integer = whole.replace(/^0+(?=\d)/, "");
  const decimals = fraction.replace(/0+$/, "");
  return decimals ? `${integer}.${decimals}` : integer;
}

/** Whether two instants are the same moment, however written. */
function sameInstant(
  first: string | undefined,
  second: string | undefined,
): boolean {
  if (first === undefined || second === undefined) return first === second;
  return Date.parse(first) === Date.parse(second);
}

/**
 * Whether `expected` is the revision `stored` carries. Both are read as the
 * instant they name, so a client that drops trailing zeros or writes an
 * offset still names the revision it read.
 */
export function sameRevision(stored: string, expected: string): boolean {
  const canonical = instant(expected);
  return canonical !== undefined && canonical === instant(stored);
}

/** Whether a stored gift is what a create with these values would write. */
export function giftMatchesCreate(
  stored: GiftRecord,
  values: GiftValues,
  attachmentFileId: string | undefined,
): boolean {
  return stored.name === values.name &&
    sameAmount(stored.amount, values.amount) &&
    stored.currencyCode === values.currencyCode &&
    sameInstant(stored.eventAt, values.eventAt) &&
    stored.comment === values.comment &&
    stored.url === values.url &&
    stored.recipientPersonId === values.recipientPersonId &&
    stored.status === values.status &&
    stored.attachmentFileId === attachmentFileId;
}

/** Whether a stored debt is what a create with these values would write. */
export function debtMatchesCreate(
  stored: DebtRecord,
  values: DebtValues,
): boolean {
  return sameAmount(stored.amount, values.amount) &&
    stored.currencyCode === values.currencyCode &&
    stored.direction === values.direction &&
    stored.reason === values.reason &&
    stored.status === values.status;
}
