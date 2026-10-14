/**
 * Gifts and debts: the shapes this surface accepts and answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/gifts` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";

const money = z.string().regex(/^\d{1,15}(?:\.\d{1,4})?$/);
const debtDirection = z.enum(["i_owe", "they_owe"]);
/** A day of the month a recurring debt falls due; a short month clamps it. */
const dayOfMonth = z.number().int().min(1).max(31);
/** Months between a recurring debt's charges: one month to ten years. */
const intervalMonths = z.number().int().min(1).max(120);

export const debt = z.strictObject({
  amount: money,
  createdAt: z.iso.datetime({ offset: true }),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  direction: debtDirection,
  id: z.uuid(),
  /** The due date of the period a recurring debt charged this debt for. */
  occurrenceOn: z.iso.date().optional(),
  personId: z.uuid(),
  reason: z.string().max(10000).optional(),
  /** The recurring debt that charged this debt, while it exists. */
  recurringDebtId: z.uuid().optional(),
  settledAt: z.iso.datetime({ offset: true }).optional(),
  status: z.enum(["open", "settled", "cancelled"]),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "Debt" });

export const debtCreateInput = z.strictObject({
  amount: z.string().regex(/^\d{1,15}(?:\.\d{1,4})?$/),
  currencyCode: z.string().regex(/^[A-Za-z]{3}$/),
  direction: z.enum(["i_owe", "they_owe"]),
  reason: z.string().trim().min(1).max(10000).optional(),
  status: z.enum(["open", "settled", "cancelled"]),
}).meta({ id: "DebtCreateInput" });

export const debtCreated = z.strictObject({
  debt: debt,
  status: z.literal("created"),
}).meta({ id: "DebtCreated" });

export const debtSaved = z.strictObject({
  debt: debt,
  status: z.enum(["saved", "unchanged"]),
}).meta({ id: "DebtSaved" });

export const debtDeleted = z.strictObject({
  debtId: z.uuid(),
  status: z.literal("deleted"),
}).meta({ id: "DebtDeleted" });

export const debtStatusInput = z.strictObject({
  status: z.enum(["open", "settled", "cancelled"]),
}).meta({ id: "DebtStatusInput" });

export const gift = z.strictObject({
  amount: z.string().regex(/^\d{1,15}(?:\.\d{1,4})?$/).optional(),
  attachmentFileId: z.uuid().optional(),
  comment: z.string().max(10000).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  eventAt: z.iso.datetime({ offset: true }).optional(),
  id: z.uuid(),
  name: z.string().min(1).max(500),
  personId: z.uuid(),
  recipientPersonId: z.uuid().optional(),
  status: z.enum(["idea", "planned", "given", "received", "archived"]),
  updatedAt: z.iso.datetime({ offset: true }),
  url: z.url().max(2000).optional(),
}).meta({ id: "Gift" });

export const giftCreateInput = z.strictObject({
  amount: z.string().regex(/^\d{1,15}(?:\.\d{1,4})?$/).optional(),
  attachmentFileId: z.uuid().optional(),
  comment: z.string().trim().min(1).max(10000).optional(),
  currencyCode: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  eventAt: z.iso.datetime({ offset: true }).optional(),
  name: z.string().trim().min(1).max(500),
  recipientPersonId: z.uuid().optional(),
  status: z.enum(["idea", "planned", "given", "received", "archived"]),
  url: z.url().max(2000).optional(),
}).meta({ id: "GiftCreateInput" });

export const giftCreated = z.strictObject({
  gift: gift,
  status: z.literal("created"),
}).meta({ id: "GiftCreated" });

/**
 * One person's gifts and debts.
 *
 * The two collections page independently inside one answer, which is what the
 * profile page needs: the gift section and the debt section are separate cards
 * that extend separately, and neither should have to refetch the other to grow.
 * Each therefore carries its own continuation, present only while that
 * collection has more rows.
 */
/**
 * A rule that charges the person the same debt every `intervalMonths` months
 * on `dayOfMonth`, from `startsOn` until the optional `endsOn`. Each due
 * period becomes its own open debt. `nextOccurrenceOn` is the next period not
 * yet charged, absent once the rule has ended; `active` is false while the
 * member has paused it.
 */
export const recurringDebt = z.strictObject({
  active: z.boolean(),
  amount: money,
  createdAt: z.iso.datetime({ offset: true }),
  currencyCode: z.string().regex(/^[A-Z]{3}$/),
  dayOfMonth,
  direction: debtDirection,
  endsOn: z.iso.date().optional(),
  id: z.uuid(),
  intervalMonths,
  nextOccurrenceOn: z.iso.date().optional(),
  personId: z.uuid(),
  reason: z.string().max(10000).optional(),
  startsOn: z.iso.date(),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "RecurringDebt" });

export const recurringDebtCreateInput = z.strictObject({
  amount: money,
  currencyCode: z.string().regex(/^[A-Za-z]{3}$/),
  dayOfMonth,
  direction: debtDirection,
  endsOn: z.iso.date().optional(),
  intervalMonths,
  reason: z.string().trim().min(1).max(10000).optional(),
  startsOn: z.iso.date(),
}).meta({ id: "RecurringDebtCreateInput" });

/**
 * A change to a recurring debt. A field left out keeps its value; `null`
 * clears the end date or the reason. `active: false` pauses the rule and
 * `active: true` resumes it from the first period on or after today.
 */
export const recurringDebtUpdateInput = z.strictObject({
  active: z.boolean().optional(),
  amount: money.optional(),
  currencyCode: z.string().regex(/^[A-Za-z]{3}$/).optional(),
  dayOfMonth: dayOfMonth.optional(),
  direction: debtDirection.optional(),
  endsOn: z.iso.date().nullable().optional(),
  intervalMonths: intervalMonths.optional(),
  reason: z.string().trim().min(1).max(10000).nullable().optional(),
  startsOn: z.iso.date().optional(),
}).refine((value) => Object.keys(value).length > 0).meta({
  id: "RecurringDebtUpdateInput",
  minProperties: 1,
});

/** A created or changed rule, and how many periods it charged at once. */
export const recurringDebtCreated = z.strictObject({
  charged: z.number().int().min(0),
  recurringDebt,
  status: z.literal("created"),
}).meta({ id: "RecurringDebtCreated" });

export const recurringDebtSaved = z.strictObject({
  charged: z.number().int().min(0),
  recurringDebt,
  status: z.literal("saved"),
}).meta({ id: "RecurringDebtSaved" });

export const recurringDebtDeleted = z.strictObject({
  recurringDebtId: z.uuid(),
  status: z.literal("deleted"),
}).meta({ id: "RecurringDebtDeleted" });

/**
 * `defaultCurrencyCode` is the currency a new debt or gift starts from: the
 * member's preferred currency, else the workspace default, else USD. The
 * person's recurring debts are few, so every page carries all of them.
 */
export const giftDebtList = z.strictObject({
  debts: z.array(debt).max(50),
  defaultCurrencyCode: z.string().regex(/^[A-Z]{3}$/),
  gifts: z.array(gift).max(50),
  nextDebtCursor: z.string().optional(),
  nextGiftCursor: z.string().optional(),
  recurringDebts: z.array(recurringDebt).max(50),
  status: z.literal("ready"),
  supportedCurrencyCodes: z.array(z.string().regex(/^[A-Z]{3}$/)),
}).meta({ id: "GiftDebtList" });

export const giftSaved = z.strictObject({
  gift: gift,
  status: z.enum(["saved", "unchanged"]),
}).meta({ id: "GiftSaved" });

export const giftStatusInput = z.strictObject({
  status: z.enum(["idea", "planned", "given", "received", "archived"]),
}).meta({ id: "GiftStatusInput" });
