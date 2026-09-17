/**
 * The profile-fact facade.
 *
 * One section of a person's profile is read one way and written three, and the
 * two halves share nothing but the context they both establish first. They are
 * assembled here so a composition root still builds a single object with
 * `list`, `create`, `update`, and `delete` on it, and so the split between
 * `profile_fact_listing.ts` and `profile_fact_writes.ts` stays an internal
 * matter rather than something every caller has to know about.
 */

import { createProfileFactListing } from "./profile_fact_listing.ts";
import { createProfileFactWrites } from "./profile_fact_writes.ts";
import type { ProfileFactDependencies } from "./profile_fact_context.ts";

export function createProfileFactManagement(
  dependencies: ProfileFactDependencies,
) {
  const writes = createProfileFactWrites(dependencies);
  return {
    list: createProfileFactListing(dependencies),
    create: writes.create,
    update: writes.update,
    delete: writes.delete,
  };
}

export type ProfileFactManagement = ReturnType<
  typeof createProfileFactManagement
>;
