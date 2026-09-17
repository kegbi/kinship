/**
 * What exporting needs before it may proceed.
 *
 * Every export path either writes a run or hands out workspace data, so every
 * one of them re-establishes the caller's standing with their rows locked,
 * inside the transaction the work will happen in. The single exception is the
 * person vCard, which reads one person and takes no lock; it asks for itself,
 * in `export_downloads.ts`, where the reason is visible.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { ExportFileBoundary } from "../../files/public.ts";
import type { ExportAudit } from "../../governance/public.ts";
import type { PeopleExportBoundary } from "../../people/public.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";
import type { ExportRepository } from "../ports/export_repository.ts";
import type {
  ExportActor,
  ExportTransaction,
  ExportTransactionRunner,
} from "../ports/context.ts";

export interface ExportManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: ExportAudit;
  readonly clock: Clock;
  readonly files: ExportFileBoundary;
  readonly ids: { next(): string };
  readonly people: PeopleExportBoundary;
  readonly repository: ExportRepository;
  readonly tokens: { next(): string };
  readonly transaction: ExportTransactionRunner;
}

/** The actor's standing, with their rows locked because a write follows. */
export async function active(
  dependencies: ExportManagementDependencies,
  actor: ExportActor,
  transaction: ExportTransaction,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock: true,
    transaction,
  }) === "active";
}
