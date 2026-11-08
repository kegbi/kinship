/**
 * Person-profile composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresPersonProfileRepository } from "./adapters/postgres/person_profile_repository.ts";
import { createPersonProfile, type PersonRailSources } from "./public.ts";

/**
 * `rail` is the owning modules' public reads the person rail is composed
 * from (AUD-Q3); the root passes the use cases it composed for those modules.
 */
export function composePersonProfile(
  shared: SharedComposition,
  rail?: PersonRailSources,
) {
  return createPersonProfile({
    actors: shared.actors,
    ...(rail ? { rail } : {}),
    repository: new PostgresPersonProfileRepository(shared.database),
    transaction: shared.peopleTransaction,
  });
}
