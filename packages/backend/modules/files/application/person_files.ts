import type { PeopleTransaction } from "../../people/public.ts";

export const PERSON_FILE_MAX_BYTES = 10 * 1024 * 1024;

export type PersonFileKind = "document" | "photo";
export type PersonFileStatus =
  | "available"
  | "deleted"
  | "missing"
  | "processing"
  | "quarantined";

export interface PersonFileActor {
  readonly memberId: string;
  readonly role: "admin" | "member" | "owner";
  readonly userId: string;
  readonly workspaceId: string;
}

export interface PersonFileRecord {
  readonly byteSize: number;
  readonly createdAt: string;
  readonly fileId: string;
  readonly filename: string;
  readonly kind: PersonFileKind;
  readonly mimeType: string;
  readonly personId: string;
  readonly status: PersonFileStatus;
  readonly title: string;
}

export interface StoredPersonFile extends PersonFileRecord {
  readonly checksumSha256?: string;
  readonly storageKey: string;
}

export interface ObjectStorage {
  readonly bucket: string;
  readonly provider: string;
  get(command: { readonly key: string }): Promise<Uint8Array | undefined>;
  health(): Promise<"available" | "not-initialized" | "unavailable">;
  put(command: {
    readonly bytes: Uint8Array;
    readonly key: string;
    readonly mimeType?: string;
  }): Promise<void>;
  remove(command: { readonly key: string }): Promise<void>;
}

export interface FileScanner {
  inspect(command: {
    readonly bytes: Uint8Array;
    readonly filename: string;
    readonly mimeType: string;
  }): Promise<"clean" | "quarantined">;
}

export interface FileMetadataRepository {
  authorizeUpload(
    command: PersonFileActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly status: "authorized" }
    | { readonly status: "forbidden" | "not-found" }
  >;
  reserveUpload(
    command: PersonFileActor & {
      readonly byteSize: number;
      readonly checksumSha256: string;
      readonly fileId: string;
      readonly filename: string;
      readonly kind: PersonFileKind;
      readonly mimeType: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly storageKey: string;
      readonly storageBucket: string;
      readonly storageProvider: string;
      readonly title: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly file: StoredPersonFile; readonly status: "reserved" }
    | { readonly status: "forbidden" | "not-found" }
  >;
  finalizeUpload(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly status: "available" | "quarantined";
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly file: StoredPersonFile; readonly status: "created" }
    | { readonly status: "forbidden" | "not-found" }
  >;
  find(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly file: StoredPersonFile; readonly status: "found" }
    | { readonly status: "forbidden" | "not-found" }
  >;
  list(
    command: PersonFileActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly files: readonly StoredPersonFile[]; readonly status: "ready" }
    | { readonly status: "forbidden" | "not-found" }
  >;
  markMissing(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly occurredAt: Date;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
  recordRead(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<void>;
  reserveRemoval(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly file: StoredPersonFile; readonly status: "reserved" }
    | { readonly status: "forbidden" | "not-found" | "processing" }
  >;
  finalizeRemoval(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly file: StoredPersonFile; readonly status: "removed" }
    | { readonly status: "forbidden" | "not-found" }
  >;
}

export interface FileAudit {
  record(command: {
    readonly action: "read" | "removed" | "uploaded";
    readonly actor: PersonFileActor;
    readonly file: StoredPersonFile;
    readonly occurredAt: Date;
    readonly transaction: PeopleTransaction;
  }): Promise<string>;
}

export interface GiftAttachmentBoundary {
  attachToGift(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly giftId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly status: "attached" }
    | { readonly status: "forbidden" | "not-found" }
  >;
  validateForGift(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly status: "ready" }
    | { readonly status: "forbidden" | "not-found" }
  >;
  listForGifts(
    command: PersonFileActor & {
      readonly giftIds: readonly string[];
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | {
      readonly links: readonly {
        readonly fileId: string;
        readonly giftId: string;
      }[];
      readonly status: "ready";
    }
    | { readonly status: "forbidden" }
  >;
}

export interface PersonFileManagementDependencies {
  readonly audit: FileAudit;
  readonly clock: { now(): Date };
  readonly ids: { next(): string };
  readonly keys: { next(): string };
  readonly repository: FileMetadataRepository;
  readonly scanner: FileScanner;
  readonly storage: ObjectStorage;
  readonly transaction: {
    run<T>(work: (transaction: PeopleTransaction) => Promise<T>): Promise<T>;
  };
}

export interface PersonFileUploadInput {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly kind: PersonFileKind;
  readonly mimeType: string;
  readonly title: string;
}

export type UploadPersonFileResult =
  | { readonly file: PersonFileRecord; readonly status: "created" }
  | {
    readonly status:
      | "forbidden"
      | "not-found"
      | "rejected-media"
      | "storage-limit"
      | "unavailable"
      | "validation-error";
  };

export type DownloadPersonFileResult =
  | {
    readonly bytes: Uint8Array;
    readonly file: PersonFileRecord;
    readonly status: "ready";
  }
  | {
    readonly status:
      | "deleted"
      | "forbidden"
      | "missing"
      | "not-found"
      | "processing"
      | "quarantined"
      | "unavailable";
  };

export type ListPersonFilesResult =
  | { readonly files: readonly PersonFileRecord[]; readonly status: "ready" }
  | { readonly status: "forbidden" | "not-found" | "unavailable" };

export type RemovePersonFileResult =
  | { readonly fileId: string; readonly status: "removed" }
  | {
    readonly status:
      | "forbidden"
      | "not-found"
      | "processing"
      | "unavailable";
  };

const allowedMedia: Readonly<Record<PersonFileKind, ReadonlySet<string>>> = {
  document: new Set([
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
  ]),
  photo: new Set(["image/jpeg", "image/png", "image/webp"]),
};

function publicFile(file: StoredPersonFile): PersonFileRecord {
  const { checksumSha256: _checksum, storageKey: _storageKey, ...visible } =
    file;
  return visible;
}

function normalizedText(value: string, maximum: number): string | undefined {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maximum
    ? normalized
    : undefined;
}

async function checksum(bytes: Uint8Array): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", bytes.slice().buffer),
  );
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function createPersonFileManagement(
  dependencies: PersonFileManagementDependencies,
) {
  return {
    upload: async (
      actor: PersonFileActor,
      personId: string,
      input: PersonFileUploadInput,
    ): Promise<UploadPersonFileResult> => {
      if (input.bytes.byteLength > PERSON_FILE_MAX_BYTES) {
        return { status: "storage-limit" };
      }
      if (
        input.bytes.byteLength === 0 ||
        !normalizedText(input.filename, 500) ||
        !normalizedText(input.title, 500)
      ) {
        return { status: "validation-error" };
      }
      const mimeType = input.mimeType.toLowerCase();
      if (!allowedMedia[input.kind].has(mimeType)) {
        return { status: "rejected-media" };
      }

      let authorization:
        | { readonly status: "authorized" }
        | { readonly status: "forbidden" | "not-found" };
      try {
        authorization = await dependencies.transaction.run((transaction) =>
          dependencies.repository.authorizeUpload({
            ...actor,
            personId,
            transaction,
          })
        );
      } catch {
        return { status: "unavailable" };
      }
      if (authorization.status !== "authorized") return authorization;

      const fileId = dependencies.ids.next();
      const storageKey = dependencies.keys.next();
      const occurredAt = dependencies.clock.now();
      const filename = input.filename.trim();
      const title = input.title.trim();
      let scan: "clean" | "quarantined";
      try {
        scan = await dependencies.scanner.inspect({
          bytes: input.bytes,
          filename,
          mimeType,
        });
      } catch {
        return { status: "unavailable" };
      }

      let reserved: Awaited<
        ReturnType<FileMetadataRepository["reserveUpload"]>
      >;
      try {
        reserved = await dependencies.transaction.run(async (transaction) =>
          dependencies.repository.reserveUpload({
            ...actor,
            byteSize: input.bytes.byteLength,
            checksumSha256: await checksum(input.bytes),
            fileId,
            filename,
            kind: input.kind,
            mimeType,
            occurredAt,
            personId,
            storageKey,
            storageBucket: dependencies.storage.bucket,
            storageProvider: dependencies.storage.provider,
            title,
            transaction,
          })
        );
      } catch {
        return { status: "unavailable" };
      }
      if (reserved.status !== "reserved") return reserved;

      try {
        await dependencies.storage.put({
          bytes: input.bytes,
          key: storageKey,
          mimeType,
        });
      } catch {
        await dependencies.transaction.run((transaction) =>
          dependencies.repository.markMissing({
            ...actor,
            fileId,
            occurredAt,
            transaction,
          })
        ).catch(() => {});
        return { status: "unavailable" };
      }

      try {
        const result = await dependencies.transaction.run(
          async (transaction) => {
            const finalized = await dependencies.repository.finalizeUpload({
              ...actor,
              fileId,
              occurredAt,
              personId,
              status: scan === "clean" ? "available" : "quarantined",
              transaction,
            });
            if (finalized.status !== "created") return finalized;
            await dependencies.audit.record({
              action: "uploaded",
              actor,
              file: finalized.file,
              occurredAt,
              transaction,
            });
            return finalized;
          },
        );
        return result.status === "created"
          ? { file: publicFile(result.file), status: "created" }
          : result;
      } catch {
        return { status: "unavailable" };
      }
    },

    list: async (
      actor: PersonFileActor,
      personId: string,
    ): Promise<ListPersonFilesResult> => {
      try {
        const result = await dependencies.transaction.run((transaction) =>
          dependencies.repository.list({ ...actor, personId, transaction })
        );
        return result.status === "ready"
          ? { files: result.files.map(publicFile), status: "ready" }
          : result;
      } catch {
        return { status: "unavailable" };
      }
    },

    download: async (
      actor: PersonFileActor,
      personId: string,
      fileId: string,
    ): Promise<DownloadPersonFileResult> => {
      let found: Awaited<ReturnType<FileMetadataRepository["find"]>>;
      try {
        found = await dependencies.transaction.run((transaction) =>
          dependencies.repository.find({
            ...actor,
            fileId,
            personId,
            transaction,
          })
        );
      } catch {
        return { status: "unavailable" };
      }
      if (found.status !== "found") return found;
      if (found.file.status !== "available") {
        return { status: found.file.status };
      }

      let bytes: Uint8Array | undefined;
      try {
        bytes = await dependencies.storage.get({ key: found.file.storageKey });
      } catch {
        return { status: "unavailable" };
      }
      const occurredAt = dependencies.clock.now();
      if (!bytes) {
        try {
          await dependencies.transaction.run((transaction) =>
            dependencies.repository.markMissing({
              ...actor,
              fileId,
              occurredAt,
              transaction,
            })
          );
        } catch {
          return { status: "unavailable" };
        }
        return { status: "missing" };
      }
      try {
        await dependencies.transaction.run(async (transaction) => {
          await dependencies.repository.recordRead({
            ...actor,
            fileId,
            personId,
            transaction,
          });
          await dependencies.audit.record({
            action: "read",
            actor,
            file: found.file,
            occurredAt,
            transaction,
          });
        });
      } catch {
        return { status: "unavailable" };
      }
      return { bytes, file: publicFile(found.file), status: "ready" };
    },

    remove: async (
      actor: PersonFileActor,
      personId: string,
      fileId: string,
    ): Promise<RemovePersonFileResult> => {
      const occurredAt = dependencies.clock.now();
      try {
        const removed = await dependencies.transaction.run(
          async (transaction) => {
            const reserved = await dependencies.repository.reserveRemoval({
              ...actor,
              fileId,
              occurredAt,
              personId,
              transaction,
            });
            if (reserved.status !== "reserved") return reserved;
            await dependencies.storage.remove({
              key: reserved.file.storageKey,
            });
            const result = await dependencies.repository.finalizeRemoval({
              ...actor,
              fileId,
              occurredAt,
              personId,
              transaction,
            });
            if (result.status !== "removed") return result;
            await dependencies.audit.record({
              action: "removed",
              actor,
              file: result.file,
              occurredAt,
              transaction,
            });
            return result;
          },
        );
        return removed.status === "removed"
          ? { fileId, status: "removed" }
          : removed;
      } catch {
        return { status: "unavailable" };
      }
    },
  };
}

export type PersonFileManagement = ReturnType<
  typeof createPersonFileManagement
>;
