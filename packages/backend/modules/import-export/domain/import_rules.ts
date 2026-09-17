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

/** One contact as it is staged, before anything is written to people. */
export interface StagedContact {
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
  readonly archived: boolean;
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
    readonly avatars: readonly PreparedImportAvatar[];
    readonly contacts: readonly PreparedImportContact[];
    readonly importId: string;
    readonly status: "ready";
  }
  | {
    readonly importId: string;
    readonly peopleCreated: number;
    readonly peopleReused: number;
    readonly status: "completed";
  }
  | Failure<"not-found">;

/** One import run, as a member sees it listed. */
export interface ImportSummary {
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly importId: string;
  readonly report: ImportReport;
  readonly sourceProfile: "json_export";
  readonly status: "completed" | "dry_run" | "failed";
}

/** How a commit ends. */
export type ImportCommitResult =
  | {
    readonly importId: string;
    readonly peopleCreated: number;
    readonly peopleReused: number;
    readonly status: "completed";
  }
  | Failure<"forbidden" | "not-found", "confirmation-required">;

/** The person a committed contact becomes. */
export interface ImportedPersonValues {
  readonly archived: boolean;
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
    const sourceUuid = contact.uuid === undefined
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
      (contact.uuid !== undefined &&
        (!sourceUuid || !SOURCE_UUID.test(sourceUuid))) ||
      (sourceUuid !== undefined && uniqueUuids.has(sourceUuid)) ||
      (deletedAt !== undefined && deletedAt !== null &&
        (typeof deletedAt !== "string" || Number.isNaN(Date.parse(deletedAt))))
    ) {
      return "Every contact needs unique valid source identity, first_name, and timestamps.";
    }
    uniqueIds.add(sourcePrimaryKey);
    if (sourceUuid) uniqueUuids.add(sourceUuid);
    const avatarPath = contact.avatar_file_name === undefined
      ? undefined
      : safePath(contact.avatar_file_name);
    if (contact.avatar_file_name !== undefined && !avatarPath) {
      return "A contact avatar path is unsafe.";
    }
    const attachment = avatarPath
      ? parsed.attachments.get(avatarPath)
      : undefined;
    if (avatarPath && (!attachment || !attachment.present)) missingFiles++;
    const rawSnapshot = redacted(contact);
    if (sourceUuid) rawSnapshot.uuid = sourceUuid;
    contacts.push({
      ...(avatarPath
        ? {
          avatar: {
            byteSize: attachment?.byteSize ?? 0,
            fileId: nextId(),
            originalFilename: avatarPath,
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
            `${counts.unsupported} unsupported record(s) will be skipped.`,
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
    contacts: contacts.map((contact) => ({
      rawSnapshot: contact.rawSnapshot,
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
