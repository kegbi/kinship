/**
 * How the module stores what it knows about a file.
 *
 * The metadata row and the bytes live in two different places, and only one of
 * them is transactional, so every write is staged in two steps around the
 * object store. An upload reserves a row, puts the bytes, and finalises;
 * `markMissing` is what a failed put leaves behind. A removal reserves, deletes
 * the object, and finalises, so a delete that fails cannot leave a row
 * claiming the bytes are still there.
 *
 * `authorizeUpload` is asked before any of that, because whether this actor
 * may add a file to this person is not a question the staging can answer once
 * the bytes are already moving.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { PersonFilePageAnchor } from "../domain/cursors.ts";
import type { PersonFileKind, StoredPersonFile } from "../domain/file_rules.ts";
import type { PersonFileActor, PersonFileTransaction } from "./context.ts";

export interface FileMetadataRepository {
  authorizeUpload(
    command: PersonFileActor & {
      readonly personId: string;
      readonly transaction: PersonFileTransaction;
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
      readonly transaction: PersonFileTransaction;
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
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<
    | { readonly file: StoredPersonFile; readonly status: "created" }
    | Failure<"forbidden" | "not-found">
  >;
  find(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly personId: string;
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<
    | { readonly file: StoredPersonFile; readonly status: "found" }
    | Failure<"forbidden" | "not-found">
  >;
  /**
   * One page of a person's files.
   *
   * The query reads `limit` rows and answers with the anchor of the page after
   * it when one exists, so "is there more" costs the same query rather than a
   * second count.
   */
  list(
    command: PersonFileActor & {
      readonly after?: PersonFilePageAnchor;
      readonly limit: number;
      readonly personId: string;
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<
    | {
      readonly files: readonly StoredPersonFile[];
      readonly next?: PersonFilePageAnchor;
      readonly status: "ready";
    }
    | Failure<"forbidden" | "not-found">
  >;
  markMissing(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly occurredAt: Date;
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<void>;
  recordRead(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly personId: string;
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<void>;
  reserveRemoval(
    command: PersonFileActor & {
      readonly fileId: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly transaction: PersonFileTransaction;
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
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<
    | { readonly file: StoredPersonFile; readonly status: "removed" }
    | Failure<"forbidden" | "not-found">
  >;
}
