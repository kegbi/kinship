import type { ImportedContactMethodType } from "./contact_import.ts";
import type { BusinessEntity } from "./business_entities.ts";
/**
 * What an import is, and what a source contact has to say for itself.
 *
 * An import happens twice. The first pass is a dry run: every contact in the
 * parsed source is turned into a staging row, the things that will be lost are
 * counted, and the whole source is fingerprinted. The second pass commits
 * those rows into people. The rules for both passes are here, because neither
 * of them needs a database to decide anything — the dry run decides what a
 * contact becomes, and the commit decides what a staged contact becomes once
 * the repository has said which rows survive.
 *
 * The source identifier rule is the one place this module keeps a pattern of
 * its own rather than calling the shared kernel's `uuid`. The kernel accepts
 * version 8 because `deterministicId` derives it; a Monica export never
 * contains one, and accepting it here would let a crafted export claim an
 * identifier the backend itself derives.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { CsvPreview, ImportedContact } from "./contact_import.ts";
import { canonicalJson, sha256Hex } from "./formats/canonical.ts";
import {
  booleanValue,
  invalidOptionalText,
  MONICA_SOURCE_LIMITS,
  type MonicaAttachment,
  type ParsedMonicaSource,
  redacted,
  safePath,
  sourceId,
  textValue,
  validOptionalBoolean,
} from "./formats/monica_source.ts";

/** A source identifier, refusing the version the backend derives itself. */
const SOURCE_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** What a dry run counts, and what it tells the member about each count. */
export interface ImportReport {
  readonly monicaChoices?: import("./monica_choices.ts").MonicaChoiceReport;
  readonly contactMethodTypes?: {
    readonly proposals:
      readonly (import("./contact_type_mapping.ts").SourceContactType & {
        readonly canCreate: boolean;
      })[];
    readonly existingTypes: readonly {
      readonly id: string;
      readonly name: string;
      readonly kind: string;
    }[];
  };
  readonly counts: {
    readonly contacts: number;
    readonly legacyCredentialsDiscarded: number;
    readonly missingFiles: number;
    readonly orphans: number;
    readonly unsupported: number;
  };
  readonly diagnostics: readonly {
    readonly code: string;
    readonly message: string;
    readonly severity: "info" | "skipped" | "warning";
  }[];
}

/** The counts a dry run arrives at, before they are explained. */
export type ImportCounts = ImportReport["counts"];

/**
 * What a contact's Monica avatar columns become in `person_avatars` (GAP-045),
 * as `monica_column_mapping_v7.csv` maps them: `default_avatar_color` is the
 * background colour, and `avatar_source` with its provider URL is the source
 * and `external_url`. A file avatar is the separate attachment.
 */
export interface ImportedAvatarPresentation {
  readonly backgroundColor?: string;
  readonly externalUrl?: string;
  readonly source?: "default" | "external" | "gravatar";
}

/** One contact as it is staged, before anything is written to people. */
export interface StagedContact {
  readonly contact?: ImportedContact;
  readonly notes?: readonly string[];
  readonly avatarPresentation?: ImportedAvatarPresentation;
  readonly avatar?: {
    readonly byteSize: number;
    readonly fileId: string;
    readonly originalFilename: string;
    readonly present: boolean;
  };
  readonly familyName?: string;
  readonly description?: string;
  readonly foodPreferences?: string;
  readonly givenName: string;
  readonly archived: boolean;
  readonly deletedAt?: string;
  readonly isDeceased: boolean;
  readonly isPartial: boolean;
  readonly isStarred: boolean;
  readonly nickname?: string;
  readonly middleName?: string;
  readonly rawSnapshot: Readonly<Record<string, unknown>>;
  readonly sourcePrimaryKey: string;
  readonly sourceUuid?: string;
  readonly targetPersonId: string;
}

/** A staged contact the repository has handed back to be committed. */
export interface PreparedImportContact {
  readonly repairBefore?: string;
  readonly legacyNotes?: readonly string[];
  readonly legacyStartedAt?: string;
  readonly legacyCompletedAt?: string;
  readonly notes?: readonly string[];
  readonly archived: boolean;
  /**
   * What an imported contact carries beyond the person: contact methods,
   * addresses, dates, work, and an optional portable-format note. Monica
   * notes remain separate bodies in `notes`.
   */
  readonly contact?: ImportedContact;
  /** The staging row, which a reused contact is retargeted by. */
  readonly entityId: string;
  readonly avatarPresentation?: ImportedAvatarPresentation;
  readonly deletedAt?: string;
  readonly description?: string;
  readonly familyName?: string;
  readonly foodPreferences?: string;
  readonly givenName: string;
  readonly isDeceased: boolean;
  readonly isPartial: boolean;
  readonly isStarred: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
  readonly previousTargetPersonId?: string;
  readonly sourcePrimaryKey: string;
  readonly targetPersonId: string;
}

/** An avatar the commit has to represent, whether or not its bytes arrived. */
export interface PreparedImportAvatar {
  readonly byteSize: number;
  readonly fileId: string;
  readonly originalFilename: string;
  readonly personSourcePrimaryKey: string;
}

/** What the repository answers when a commit is prepared. */
export type PreparedImportCommit =
  | {
    readonly contactTypeCatalog?: readonly ImportedContactMethodType[];
    readonly businessEntities?: readonly BusinessEntity[];
    readonly avatars: readonly PreparedImportAvatar[];
    readonly contacts: readonly PreparedImportContact[];
    readonly importId: string;
    readonly status: "ready";
  }
  | ImportCommitCounts & {
    readonly importId: string;
    readonly status: "completed";
  }
  | Failure<"not-found", "monica-choices-changed">;

/**
 * Whether this role may import, or read what an import did.
 *
 * Only an owner or an administrator may. An import writes people into a
 * workspace that already has some and an import run is an administrative
 * record, so both halves are the same rule and it is written once. Every
 * import path asks it first, before the source is even looked at, so an
 * unauthorised caller learns nothing about what a file contained or whether a
 * run exists. Two of the four paths asked it in the route file until GAP-020.
 */
export function mayImport(role: ImportRole): boolean {
  return role !== "member";
}

/** The workspace roles an import path distinguishes. */
export type ImportRole = "admin" | "member" | "owner";

/** The source systems an import run reads (`data_imports.source_system`). */
export type ImportSourceSystem = "csv" | "monica" | "vcard";

/** One import run, as a member sees it listed. */
export interface ImportSummary {
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly importId: string;
  /** A CSV run awaiting its column mapping carries what the member maps. */
  readonly preview?: CsvPreview;
  readonly report: ImportReport;
  readonly sourceProfile: "csv" | "json_export" | "sql_export" | "vcf";
  readonly sourceSystem: ImportSourceSystem;
  readonly status: "completed" | "dry_run" | "failed" | "pending";
}

/** What listing import runs answers with. */
export type ImportListResult =
  | {
    readonly imports: readonly ImportSummary[];
    readonly status: "ready";
  }
  | Failure<"forbidden">;

/** What reading one import run answers with. */
export type ImportReadResult =
  | {
    readonly import: ImportSummary;
    readonly status: "ready";
  }
  | Failure<"forbidden" | "not-found">;

/**
 * What a commit did with each staged contact. A contact an earlier import
 * made a person of is reused while that person is active, archived included,
 * and skipped while a member has deleted them (REL-065): a deleted person
 * stays deleted and nothing from the source row is written onto them.
 */
export interface ImportCommitCounts {
  readonly peopleCreated: number;
  readonly peopleReused: number;
  readonly peopleSkippedDeleted: number;
}

/** How a commit ends. */
export type ImportCommitResult =
  | ImportCommitCounts & {
    readonly importId: string;
    readonly status: "completed";
  }
  | Failure<
    "forbidden" | "not-found",
    | "confirmation-required"
    | "contact-type-decision-required"
    | "monica-choice-required"
    | "monica-choices-changed"
  >;

/** The person a committed contact becomes. */
export interface ImportedPersonValues {
  readonly archived: boolean;
  readonly avatar?: ImportedAvatarPresentation;
  readonly deletedAt?: Date;
  readonly description?: string;
  readonly familyName?: string;
  readonly foodPreferences?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isDeceased: boolean;
  readonly isPartial: boolean;
  readonly isStarred: boolean;
  readonly middleName?: string;
  readonly nickname?: string;
}

/** What a dry run produced, or the sentence the member is shown instead. */
export type StagedSource =
  | {
    readonly contacts: readonly StagedContact[];
    readonly missingFiles: number;
  }
  | string;

/**
 * Every contact in the parsed source as a staging row.
 *
 * One unusable contact makes the whole source unusable rather than being
 * skipped: a partial import is worse than none, because the member cannot see
 * from the report which of their people were left behind. Identity is what is
 * checked hardest — the source key and the source UUID must each be present at
 * most once, or two staging rows would race for the same person on commit.
 *
 * Identifiers are drawn from the caller rather than generated here so the rule
 * stays reproducible: the suite hands it a counter and reads the result back.
 */
const AVATAR_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** A provider URL worth keeping: an absolute http(s) URL of sane length. */
function providerUrl(value: unknown): string | undefined {
  const text = textValue(value, 2048);
  if (!text) return undefined;
  try {
    const url = new URL(text);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** The provider URL each Monica `avatar_source` is read from. */
function providerFor(
  contact: Readonly<Record<string, unknown>>,
): Pick<ImportedAvatarPresentation, "externalUrl" | "source"> {
  const source = textValue(contact.avatar_source, 32)?.toLowerCase();
  const url = source === "gravatar"
    ? providerUrl(contact.avatar_gravatar_url) ??
      providerUrl(contact.gravatar_url)
    : source === "adorable"
    ? providerUrl(contact.avatar_adorable_url)
    : source === "external"
    ? providerUrl(contact.avatar_external_url)
    : source === "default"
    ? providerUrl(contact.avatar_default_url)
    : undefined;
  if (!url) return {};
  return {
    externalUrl: url,
    source: source === "gravatar"
      ? "gravatar"
      : source === "default"
      ? "default"
      : "external",
  };
}

/**
 * What a contact's avatar columns say, or nothing when they say nothing
 * usable. An unsafe URL or a value that is not a colour is dropped rather
 * than stored, so nothing the importer keeps can be drawn as something else.
 */
export function importedAvatarPresentation(
  contact: Readonly<Record<string, unknown>>,
): ImportedAvatarPresentation | undefined {
  const color = textValue(contact.default_avatar_color, 7);
  const digits = color && AVATAR_COLOR.test(color)
    ? color.slice(1).toLowerCase()
    : undefined;
  const presentation: ImportedAvatarPresentation = {
    ...(digits
      ? {
        backgroundColor: `#${
          digits.length === 3
            ? [...digits].map((digit) => digit + digit).join("")
            : digits
        }`,
      }
      : {}),
    ...providerFor(contact),
  };
  return Object.keys(presentation).length > 0 ? presentation : undefined;
}

export function stageContacts(
  parsed: ParsedMonicaSource,
  nextId: () => string,
): StagedSource {
  const contacts: StagedContact[] = [];
  let missingFiles = 0;
  const uniqueIds = new Set<string>();
  const uniqueUuids = new Set<string>();
  for (const contact of parsed.contacts) {
    const sourcePrimaryKey = sourceId(contact.id);
    const givenName = textValue(contact.first_name);
    const sourceUuid = (contact.uuid === null || contact.uuid === undefined)
      ? undefined
      : textValue(contact.uuid, 36)?.toLowerCase();
    const deletedAt = contact.deleted_at;
    if (
      !sourcePrimaryKey || uniqueIds.has(sourcePrimaryKey) || !givenName ||
      invalidOptionalText(contact, "middle_name", 500) ||
      invalidOptionalText(contact, "last_name", 500) ||
      invalidOptionalText(contact, "nickname", 500) ||
      invalidOptionalText(contact, "description", MONICA_SOURCE_LIMITS.text) ||
      invalidOptionalText(
        contact,
        "food_preferences",
        MONICA_SOURCE_LIMITS.text,
      ) ||
      !validOptionalBoolean(contact.is_active) ||
      !validOptionalBoolean(contact.is_dead) ||
      !validOptionalBoolean(contact.is_partial) ||
      !validOptionalBoolean(contact.is_starred) ||
      ((contact.uuid !== null && contact.uuid !== undefined) &&
        (!sourceUuid || !SOURCE_UUID.test(sourceUuid))) ||
      (sourceUuid !== undefined && uniqueUuids.has(sourceUuid)) ||
      (deletedAt !== undefined && deletedAt !== null &&
        (typeof deletedAt !== "string" || Number.isNaN(Date.parse(deletedAt))))
    ) {
      return "Every contact needs unique valid source identity, first_name, and timestamps.";
    }
    uniqueIds.add(sourcePrimaryKey);
    if (sourceUuid) uniqueUuids.add(sourceUuid);
    const avatarPath = (contact.avatar_file_name === null ||
        contact.avatar_file_name === undefined)
      ? undefined
      : safePath(contact.avatar_file_name);
    if (
      (contact.avatar_file_name !== null &&
        contact.avatar_file_name !== undefined) && !avatarPath
    ) {
      return "A contact avatar path is unsafe.";
    }
    const attachment = avatarPath
      ? parsed.attachments.get(avatarPath)
      : undefined;
    if (avatarPath && (!attachment || !attachment.present)) missingFiles++;
    const rawSnapshot = redacted(contact);
    if (sourceUuid) rawSnapshot.uuid = sourceUuid;
    const avatarPresentation = importedAvatarPresentation(contact);
    contacts.push({
      ...(parsed.details?.get(sourcePrimaryKey)
        ? { contact: parsed.details.get(sourcePrimaryKey)! }
        : {}),
      ...(parsed.notes?.get(sourcePrimaryKey)
        ? { notes: parsed.notes.get(sourcePrimaryKey)! }
        : {}),
      ...(avatarPresentation ? { avatarPresentation } : {}),
      ...(avatarPath
        ? {
          avatar: {
            byteSize: attachment?.byteSize ?? 0,
            fileId: nextId(),
            originalFilename: attachment?.path ?? avatarPath,
            present: attachment?.present ?? false,
          },
        }
        : {}),
      ...(textValue(contact.last_name)
        ? { familyName: textValue(contact.last_name)! }
        : {}),
      ...(textValue(contact.description, MONICA_SOURCE_LIMITS.text)
        ? {
          description: textValue(
            contact.description,
            MONICA_SOURCE_LIMITS.text,
          )!,
        }
        : {}),
      ...(textValue(contact.food_preferences, MONICA_SOURCE_LIMITS.text)
        ? {
          foodPreferences: textValue(
            contact.food_preferences,
            MONICA_SOURCE_LIMITS.text,
          )!,
        }
        : {}),
      givenName,
      archived: contact.is_active === false || contact.is_active === 0,
      ...(typeof deletedAt === "string" ? { deletedAt } : {}),
      isDeceased: booleanValue(contact.is_dead),
      isPartial: booleanValue(contact.is_partial),
      isStarred: booleanValue(contact.is_starred),
      ...(textValue(contact.nickname)
        ? { nickname: textValue(contact.nickname)! }
        : {}),
      ...(textValue(contact.middle_name)
        ? { middleName: textValue(contact.middle_name)! }
        : {}),
      rawSnapshot,
      sourcePrimaryKey,
      ...(sourceUuid ? { sourceUuid } : {}),
      targetPersonId: nextId(),
    });
  }
  return { contacts, missingFiles };
}

/**
 * The counts, each with the sentence that says what it costs.
 *
 * A count of zero says nothing at all: a report that listed every category it
 * did not encounter would bury the one line the member has to read.
 */
export function importReport(counts: ImportCounts): ImportReport {
  return {
    counts,
    diagnostics: [
      ...(counts.legacyCredentialsDiscarded > 0
        ? [{
          code: "legacy-credentials-discarded",
          message:
            `${counts.legacyCredentialsDiscarded} legacy user record(s) will not create identities, sessions, passwords, API keys, or factors.`,
          severity: "skipped" as const,
        }]
        : []),
      ...(counts.missingFiles > 0
        ? [{
          code: "missing-attachment",
          message:
            `${counts.missingFiles} attachment reference(s) will be represented as missing metadata.`,
          severity: "warning" as const,
        }]
        : []),
      ...(counts.orphans > 0
        ? [{
          code: "orphaned-reference",
          message:
            `${counts.orphans} contact reference(s) cannot be resolved and will be skipped.`,
          severity: "warning" as const,
        }]
        : []),
      ...(counts.unsupported > 0
        ? [{
          code: "unsupported-data",
          message:
            `${counts.unsupported} unsupported row(s) or field value(s) will be skipped.`,
          severity: "skipped" as const,
        }]
        : []),
    ],
  };
}

/**
 * The fingerprint recorded against the staged run.
 *
 * It signs the identity of every contact and the snapshot that came with it,
 * the attachment manifest, and the two counts of what was discarded — not the
 * identifiers this backend minted, which differ on every dry run of the same
 * file. An absent source UUID is part of what is signed and renders as the
 * word `undefined`; `formats/canonical.ts` explains why that is kept.
 */
export function sourceFingerprint(
  parsed: ParsedMonicaSource,
  contacts: readonly StagedContact[],
): Promise<string> {
  const attachments: readonly MonicaAttachment[] = [
    ...parsed.attachments.values(),
  ];
  return sha256Hex(canonicalJson({
    attachments,
    ...(parsed.contactTypeCatalog?.length
      ? { contactTypeCatalog: parsed.contactTypeCatalog }
      : {}),
    contacts: contacts.map((contact) => ({
      rawSnapshot: contact.rawSnapshot,
      ...(contact.contact ? { contact: contact.contact } : {}),
      ...(contact.notes ? { notes: contact.notes } : {}),
      sourcePrimaryKey: contact.sourcePrimaryKey,
      sourceUuid: contact.sourceUuid,
    })),
    unsupported: parsed.unsupported,
    userCount: parsed.userCount,
  }));
}

/**
 * The person a prepared contact becomes, under the identifier the commit
 * settled on — the one already in the workspace when the row is being
 * re-imported, the freshly staged one otherwise.
 */
export function importedPerson(
  contact: PreparedImportContact,
  targetPersonId: string,
): ImportedPersonValues {
  return {
    archived: contact.archived,
    ...(contact.avatarPresentation
      ? { avatar: contact.avatarPresentation }
      : {}),
    ...(contact.deletedAt ? { deletedAt: new Date(contact.deletedAt) } : {}),
    ...(contact.description ? { description: contact.description } : {}),
    ...(contact.familyName ? { familyName: contact.familyName } : {}),
    ...(contact.foodPreferences
      ? { foodPreferences: contact.foodPreferences }
      : {}),
    givenName: contact.givenName,
    id: targetPersonId,
    isDeceased: contact.isDeceased,
    isPartial: contact.isPartial,
    isStarred: contact.isStarred,
    ...(contact.middleName ? { middleName: contact.middleName } : {}),
    ...(contact.nickname ? { nickname: contact.nickname } : {}),
  };
}
