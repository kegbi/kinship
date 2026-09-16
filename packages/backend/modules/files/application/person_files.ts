import type { Clock } from "../../../shared-kernel/clock.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import { boundedText } from "../../../shared-kernel/validation.ts";
import type { PeopleTransaction } from "../../people/public.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

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
    | Failure<"forbidden" | "not-found">
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
    | Failure<"forbidden" | "not-found">
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
    | Failure<"forbidden" | "not-found">
  >;
  find(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly file: StoredPersonFile; readonly status: "found" }
    | Failure<"forbidden" | "not-found">
  >;
  list(
    command: PersonFileActor & {
      readonly personId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly files: readonly StoredPersonFile[]; readonly status: "ready" }
    | Failure<"forbidden" | "not-found">
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
    | Failure<"forbidden" | "not-found", "processing">
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
    | Failure<"forbidden" | "not-found">
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

/**
 * Which of the named gifts a workspace owns. The `gifts` module owns the gift
 * table and already depends on this one, so it fills this port at the
 * composition root instead of `files` reading a table it does not own.
 */
export interface GiftAttachmentTarget {
  ownedGiftIds(command: {
    readonly giftIds: readonly string[];
    readonly transaction: PeopleTransaction;
    readonly workspaceId: string;
  }): Promise<readonly string[]>;
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
    | Failure<"forbidden" | "not-found">
  >;
  validateForGift(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly transaction: PeopleTransaction;
    },
  ): Promise<
    | { readonly status: "ready" }
    | Failure<"forbidden" | "not-found">
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
    | Failure<"forbidden">
  >;
}

export interface PersonFileManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: FileAudit;
  readonly clock: Clock;
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
  | Failure<
    "forbidden" | "not-found" | "unavailable",
    "rejected-media" | "storage-limit" | "validation-error"
  >;

export type DownloadPersonFileResult =
  | {
    readonly bytes: Uint8Array;
    readonly file: PersonFileRecord;
    readonly status: "ready";
  }
  | Failure<
    "forbidden" | "not-found" | "unavailable",
    "deleted" | "missing" | "processing" | "quarantined"
  >;

export type ListPersonFilesResult =
  | { readonly files: readonly PersonFileRecord[]; readonly status: "ready" }
  | Failure<"forbidden" | "not-found" | "unavailable">;

export type RemovePersonFileResult =
  | { readonly fileId: string; readonly status: "removed" }
  | Failure<"forbidden" | "not-found" | "unavailable", "processing">;

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
  /**
   * Every step below opens its own transaction, so each one re-establishes the
   * actor's standing inside it. Write steps lock the actor's rows; reads keep
   * their lock-free concurrency.
   */
  const active = async (
    actor: PersonFileActor,
    transaction: PeopleTransaction,
    lock: boolean,
  ): Promise<boolean> =>
    await dependencies.actors.revalidate({ ...actor, lock, transaction }) ===
      "active";

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
        !boundedText(input.filename, 500) ||
        !boundedText(input.title, 500)
      ) {
        return { status: "validation-error" };
      }
      const mimeType = input.mimeType.toLowerCase();
      if (!allowedMedia[input.kind].has(mimeType)) {
        return { status: "rejected-media" };
      }

      const authorization = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          return await dependencies.repository.authorizeUpload({
            ...actor,
            personId,
            transaction,
          });
        },
      );
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

      const reserved = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          return await dependencies.repository.reserveUpload({
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
          });
        },
      );
      if (reserved.status !== "reserved") return reserved;

      try {
        await dependencies.storage.put({
          bytes: input.bytes,
          key: storageKey,
          mimeType,
        });
      } catch {
        await runOrUnavailable(
          dependencies.transaction,
          async (transaction) => {
            if (!await active(actor, transaction, true)) return undefined;
            return await dependencies.repository.markMissing({
              ...actor,
              fileId,
              occurredAt,
              transaction,
            });
          },
        );
        return { status: "unavailable" };
      }

      const result = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
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
    },

    list: async (
      actor: PersonFileActor,
      personId: string,
    ): Promise<ListPersonFilesResult> => {
      const result = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, false)) {
            return { status: "forbidden" as const };
          }
          return await dependencies.repository.list({
            ...actor,
            personId,
            transaction,
          });
        },
      );
      return result.status === "ready"
        ? { files: result.files.map(publicFile), status: "ready" }
        : result;
    },

    download: async (
      actor: PersonFileActor,
      personId: string,
      fileId: string,
    ): Promise<DownloadPersonFileResult> => {
      const found = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, false)) {
            return { status: "forbidden" as const };
          }
          return await dependencies.repository.find({
            ...actor,
            fileId,
            personId,
            transaction,
          });
        },
      );
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
        return await runOrUnavailable(
          dependencies.transaction,
          async (transaction) => {
            if (!await active(actor, transaction, true)) {
              return { status: "forbidden" } as const;
            }
            await dependencies.repository.markMissing({
              ...actor,
              fileId,
              occurredAt,
              transaction,
            });
            return { status: "missing" } as const;
          },
        );
      }
      const recorded = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, true)) {
            return { status: "forbidden" } as const;
          }
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
          return { status: "recorded" } as const;
        },
      );
      if (recorded.status !== "recorded") return recorded;
      return { bytes, file: publicFile(found.file), status: "ready" };
    },

    remove: async (
      actor: PersonFileActor,
      personId: string,
      fileId: string,
    ): Promise<RemovePersonFileResult> => {
      const occurredAt = dependencies.clock.now();
      const removed = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const reserved = await dependencies.repository.reserveRemoval({
            ...actor,
            fileId,
            occurredAt,
            personId,
            transaction,
          });
          if (reserved.status !== "reserved") return reserved;
          await dependencies.storage.remove({ key: reserved.file.storageKey });
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
    },
  };
}

export type PersonFileManagement = ReturnType<
  typeof createPersonFileManagement
>;
