/**
 * What a vCard or a CSV row becomes when it is imported (GAP-050).
 *
 * Both contact formats arrive here as `SourceContact`s and leave as staged
 * rows. Three rules decide the way, and none of them needs a database:
 *
 * - **A name.** A person must have a given name, so one is chosen from what
 *   the contact does say: the given name, else the formatted name, the
 *   nickname, the family name, an email address, or a phone number. A contact
 *   with no name and no email or phone names nobody and is skipped with a
 *   warning, never silently.
 * - **An identity.** A vCard with a `UID` is that UID; anything else is the
 *   fingerprint of what it says after normalization, so the same person
 *   written twice in one file is imported once and the second is reported as
 *   a duplicate. The identity is what a later import of the same file is
 *   matched by (`ports/import_repository.ts`), which is what keeps
 *   re-importing idempotent.
 * - **A report.** Everything that will not be kept — a property this importer
 *   cannot map, a contact method the workspace has no type for, a company
 *   with no job title, a card already imported — is counted and said in the
 *   dry run before anything is committed.
 *
 * The CSV column mapping is here too: it is the member's own statement of
 * which column means what, applied to a row to produce the same
 * `SourceContact` a vCard produces.
 */

import { parsePartialDateText } from "../../../shared-kernel/partial_date.ts";
import type { PartialDateComponents } from "../../../shared-kernel/partial_date.ts";
import { canonicalJson, sha256Hex } from "./formats/canonical.ts";
import {
  CONTACT_SOURCE_LIMITS,
  plainText,
  type SourceAddress,
  type SourceContact,
} from "./formats/contact_source.ts";
import type { ImportReport } from "./import_rules.ts";

/** The two contact formats, as `data_imports.source_system` names them. */
export type ContactSourceSystem = "csv" | "vcard";

/** The contact-method kinds an imported contact can carry. */
export type ContactMethodKind = "email" | "phone" | "url";

/** A person date as the people module's vocabulary names it. */
export type ImportedDate = PartialDateComponents & {
  readonly kind: "birthday" | "custom" | "deceased";
  readonly label?: string;
};

/** A contact normalized for staging, fingerprinting, and commit. */
export interface ImportedContact {
  readonly addresses: readonly SourceAddress[];
  readonly dates: readonly ImportedDate[];
  readonly emails: readonly string[];
  readonly familyName?: string;
  readonly givenName: string;
  readonly jobTitle?: string;
  readonly middleName?: string;
  readonly nickname?: string;
  readonly note?: string;
  readonly organization?: string;
  readonly phones: readonly string[];
  readonly urls: readonly string[];
}

/** One card or row as it is staged. */
export type StagedSourceContact =
  | {
    readonly contact: ImportedContact;
    readonly fingerprint: string;
    readonly row: number;
    readonly sourcePrimaryKey?: string;
    readonly status: "mapped";
    readonly targetPersonId: string;
  }
  | {
    readonly reason: "duplicate" | "no-name";
    readonly row: number;
    readonly status: "skipped";
  }
  | {
    /** The card the UID was first staged under, with its name and this one's. */
    readonly conflictsWith: {
      readonly givenName: string;
      readonly row: number;
    };
    readonly givenName: string;
    readonly reason: "conflict";
    readonly row: number;
    readonly sourcePrimaryKey: string;
    readonly status: "skipped";
  };

/** A workspace contact-method type, as the importer files values under it. */
export interface ContactTypeChoice {
  /** Chosen because its name says the kind while its own kind is custom. */
  readonly byName: boolean;
  readonly id: string;
  readonly name: string;
}

/** The type the workspace offers for each kind, where it has one. */
export type ContactTypeChoices = Readonly<
  Partial<Record<ContactMethodKind, ContactTypeChoice>>
>;

/** What every staged card and row together would lose, by cause. */
export interface ContactImportLosses {
  /** Contact methods whose kind the workspace has no active type for. */
  readonly missingTypes: Readonly<Partial<Record<ContactMethodKind, number>>>;
  /** The custom types used for a kind because of their names. */
  readonly namedTypes?: readonly {
    readonly kind: ContactMethodKind;
    readonly name: string;
  }[];
  /** Companies that arrived without a job title. */
  readonly organizationsWithoutTitle: number;
  /** Properties or fields that could not be read, by name. */
  readonly skipped: Readonly<Record<string, number>>;
}

/** How the staged rows relate to earlier imports into the workspace. */
export interface ContactImportHistory {
  /** Rows whose identity an earlier import holds with different content. */
  readonly conflicts: number;
  /**
   * Whether an earlier completed import of the same format read exactly this
   * file; then any row it does not match was edited or mapped differently.
   */
  readonly fileImportedBefore?: boolean;
  /** Rows an earlier import already brought in, unchanged. */
  readonly reused: number;
}

/** The most text a structured part of a contact keeps. */
const PART_MAX = 1_000;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/** A name part as it is kept. */
function namePart(value: string | undefined): string | undefined {
  return plainText(value, CONTACT_SOURCE_LIMITS.name);
}

/**
 * The contact, normalized, or `undefined` when it names nobody.
 *
 * Email addresses are compared case-insensitively everywhere, so they are
 * lower-cased; phones and URLs are kept as written. Repeated values are
 * kept once. An anniversary is a custom date, because the people module's
 * vocabulary has no anniversary kind.
 */
export function importedContact(
  source: SourceContact,
): ImportedContact | undefined {
  const emails = unique(
    source.emails.flatMap((email) =>
      plainText(email, 320)?.toLowerCase() ?? []
    ),
  );
  const phones = unique(
    source.phones.flatMap((phone) => plainText(phone, 64) ?? []),
  );
  const given = namePart(source.givenName);
  const family = namePart(source.familyName);
  const fallback = given ?? namePart(source.fullName) ??
    namePart(source.nickname) ?? family ?? emails[0] ?? phones[0];
  if (!fallback) return undefined;
  const familyName = given || fallback !== family ? family : undefined;
  const middleName = namePart(source.middleName);
  const nickname = namePart(source.nickname);
  const organization = plainText(source.organization, PART_MAX);
  const jobTitle = plainText(source.jobTitle, PART_MAX);
  const note = plainText(source.note);
  return {
    addresses: source.addresses.flatMap((address) => {
      const kept = Object.fromEntries(
        Object.entries(address).flatMap(([key, value]) => {
          const text = plainText(value as string | undefined, PART_MAX);
          return text ? [[key, text]] : [];
        }),
      ) as SourceAddress;
      return Object.keys(kept).length > 0 ? [kept] : [];
    }),
    dates: source.dates.filter((date, index) =>
      // A person has one birthday and one date of death.
      date.kind === "anniversary" ||
      source.dates.findIndex((other) => other.kind === date.kind) === index
    ).map(({ kind, ...date }) =>
      kind === "anniversary"
        ? { ...date, kind: "custom" as const, label: "Anniversary" }
        : { ...date, kind }
    ),
    emails,
    ...(familyName ? { familyName } : {}),
    givenName: fallback,
    ...(jobTitle ? { jobTitle } : {}),
    ...(middleName ? { middleName } : {}),
    ...(nickname && nickname !== fallback ? { nickname } : {}),
    ...(note ? { note } : {}),
    ...(organization ? { organization } : {}),
    phones,
    urls: unique(source.urls),
  };
}

/**
 * What a committed contact writes beside its person: each contact method
 * under the workspace's type for its kind (a kind without one was reported
 * in the dry run and is left out), an occupation when there is a title, and
 * the note, which the interactions module keeps.
 */
export function personDetails(
  contact: ImportedContact,
  types: ContactTypeChoices,
): {
  readonly details: {
    readonly addresses: readonly SourceAddress[];
    readonly contactMethods: readonly {
      readonly typeId: string;
      readonly value: string;
    }[];
    readonly dates: readonly ImportedDate[];
    readonly occupation?: {
      readonly organizationName?: string;
      readonly title: string;
    };
  };
  readonly note?: string;
} {
  const methods = (kind: ContactMethodKind, values: readonly string[]) =>
    types[kind]
      ? values.map((value) => ({ typeId: types[kind]!.id, value }))
      : [];
  return {
    details: {
      addresses: contact.addresses,
      contactMethods: [
        ...methods("email", contact.emails),
        ...methods("phone", contact.phones),
        ...methods("url", contact.urls),
      ],
      dates: contact.dates,
      ...(contact.jobTitle
        ? {
          occupation: {
            ...(contact.organization
              ? { organizationName: contact.organization }
              : {}),
            title: contact.jobTitle,
          },
        }
        : {}),
    },
    ...(contact.note ? { note: contact.note } : {}),
  };
}

/** The fingerprint of what a normalized contact says. */
export function contactFingerprint(contact: ImportedContact): Promise<string> {
  return sha256Hex(canonicalJson(contact));
}

/**
 * Every source contact as a staged row, in file order.
 *
 * `sources` carry the identity the format declares: a vCard `UID`, or
 * nothing, in which case the fingerprint is the identity. A second contact
 * with an identity already staged is a duplicate and is skipped, unless it
 * shares a UID but says something else: that is a conflict, reported with
 * both cards, and the first one is imported. Two cards with different UIDs
 * are two people even when they say the same thing.
 */
export async function stageSourceContacts(
  sources: readonly {
    readonly contact: SourceContact;
    readonly sourcePrimaryKey?: string;
  }[],
  nextId: () => string,
): Promise<StagedSourceContact[]> {
  const seen = new Map<
    string,
    {
      readonly fingerprint: string;
      readonly givenName: string;
      readonly row: number;
    }
  >();
  const staged: StagedSourceContact[] = [];
  for (const [index, source] of sources.entries()) {
    const row = index + 1;
    const contact = importedContact(source.contact);
    if (!contact) {
      staged.push({ reason: "no-name", row, status: "skipped" });
      continue;
    }
    const fingerprint = await contactFingerprint(contact);
    const identity = source.sourcePrimaryKey
      ? `key:${source.sourcePrimaryKey}`
      : `fingerprint:${fingerprint}`;
    const first = seen.get(identity);
    if (first && source.sourcePrimaryKey && first.fingerprint !== fingerprint) {
      staged.push({
        conflictsWith: { givenName: first.givenName, row: first.row },
        givenName: contact.givenName,
        reason: "conflict",
        row,
        sourcePrimaryKey: source.sourcePrimaryKey,
        status: "skipped",
      });
      continue;
    }
    if (first) {
      staged.push({ reason: "duplicate", row, status: "skipped" });
      continue;
    }
    seen.set(identity, { fingerprint, givenName: contact.givenName, row });
    staged.push({
      contact,
      fingerprint,
      row,
      ...(source.sourcePrimaryKey
        ? { sourcePrimaryKey: source.sourcePrimaryKey }
        : {}),
      status: "mapped",
      targetPersonId: nextId(),
    });
  }
  return staged;
}

/**
 * What the staged contacts would lose in this workspace: a contact method is
 * lost when the workspace has no active type of its kind, and a company when
 * it has no title to be an occupation with.
 */
export function contactLosses(
  staged: readonly StagedSourceContact[],
  types: ContactTypeChoices,
  skipped: Readonly<Record<string, number>>,
): ContactImportLosses {
  const missingTypes: Partial<Record<ContactMethodKind, number>> = {};
  const used = new Set<ContactMethodKind>();
  let organizationsWithoutTitle = 0;
  for (const row of staged) {
    if (row.status !== "mapped") continue;
    const kinds: readonly [ContactMethodKind, number][] = [
      ["email", row.contact.emails.length],
      ["phone", row.contact.phones.length],
      ["url", row.contact.urls.length],
    ];
    for (const [kind, count] of kinds) {
      if (count === 0) continue;
      if (types[kind]) used.add(kind);
      else missingTypes[kind] = (missingTypes[kind] ?? 0) + count;
    }
    if (row.contact.organization && !row.contact.jobTitle) {
      organizationsWithoutTitle++;
    }
  }
  const namedTypes = (["email", "phone", "url"] as const).flatMap((kind) =>
    used.has(kind) && types[kind]!.byName
      ? [{ kind, name: types[kind]!.name }]
      : []
  );
  return {
    missingTypes,
    ...(namedTypes.length > 0 ? { namedTypes } : {}),
    organizationsWithoutTitle,
    skipped,
  };
}

const KIND_NAMES: Readonly<Record<ContactMethodKind, string>> = {
  email: "email address",
  phone: "phone number",
  url: "website",
};

const KIND_PLURALS: Readonly<Record<ContactMethodKind, string>> = {
  email: "email addresses",
  phone: "phone numbers",
  url: "websites",
};

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The dry-run report for a contact import.
 *
 * The counts keep the Monica report's shape: `contacts` is what will be
 * imported and `unsupported` is every property or field that will not be.
 * Each diagnostic says one thing the member loses or keeps, and a count of
 * zero says nothing.
 */
export function contactImportReport(
  format: ContactSourceSystem,
  staged: readonly StagedSourceContact[],
  losses: ContactImportLosses,
  history: ContactImportHistory,
): ImportReport {
  const mapped = staged.filter((row) => row.status === "mapped").length;
  const noName =
    staged.filter((row) => row.status === "skipped" && row.reason === "no-name")
      .length;
  const duplicates =
    staged.filter((row) =>
      row.status === "skipped" && row.reason === "duplicate"
    ).length;
  // Entries sort by their `name,count` text, which orders them by name.
  const skippedEntries = Object.entries(losses.skipped).sort();
  const unsupported = skippedEntries.reduce((sum, [, count]) => sum + count, 0);
  const unit = format === "vcard" ? "card" : "row";
  const field = format === "vcard" ? "vCard propert" : "CSV value";
  const fieldNoun = (count: number) =>
    format === "vcard"
      ? `${count} ${field}${count === 1 ? "y" : "ies"}`
      : plural(count, field);
  const diagnostics: ImportReport["diagnostics"][number][] = [];
  if (unsupported > 0) {
    diagnostics.push({
      code: "skipped-properties",
      message: `${fieldNoun(unsupported)} will be skipped: ${
        skippedEntries.map(([name, count]) => `${name} (${count})`).join(", ")
      }.${losses.skipped.PHOTO ? " Photos are not imported." : ""}`,
      severity: "skipped",
    });
  }
  if (noName > 0) {
    diagnostics.push({
      code: "contact-without-name",
      message: `${
        plural(noName, unit)
      } with no name, email, or phone will be skipped.`,
      severity: "warning",
    });
  }
  if (duplicates > 0) {
    diagnostics.push({
      code: "duplicate-in-source",
      message: `${
        plural(duplicates, `duplicate ${unit}`)
      } in this file will be imported once.`,
      severity: "skipped",
    });
  }
  for (const row of staged) {
    if (row.status !== "skipped" || row.reason !== "conflict") continue;
    const first = row.conflictsWith;
    diagnostics.push({
      code: "identity-conflict-in-file",
      message:
        `Cards ${first.row} (${first.givenName}) and ${row.row} (${row.givenName}) share the UID ${row.sourcePrimaryKey} but differ; card ${first.row} is imported and card ${row.row} is skipped.`,
      severity: "warning",
    });
  }
  for (const kind of ["email", "phone", "url"] as const) {
    const count = losses.missingTypes[kind] ?? 0;
    if (count === 0) continue;
    diagnostics.push({
      code: "missing-contact-type",
      message: `${
        plural(count, KIND_NAMES[kind])
      } will be skipped because the workspace has no ${kind} contact type. Add an Email, Phone, or Website contact type in Personalization and set its kind.`,
      severity: "warning",
    });
  }
  const named = losses.namedTypes ?? [];
  if (named.length > 0) {
    const phrases = named.map((type, index) =>
      index === 0
        ? `${KIND_PLURALS[type.kind][0]!.toUpperCase()}${
          KIND_PLURALS[type.kind].slice(1)
        } will be filed under the custom type "${type.name}"`
        : `${KIND_PLURALS[type.kind]} under "${type.name}"`
    );
    const listed = phrases.length === 1
      ? phrases[0]
      : `${phrases.slice(0, -1).join(", ")}, and ${phrases.at(-1)}`;
    const one = named.length === 1;
    diagnostics.push({
      code: "contact-type-by-name",
      message: `${listed} because of ${one ? "its name" : "their names"}. Set ${
        one ? "its" : "their"
      } kind in Personalization to make this explicit.`,
      severity: "info",
    });
  }
  const titleless = losses.organizationsWithoutTitle;
  if (titleless > 0) {
    diagnostics.push({
      code: "organization-without-title",
      message: `${titleless} ${
        titleless === 1 ? "company" : "companies"
      } without a job title will be skipped.`,
      severity: "skipped",
    });
  }
  if (history.reused > 0) {
    diagnostics.push({
      code: "already-imported",
      message: `${history.reused} ${
        history.reused === 1 ? "contact was" : "contacts were"
      } imported before and will be reused.`,
      severity: "info",
    });
  }
  if (history.conflicts > 0) {
    const one = history.conflicts === 1;
    diagnostics.push({
      code: "identity-conflict",
      message: `${history.conflicts} ${
        one ? "contact shares" : "contacts share"
      } an identity with an earlier import but changed since; the existing ${
        one ? "person is" : "people are"
      } kept unchanged.`,
      severity: "warning",
    });
  }
  const unmatched = mapped - history.reused - history.conflicts;
  if (history.fileImportedBefore && unmatched > 0) {
    diagnostics.push({
      code: "file-imported-before",
      message: `This file was imported before, but ${plural(unmatched, unit)} ${
        unmatched === 1 ? "differs" : "differ"
      } from that import; edited rows or a changed mapping will create new people.`,
      severity: "warning",
    });
  }
  return {
    counts: {
      contacts: mapped,
      legacyCredentialsDiscarded: 0,
      missingFiles: 0,
      orphans: 0,
      unsupported,
    },
    diagnostics,
  };
}

const CREDENTIAL_WORDS = new Set([
  "otp",
  "passwd",
  "password",
  "pwd",
  "secret",
  "session",
  "token",
  "totp",
]);
const CREDENTIAL_JOINED = /password|passwd|apikey|privatekey/;

/**
 * Whether a CSV header or a vCard property name looks like it holds a
 * credential: a password, a secret, a token, an API or private key, a
 * one-time-password seed, or a session. Case and separators are ignored, and
 * camelCase is split, so `apiKey`, `API key`, and `X-API-KEY` all match.
 */
export function credentialName(name: string): boolean {
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word) => CREDENTIAL_WORDS.has(word)) ||
    CREDENTIAL_JOINED.test(words.join(""));
}

/** Every field a CSV column can be mapped to. */
export const CSV_TARGETS = [
  "ignore",
  "givenName",
  "familyName",
  "middleName",
  "nickname",
  "email",
  "phone",
  "street",
  "city",
  "region",
  "postalCode",
  "country",
  "birthday",
  "note",
  "company",
  "jobTitle",
] as const;

export type CsvTarget = typeof CSV_TARGETS[number];

/** How many rows a CSV preview shows the member before they map. */
export const CSV_PREVIEW_ROWS = 5;

/** The CSV header and first rows a member maps from. */
export interface CsvPreview {
  readonly delimiter: "," | ";";
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly rows: readonly (readonly string[])[];
  readonly suggested: readonly CsvTarget[];
}

/** What a column mapping is refused with. */
export function csvMappingProblem(
  headers: readonly string[],
  mapping: readonly string[],
): string | undefined {
  if (mapping.length !== headers.length) {
    return "Map every column, or choose Ignore for it.";
  }
  if (
    !mapping.every((target) =>
      (CSV_TARGETS as readonly string[]).includes(target)
    )
  ) return "A column is mapped to an unknown field.";
  if (
    !mapping.some((target) =>
      ["givenName", "familyName", "nickname", "email", "phone"].includes(target)
    )
  ) return "Map at least one column to a name, email, or phone.";
  return undefined;
}

const HEADER_GUESSES: readonly [RegExp, CsvTarget][] = [
  [/^(first|given|fore)[ _-]?name$|^first$/i, "givenName"],
  [/^(last|family|sur)[ _-]?name$|^surname$|^last$/i, "familyName"],
  [/^middle[ _-]?name$|^middle$/i, "middleName"],
  [/^nick[ _-]?name$/i, "nickname"],
  [/e-?mail/i, "email"],
  [/phone|mobile|^tel/i, "phone"],
  [/^(street|address)/i, "street"],
  [/^city$|^town$/i, "city"],
  [/^(state|region|province)$/i, "region"],
  [/^(zip|postal|post)[ _-]?(code)?$/i, "postalCode"],
  [/^country$/i, "country"],
  [/birth/i, "birthday"],
  [/^notes?$/i, "note"],
  [/^(company|organi[sz]ation|employer)$/i, "company"],
  [/^(job[ _-]?)?title$|^job$|^position$/i, "jobTitle"],
  [/^(full[ _-]?)?name$/i, "givenName"],
];

/** The mapping a header row suggests; the member confirms or changes it. */
export function suggestedCsvMapping(headers: readonly string[]): CsvTarget[] {
  const taken = new Set<CsvTarget>();
  return headers.map((header) => {
    const target = HEADER_GUESSES.find(([pattern]) =>
      pattern.test(header.trim())
    )?.[1];
    const repeatable = target === "email" || target === "phone";
    if (!target || (!repeatable && taken.has(target))) return "ignore";
    taken.add(target);
    return target;
  });
}

/** The longest value each mapped field keeps; a longer one is skipped. */
const VALUE_LIMITS: Partial<Record<CsvTarget, number>> = {
  email: 320,
  familyName: CONTACT_SOURCE_LIMITS.name,
  givenName: CONTACT_SOURCE_LIMITS.name,
  middleName: CONTACT_SOURCE_LIMITS.name,
  nickname: CONTACT_SOURCE_LIMITS.name,
  phone: 64,
};

/**
 * One CSV row as a source contact, by the member's mapping, with the values
 * that could not be read counted by header.
 *
 * Email and phone columns may repeat and each adds a value; for every other
 * field the first non-empty mapped column wins, except a note, where every
 * mapped column is kept, one paragraph each.
 */
export function mappedCsvContact(
  headers: readonly string[],
  row: readonly string[],
  mapping: readonly CsvTarget[],
): { readonly contact: SourceContact; readonly unreadable: string[] } {
  const first = new Map<CsvTarget, string>();
  const emails: string[] = [];
  const phones: string[] = [];
  const notes: string[] = [];
  const unreadable: string[] = [];
  let birthday: PartialDateComponents | undefined;
  for (const [column, target] of mapping.entries()) {
    const value = row[column]?.trim() ?? "";
    if (target === "ignore" || value === "") continue;
    const limit = VALUE_LIMITS[target];
    if (limit !== undefined && value.length > limit) {
      unreadable.push(headers[column] ?? `Column ${column + 1}`);
      continue;
    }
    if (target === "email") emails.push(value);
    else if (target === "phone") phones.push(value);
    else if (target === "note") notes.push(value);
    else if (target === "birthday") {
      const date = parsePartialDateText(value);
      if (date) birthday ??= date;
      else unreadable.push(headers[column] ?? `Column ${column + 1}`);
    } else if (!first.has(target)) first.set(target, value);
  }
  const address: SourceAddress = {
    ...(first.get("city") ? { city: first.get("city")! } : {}),
    ...(first.get("country") ? { country: first.get("country")! } : {}),
    ...(first.get("postalCode")
      ? { postalCode: first.get("postalCode")! }
      : {}),
    ...(first.get("region") ? { region: first.get("region")! } : {}),
    ...(first.get("street") ? { street: first.get("street")! } : {}),
  };
  const text = (target: CsvTarget) =>
    first.get(target) ? { [target]: first.get(target)! } : {};
  return {
    contact: {
      addresses: Object.keys(address).length > 0 ? [address] : [],
      dates: birthday ? [{ ...birthday, kind: "birthday" }] : [],
      emails,
      ...text("familyName"),
      ...text("givenName"),
      ...(first.get("jobTitle") ? { jobTitle: first.get("jobTitle")! } : {}),
      ...text("middleName"),
      ...text("nickname"),
      ...(notes.length > 0 ? { note: notes.join("\n\n") } : {}),
      ...(first.get("company") ? { organization: first.get("company")! } : {}),
      phones,
      urls: [],
    },
    unreadable,
  };
}
