/**
 * Reading a vCard file (GAP-050): vCard 3.0 and 4.0, and the 2.1-era 3.0
 * exports older address books still write.
 *
 * The file is unfolded first (RFC 6350 §3.2: a line that begins with a space
 * or a tab continues the one before it), and a quoted-printable value's soft
 * line breaks are joined as well, because that is the one place a 2.1-style
 * export breaks a line without folding it. Each content line is then split
 * into its group, name, parameters, and value; the value is decoded by its
 * `ENCODING` and `CHARSET`, and unescaped by RFC 6350 §3.4.
 *
 * What a card says is mapped into `SourceContact`. Everything this importer
 * cannot keep — a photo, a vendor `X-` property, a date written as prose, a
 * URL that is not http(s) — is counted by property name in `skipped`, so the
 * dry run can list it: a property is never dropped without being named. A
 * blank value carries nothing and is not counted.
 *
 * A file that is not a sequence of well-formed cards is refused outright with
 * one sentence, as a malformed Monica export is. A card that is well formed
 * but names nobody is not a structural problem; the staging rules decide what
 * happens to it.
 */

import { parsePartialDateText } from "../../../../shared-kernel/partial_date.ts";
import {
  CONTACT_SOURCE_LIMITS,
  plainText,
  type SourceAddress,
  type SourceContact,
  type SourceDate,
  webAddress,
} from "./contact_source.ts";

/** Every card in the file, and what could not be kept, by property. */
export interface ParsedVCardSource {
  readonly cards: readonly SourceContact[];
  readonly skipped: Readonly<Record<string, number>>;
}

/** The properties a card is made of rather than what it says. */
const STRUCTURAL = new Set(["BEGIN", "END", "VERSION", "PRODID", "REV"]);
const VERSIONS = new Set(["2.1", "3.0", "4.0"]);
const BARE_ENCODINGS = new Set(["QUOTED-PRINTABLE", "BASE64", "8BIT", "7BIT"]);
const ENCODER = new TextEncoder();

interface ContentLine {
  readonly name: string;
  readonly parameters: ReadonlyMap<string, readonly string[]>;
  readonly value: string;
}

/** A content line's head (before its value) declares quoted-printable. */
const QUOTED_PRINTABLE =
  /(?:^|;)\s*(?:ENCODING\s*=\s*)?QUOTED-PRINTABLE\s*(?:;|$)/i;

/**
 * The physical lines, unfolded, with quoted-printable soft breaks joined.
 *
 * Each logical line is collected as pieces and joined once, and whether it
 * is quoted-printable is decided once, from its head, when it starts: a file
 * of a few hundred thousand soft breaks is then one pass, not one pass per
 * break. `work`, when given, counts the characters inspected and the pieces
 * kept, which is how the suite proves the pass is linear.
 */
export function logicalLines(
  text: string,
  work?: { steps: number },
): string[] {
  const lines: string[] = [];
  let pieces: string[] | undefined;
  let quotedPrintable = false;
  const flush = () => {
    if (pieces) lines.push(pieces.join(""));
    pieces = undefined;
  };
  for (const raw of text.split(/\r\n|\r|\n/)) {
    if (pieces && (raw.startsWith(" ") || raw.startsWith("\t"))) {
      pieces.push(raw.slice(1));
      if (work) work.steps++;
      continue;
    }
    const last = pieces?.at(-1);
    if (pieces && quotedPrintable && last?.endsWith("=")) {
      pieces[pieces.length - 1] = last.slice(0, -1);
      pieces.push(raw);
      if (work) work.steps++;
      continue;
    }
    flush();
    const colon = raw.indexOf(":");
    const head = colon < 0 ? raw : raw.slice(0, colon);
    if (work) work.steps += head.length + 1;
    quotedPrintable = QUOTED_PRINTABLE.test(head);
    pieces = [raw];
  }
  flush();
  return lines.filter((line) => line.trim() !== "");
}

/** The index of the first `:` outside a quoted parameter value. */
function valueStart(line: string, work?: { steps: number }): number {
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    if (work) work.steps++;
    const character = line[index];
    if (character === '"') quoted = !quoted;
    else if (character === ":" && !quoted) return index;
  }
  return -1;
}

/** `text` split on `separator` wherever it is not quoted. */
function unquotedSplit(
  text: string,
  separator: string,
  work?: { steps: number },
): string[] {
  const parts: string[] = [""];
  let quoted = false;
  for (const character of text) {
    if (work) work.steps++;
    if (character === '"') quoted = !quoted;
    if (character === separator && !quoted) parts.push("");
    else parts[parts.length - 1] += character;
  }
  return parts;
}

/**
 * The most parameters one content line may carry. Real exports use a
 * handful; a line with more is skipped and counted under its property name,
 * so the dry run names it, rather than read.
 */
export const MAX_PARAMETERS = 100;

/** A content line whose parameters are over `MAX_PARAMETERS`. */
interface OverParameterLine {
  readonly name: string;
  readonly overParameterLimit: true;
}

/**
 * One unfolded line split into its name, parameters, and value; `undefined`
 * when it is not a content line. `work`, when given, counts the characters
 * inspected and the parameter values kept, which is how the suite proves a
 * line of many parameters is read in linear work.
 */
export function contentLine(
  line: string,
  work?: { steps: number },
): ContentLine | OverParameterLine | undefined {
  const colon = valueStart(line, work);
  if (colon <= 0) return undefined;
  const [head = "", ...rawParameters] = unquotedSplit(
    line.slice(0, colon),
    ";",
    work,
  );
  const name = head.slice(head.lastIndexOf(".") + 1).trim().toUpperCase();
  if (!name) return undefined;
  if (rawParameters.length > MAX_PARAMETERS) {
    return { name, overParameterLimit: true };
  }
  const parameters = new Map<string, string[]>();
  for (const parameter of rawParameters) {
    const equals = parameter.indexOf("=");
    // A 2.1-style bare parameter, `TEL;HOME;VOICE:`, is a TYPE, except the
    // bare encodings, `NOTE;QUOTED-PRINTABLE:`, which are an ENCODING.
    const bare = parameter.trim().toUpperCase();
    const key = equals < 0
      ? BARE_ENCODINGS.has(bare) ? "ENCODING" : "TYPE"
      : parameter.slice(0, equals).trim().toUpperCase();
    let values = parameters.get(key);
    if (!values) parameters.set(key, values = []);
    // Appended in place: the list is never copied, however often its key
    // repeats on the line.
    for (
      const value of unquotedSplit(
        equals < 0 ? parameter : parameter.slice(equals + 1),
        ",",
        work,
      )
    ) {
      if (work) work.steps++;
      values.push(value.trim().replace(/^"|"$/g, ""));
    }
  }
  return { name, parameters, value: line.slice(colon + 1) };
}

/** A parameter's first value, upper-cased. */
function parameter(line: ContentLine, key: string): string | undefined {
  return line.parameters.get(key)?.[0]?.toUpperCase();
}

/**
 * The value's text, decoded by its encoding and charset, or `undefined` when
 * the declared charset is one this runtime cannot decode.
 */
function decoded(line: ContentLine): string | undefined {
  const charset = parameter(line, "CHARSET") ?? "UTF-8";
  if (parameter(line, "ENCODING") !== "QUOTED-PRINTABLE") return line.value;
  const bytes: number[] = [];
  const value = line.value;
  for (let index = 0; index < value.length;) {
    const hex = value.slice(index + 1, index + 3);
    if (value[index] === "=" && /^[0-9A-Fa-f]{2}$/.test(hex)) {
      bytes.push(Number.parseInt(hex, 16));
      index += 3;
      continue;
    }
    // A literal character is its UTF-8 bytes, a whole code point at a time,
    // so an emoji's surrogate pair is never split into two halves.
    const character = String.fromCodePoint(value.codePointAt(index)!);
    for (const byte of ENCODER.encode(character)) bytes.push(byte);
    index += character.length;
  }
  try {
    return new TextDecoder(charset, { fatal: true }).decode(
      new Uint8Array(bytes),
    ).replace(/\r\n/g, "\n");
  } catch {
    return undefined;
  }
}

/** `text` split on every unescaped `separator`, each part still escaped. */
function split(text: string, separator: "," | ";"): string[] {
  const parts: string[] = [""];
  for (let index = 0; index < text.length; index++) {
    const character = text[index]!;
    if (character === "\\" && index + 1 < text.length) {
      parts[parts.length - 1] += character + text[++index];
    } else if (character === separator) {
      parts.push("");
    } else {
      parts[parts.length - 1] += character;
    }
  }
  return parts;
}

/** RFC 6350 §3.4: `\\n` is a newline, and any other escape is its character. */
function unescaped(text: string): string {
  return text.replace(
    /\\(.)/gs,
    (_, next: string) => next === "n" || next === "N" ? "\n" : next,
  );
}

/** A structured value's components, each one's list values unescaped. */
function components(text: string, join: string): string[] {
  return split(text, ";").map((part) =>
    split(part, ",").map(unescaped).join(join)
  );
}

/** A mutable card, filled property by property. */
interface CardDraft {
  addresses: SourceAddress[];
  dates: SourceDate[];
  emails: string[];
  phones: string[];
  urls: string[];
  text: Partial<
    Record<
      | "familyName"
      | "fullName"
      | "givenName"
      | "jobTitle"
      | "middleName"
      | "nickname"
      | "note"
      | "organization"
      | "uid",
      string
    >
  >;
}

const DATE_KINDS: Readonly<Record<string, SourceDate["kind"]>> = {
  ANNIVERSARY: "anniversary",
  BDAY: "birthday",
  DEATHDATE: "deceased",
};

/**
 * Applies one property to the card; answers `false` when the property, or
 * its value, cannot be kept.
 */
function apply(card: CardDraft, line: ContentLine, raw: string): boolean {
  const single = (max?: number) => plainText(unescaped(raw), max);
  switch (line.name) {
    case "FN":
    case "NOTE":
    case "TITLE":
    case "UID": {
      const key = line.name === "FN"
        ? "fullName"
        : line.name === "NOTE"
        ? "note"
        : line.name === "TITLE"
        ? "jobTitle"
        : "uid";
      const value = single(
        key === "note" ? CONTACT_SOURCE_LIMITS.value : 1_000,
      );
      if (value && !card.text[key]) card.text[key] = value;
      return value !== undefined;
    }
    case "N": {
      const parts = components(raw, " ").slice(0, 3);
      const [family, given, middle] = parts.map((part) =>
        plainText(part, CONTACT_SOURCE_LIMITS.name)
      );
      if (family) card.text.familyName ??= family;
      if (given) card.text.givenName ??= given;
      if (middle) card.text.middleName ??= middle;
      // A part too long to keep is skipped, and the property says so.
      return parts.every((part, index) =>
        part.trim() === "" || [family, given, middle][index] !== undefined
      );
    }
    case "NICKNAME": {
      const nickname = split(raw, ",").map((part) =>
        plainText(unescaped(part), CONTACT_SOURCE_LIMITS.name)
      ).find(Boolean);
      if (nickname) card.text.nickname ??= nickname;
      return nickname !== undefined;
    }
    case "ORG": {
      const organization = plainText(unescaped(split(raw, ";")[0]!), 1_000);
      if (organization) card.text.organization ??= organization;
      return organization !== undefined;
    }
    case "EMAIL": {
      const email = single(320)?.replace(/^mailto:/i, "");
      if (email) card.emails.push(email);
      return email !== undefined;
    }
    case "TEL": {
      const phone = single(64)?.replace(/^tel:/i, "");
      if (phone) card.phones.push(phone);
      return phone !== undefined;
    }
    case "URL": {
      const url = webAddress(unescaped(raw));
      if (url) card.urls.push(url);
      return url !== undefined;
    }
    case "ADR": {
      const parts = components(raw, "\n");
      const [, , street, city, region, postalCode, country] = parts.map((
        part,
      ) => plainText(part, 1_000));
      const dropped = parts.slice(2, 7).some((part) =>
        part.trim() !== "" && plainText(part, 1_000) === undefined
      );
      const address: SourceAddress = {
        ...(city ? { city } : {}),
        ...(country ? { country } : {}),
        ...(postalCode ? { postalCode } : {}),
        ...(region ? { region } : {}),
        ...(street ? { street } : {}),
      };
      if (Object.keys(address).length > 0) card.addresses.push(address);
      return Object.keys(address).length > 0 && !dropped;
    }
    case "BDAY":
    case "ANNIVERSARY":
    case "DEATHDATE": {
      const parsedDate = parameter(line, "VALUE") === "TEXT"
        ? undefined
        : parsePartialDateText(unescaped(raw));
      // Apple writes a birthday without a year as that placeholder year.
      const omitted = parameter(line, "X-APPLE-OMIT-YEAR");
      const date = parsedDate?.precision === "full" && omitted !== undefined &&
          String(parsedDate.year) === omitted
        ? {
          day: parsedDate.day!,
          month: parsedDate.month!,
          precision: "month_day" as const,
        }
        : parsedDate;
      if (date) card.dates.push({ ...date, kind: DATE_KINDS[line.name]! });
      return date !== undefined;
    }
    default:
      return false;
  }
}

/** The finished card, with absent text left absent. */
function finished(card: CardDraft): SourceContact {
  return {
    addresses: card.addresses,
    dates: card.dates,
    emails: card.emails,
    phones: card.phones,
    urls: card.urls,
    ...Object.fromEntries(
      Object.entries(card.text).filter(([, value]) => value !== undefined),
    ),
  };
}

/**
 * Every card in `text`, or the sentence the member is shown instead.
 *
 * `text` is the file already checked to be UTF-8 (`sourceText`); a
 * byte-order mark is still dropped here so the parser can be handed a file
 * directly.
 */
export function parseVCardSource(text: string): ParsedVCardSource | string {
  const cards: SourceContact[] = [];
  const skipped: Record<string, number> = {};
  let card: CardDraft | undefined;
  let version: string | undefined;
  for (const raw of logicalLines(text.replace(/^\uFEFF/, ""))) {
    const line = contentLine(raw);
    const marker = raw.trim().toUpperCase();
    if (marker === "BEGIN:VCARD") {
      if (card) return "Nested vCards are not supported.";
      if (cards.length === CONTACT_SOURCE_LIMITS.contacts) {
        return `A vCard file may contain at most ${CONTACT_SOURCE_LIMITS.contacts} cards.`;
      }
      card = {
        addresses: [],
        dates: [],
        emails: [],
        phones: [],
        text: {},
        urls: [],
      };
      version = undefined;
      continue;
    }
    if (marker === "END:VCARD") {
      if (!card) return "END:VCARD appears without BEGIN:VCARD.";
      if (!version || !VERSIONS.has(version)) {
        return "Only vCard 2.1, 3.0, and 4.0 are supported.";
      }
      cards.push(finished(card));
      card = undefined;
      continue;
    }
    if (!card) {
      return cards.length === 0
        ? "The file contains no vCards."
        : "Text outside a vCard is not supported.";
    }
    if (!line) return "A vCard line has no value.";
    if ("overParameterLimit" in line) {
      skipped[line.name] = (skipped[line.name] ?? 0) + 1;
      continue;
    }
    if (line.name === "VERSION") {
      version = line.value.trim();
      continue;
    }
    if (STRUCTURAL.has(line.name)) continue;
    const value = decoded(line);
    if (value !== undefined && value.trim() === "") continue;
    if (value === undefined || !apply(card, line, value)) {
      skipped[line.name] = (skipped[line.name] ?? 0) + 1;
    }
  }
  if (card) return "A vCard is missing END:VCARD.";
  if (cards.length === 0) return "The file contains no vCards.";
  return { cards, skipped };
}
