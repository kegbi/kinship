/**
 * What a vCard or a CSV row says about one person, before it is staged.
 *
 * The two contact formats GAP-050 reads meet in this shape. A vCard parser
 * fills it from properties and a CSV mapping fills it from the columns the
 * member chose, and from here on neither format matters: the staging rules in
 * `domain/contact_import.ts` normalize it, fingerprint it, and decide whether
 * it is importable at all. Nothing here is interpreted — every value is kept
 * as the plain text the file carried, and a URL is text that is never
 * followed.
 */

import type { PartialDateComponents } from "../../../../shared-kernel/partial_date.ts";

/** The limits both contact formats refuse a file by, before staging. */
export const CONTACT_SOURCE_LIMITS = {
  /** Cards in one vCard file, or data rows in one CSV file. */
  contacts: 500,
  /** Columns one CSV header may declare. */
  columns: 100,
  /** Characters one value may carry before it is skipped. */
  value: 10_000,
  /** Characters of one name part, the people module's own limit. */
  name: 500,
} as const;

/** One postal address, component by component. */
export interface SourceAddress {
  readonly city?: string;
  readonly country?: string;
  readonly postalCode?: string;
  readonly region?: string;
  readonly street?: string;
}

/** One remembered date, with the vCard property it came from. */
export type SourceDate = PartialDateComponents & {
  readonly kind: "anniversary" | "birthday" | "deceased";
};

/** Everything one card or row says about a person. */
export interface SourceContact {
  readonly addresses: readonly SourceAddress[];
  readonly dates: readonly SourceDate[];
  readonly emails: readonly string[];
  readonly familyName?: string;
  readonly fullName?: string;
  readonly givenName?: string;
  readonly jobTitle?: string;
  readonly middleName?: string;
  readonly nickname?: string;
  readonly note?: string;
  readonly organization?: string;
  readonly phones: readonly string[];
  readonly uid?: string;
  readonly urls: readonly string[];
}

/**
 * The text of a file as a member uploaded it, or why it cannot be read.
 *
 * Both formats are UTF-8 only. A byte-order mark is dropped; a UTF-16 mark,
 * a NUL, or the replacement character a lenient decoder leaves behind means
 * the bytes were never UTF-8, and guessing another encoding would store
 * mojibake as somebody's name.
 */
export function sourceText(
  value: unknown,
): string | { readonly problem: string } {
  if (typeof value !== "string") {
    return { problem: "The file text is missing." };
  }
  if (
    value.startsWith("\uFFFE") || value.includes("\u0000") ||
    value.includes("\uFFFD")
  ) {
    return {
      problem: "The file is not UTF-8 encoded. Save it as UTF-8 and try again.",
    };
  }
  return value.startsWith("\uFEFF") ? value.slice(1) : value;
}

/**
 * Text as it is kept: C0 controls other than tab and newline removed and the
 * ends trimmed, or nothing when nothing is left or it is over the limit.
 */
export function plainText(
  value: string | undefined,
  max: number = CONTACT_SOURCE_LIMITS.value,
): string | undefined {
  // deno-lint-ignore no-control-regex
  const text = value?.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .trim();
  return text && text.length <= max ? text : undefined;
}

/** An absolute http(s) URL, as text, or nothing. It is never fetched. */
export function webAddress(value: string | undefined): string | undefined {
  const text = plainText(value, 2_048);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:"
      ? text
      : undefined;
  } catch {
    return undefined;
  }
}
