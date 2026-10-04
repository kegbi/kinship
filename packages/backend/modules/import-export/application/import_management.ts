/**
 * The import facade.
 *
 * An import is three separate pieces of work — reading a file and staging what
 * it would do, committing those rows into people, and listing what has been
 * run — which share only the context they each establish first. They are
 * assembled here so a composition root still builds one object with `dryRun`,
 * `commit`, `get`, `list`, and `mapColumns` on it, and so the split stays an internal matter
 * rather than something every caller has to know about.
 */

import type {
  ImportCommitResult,
  ImportListResult,
  ImportReadResult,
} from "../domain/import_rules.ts";
import type { ImportActor } from "../ports/context.ts";
import { createImportCommit } from "./import_commit.ts";
import type { ImportManagementDependencies } from "./import_context.ts";
import { createImportReads } from "./import_reads.ts";
import {
  createImportStaging,
  type CsvMappingResult,
  type DryRunResult,
} from "./import_staging.ts";

export interface ImportManagement {
  commit(
    actor: ImportActor,
    importId: string,
    confirmed: boolean,
    contactMethodTypes?:
      readonly import("../domain/contact_type_mapping.ts").ContactTypeDecision[],
  ): Promise<ImportCommitResult>;
  dryRun(actor: ImportActor, source: unknown): Promise<DryRunResult>;
  get(actor: ImportActor, importId: string): Promise<ImportReadResult>;
  list(actor: ImportActor): Promise<ImportListResult>;
  /** Applies a member's column mapping to a pending CSV run (GAP-050). */
  mapColumns(
    actor: ImportActor,
    importId: string,
    mapping: readonly string[],
  ): Promise<CsvMappingResult>;
}

export function createImportManagement(
  dependencies: ImportManagementDependencies,
): ImportManagement {
  const commit = createImportCommit(dependencies);
  const reads = createImportReads(dependencies);
  const staging = createImportStaging(dependencies);
  return {
    commit: commit.commit,
    dryRun: staging.dryRun,
    get: reads.get,
    list: reads.list,
    mapColumns: staging.mapColumns,
  };
}
