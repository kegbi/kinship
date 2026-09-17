/**
 * The interaction facade.
 *
 * An interaction is read one way — the vocabulary a member picks from — and
 * written one way, and the two halves share only the context they both
 * establish first. They are assembled here so a composition root still builds
 * a single object with `options` and `record` on it, and so the split between
 * `interaction_listing.ts` and `interaction_writes.ts` stays an internal
 * matter rather than something every caller has to know about.
 */

import { createInteractionListing } from "./interaction_listing.ts";
import { createInteractionWrites } from "./interaction_writes.ts";
import type { InteractionDependencies } from "./interaction_context.ts";

export function createInteractionManagement(
  dependencies: InteractionDependencies,
) {
  const listing = createInteractionListing(dependencies);
  const writes = createInteractionWrites(dependencies);
  return {
    options: listing.options,
    record: writes.record,
  };
}

export type InteractionManagement = ReturnType<
  typeof createInteractionManagement
>;
