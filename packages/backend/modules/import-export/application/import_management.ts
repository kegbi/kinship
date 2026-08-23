export interface ImportActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ImportTransaction {
  readonly opaque: unknown;
}

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

export interface StageImportCommand {
  readonly actor: ImportActor;
  readonly contacts: readonly StagedContact[];
  readonly fingerprint: string;
  readonly importId: string;
  readonly report: ImportReport;
  readonly transaction: ImportTransaction;
}

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

export interface PreparedImportAvatar {
  readonly byteSize: number;
  readonly fileId: string;
  readonly originalFilename: string;
  readonly personSourcePrimaryKey: string;
}

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
  | { readonly status: "not-found" };

export interface ImportSummary {
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly importId: string;
  readonly report: ImportReport;
  readonly sourceProfile: "json_export";
  readonly status: "completed" | "dry_run" | "failed";
}

export type ImportCommitResult =
  | {
    readonly importId: string;
    readonly peopleCreated: number;
    readonly peopleReused: number;
    readonly status: "completed";
  }
  | { readonly status: "confirmation-required" | "forbidden" | "not-found" };

export interface ImportRepository {
  authorize(
    actor: ImportActor,
    transaction: ImportTransaction,
  ): Promise<boolean>;
  complete(
    actor: ImportActor,
    importId: string,
    counts: { readonly peopleCreated: number; readonly peopleReused: number },
    transaction: ImportTransaction,
  ): Promise<void>;
  get(actor: ImportActor, importId: string): Promise<ImportSummary | undefined>;
  list(actor: ImportActor): Promise<readonly ImportSummary[]>;
  prepareCommit(
    actor: ImportActor,
    importId: string,
    transaction: ImportTransaction,
  ): Promise<PreparedImportCommit>;
  retargetContact(
    importId: string,
    sourcePrimaryKey: string,
    targetPersonId: string,
    transaction: ImportTransaction,
  ): Promise<void>;
  stage(command: StageImportCommand): Promise<{
    readonly importId: string;
    readonly report: ImportReport;
    readonly status: "dry_run";
  }>;
}

export interface ImportManagementDependencies {
  readonly audit: ImportAudit;
  readonly files: FileImportBoundary;
  readonly ids: { next(): string };
  readonly people: PeopleImportBoundary;
  readonly repository: ImportRepository;
  readonly transaction: {
    run<T>(work: (transaction: ImportTransaction) => Promise<T>): Promise<T>;
  };
}

type DryRunResult =
  | {
    readonly importId: string;
    readonly report: ImportReport;
    readonly status: "dry_run";
  }
  | { readonly detail: string; readonly status: "invalid-source" }
  | { readonly status: "forbidden" };

export interface ImportManagement {
  commit(
    actor: ImportActor,
    importId: string,
    confirmed: boolean,
  ): Promise<ImportCommitResult>;
  dryRun(actor: ImportActor, source: unknown): Promise<DryRunResult>;
  get(actor: ImportActor, importId: string): Promise<ImportSummary | undefined>;
  list(actor: ImportActor): Promise<readonly ImportSummary[]>;
}

const MAX_CONTACTS = 500;
const MAX_ATTACHMENTS = 1_000;
const MAX_TEXT = 10_000;
const secretKeys = new Set([
  "api_key",
  "password",
  "remember_token",
  "two_factor_recovery_codes",
  "two_factor_secret",
]);

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
function textValue(value: unknown, max = 500): string | undefined {
  return typeof value === "string" && value.trim().length > 0 &&
      value.length <= max
    ? value.trim()
    : undefined;
}
function sourceId(value: unknown): string | undefined {
  if (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0
  ) return String(value);
  return typeof value === "string" && value.trim().length > 0 &&
      value.length <= 100
    ? value.trim()
    : undefined;
}
function invalidOptionalText(
  source: Record<string, unknown>,
  key: string,
  max: number,
): boolean {
  const value = source[key];
  return value !== undefined && value !== null &&
    (typeof value !== "string" || value.length > max);
}
function booleanValue(value: unknown): boolean {
  return value === true || value === 1;
}
function validOptionalBoolean(value: unknown): boolean {
  return value === undefined || value === true || value === false ||
    value === 1 || value === 0;
}
function safePath(value: unknown): string | undefined {
  const path = textValue(value, 500)?.replaceAll("\\", "/");
  if (
    !path || path.startsWith("/") || path.includes("../") ||
    path === ".." || /^[A-Za-z]:/.test(path)
  ) return undefined;
  return path;
}
function redacted(source: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(source).filter(([key, value]) =>
      !secretKeys.has(key) &&
      (value === null || ["boolean", "number", "string"].includes(typeof value))
    ).map(([key, value]) => [
      key,
      typeof value === "string" && value.length > MAX_TEXT
        ? value.slice(0, MAX_TEXT)
        : value,
    ]),
  );
}
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = object(value);
  if (record) {
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${canonicalJson(record[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}
async function fingerprint(source: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(source));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest)).map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

interface ParsedSource {
  readonly attachments: ReadonlyMap<string, {
    readonly byteSize: number;
    readonly path: string;
    readonly present: boolean;
  }>;
  readonly contacts: readonly Record<string, unknown>[];
  readonly userCount: number;
  readonly unsupported: number;
}

const supportedContactFields = new Set([
  "avatar_file_name",
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

function parseSource(source: unknown): ParsedSource | string {
  const root = object(source);
  if (!root || root.format !== "monica-json" || root.version !== 1) {
    return "Only the version 1 Monica JSON export profile is supported.";
  }
  const tables = object(root.tables);
  if (
    !tables || !Array.isArray(tables.contacts) ||
    tables.contacts.length > MAX_CONTACTS
  ) {
    return `The export must contain at most ${MAX_CONTACTS} contacts.`;
  }
  if (tables.contacts.some((contact) => !object(contact))) {
    return "Every contact must be an object.";
  }
  const rawAttachments = root.attachments ?? [];
  if (
    !Array.isArray(rawAttachments) || rawAttachments.length > MAX_ATTACHMENTS
  ) {
    return `The manifest must contain at most ${MAX_ATTACHMENTS} attachments.`;
  }
  const attachments = new Map<string, {
    byteSize: number;
    path: string;
    present: boolean;
  }>();
  for (const value of rawAttachments) {
    const attachment = object(value);
    const path = safePath(attachment?.path);
    const byteSize = attachment?.byteSize;
    if (
      !attachment || !path || !Number.isSafeInteger(byteSize) ||
      (byteSize as number) < 0 ||
      (byteSize as number) > PERSON_FILE_MAX_BYTES ||
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
  if (users !== undefined && (!Array.isArray(users) || users.length > 100)) {
    return "The legacy user list is invalid.";
  }
  const supportedTables = new Set(["contacts", "users"]);
  const unsupportedTables = Object.entries(tables).reduce(
    (count, [name, rows]) =>
      count +
      (supportedTables.has(name) ? 0 : Array.isArray(rows) ? rows.length : 1),
    0,
  );
  const unsupportedFields = (tables.contacts as Record<string, unknown>[])
    .reduce(
      (count, contact) =>
        count +
        Object.keys(contact).filter((key) => !supportedContactFields.has(key))
          .length,
      0,
    );
  return {
    attachments,
    contacts: tables.contacts as Record<string, unknown>[],
    unsupported: unsupportedTables + unsupportedFields,
    userCount: Array.isArray(users) ? users.length : 0,
  };
}

export function createImportManagement(
  dependencies: ImportManagementDependencies,
): ImportManagement {
  return {
    commit(actor, importId, confirmed) {
      if (!confirmed) {
        return Promise.resolve({ status: "confirmation-required" });
      }
      if (actor.role === "member") {
        return Promise.resolve({ status: "forbidden" });
      }
      return dependencies.transaction.run(async (transaction) => {
        if (!(await dependencies.repository.authorize(actor, transaction))) {
          return { status: "forbidden" };
        }
        const prepared = await dependencies.repository.prepareCommit(
          actor,
          importId,
          transaction,
        );
        if (prepared.status !== "ready") return prepared;
        const occurredAt = new Date();
        const committedContacts = new Map<string, {
          readonly reused: boolean;
          readonly targetPersonId: string;
        }>();
        for (const contact of prepared.contacts) {
          const reused = contact.previousTargetPersonId
            ? await dependencies.people.exists({
              actor,
              personId: contact.previousTargetPersonId,
              transaction,
            })
            : false;
          const targetPersonId = reused
            ? contact.previousTargetPersonId!
            : contact.targetPersonId;
          if (reused) {
            await dependencies.repository.retargetContact(
              importId,
              contact.sourcePrimaryKey,
              targetPersonId,
              transaction,
            );
            committedContacts.set(contact.sourcePrimaryKey, {
              reused: true,
              targetPersonId,
            });
            continue;
          }
          await dependencies.people.create({
            actor,
            occurredAt,
            person: {
              archived: contact.archived,
              ...(contact.deletedAt
                ? { deletedAt: new Date(contact.deletedAt) }
                : {}),
              ...(contact.description
                ? { description: contact.description }
                : {}),
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
            },
            transaction,
          });
          committedContacts.set(contact.sourcePrimaryKey, {
            reused: false,
            targetPersonId,
          });
        }
        for (const avatar of prepared.avatars) {
          const person = committedContacts.get(avatar.personSourcePrimaryKey);
          if (!person || person.reused) continue;
          await dependencies.files.representMissing({
            actor,
            byteSize: avatar.byteSize,
            fileId: avatar.fileId,
            importId,
            originalFilename: avatar.originalFilename,
            transaction,
          });
          await dependencies.people.linkAvatar({
            actor,
            fileId: avatar.fileId,
            personId: person.targetPersonId,
            transaction,
          });
        }
        const peopleCreated = [...committedContacts.values()].filter(
          (contact) => !contact.reused,
        ).length;
        const peopleReused = prepared.contacts.length - peopleCreated;
        await dependencies.audit.record({
          action: "committed",
          actor,
          importId,
          occurredAt,
          payload: { peopleCreated, peopleReused },
          transaction,
        });
        await dependencies.repository.complete(
          actor,
          importId,
          { peopleCreated, peopleReused },
          transaction,
        );
        return {
          importId,
          peopleCreated,
          peopleReused,
          status: "completed" as const,
        };
      });
    },
    dryRun(actor, source) {
      if (actor.role === "member") {
        return Promise.resolve({ status: "forbidden" });
      }
      const parsed = parseSource(source);
      if (typeof parsed === "string") {
        return Promise.resolve({ detail: parsed, status: "invalid-source" });
      }
      const contacts: StagedContact[] = [];
      let missingFiles = 0;
      const orphans = 0;
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
          invalidOptionalText(contact, "description", MAX_TEXT) ||
          invalidOptionalText(contact, "food_preferences", MAX_TEXT) ||
          !validOptionalBoolean(contact.is_active) ||
          !validOptionalBoolean(contact.is_dead) ||
          !validOptionalBoolean(contact.is_partial) ||
          !validOptionalBoolean(contact.is_starred) ||
          (contact.uuid !== undefined &&
            (!sourceUuid ||
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
                .test(
                  sourceUuid,
                ))) ||
          (sourceUuid !== undefined && uniqueUuids.has(sourceUuid)) ||
          (deletedAt !== undefined && deletedAt !== null &&
            (typeof deletedAt !== "string" ||
              Number.isNaN(Date.parse(deletedAt))))
        ) {
          return Promise.resolve({
            detail:
              "Every contact needs unique valid source identity, first_name, and timestamps.",
            status: "invalid-source",
          });
        }
        uniqueIds.add(sourcePrimaryKey);
        if (sourceUuid) uniqueUuids.add(sourceUuid);
        const avatarPath = contact.avatar_file_name === undefined
          ? undefined
          : safePath(contact.avatar_file_name);
        if (contact.avatar_file_name !== undefined && !avatarPath) {
          return Promise.resolve({
            detail: "A contact avatar path is unsafe.",
            status: "invalid-source",
          });
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
                fileId: dependencies.ids.next(),
                originalFilename: avatarPath,
                present: attachment?.present ?? false,
              },
            }
            : {}),
          ...(textValue(contact.last_name)
            ? { familyName: textValue(contact.last_name)! }
            : {}),
          ...(textValue(contact.description, MAX_TEXT)
            ? { description: textValue(contact.description, MAX_TEXT)! }
            : {}),
          ...(textValue(contact.food_preferences, MAX_TEXT)
            ? {
              foodPreferences: textValue(
                contact.food_preferences,
                MAX_TEXT,
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
          targetPersonId: dependencies.ids.next(),
        });
      }
      const diagnostics: ImportReport["diagnostics"] = [
        ...(parsed.userCount > 0
          ? [{
            code: "legacy-credentials-discarded",
            message:
              `${parsed.userCount} legacy user record(s) will not create identities, sessions, passwords, API keys, or factors.`,
            severity: "skipped" as const,
          }]
          : []),
        ...(missingFiles > 0
          ? [{
            code: "missing-attachment",
            message:
              `${missingFiles} attachment reference(s) will be represented as missing metadata.`,
            severity: "warning" as const,
          }]
          : []),
        ...(orphans > 0
          ? [{
            code: "orphaned-reference",
            message:
              `${orphans} contact reference(s) cannot be resolved and will be skipped.`,
            severity: "warning" as const,
          }]
          : []),
        ...(parsed.unsupported > 0
          ? [{
            code: "unsupported-data",
            message:
              `${parsed.unsupported} unsupported record(s) will be skipped.`,
            severity: "skipped" as const,
          }]
          : []),
      ];
      const report: ImportReport = {
        counts: {
          contacts: contacts.length,
          legacyCredentialsDiscarded: parsed.userCount,
          missingFiles,
          orphans,
          unsupported: parsed.unsupported,
        },
        diagnostics,
      };
      return dependencies.transaction.run(async (transaction) => {
        if (!(await dependencies.repository.authorize(actor, transaction))) {
          return { status: "forbidden" as const };
        }
        const staged = await dependencies.repository.stage({
          actor,
          contacts,
          fingerprint: await fingerprint({
            attachments: [...parsed.attachments.values()],
            contacts: contacts.map((contact) => ({
              rawSnapshot: contact.rawSnapshot,
              sourcePrimaryKey: contact.sourcePrimaryKey,
              sourceUuid: contact.sourceUuid,
            })),
            unsupported: parsed.unsupported,
            userCount: parsed.userCount,
          }),
          importId: dependencies.ids.next(),
          report,
          transaction,
        });
        const occurredAt = new Date();
        await dependencies.audit.record({
          action: "started",
          actor,
          importId: staged.importId,
          occurredAt,
          payload: { sourceProfile: "json_export" },
          transaction,
        });
        await dependencies.audit.record({
          action: "validated",
          actor,
          importId: staged.importId,
          occurredAt,
          payload: { ...staged.report.counts },
          transaction,
        });
        return staged;
      });
    },
    get(actor, importId) {
      if (actor.role === "member") return Promise.resolve(undefined);
      return dependencies.repository.get(actor, importId);
    },
    list(actor) {
      if (actor.role === "member") return Promise.resolve([]);
      return dependencies.repository.list(actor);
    },
  };
}
import type { FileImportBoundary } from "../../files/public.ts";
import { PERSON_FILE_MAX_BYTES } from "../../files/public.ts";
import type { ImportAudit } from "../../governance/public.ts";
import type { PeopleImportBoundary } from "../../people/public.ts";
