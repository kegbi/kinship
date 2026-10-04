import type { ImportedContactMethodType } from "../domain/contact_import.ts";
import type { BusinessEntity } from "../domain/business_entities.ts";
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
 * everybody. A contact whose person was deleted since is retargeted too, so
 * every later run finds the same deleted person and skips them again.
 */

import type {
  ImportCommitCounts,
  ImportReport,
  ImportSummary,
  PreparedImportCommit,
  StagedContact,
} from "../domain/import_rules.ts";
import type { ImportActor, ImportTransaction } from "./context.ts";

/** Everything one dry run produced, written in a single statement. */
export interface StageImportCommand {
  readonly contactTypeCatalog?: readonly ImportedContactMethodType[];
  readonly compatibleFingerprints?: readonly string[];
  readonly businessEntities?: readonly BusinessEntity[];
  readonly sourceProfile?: "json_export" | "sql_export";
  readonly actor: ImportActor;
  readonly contacts: readonly StagedContact[];
  readonly fingerprint: string;
  readonly importId: string;
  readonly report: ImportReport;
  readonly transaction: ImportTransaction;
}

export interface ContactTypeOutcome {
  readonly createdTypes: number;
  readonly mappedMethods: number;
  readonly skippedMethods: number;
}

export interface ImportRepository {
  retargetBusinessEntity?(
    importId: string,
    entity: BusinessEntity,
    targetId: string,
    transaction: ImportTransaction,
  ): Promise<void>;
  complete(
    actor: ImportActor,
    importId: string,
    counts: ImportCommitCounts,
    transaction: ImportTransaction,
    contactTypeOutcome?: ContactTypeOutcome,
    choices?: import("../domain/monica_choices.ts").MonicaChoices,
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
