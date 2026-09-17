/**
 * Listing import runs, and reading one.
 *
 * Both reads ask the role rule first and refuse a member outright: an import
 * run is an administrative record, and the route file made that refusal
 * itself until GAP-020. Beyond the role, both open a transaction only to
 * establish the caller's standing without a lock, and a caller whose standing
 * has since been revoked is answered with emptiness rather than a second
 * refusal — they were entitled to ask, and what they are told is that there is
 * nothing to see.
 */

import {
  type ImportListResult,
  type ImportReadResult,
  mayImport,
} from "../domain/import_rules.ts";
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
    ): Promise<ImportReadResult> => {
      if (!mayImport(actor.role)) return { status: "forbidden" };
      return await dependencies.transaction.run(async (transaction) => {
        if (!await readable(dependencies, actor, transaction)) {
          return { status: "not-found" };
        }
        const found = await dependencies.repository.get(actor, importId);
        return found
          ? { import: found, status: "ready" }
          : { status: "not-found" };
      });
    },
    list: async (actor: ImportActor): Promise<ImportListResult> => {
      if (!mayImport(actor.role)) return { status: "forbidden" };
      return await dependencies.transaction.run(async (transaction) => ({
        imports: await readable(dependencies, actor, transaction)
          ? await dependencies.repository.list(actor)
          : [],
        status: "ready",
      }));
    },
  };
}
