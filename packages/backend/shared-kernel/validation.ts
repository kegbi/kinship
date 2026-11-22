/**
 * Input validators.
 *
 * Every function here is total and pure: it answers with the canonical value
 * or with `undefined`, and the calling use case decides which kernel failure
 * that becomes. They are deliberately not schema declarations — the kernel
 * carries no validation framework, so a module can keep these in its domain
 * and application layers without dragging a vendor in behind them.
 */

import type { Instant } from "./clock.ts";

/**
 * Every RFC 9562 version, 1 through 8, with the RFC variant: the versions
 * `z.uuid()` accepts at the API boundary. Version 8 is the one
 * `deterministicId` derives, so a check that stops at 5 refuses the records
 * a retry-safe create made (MCP-R3).
 */
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_TIME = /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/;
const CURRENCY_CODE = /^[A-Z]{3}$/;
/** At most fifteen whole digits and four decimals, as `numeric(19,4)` holds. */
const MONEY_AMOUNT = /^\d{1,15}(?:\.\d{1,4})?$/;
/** More fractional digits than a `timestamptz` column keeps. */
const OVERPRECISE_INSTANT = /\.(\d{7,})(?:Z|[+-]\d{2}:\d{2})$/i;
const INSTANT_FRACTION = /\.(\d{1,6})(?:Z|[+-]\d{2}:\d{2})$/i;

/** Trimmed text, or `undefined` when the caller supplied nothing usable. */
export function optionalText(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

/** Trimmed text within `maximum` characters, or `undefined`. */
export function boundedText(
  value: string | undefined,
  maximum: number,
): string | undefined {
  const normalized = optionalText(value);
  return normalized !== undefined && normalized.length <= maximum
    ? normalized
    : undefined;
}

/**
 * True when the text names a point in time. Use this to check a revision the
 * database issued, which must be compared exactly as it was received rather
 * than reformatted.
 */
export function isInstant(value: string | undefined): value is string {
  return value !== undefined && Number.isFinite(Date.parse(value));
}

/**
 * The canonical UTC rendering of an instant, with the six fractional digits
 * the schema stores, or `undefined` when the text is not a usable instant.
 * Text carrying more precision than the column keeps is refused rather than
 * silently truncated.
 */
export function instant(value: string | undefined): Instant | undefined {
  if (!isInstant(value)) return undefined;
  if (OVERPRECISE_INSTANT.test(value)) return undefined;
  const fraction = INSTANT_FRACTION.exec(value)?.[1] ?? "";
  const seconds = new Date(value).toISOString().slice(0, 19);
  return `${seconds}.${fraction.padEnd(6, "0")}Z`;
}

/**
 * True when the value is a UUID in any case, of any RFC 9562 version.
 *
 * This is the one definition of "a UUID" for backend code; nothing should
 * spell its own version range. The nil and max UUIDs are refused although
 * `z.uuid()` admits them: RFC 9562 reserves both as sentinels, no record is
 * ever stored under either, and a check here asks whether the text could name
 * a record. A request naming one therefore gets the same refusal it always
 * did.
 */
export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** The lower-case canonical form of a UUID ({@link isUuid}), or `undefined`. */
export function uuid(value: string | undefined): string | undefined {
  return isUuid(value) ? value.toLowerCase() : undefined;
}

/** A `YYYY-MM-DD` calendar date, or `undefined`. */
export function isoDate(value: string | undefined): string | undefined {
  return value !== undefined && ISO_DATE.test(value) ? value : undefined;
}

/** A wall-clock time as `HH:MM:SS`, filling in omitted seconds. */
export function isoTime(value: string | undefined): string | undefined {
  if (value === undefined || !ISO_TIME.test(value)) return undefined;
  return value.length === 5 ? `${value}:00` : value;
}

/** An upper-case ISO 4217 currency code, or `undefined`. */
export function currencyCode(value: string | undefined): string | undefined {
  const normalized = value?.trim().toUpperCase();
  return normalized && CURRENCY_CODE.test(normalized) ? normalized : undefined;
}

/**
 * A non-negative decimal amount the money columns can hold, kept as text so no
 * float ever rounds it.
 */
export function moneyAmount(value: string | undefined): string | undefined {
  return value !== undefined && MONEY_AMOUNT.test(value) ? value : undefined;
}
