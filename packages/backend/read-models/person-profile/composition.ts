/**
 * Person-profile composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresPersonProfileRepository } from "./adapters/postgres/person_profile_repository.ts";
import { createPersonProfile } from "./public.ts";

export function composePersonProfile(shared: SharedComposition) {
  return createPersonProfile({
    actors: shared.actors,
    repository: new PostgresPersonProfileRepository(shared.database),
    transaction: shared.peopleTransaction,
  });
}
