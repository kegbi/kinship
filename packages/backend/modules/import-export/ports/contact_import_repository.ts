/**
 * How a vCard or CSV import run is stored (GAP-050).
 *
 * The contact formats use the same three tables as a Monica run —
 * `data_imports`, `data_import_entities`, `data_import_reports` — and the
 * same commit, so this port only adds what they do differently.
 *
 * - A vCard run is staged in one step, like a Monica run.
 * - A CSV run is staged in two. The file's rows are stored first, raw, in a
 *   `pending` run whose stats carry the header and the preview, and the
 *   member's column mapping is applied to them later. The mapping is saved
 *   on the run, so a member who leaves between the two steps can come back
 *   to the same run rather than upload the file again.
 *
 * `history` is how a dry run learns which of its rows an earlier completed
 * import of the same format into the same workspace already brought in, by
 * the identity each row was staged under: its source key (a vCard `UID`) or,
 * without one, its fingerprint. A row whose key matches but whose
 * fingerprint differs is a conflict. The commit asks the same question, in
 * `ImportRepository.prepareCommit`, and reuses the earlier person either way.
 */

import type {
  ContactSourceSystem,
  CsvPreview,
  CsvTarget,
  StagedSourceContact,
} from "../domain/contact_import.ts";
import type { ImportReport } from "../domain/import_rules.ts";
import type { ImportActor, ImportTransaction } from "./context.ts";

/** A pending CSV run, locked for its mapping to be applied. */
export interface PendingCsvRun {
  /** The whole file's fingerprint, recorded when it was staged. */
  readonly fingerprint: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

/** A staged row an earlier completed import already brought in. */
export interface ContactImportMatch {
  /** Whether the earlier row said something different under that identity. */
  readonly changed: boolean;
  readonly row: number;
  readonly targetPersonId: string;
}

export interface ContactImportRepository {
  /**
   * The rows of `rows` an earlier completed import already holds, and
   * whether one read exactly this file (`fingerprint`).
   */
  history(command: {
    readonly actor: ImportActor;
    readonly fingerprint: string;
    readonly rows: readonly StagedSourceContact[];
    readonly sourceSystem: ContactSourceSystem;
    readonly transaction: ImportTransaction;
  }): Promise<{
    readonly fileImportedBefore: boolean;
    readonly matches: readonly ContactImportMatch[];
  }>;
  /** A pending CSV run's rows, under lock, or nothing when there is none. */
  lockPendingCsv(
    actor: ImportActor,
    importId: string,
    transaction: ImportTransaction,
  ): Promise<PendingCsvRun | undefined>;
  /**
   * Applies a mapping's staged rows and report to a pending CSV run. Each
   * row's raw cells are replaced by what the mapping kept, and the preview
   * is dropped, so nothing the member did not map is kept.
   */
  mapCsv(command: {
    readonly actor: ImportActor;
    readonly importId: string;
    readonly mapping: readonly CsvTarget[];
    readonly report: ImportReport;
    readonly rows: readonly StagedSourceContact[];
    readonly transaction: ImportTransaction;
  }): Promise<void>;
  /** A vCard run, staged in one statement per row. */
  stageContacts(command: {
    readonly actor: ImportActor;
    readonly fingerprint: string;
    readonly importId: string;
    readonly report: ImportReport;
    readonly rows: readonly StagedSourceContact[];
    readonly sourceSystem: ContactSourceSystem;
    readonly transaction: ImportTransaction;
  }): Promise<void>;
  /** A CSV file's raw rows, stored as a run awaiting its mapping. */
  stagePendingCsv(command: {
    readonly actor: ImportActor;
    readonly fingerprint: string;
    readonly importId: string;
    readonly preview: CsvPreview;
    readonly rows: readonly (readonly string[])[];
    readonly transaction: ImportTransaction;
  }): Promise<void>;
}
