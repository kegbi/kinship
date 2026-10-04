import type { BusinessImportBoundaries } from "./application/business_import.ts";
/**
 * Import-export composition. Only a declared composition root imports it.
 *
 * Both use cases are pure orchestration over other modules' boundaries, so
 * every collaborator arrives as a port.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresImportPersonMergeParticipant } from "./adapters/postgres/person_merge_participant.ts";
import {
  PostgresExportRepository,
  PostgresExportTransaction,
} from "./adapters/postgres/export_repository.ts";
import { PostgresContactImportRepository } from "./adapters/postgres/contact_import_repository.ts";
import {
  PostgresImportRepository,
  PostgresImportTransaction,
} from "./adapters/postgres/import_repository.ts";
import { PostgresImportExportWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import {
  createExportManagement,
  createImportManagement,
  type ExportFileBoundary,
} from "./public.ts";
import { exportAuditFrom, importAuditFrom } from "../governance/public.ts";
import type { FileImportBoundary } from "../files/public.ts";
import type { InteractionImportBoundary } from "../interactions/public.ts";
import type {
  PeopleExportBoundary,
  PeopleImportBoundary,
} from "../people/public.ts";
import type { ContactMethodTypeCatalog } from "../workspaces/public.ts";

export interface ImportExportPorts {
  readonly business?: BusinessImportBoundaries;
  readonly exportFiles: ExportFileBoundary;
  readonly exportPeople: PeopleExportBoundary;
  /** The workspace types a vCard or CSV contact method is filed under. */
  readonly importContactTypes: ContactMethodTypeCatalog;
  readonly importFiles: FileImportBoundary;
  /** Where a vCard or CSV contact's note is written. */
  readonly importNotes: InteractionImportBoundary;
  readonly importPeople: PeopleImportBoundary;
}

export function composeImportExport(
  shared: SharedComposition,
  ports: ImportExportPorts,
) {
  return {
    exports: createExportManagement({
      actors: shared.actors,
      audit: exportAuditFrom(shared.audit),
      clock: shared.clock,
      files: ports.exportFiles,
      ids: { next: () => shared.ids.create() },
      people: ports.exportPeople,
      repository: new PostgresExportRepository(),
      tokens: { next: () => crypto.randomUUID() },
      transaction: new PostgresExportTransaction(shared.database),
    }),
    imports: createImportManagement({
      ...(ports.business ? { business: ports.business } : {}),
      actors: shared.actors,
      audit: importAuditFrom(shared.audit),
      contactTypes: ports.importContactTypes,
      contacts: new PostgresContactImportRepository(),
      files: ports.importFiles,
      ids: { next: () => shared.ids.create() },
      notes: ports.importNotes,
      people: ports.importPeople,
      repository: new PostgresImportRepository(shared.database),
      transaction: new PostgresImportTransaction(shared.database),
    }),
    lifecycleImpact: PostgresImportExportWorkspaceLifecycleImpact,
  };
}

/**
 * This module's rows in a person merge (the import identity map, GAP-049). It depends on
 * nothing the module composes, so the root registers it before composing
 * people.
 */
export function importPersonMergeParticipant(): PostgresImportPersonMergeParticipant {
  return new PostgresImportPersonMergeParticipant();
}
