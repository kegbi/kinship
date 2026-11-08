/**
 * Listing a person's files and handing one back.
 *
 * A download is a read that writes twice: the object store is not in the
 * database's unit of work, so the row is found in one transaction, the bytes
 * are fetched outside any, and a second transaction either records that the
 * object has gone missing or records the read and audits it. Nothing is
 * decided here — what a reader may see is `publicFile`'s rule, and a file that
 * is not available reports its own status.
 *
 * The listing pages: one request serves the photo card and the document card
 * in that order, so a cursor resumes the combined listing rather than either
 * card on its own. A cursor that does not decode for this workspace and this
 * person is a rejected query rather than an empty page.
 */

import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import type { Failure } from "../../../shared-kernel/result.ts";
import {
  decodePersonFileCursor,
  encodePersonFileCursor,
} from "../domain/cursors.ts";
import {
  type PersonFileRecord,
  publicFile,
  recordsReads,
} from "../domain/file_rules.ts";
import type { PersonFileActor } from "../ports/context.ts";
import {
  active,
  type PersonFileManagementDependencies,
} from "./person_file_context.ts";

/** The largest page this listing serves, as the contract publishes it. */
export const PERSON_FILE_PAGE_LIMIT_MAXIMUM = 50;
/** The page it serves when the caller names no size. */
export const PERSON_FILE_PAGE_LIMIT_DEFAULT = 20;

/** Where a caller asked the listing to resume, and how many rows. */
export interface ListPersonFilesInput {
  readonly cursor?: string;
  readonly limit?: number;
}

/** The page size this listing accepts, clamped to what it will serve. */
export function personFilePageLimit(limit: number | undefined): number {
  return Math.max(
    1,
    Math.min(
      PERSON_FILE_PAGE_LIMIT_MAXIMUM,
      Math.trunc(limit ?? PERSON_FILE_PAGE_LIMIT_DEFAULT),
    ),
  );
}

export type ListPersonFilesResult =
  | {
    readonly files: readonly PersonFileRecord[];
    readonly nextCursor?: string;
    readonly status: "ready";
  }
  | Failure<
    "forbidden" | "not-found" | "unavailable",
    "validation-error"
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

export function createPersonFileReads(
  dependencies: PersonFileManagementDependencies,
) {
  return {
    list: async (
      actor: PersonFileActor,
      personId: string,
      input: ListPersonFilesInput = {},
    ): Promise<ListPersonFilesResult> => {
      const after = input.cursor
        ? decodePersonFileCursor(input.cursor, actor.workspaceId, personId)
        : undefined;
      if (input.cursor && !after) return { status: "validation-error" };
      const result = await runOrUnavailable(
        dependencies.transaction,
        async (transaction) => {
          if (!await active(dependencies, actor, transaction, false)) {
            return { status: "forbidden" as const };
          }
          return await dependencies.repository.list({
            ...actor,
            ...(after ? { after } : {}),
            limit: personFilePageLimit(input.limit),
            personId,
            transaction,
          });
        },
        { workspaceId: actor.workspaceId },
      );
      if (result.status !== "ready") return result;
      return {
        files: result.files.map(publicFile),
        ...(result.next
          ? {
            nextCursor: encodePersonFileCursor(
              result.next,
              actor.workspaceId,
              personId,
            ),
          }
          : {}),
        status: "ready",
      };
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
        { workspaceId: actor.workspaceId },
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
          { workspaceId: actor.workspaceId },
        );
      }
      if (!recordsReads(found.file.kind)) {
        return { bytes, file: publicFile(found.file), status: "ready" };
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
        { workspaceId: actor.workspaceId },
      );
      if (recorded.status !== "recorded") return recorded;
      return { bytes, file: publicFile(found.file), status: "ready" };
    },
  };
}
