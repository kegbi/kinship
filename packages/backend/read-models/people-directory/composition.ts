/**
 * People-directory composition. Only a declared composition root imports it.
 *
 * The directory, its tag options, its duplicate review (GAP-049), and its tag
 * facet (GAP-053) read the same repository, so they share one instance.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresPeopleDirectoryRepository } from "./adapters/postgres/people_directory_repository.ts";
import {
  createPeopleDirectory,
  createPeopleDuplicates,
  createPeopleTagFacet,
  createPeopleTagOptions,
} from "./public.ts";

export function composePeopleDirectory(shared: SharedComposition) {
  const dependencies = {
    actors: shared.actors,
    repository: new PostgresPeopleDirectoryRepository(shared.database),
    transaction: shared.peopleTransaction,
  };
  return {
    directory: createPeopleDirectory(dependencies),
    duplicates: createPeopleDuplicates(dependencies),
    tagFacet: createPeopleTagFacet(dependencies),
    tagOptions: createPeopleTagOptions(dependencies),
  };
}
