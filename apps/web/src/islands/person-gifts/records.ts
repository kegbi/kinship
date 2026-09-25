/**
 * What the gifts and debts island shows, as pure functions of its records.
 *
 * The rules are the ones `lib/person-gifts.ts` carried before the section
 * became an island (GAP-026): which lifecycle steps a record may take next,
 * how a row reads, what the state line and badge say, and how one answer from
 * the paged list folds into what the section already shows.
 */

import type {
  Debt,
  DebtStatus,
  Gift,
  GiftDebtList,
  GiftDebtPageInput,
  GiftStatus,
  PeopleDirectoryPerson,
  PersonFile,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  debtCreateInput,
  giftCreateInput,
} from "../../../../../packages/contracts/schemas/gifts.ts";
import { z } from "zod";

export type RecordType = "gift" | "debt";

/** The two collections one list answer carries, each with its own cursor. */
export interface GiftDebtRecords {
  readonly currencies: readonly string[];
  readonly debts: readonly Debt[];
  readonly gifts: readonly Gift[];
  readonly nextDebtCursor?: string;
  readonly nextGiftCursor?: string;
}

export const EMPTY_RECORDS: GiftDebtRecords = {
  currencies: [],
  debts: [],
  gifts: [],
};

/** The section, heading, and glyph each record type lives in. */
export const SURFACES = {
  debt: { id: "debts", plural: "debts", title: "Debts" },
  gift: { id: "gifts", plural: "gifts", title: "Gifts" },
} as const satisfies Record<
  RecordType,
  { readonly id: string; readonly plural: string; readonly title: string }
>;

/** The lifecycle steps a gift may still take. */
export function giftStatusOptions(current: GiftStatus): readonly GiftStatus[] {
  if (current === "idea") return ["planned", "given", "received", "archived"];
  if (current === "planned") return ["given", "received", "archived"];
  if (current === "given" || current === "received") return ["archived"];
  return [];
}

/** The lifecycle steps a debt may still take. */
export function debtStatusOptions(current: DebtStatus): readonly DebtStatus[] {
  return current === "open" ? ["settled", "cancelled"] : [];
}

export function giftDetail(gift: Gift): string {
  return [
    gift.status,
    gift.amount
      ? `${gift.amount} ${gift.currencyCode ?? ""}`.trim()
      : "Amount unknown",
    gift.recipientPersonId ? "Recipient selected" : "No recipient",
    gift.attachmentFileId ? "Attachment linked" : undefined,
  ].filter(Boolean).join(" · ");
}

export function debtTitle(debt: Debt): string {
  return debt.reason ?? "Debt";
}

export function debtDetail(debt: Debt): string {
  return `${
    debt.direction === "i_owe" ? "I owe" : "They owe"
  } · ${debt.amount} ${debt.currencyCode ?? ""} · ${debt.status}`;
}

/** The state line of a section that has loaded `count` records. */
export function countText(type: RecordType, count: number): string {
  return count === 0
    ? `No ${type}s saved.`
    : `${count} ${type}${count === 1 ? "" : "s"} saved.`;
}

/**
 * Folds one list answer into the records a section shows.
 *
 * Each half continues on its own. One answer always carries both, so
 * extending the gift card appends its page and leaves the debts, and the
 * debts' cursor, exactly as they were rather than replacing them with their
 * first page again. An answer to a plain refresh replaces both.
 */
export function foldPage(
  records: GiftDebtRecords,
  page: GiftDebtList,
  continued: GiftDebtPageInput,
): GiftDebtRecords {
  const gifts = continued.giftCursor
    ? [...records.gifts, ...page.gifts]
    : continued.debtCursor
    ? records.gifts
    : page.gifts;
  const debts = continued.debtCursor
    ? [...records.debts, ...page.debts]
    : continued.giftCursor
    ? records.debts
    : page.debts;
  const nextGiftCursor = continued.debtCursor
    ? records.nextGiftCursor
    : page.nextGiftCursor;
  const nextDebtCursor = continued.giftCursor
    ? records.nextDebtCursor
    : page.nextDebtCursor;
  return {
    currencies: page.supportedCurrencyCodes,
    debts,
    gifts,
    ...(nextDebtCursor ? { nextDebtCursor } : {}),
    ...(nextGiftCursor ? { nextGiftCursor } : {}),
  };
}

/** Drops both cursors, which is what a failed load leaves behind. */
export function withoutCursors(records: GiftDebtRecords): GiftDebtRecords {
  return {
    currencies: records.currencies,
    debts: records.debts,
    gifts: records.gifts,
  };
}

export function personName(person: PeopleDirectoryPerson): string {
  return [person.givenName, person.familyName].filter(Boolean).join(" ") ||
    person.nickname || "Unnamed person";
}

/** The choices the gift editor offers once its options have loaded. */
export interface EditorOptions {
  readonly files: readonly PersonFile[];
  readonly people: readonly PeopleDirectoryPerson[];
}

export function recipientChoices(
  options: EditorOptions,
): ReadonlyArray<{ readonly label: string; readonly value: string }> {
  return options.people.filter((person) => person.lifecycle === "active").map((
    person,
  ) => ({ label: personName(person), value: person.id }));
}

export function attachmentChoices(
  options: EditorOptions,
): ReadonlyArray<{ readonly label: string; readonly value: string }> {
  return options.files.filter((file) => file.status === "available").map((
    file,
  ) => ({ label: file.title, value: file.fileId }));
}

/**
 * The editor's raw values as the create request carries them: a blank field
 * is left out rather than sent empty, and a local event time becomes an
 * instant. Anything else reaches the contract schema unchanged, so the schema
 * alone decides what is valid.
 */
export function submittedValues(values: unknown): unknown {
  if (typeof values !== "object" || values === null) return values;
  const kept = Object.entries(values).filter(([, value]) =>
    String(value).trim() !== ""
  );
  return Object.fromEntries(kept.map(([name, value]) => {
    if (name !== "eventAt" || typeof value !== "string") return [name, value];
    const instant = new Date(value);
    return [
      name,
      Number.isNaN(instant.getTime()) ? value : instant.toISOString(),
    ];
  }));
}

/** The gift editor's values, as its fields hold them. */
export interface GiftFormValues {
  amount: string;
  attachmentFileId: string;
  comment: string;
  currencyCode: string;
  eventAt: string;
  name: string;
  recipientPersonId: string;
  status: "idea" | "planned" | "given" | "received";
  url: string;
}

/** The debt editor's values, as its fields hold them. */
export interface DebtFormValues {
  amount: string;
  currencyCode: string;
  direction: "i_owe" | "they_owe";
  reason: string;
  status: "open" | "settled" | "cancelled";
}

/** Validates the gift editor with the create route's own contract schema. */
export const giftForm = z.preprocess(
  submittedValues,
  giftCreateInput,
) as unknown as z.ZodType<z.output<typeof giftCreateInput>, GiftFormValues>;

/** Validates the debt editor with the create route's own contract schema. */
export const debtForm = z.preprocess(
  submittedValues,
  debtCreateInput,
) as unknown as z.ZodType<z.output<typeof debtCreateInput>, DebtFormValues>;
