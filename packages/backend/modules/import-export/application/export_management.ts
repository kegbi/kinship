import type { ExportFileBoundary } from "../../files/public.ts";
import type { ExportAudit } from "../../governance/public.ts";
import type {
  ExportPerson,
  PeopleExportBoundary,
} from "../../people/public.ts";

export interface ExportActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface ExportTransaction {
  readonly opaque: unknown;
}

export interface ExportManifest {
  readonly attachments: {
    readonly count: number;
    readonly items: readonly {
      readonly byteSize: number;
      readonly filename: string;
      readonly sha256: string;
    }[];
    readonly sha256: string;
  };
  readonly limitations: readonly string[];
  readonly profile: "monica-json";
  readonly rows: {
    readonly people: { readonly count: number; readonly sha256: string };
  };
  readonly version: 1;
}

export interface ExportSummary {
  readonly completedAt?: string;
  readonly createdAt: string;
  readonly error?: string;
  readonly expiresAt?: string;
  readonly exportId: string;
  readonly format: "json";
  readonly manifest: ExportManifest;
  readonly status:
    | "cancelled"
    | "completed"
    | "expired"
    | "failed"
    | "pending"
    | "running";
}

export interface StoredExport extends ExportSummary {
  readonly downloadDigest?: string;
  readonly downloadExpiresAt?: string;
  readonly fileId?: string;
}

export interface ExportRepository {
  authorize(
    actor: ExportActor,
    transaction: ExportTransaction,
  ): Promise<boolean>;
  complete(command: {
    readonly actor: ExportActor;
    readonly completedAt: Date;
    readonly expiresAt: Date;
    readonly exportId: string;
    readonly fileId: string;
    readonly manifest: ExportManifest;
    readonly transaction: ExportTransaction;
  }): Promise<ExportSummary>;
  fail(command: {
    readonly actor: ExportActor;
    readonly error: string;
    readonly exportId: string;
    readonly failedAt: Date;
    readonly transaction: ExportTransaction;
  }): Promise<void>;
  consumeDownload(command: {
    readonly actor: ExportActor;
    readonly digest: string;
    readonly exportId: string;
    readonly now: Date;
    readonly transaction: ExportTransaction;
  }): Promise<
    | { readonly fileId: string; readonly status: "consumed" }
    | { readonly status: "expired" | "not-found" }
  >;
  issueDownload(command: {
    readonly actor: ExportActor;
    readonly digest: string;
    readonly expiresAt: Date;
    readonly exportId: string;
    readonly transaction: ExportTransaction;
  }): Promise<boolean>;
  list(
    actor: ExportActor,
    transaction: ExportTransaction,
  ): Promise<readonly ExportSummary[]>;
  lock(
    actor: ExportActor,
    exportId: string,
    transaction: ExportTransaction,
  ): Promise<StoredExport | undefined>;
  startOrResume(command: {
    readonly actor: ExportActor;
    readonly exportId: string;
    readonly startedAt: Date;
    readonly transaction: ExportTransaction;
  }): Promise<{ readonly created: boolean; readonly exportId: string }>;
}

export interface ExportManagementDependencies {
  readonly audit: ExportAudit;
  readonly clock: { now(): Date };
  readonly files: ExportFileBoundary;
  readonly ids: { next(): string };
  readonly people: PeopleExportBoundary;
  readonly repository: ExportRepository;
  readonly tokens: { next(): string };
  readonly transaction: {
    run<T>(work: (transaction: ExportTransaction) => Promise<T>): Promise<T>;
  };
}

const encoder = new TextEncoder();
const FIVE_MINUTES = 5 * 60 * 1_000;
const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1_000;
const MAX_PORTABLE_PEOPLE = 500;

async function sha256(value: Uint8Array | string): Promise<string> {
  const bytes = typeof value === "string" ? encoder.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${
      Object.keys(record).sort().map((key) =>
        `${JSON.stringify(key)}:${canonical(record[key])}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

function portableContact(person: ExportPerson): Record<string, unknown> {
  return {
    id: person.id,
    uuid: person.id,
    first_name: person.givenName,
    ...(person.middleName ? { middle_name: person.middleName } : {}),
    ...(person.familyName ? { last_name: person.familyName } : {}),
    ...(person.nickname ? { nickname: person.nickname } : {}),
    ...(person.description ? { description: person.description } : {}),
    ...(person.foodPreferences
      ? { food_preferences: person.foodPreferences }
      : {}),
    is_active: !person.archived,
    is_dead: person.isDeceased,
    is_partial: person.isPartial,
    is_starred: person.isStarred,
    ...(person.deletedAt ? { deleted_at: person.deletedAt } : {}),
  };
}

function vcardText(person: ExportPerson): string {
  const escape = (value: string) =>
    value.replaceAll("\\", "\\\\").replace(/\r\n|\r|\n/g, "\\n")
      .replaceAll(",", "\\,").replaceAll(";", "\\;");
  const parameter = (value: string) =>
    value.trim().replace(/[^A-Za-z0-9-]/g, "-").slice(0, 40) || "other";
  const display =
    [person.givenName, person.familyName].filter(Boolean).join(" ") ||
    person.nickname || "Unnamed person";
  const lines = [
    "BEGIN:VCARD",
    "VERSION:4.0",
    `FN:${escape(display)}`,
    `N:${escape(person.familyName ?? "")};${escape(person.givenName)};${
      escape(person.middleName ?? "")
    };;`,
    ...person.contactMethods.filter((method) =>
      method.kind === "email" || method.kind === "phone"
    ).map((method) =>
      `${method.kind === "email" ? "EMAIL" : "TEL"};TYPE=${
        parameter(method.label)
      }:${escape(method.value)}`
    ),
    "END:VCARD",
    "",
  ];
  return lines.join("\r\n");
}

function publicSummary(stored: StoredExport): ExportSummary {
  const {
    downloadDigest: _digest,
    downloadExpiresAt: _downloadExpiry,
    fileId: _fileId,
    ...summary
  } = stored;
  return summary;
}

async function recoveredArtifact(bytes: Uint8Array): Promise<
  | {
    readonly checksumSha256: string;
    readonly manifest: ExportManifest;
    readonly people: number;
  }
  | undefined
> {
  try {
    const source = JSON.parse(new TextDecoder().decode(bytes)) as Record<
      string,
      unknown
    >;
    const manifest = source.manifest as ExportManifest | undefined;
    const tables = source.tables as Record<string, unknown> | undefined;
    const contacts = tables?.contacts;
    if (
      source.format !== "monica-json" || source.version !== 1 ||
      !manifest || manifest.version !== 1 ||
      manifest.profile !== "monica-json" || !Array.isArray(contacts) ||
      manifest.rows?.people?.count !== contacts.length ||
      !/^[0-9a-f]{64}$/.test(manifest.rows.people.sha256) ||
      manifest.rows.people.sha256 !== await sha256(canonical(contacts)) ||
      manifest.attachments?.count !== 0 ||
      !Array.isArray(manifest.attachments.items) ||
      manifest.attachments.items.length !== 0 ||
      manifest.attachments.sha256 !== await sha256("[]") ||
      !Array.isArray(manifest.limitations) ||
      !manifest.limitations.every((item) => typeof item === "string")
    ) return undefined;
    return {
      checksumSha256: await sha256(bytes),
      manifest,
      people: contacts.length,
    };
  } catch {
    return undefined;
  }
}

export function createExportManagement(
  dependencies: ExportManagementDependencies,
) {
  return {
    async createWorkspace(actor: ExportActor) {
      if (actor.role === "member") return { status: "forbidden" as const };
      const startedAt = dependencies.clock.now();
      const claimed = await dependencies.transaction.run(
        async (transaction) => {
          if (!(await dependencies.repository.authorize(actor, transaction))) {
            return undefined;
          }
          const claim = await dependencies.repository.startOrResume({
            actor,
            exportId: dependencies.ids.next(),
            startedAt,
            transaction,
          });
          if (claim.created) {
            await dependencies.audit.record({
              action: "requested",
              actor,
              exportId: claim.exportId,
              occurredAt: startedAt,
              payload: { format: "json" },
              transaction,
            });
          }
          return claim;
        },
      );
      if (!claimed) return { status: "forbidden" as const };
      return dependencies.transaction.run(async (transaction) => {
        const locked = await dependencies.repository.lock(
          actor,
          claimed.exportId,
          transaction,
        );
        if (!locked) return { status: "unavailable" as const };
        if (locked.status === "completed") return publicSummary(locked);
        if (locked.status !== "running") {
          return { status: "unavailable" as const };
        }

        let artifact = await dependencies.files.recover({
          ...actor,
          exportId: claimed.exportId,
        }).catch(() => ({ status: "unavailable" as const }));
        let prepared = artifact.status === "stored"
          ? await recoveredArtifact(artifact.bytes)
          : undefined;
        if (artifact.status === "stored" && !prepared) {
          const discarded = await dependencies.files.discard({
            ...actor,
            fileId: artifact.fileId,
          }).catch(() => ({ status: "unavailable" as const }));
          if (discarded.status !== "discarded") {
            return { status: "unavailable" as const };
          }
          artifact = { status: "absent" as const };
        }
        if (
          artifact.status === "unavailable" || artifact.status === "forbidden"
        ) {
          return { status: "unavailable" as const };
        }

        if (artifact.status === "absent") {
          const people = await dependencies.people.listWorkspace({
            actor,
            transaction,
          });
          if (people.length > MAX_PORTABLE_PEOPLE) {
            await dependencies.repository.fail({
              actor,
              error: "Portable export is limited to 500 people.",
              exportId: claimed.exportId,
              failedAt: dependencies.clock.now(),
              transaction,
            });
            return { status: "too-large" as const };
          }
          const contacts = people.map(portableContact);
          const manifest: ExportManifest = {
            attachments: {
              count: 0,
              items: [],
              sha256: await sha256("[]"),
            },
            limitations: [
              "Only person identity fields accepted by Monica JSON import are included.",
              "Contact methods are available in person vCard exports but are not in this portable JSON profile.",
              "Attachments are not included in this bounded export profile.",
            ],
            profile: "monica-json",
            rows: {
              people: {
                count: contacts.length,
                sha256: await sha256(canonical(contacts)),
              },
            },
            version: 1,
          };
          const bytes = encoder.encode(JSON.stringify({
            attachments: [],
            format: "monica-json",
            manifest,
            tables: { contacts },
            version: 1,
          }));
          const checksumSha256 = await sha256(bytes);
          const stored = await dependencies.files.store({
            ...actor,
            bytes,
            checksumSha256,
            exportId: claimed.exportId,
            filename: `kinship-${claimed.exportId}.json`,
            mimeType: "application/json",
          }).catch(() => ({ status: "unavailable" as const }));
          if (stored.status !== "stored") return stored;
          artifact = { ...stored, bytes };
          prepared = { checksumSha256, manifest, people: contacts.length };
        }
        if (!prepared || artifact.status !== "stored") {
          return { status: "unavailable" as const };
        }
        const completedAt = dependencies.clock.now();
        const summary = await dependencies.repository.complete({
          actor,
          completedAt,
          expiresAt: new Date(completedAt.getTime() + SEVEN_DAYS),
          exportId: claimed.exportId,
          fileId: artifact.fileId,
          manifest: prepared.manifest,
          transaction,
        });
        await dependencies.audit.record({
          action: "completed",
          actor,
          exportId: claimed.exportId,
          occurredAt: completedAt,
          payload: {
            checksumSha256: prepared.checksumSha256,
            people: prepared.people,
          },
          transaction,
        });
        return summary;
      }).catch(() => ({ status: "unavailable" as const }));
    },
    async exportVCard(actor: ExportActor, personId: string) {
      const prepared = await dependencies.transaction.run(
        async (transaction) => {
          const person = await dependencies.people.getPerson({
            actor,
            personId,
            transaction,
          });
          if (!person) return undefined;
          const bytes = encoder.encode(vcardText(person));
          await dependencies.audit.recordPersonDownload({
            actor,
            occurredAt: dependencies.clock.now(),
            personId,
            transaction,
          });
          return { bytes, person };
        },
      );
      if (!prepared) return { status: "not-found" as const };
      const { bytes, person } = prepared;
      const safeName = [person.givenName, person.familyName].filter(Boolean)
        .join("-").replace(/[^A-Za-z0-9._-]+/g, "-") || "person";
      return {
        bytes,
        filename: `${safeName}.vcf`,
        mimeType: "text/vcard; charset=utf-8",
        status: "ready" as const,
      };
    },
    async list(actor: ExportActor) {
      if (actor.role === "member") return { status: "forbidden" as const };
      return await dependencies.transaction.run(async (transaction) =>
        (await dependencies.repository.authorize(actor, transaction))
          ? {
            exports: await dependencies.repository.list(actor, transaction),
            status: "ready" as const,
          }
          : { status: "forbidden" as const }
      );
    },
    async createDownload(actor: ExportActor, exportId: string) {
      if (actor.role === "member") return { status: "forbidden" as const };
      const token = dependencies.tokens.next();
      const expiresAt = new Date(
        dependencies.clock.now().getTime() + FIVE_MINUTES,
      );
      const digest = await sha256(token);
      const issued = await dependencies.transaction.run(async (transaction) =>
        await dependencies.repository.authorize(actor, transaction) &&
        await dependencies.repository.issueDownload({
          actor,
          digest,
          expiresAt,
          exportId,
          transaction,
        })
      );
      return issued
        ? {
          expiresAt: expiresAt.toISOString(),
          href: `/api/v1/exports/${exportId}/download?token=${
            encodeURIComponent(token)
          }&workspaceId=${encodeURIComponent(actor.workspaceId)}`,
          status: "ready" as const,
        }
        : { status: "not-found" as const };
    },
    async download(actor: ExportActor, exportId: string, token: string) {
      if (actor.role === "member") return { status: "forbidden" as const };
      const now = dependencies.clock.now();
      const digest = await sha256(token);
      const attempt = await dependencies.transaction.run(
        async (transaction) => {
          if (!(await dependencies.repository.authorize(actor, transaction))) {
            return { authorized: false as const };
          }
          return {
            authorized: true as const,
            consumed: await dependencies.repository.consumeDownload({
              actor,
              digest,
              exportId,
              now,
              transaction,
            }),
          };
        },
      );
      if (!attempt.authorized) {
        return { status: "not-found" as const };
      }
      if (attempt.consumed.status !== "consumed") return attempt.consumed;
      const file = await dependencies.files.read({
        ...actor,
        fileId: attempt.consumed.fileId,
      });
      if (file.status !== "ready") return file;
      await dependencies.transaction.run((transaction) =>
        dependencies.audit.record({
          action: "downloaded",
          actor,
          exportId,
          occurredAt: now,
          payload: {},
          transaction,
        })
      );
      return file;
    },
  };
}

export type ExportManagement = ReturnType<typeof createExportManagement>;
