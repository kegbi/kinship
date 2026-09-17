/**
 * What an administrator is shown about the workspace's storage.
 *
 * This is one read over every file in the workspace rather than one person's,
 * so it is its own port: the totals are counted in the database and the page
 * is a lookup, which is why the item below carries the person's name beside
 * the file and why neither is the record a person's own file list returns.
 *
 * The usage totals live here rather than in the domain because nothing decides
 * anything about them — they are counted, reported, and never compared.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type { PersonFileStatus } from "../domain/file_rules.ts";
import type { PersonFileActor, PersonFileTransaction } from "./context.ts";

/** One file as the storage page lists it, with whose it is. */
export interface StorageFileLookupItem {
  readonly byteSize: number;
  readonly createdAt: string;
  readonly fileId: string;
  readonly filename: string;
  readonly kind: string;
  readonly mimeType: string;
  readonly personId?: string;
  readonly personName?: string;
  readonly status: PersonFileStatus;
  readonly title: string;
}

/** What the workspace is storing, counted by the database. */
export interface StorageUsage {
  readonly available: number;
  readonly missing: number;
  readonly processing: number;
  readonly quarantined: number;
  readonly totalBytes: number;
  readonly totalFiles: number;
}

export interface StorageSettingsRepository {
  read(
    command: PersonFileActor & {
      readonly query?: string;
      readonly transaction: PersonFileTransaction;
    },
  ): Promise<
    | {
      readonly files: readonly StorageFileLookupItem[];
      readonly status: "ready";
      readonly usage: StorageUsage;
    }
    | Failure<"forbidden">
  >;
}
