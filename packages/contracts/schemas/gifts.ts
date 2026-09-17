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

export const debt = z.strictObject({
  amount: z.string().regex(/^\d{1,15}(?:\.\d{1,4})?$/),
  createdAt: z.iso.datetime({ offset: true }),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).optional(),
  direction: z.enum(["i_owe", "they_owe"]),
  id: z.uuid(),
  personId: z.uuid(),
  reason: z.string().max(10000).optional(),
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

export const giftDebtList = z.strictObject({
  debts: z.array(debt),
  gifts: z.array(gift),
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
