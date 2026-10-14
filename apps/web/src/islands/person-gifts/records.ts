/**
 * What the gifts and debts island shows, as pure functions of its records.
 *
 * The rules are the ones `lib/person-gifts.ts` carried before the section
 * became an island (GAP-026): which lifecycle steps a record may take next,
 * how a row reads, what the state line and badge say, and how one answer from
 * the paged list folds into what the section already shows. The recurring
 * debts of GIFTS-001 add how a rule reads and what its editor sends.
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
  RecurringDebt,
  RecurringDebtUpdateInput,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  debtCreateInput,
  giftCreateInput,
  recurringDebtCreateInput,
} from "../../../../../packages/contracts/schemas/gifts.ts";
import { z } from "zod";

export type RecordType = "gift" | "debt";

/** The two collections one list answer carries, each with its own cursor. */
export interface GiftDebtRecords {
  readonly currencies: readonly string[];
  readonly debts: readonly Debt[];
  /** The currency a new debt, gift amount, or recurring debt starts from. */
  readonly defaultCurrency: string;
  readonly gifts: readonly Gift[];
  readonly nextDebtCursor?: string;
  readonly nextGiftCursor?: string;
  /** Every recurring debt the person has; each answer carries all of them. */
  readonly recurringDebts: readonly RecurringDebt[];
}

/** The currency a money form starts from before the list has answered. */
export const FALLBACK_CURRENCY = "USD";

export const EMPTY_RECORDS: GiftDebtRecords = {
  currencies: [],
  debts: [],
  defaultCurrency: FALLBACK_CURRENCY,
  gifts: [],
  recurringDebts: [],
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
  return current === "open"
    ? ["settled", "cancelled"]
    : current === "settled"
    ? ["open"]
    : [];
}

/**
 * Keep significant decimals without inventing places for whole amounts.
 * The database pads every amount to four places ("150.0000" reads "150").
 */
export function displayAmount(amount: string): string {
  const [whole = "0", fraction = ""] = amount.split(".");
  const significant = fraction.replace(/0+$/, "");
  return significant ? `${whole}.${significant}` : whole;
}

/**
 * The page's debts with each batch charged together (one creation instant)
 * shown newest occurrence first. Everything else keeps the page's order,
 * which its cursor depends on.
 */
export function chargeOrder<
  T extends { readonly createdAt: string; readonly occurrenceOn?: string },
>(debts: readonly T[]): T[] {
  const ordered: T[] = [];
  let run: T[] = [];
  const flush = () => {
    ordered.push(
      ...run.toSorted((left, right) =>
        (right.occurrenceOn ?? "").localeCompare(left.occurrenceOn ?? "")
      ),
    );
    run = [];
  };
  for (const debt of debts) {
    if (run.length > 0 && run[0]!.createdAt !== debt.createdAt) flush();
    run.push(debt);
  }
  flush();
  return ordered;
}

export function giftDetail(gift: Gift): string {
  return [
    gift.status,
    gift.amount
      ? `${displayAmount(gift.amount)} ${gift.currencyCode ?? ""}`.trim()
      : "Amount unknown",
    gift.recipientPersonId ? "Recipient selected" : "No recipient",
    gift.attachmentFileId ? "Attachment linked" : undefined,
  ].filter(Boolean).join(" · ");
}

export function debtTitle(debt: Debt): string {
  return debt.reason ?? "Debt";
}

export function debtDetail(debt: Debt): string {
  return `${debt.direction === "i_owe" ? "I owe" : "They owe"} · ${
    displayAmount(debt.amount)
  } ${debt.currencyCode ?? ""} · ${debt.status}${
    debt.occurrenceOn ? ` · Recurring, due ${debt.occurrenceOn}` : ""
  }`;
}

/**
 * The currency a money form starts with: the default the list named when the
 * workspace still supports it, else the first supported one.
 */
export function startingCurrency(
  defaultCurrency: string,
  currencies: readonly string[],
): string {
  return currencies.length === 0 || currencies.includes(defaultCurrency)
    ? defaultCurrency
    : currencies[0]!;
}

export function recurringDebtTitle(rule: RecurringDebt): string {
  return rule.reason ?? "Recurring debt";
}

/** How often a rule charges, as a person would say it. */
export function recurrenceText(rule: RecurringDebt): string {
  return rule.intervalMonths === 1
    ? `Monthly on day ${rule.dayOfMonth}`
    : `Every ${rule.intervalMonths} months on day ${rule.dayOfMonth}`;
}

export function recurringDebtDetail(rule: RecurringDebt): string {
  const state = !rule.active
    ? "Paused"
    : rule.nextOccurrenceOn
    ? `Next ${rule.nextOccurrenceOn}`
    : "Ended";
  return [
    rule.direction === "i_owe" ? "I owe" : "They owe",
    `${displayAmount(rule.amount)} ${rule.currencyCode}`,
    recurrenceText(rule),
    rule.endsOn ? `Until ${rule.endsOn}` : undefined,
    state,
  ].filter(Boolean).join(" · ");
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
    defaultCurrency: page.defaultCurrencyCode,
    gifts,
    ...(nextDebtCursor ? { nextDebtCursor } : {}),
    ...(nextGiftCursor ? { nextGiftCursor } : {}),
    recurringDebts: page.recurringDebts,
  };
}

/** Drops both cursors, which is what a failed load leaves behind. */
export function withoutCursors(records: GiftDebtRecords): GiftDebtRecords {
  return {
    currencies: records.currencies,
    debts: records.debts,
    defaultCurrency: records.defaultCurrency,
    gifts: records.gifts,
    recurringDebts: records.recurringDebts,
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

/**
 * The gift editor's values as the create request carries them. The currency
 * starts filled in, but it describes the amount, so a gift saved without an
 * amount is saved without a currency too.
 */
export function submittedGiftValues(values: unknown): unknown {
  const submitted = submittedValues(values);
  if (
    typeof submitted !== "object" || submitted === null ||
    "amount" in submitted
  ) return submitted;
  const { currencyCode: _currency, ...rest } = submitted as Record<
    string,
    unknown
  >;
  return rest;
}

/** Validates the gift editor with the create route's own contract schema. */
export const giftForm = z.preprocess(
  submittedGiftValues,
  giftCreateInput,
) as unknown as z.ZodType<z.output<typeof giftCreateInput>, GiftFormValues>;

/** Validates the debt editor with the create route's own contract schema. */
export const debtForm = z.preprocess(
  submittedValues,
  debtCreateInput,
) as unknown as z.ZodType<z.output<typeof debtCreateInput>, DebtFormValues>;

/** The recurring debt editor's values, as its fields hold them. */
export interface RecurringDebtFormValues {
  amount: string;
  currencyCode: string;
  dayOfMonth: string;
  direction: "i_owe" | "they_owe";
  endsOn: string;
  intervalMonths: string;
  reason: string;
  startsOn: string;
}

/**
 * The recurring debt editor's values as the create request carries them: a
 * blank field left out, and the two whole numbers read as numbers. A number
 * field that holds no whole number is passed through as text, so the contract
 * schema refuses it against its own field.
 */
export function submittedRecurringValues(values: unknown): unknown {
  const submitted = submittedValues(values);
  if (typeof submitted !== "object" || submitted === null) return submitted;
  return Object.fromEntries(
    Object.entries(submitted).map(([name, value]) =>
      (name === "dayOfMonth" || name === "intervalMonths") &&
        typeof value === "string" && /^\d+$/.test(value.trim())
        ? [name, Number(value)]
        : [name, value]
    ),
  );
}

/** Validates the recurring debt editor with the create route's schema. */
export const recurringDebtForm = z.preprocess(
  submittedRecurringValues,
  recurringDebtCreateInput,
) as unknown as z.ZodType<
  z.output<typeof recurringDebtCreateInput>,
  RecurringDebtFormValues
>;

/** The editor's starting values: a rule being edited, or a new one. */
export function recurringDebtFormValues(
  rule: RecurringDebt | undefined,
  currency: string,
  today: string,
): RecurringDebtFormValues {
  return rule
    ? {
      amount: rule.amount,
      currencyCode: rule.currencyCode,
      dayOfMonth: String(rule.dayOfMonth),
      direction: rule.direction,
      endsOn: rule.endsOn ?? "",
      intervalMonths: String(rule.intervalMonths),
      reason: rule.reason ?? "",
      startsOn: rule.startsOn,
    }
    : {
      amount: "",
      currencyCode: currency,
      dayOfMonth: String(Number(today.slice(8, 10))),
      direction: "they_owe",
      endsOn: "",
      intervalMonths: "1",
      reason: "",
      startsOn: today,
    };
}

/**
 * An edited rule as the change request carries it. Every field is sent, and a
 * cleared end date or reason is sent as `null`, which is how the route clears
 * it rather than keeping the old value.
 */
export function recurringDebtChange(
  input: z.output<typeof recurringDebtCreateInput>,
): RecurringDebtUpdateInput {
  return {
    amount: input.amount,
    currencyCode: input.currencyCode,
    dayOfMonth: input.dayOfMonth,
    direction: input.direction,
    endsOn: input.endsOn ?? null,
    intervalMonths: input.intervalMonths,
    reason: input.reason ?? null,
    startsOn: input.startsOn,
  };
}

/** Today's date in the browser's own calendar, as a date field holds it. */
export function localToday(now: Date = new Date()): string {
  return [
    String(now.getFullYear()).padStart(4, "0"),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}
