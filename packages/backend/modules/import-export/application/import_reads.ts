/**
 * Listing import runs, and reading one.
 *
 * Both reads open a transaction only to establish the caller's standing
 * without a lock, and both answer a member with emptiness rather than with a
 * refusal: an import run is an administrative record, and a member who cannot
 * see one does not need to be told that it exists.
 */

import type { ImportSummary } from "../domain/import_rules.ts";
import type { ImportActor } from "../ports/context.ts";
import {
  type ImportManagementDependencies,
  readable,
} from "./import_context.ts";

export function createImportReads(dependencies: ImportManagementDependencies) {
  return {
    get: async (
      actor: ImportActor,
      importId: string,
    ): Promise<ImportSummary | undefined> => {
      if (actor.role === "member") return undefined;
      return await dependencies.transaction.run(async (transaction) =>
        await readable(dependencies, actor, transaction)
          ? await dependencies.repository.get(actor, importId)
          : undefined
      );
    },
    list: async (actor: ImportActor): Promise<readonly ImportSummary[]> => {
      if (actor.role === "member") return [];
      return await dependencies.transaction.run(async (transaction) =>
        await readable(dependencies, actor, transaction)
          ? await dependencies.repository.list(actor)
          : []
      );
    },
  };
}
