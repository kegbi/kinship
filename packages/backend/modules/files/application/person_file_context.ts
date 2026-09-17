/**
 * What every step of a file operation needs before it may proceed.
 *
 * Files are the one module where a single use case opens several transactions:
 * the bytes go to an object store that is not in the database's unit of work,
 * so an upload reserves a row, leaves the transaction to put the object, and
 * opens another to finalise. Each of those steps therefore re-establishes the
 * actor's standing inside its own transaction, and that step and the
 * dependency set every path shares are written once here.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { FileAudit } from "../ports/audit.ts";
import type {
  PersonFileActor,
  PersonFileTransaction,
  PersonFileTransactionRunner,
} from "../ports/context.ts";
import type { FileMetadataRepository } from "../ports/file_metadata_repository.ts";
import type { FileScanner, ObjectStorage } from "../ports/object_storage.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface PersonFileManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: FileAudit;
  readonly clock: Clock;
  readonly ids: { next(): string };
  readonly keys: { next(): string };
  readonly repository: FileMetadataRepository;
  readonly scanner: FileScanner;
  readonly storage: ObjectStorage;
  readonly transaction: PersonFileTransactionRunner;
}

/**
 * The actor's standing, asked first inside each step's own transaction. Write
 * steps lock the actor's rows; reads keep their lock-free concurrency.
 */
export async function active(
  dependencies: Pick<PersonFileManagementDependencies, "actors">,
  actor: PersonFileActor,
  transaction: PersonFileTransaction,
  lock: boolean,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock,
    transaction,
  }) === "active";
}
