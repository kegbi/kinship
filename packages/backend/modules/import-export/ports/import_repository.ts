/**
 * How the module stores an import run.
 *
 * A run is staged once and committed once, and the two are separated by
 * however long the member takes to look at the report, so every method takes
 * the actor as well as the identifier: the rows are the workspace's and the
 * repository scopes them by the standing the use case just established.
 *
 * `prepareCommit` is the one that carries the weight. It answers with the
 * staged rows under lock, or says the run is already finished, so a member who
 * confirms twice commits once. `retargetContact` is how the commit records
 * that a staged contact landed on a person who was already there, which is
 * what makes re-importing the same file idempotent rather than duplicating
 * everybody.
 */

import type {
  ImportReport,
  ImportSummary,
  PreparedImportCommit,
  StagedContact,
} from "../domain/import_rules.ts";
import type { ImportActor, ImportTransaction } from "./context.ts";

/** Everything one dry run produced, written in a single statement. */
export interface StageImportCommand {
  readonly actor: ImportActor;
  readonly contacts: readonly StagedContact[];
  readonly fingerprint: string;
  readonly importId: string;
  readonly report: ImportReport;
  readonly transaction: ImportTransaction;
}

export interface ImportRepository {
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
    entityId: string,
    targetPersonId: string,
    transaction: ImportTransaction,
  ): Promise<void>;
  stage(command: StageImportCommand): Promise<{
    readonly importId: string;
    readonly report: ImportReport;
    readonly status: "dry_run";
  }>;
}
