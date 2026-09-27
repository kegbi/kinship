/**
 * Workspace-search composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresSearchRepository } from "./adapters/postgres/search_repository.ts";
import { createWorkspaceSearch } from "./public.ts";

export function composeSearch(shared: SharedComposition) {
  return createWorkspaceSearch({
    actors: shared.actors,
    repository: new PostgresSearchRepository(shared.database),
    transaction: shared.peopleTransaction,
  });
}
