/**
 * Adding a file to a person, and taking one away.
 *
 * Both writes are staged around an object store that is not in the database's
 * unit of work, and the staging is the whole of the orchestration. An upload
 * authorises, scans, reserves the row, puts the object, and finalises, and a
 * put that fails marks the row missing rather than leaving one that claims
 * bytes that are not there. A removal reserves, deletes the object, and
 * finalises inside one transaction, so a delete that fails takes the row
 * change with it.
 *
 * What may be uploaded, and what the scanner's answer means for the stored
 * status, are decided in `domain/file_rules.ts` before any of this begins.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import {
  checksum,
  LISTED_KINDS,
  type PersonFileRecord,
  type PersonFileUploadInput,
  publicFile,
  scannedStatus,
  validateUpload,
} from "../domain/file_rules.ts";
import type { PersonFileActor } from "../ports/context.ts";
import {
  active,
  type PersonFileManagementDependencies,
} from "./person_file_context.ts";

export type UploadPersonFileResult =
  | { readonly file: PersonFileRecord; readonly status: "created" }
  | Failure<
    "forbidden" | "not-found" | "unavailable",
    "rejected-media" | "storage-limit" | "validation-error"
  >;

export type RemovePersonFileResult =
  | { readonly fileId: string; readonly status: "removed" }
  | Failure<"forbidden" | "not-found" | "unavailable", "processing">;

export function createPersonFileWrites(
  dependencies: PersonFileManagementDependencies,
) {
  return {
    upload: async (
      actor: PersonFileActor,
      personId: string,
      input: PersonFileUploadInput,
    ): Promise<UploadPersonFileResult> => {
      const checked = validateUpload(input);
      if (checked.status !== "ready") return checked;
      const { filename, mimeType, title } = checked.values;

      const authorization = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
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
          if (!await active(dependencies, actor, transaction, true)) {
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
            if (!await active(dependencies, actor, transaction, true)) {
              return undefined;
            }
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
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const finalized = await dependencies.repository.finalizeUpload({
            ...actor,
            fileId,
            occurredAt,
            personId,
            status: scannedStatus(scan),
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

    remove: async (
      actor: PersonFileActor,
      personId: string,
      fileId: string,
    ): Promise<RemovePersonFileResult> => {
      const occurredAt = dependencies.clock.now();
      const removed = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, true)) {
            return { status: "forbidden" as const };
          }
          const reserved = await dependencies.repository.reserveRemoval({
            ...actor,
            fileId,
            kinds: LISTED_KINDS,
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
