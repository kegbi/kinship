/**
 * How the module stores an export run and the links handed out for it.
 *
 * Producing an artifact takes long enough that a run can be interrupted in the
 * middle, so `startOrResume` says whether it claimed a new run or rejoined one
 * and `lock` re-reads it under lock before the work continues. That pair is
 * why a member who asks twice gets one artifact rather than two.
 *
 * A download link is a one-shot credential: `issueDownload` stores only its
 * digest and `consumeDownload` spends it, answering with the artifact or with
 * the reason it will not — expired, or never issued at all.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  ExportFormat,
  ExportManifest,
  ExportSummary,
  StoredExport,
} from "../domain/export_rules.ts";
import type { ExportActor, ExportTransaction } from "./context.ts";

export interface ExportRepository {
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
    | Failure<"not-found", "expired">
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
  /** Claims a run of `format`, or rejoins the actor's running one of it. */
  startOrResume(command: {
    readonly actor: ExportActor;
    readonly exportId: string;
    readonly format: ExportFormat;
    readonly startedAt: Date;
    readonly transaction: ExportTransaction;
  }): Promise<{ readonly created: boolean; readonly exportId: string }>;
}
