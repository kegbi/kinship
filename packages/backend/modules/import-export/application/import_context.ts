/**
 * What importing needs before it may proceed.
 *
 * Every import path — the dry run, the commit, and the two reads — begins by
 * asking the workspace whether the caller still stands where the request said
 * they did, inside the transaction the work will happen in. The two answers
 * differ only in whether the actor's rows are locked, and the difference is a
 * rule worth keeping visible: a path that writes takes the lock, a path that
 * only lists does not, so a long listing cannot block a commit.
 */

import type { FileImportBoundary } from "../../files/public.ts";
import type { ImportAudit } from "../../governance/public.ts";
import type { PeopleImportBoundary } from "../../people/public.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";
import type { ImportRepository } from "../ports/import_repository.ts";
import type {
  ImportActor,
  ImportTransaction,
  ImportTransactionRunner,
} from "../ports/context.ts";

export interface ImportManagementDependencies {
  readonly audit: ImportAudit;
  readonly files: FileImportBoundary;
  readonly ids: { next(): string };
  readonly people: PeopleImportBoundary;
  readonly actors: ActorRevalidation;
  readonly repository: ImportRepository;
  readonly transaction: ImportTransactionRunner;
}

/** The actor's standing, with their rows locked because a write follows. */
export async function active(
  dependencies: ImportManagementDependencies,
  actor: ImportActor,
  transaction: ImportTransaction,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock: true,
    transaction,
  }) === "active";
}

/** The actor's standing for a read, which takes no lock. */
export async function readable(
  dependencies: ImportManagementDependencies,
  actor: ImportActor,
  transaction: ImportTransaction,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock: false,
    transaction,
  }) === "active";
}
