/**
 * Monica JSON envelopes and SQL data exports normalized into one source.
 *
 * Everything about that file format lives here — how large it may be, which
 * tables and which contact fields are understood, what a safe attachment path
 * is, and which columns are secrets that must never reach the staging rows.
 * Nothing in this file knows what a workspace or a transaction is: it turns
 * whatever bytes a member uploaded into a `ParsedMonicaSource`, or into the
 * one sentence the member is shown about why it could not be read.
 *
 * The directory is called `formats` because GAP-050 added vCard and CSV import
 * beside this file (`vcard_parse.ts`, `csv.ts`). Each is a sibling with the
 * same shape — limits, a vocabulary, and a `parse` that answers with a parsed
 * source or a sentence — and their staging rules live in
 * `domain/contact_import.ts`, beside the Monica rules in `import_rules.ts`.
 *
 * The largest attachment arrives as a limit rather than as an import: the size
 * a stored file may reach is the files module's rule, and a domain file has no
 * business reaching into another module to ask for it.
 */

import { optionalText } from "../../../../shared-kernel/validation.ts";
import { credentialName, type ImportedContact } from "../contact_import.ts";
import { monicaDetails } from "./monica_details.ts";
import { parseMonicaSql } from "./monica_sql.ts";
import { jsonObject } from "./canonical.ts";

/** What the profile refuses outright, before any contact is looked at. */
export const MONICA_SOURCE_LIMITS = {
  /** Contacts in one export. */
  contacts: 500,
  /** Entries in the attachment manifest. */
  attachments: 1_000,
  /** Legacy user rows, which are counted and then discarded. */
  legacyUsers: 100,
  /** Characters kept of a long free-text column. */
  text: 10_000,
} as const;

/**
 * The columns a Monica export carries that must never be staged.
 *
 * A raw snapshot is kept beside every staged contact so a member can see what
 * the importer read, and these are the five columns that would turn that
 * audit trail into a credential store.
 */
const SECRET_KEYS = new Set([
  "api_key",
  "password",
  "remember_token",
  "two_factor_recovery_codes",
  "two_factor_secret",
]);

/** The contact columns this profile understands; the rest are counted. */
const SUPPORTED_CONTACT_FIELDS = new Set([
  // The avatar columns `monica_column_mapping_v7.csv` maps into
  // `person_avatars` (GAP-045); the file itself arrives as an attachment.
  "avatar_adorable_url",
  "avatar_default_url",
  "avatar_external_url",
  "avatar_file_name",
  "avatar_gravatar_url",
  "avatar_source",
  "default_avatar_color",
  "gravatar_url",
  "avatar_photo_id",
  "account_id",
  "job",
  "company",
  "birthday_special_date_id",
  "deceased_special_date_id",
  "first_met_special_date_id",
  "deleted_at",
  "description",
  "first_name",
  "food_preferences",
  "id",
  "is_active",
  "is_dead",
  "is_partial",
  "is_starred",
  "last_name",
  "middle_name",
  "nickname",
  "uuid",
]);

/** An attachment the manifest declares. */
export interface MonicaAttachment {
  readonly byteSize: number;
  readonly path: string;
  readonly present: boolean;
}

/** A source that has been read but not yet judged contact by contact. */
export interface ParsedMonicaSource {
  /** Prior normalization, used only to match imports created before type support. */
  readonly legacySource?: ParsedMonicaSource;
  readonly attachments: ReadonlyMap<string, MonicaAttachment>;
  readonly contacts: readonly Record<string, unknown>[];
  readonly userCount: number;
  readonly sourceProfile?: "json_export" | "sql_export";
  readonly details?: ReadonlyMap<string, ImportedContact>;
  readonly notes?: ReadonlyMap<string, readonly string[]>;
  readonly unsupportedRows?: Readonly<Record<string, number>>;
  readonly unsupportedFields?: Readonly<Record<string, number>>;
  readonly orphans?: number;
  readonly unsupported: number;
}

/** The limits a caller supplies because another module owns them. */
export interface MonicaSourceLimits {
  readonly maxAttachmentBytes: number;
}

/** Trimmed text within `max` characters, or nothing. */
export function textValue(value: unknown, max = 500): string | undefined {
  return typeof value === "string" && value.length <= max
    ? optionalText(value)
    : undefined;
}

/**
 * The source's own primary key as text.
 *
 * Monica writes an integer and a hand-edited export may write the same value
 * as a string, so both are accepted and both land on the same key.
 */
export function sourceId(value: unknown): string | undefined {
  if (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  ) return String(value);
  return typeof value === "string" && value.trim().length > 0 &&
      value.length <= 100
    ? value.trim()
    : undefined;
}

/**
 * True when a column that may be absent is present and unusable.
 *
 * Absent is fine and blank is fine; the wrong type or too much text is what
 * makes the whole export unreadable rather than that one contact poorer.
 */
export function invalidOptionalText(
  source: Record<string, unknown>,
  key: string,
  max: number,
): boolean {
  const value = source[key];
  return value !== undefined && value !== null &&
    (typeof value !== "string" || value.length > max);
}

/** Monica writes its booleans as `1` and `0` as often as `true` and `false`. */
export function booleanValue(value: unknown): boolean {
  return value === true || value === 1;
}

/** True when an optional flag is one of the four spellings, or absent. */
export function validOptionalBoolean(value: unknown): boolean {
  return value === undefined || value === true || value === false ||
    value === 1 || value === 0;
}

/**
 * An attachment path that stays inside the export.
 *
 * Backslashes are folded to forward slashes first so a Windows-written export
 * is judged by the same rule, and then anything that could climb out of the
 * archive — an absolute path, a parent segment, a drive letter — is refused.
 */
export function safePath(value: unknown): string | undefined {
  const path = textValue(value, 500)?.replaceAll("\\", "/");
  if (
    !path || path.startsWith("/") || path.includes("../") ||
    path === ".." || /^[A-Za-z]:/.test(path)
  ) return undefined;
  return path;
}

/**
 * The snapshot kept beside a staged contact: scalars only, secrets dropped,
 * long text cut to the profile's limit.
 */
export function redacted(
  source: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) =>
      !SECRET_KEYS.has(key.toLowerCase()) && !credentialName(key) &&
      (value === null || ["boolean", "number", "string"].includes(typeof value))
    ).map(([key, value]) => [
      key,
      typeof value === "string" && value.length > MONICA_SOURCE_LIMITS.text
        ? value.slice(0, MONICA_SOURCE_LIMITS.text)
        : value,
    ]),
  );
}

/**
 * The source as this profile reads it, or the sentence the member is shown.
 *
 * Everything refused here is refused about the file as a whole: the profile
 * header, the table sizes, the attachment manifest, and the legacy user list.
 * What a single contact has to say for itself is `domain/import_rules.ts`,
 * because that judgement is the same whichever format the contact arrived in.
 */
export function parseMonicaSource(
  source: unknown,
  limits: MonicaSourceLimits,
): ParsedMonicaSource | string {
  let root = jsonObject(source);
  const sourceProfile = root?.format === "monica-sql"
    ? "sql_export"
    : "json_export";
  if (sourceProfile === "sql_export") {
    const sql = parseMonicaSql(root?.text);
    if (typeof sql === "string") return sql;
    root = { format: "monica-json", version: 1, tables: sql.tables };
  }
  if (!root || root.format !== "monica-json" || root.version !== 1) {
    return "Only the version 1 Monica JSON export profile is supported.";
  }
  const tables = jsonObject(root.tables);
  if (
    !tables || !Array.isArray(tables.contacts) ||
    tables.contacts.length > MONICA_SOURCE_LIMITS.contacts
  ) {
    return `The export must contain at most ${MONICA_SOURCE_LIMITS.contacts} contacts.`;
  }
  if (tables.contacts.some((contact) => !jsonObject(contact))) {
    return "Every contact must be an object.";
  }
  const rawAttachments = root.attachments ?? [];
  if (
    !Array.isArray(rawAttachments) ||
    rawAttachments.length > MONICA_SOURCE_LIMITS.attachments
  ) {
    return `The manifest must contain at most ${MONICA_SOURCE_LIMITS.attachments} attachments.`;
  }
  const attachments = new Map<string, MonicaAttachment>();
  for (const value of rawAttachments) {
    const attachment = jsonObject(value);
    const path = safePath(attachment?.path);
    const byteSize = attachment?.byteSize;
    if (
      !attachment || !path || !Number.isSafeInteger(byteSize) ||
      (byteSize as number) < 0 ||
      (byteSize as number) > limits.maxAttachmentBytes ||
      typeof attachment.present !== "boolean" ||
      attachments.has(path)
    ) return "The attachment manifest is invalid.";
    attachments.set(path, {
      byteSize: byteSize as number,
      path,
      present: attachment.present,
    });
  }
  const users = tables.users;
  if (
    users !== undefined &&
    (!Array.isArray(users) || users.length > MONICA_SOURCE_LIMITS.legacyUsers)
  ) {
    return "The legacy user list is invalid.";
  }
  const related = monicaDetails(tables, limits.maxAttachmentBytes);
  if (typeof related === "string") return related;
  // The prior normalizer shares the bounded table reader and all non-type
  // rules. Its projection is never persisted or exposed as the dry-run report.
  const legacyRelated = monicaDetails(tables, limits.maxAttachmentBytes, true);
  if (typeof legacyRelated === "string") return legacyRelated;
  const project = (
    related: Exclude<ReturnType<typeof monicaDetails>, string>,
  ): ParsedMonicaSource => {
    const unsupportedFields = { ...related.unsupportedFields };
    for (const contact of tables.contacts as Record<string, unknown>[]) {
      for (const key of Object.keys(contact)) {
        if (!SUPPORTED_CONTACT_FIELDS.has(key)) {
          const field = `contacts.${key}`;
          unsupportedFields[field] = (unsupportedFields[field] ?? 0) + 1;
        }
      }
    }
    const projectedAttachments = new Map(attachments);
    for (const [key, attachment] of related.attachments) {
      projectedAttachments.set(key, attachment);
    }

    return {
      attachments: projectedAttachments,
      contacts: related.contacts,
      details: related.details,
      notes: related.notes,
      orphans: related.orphans,
      sourceProfile,
      unsupportedRows: related.unsupportedRows,
      unsupportedFields,
      unsupported:
        Object.values(related.unsupportedRows).reduce((a, b) => a + b, 0) +
        Object.values(unsupportedFields).reduce((a, b) => a + b, 0),
      userCount: Array.isArray(users) ? users.length : 0,
    };
  };
  return { ...project(related), legacySource: project(legacyRelated) };
}
