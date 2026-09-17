/**
 * Listing a person's files and handing one back.
 *
 * A download is a read that writes twice: the object store is not in the
 * database's unit of work, so the row is found in one transaction, the bytes
 * are fetched outside any, and a second transaction either records that the
 * object has gone missing or records the read and audits it. Nothing is
 * decided here — what a reader may see is `publicFile`'s rule, and a file that
 * is not available reports its own status.
 */

import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import { type PersonFileRecord, publicFile } from "../domain/file_rules.ts";
import type { PersonFileActor } from "../ports/context.ts";
import {
  active,
  type PersonFileManagementDependencies,
} from "./person_file_context.ts";

export type ListPersonFilesResult =
  | { readonly files: readonly PersonFileRecord[]; readonly status: "ready" }
  | Failure<"forbidden" | "not-found" | "unavailable">;

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

export function createPersonFileReads(
  dependencies: PersonFileManagementDependencies,
) {
  return {
    list: async (
      actor: PersonFileActor,
      personId: string,
    ): Promise<ListPersonFilesResult> => {
      const result = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, false)) {
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
          if (!await active(dependencies, actor, transaction, false)) {
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
            if (!await active(dependencies, actor, transaction, true)) {
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
          if (!await active(dependencies, actor, transaction, true)) {
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
  };
}
