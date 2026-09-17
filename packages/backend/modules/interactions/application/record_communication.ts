/**
 * The communication facade.
 *
 * Communications are read two ways — the channels a member may pick and one
 * person's history — and written one, and all three share only the context
 * they establish first. They are assembled here so a composition root still
 * builds a single object with `communicationOptions`, `listCommunications`,
 * and `recordCommunication` on it, and so the split between
 * `communication_listing.ts` and `communication_writes.ts` stays an internal
 * matter rather than something every caller has to know about.
 */

import { createCommunicationListing } from "./communication_listing.ts";
import { createCommunicationWrites } from "./communication_writes.ts";
import type { CommunicationDependencies } from "./communication_context.ts";

export function createCommunicationManagement(
  dependencies: CommunicationDependencies,
) {
  const listing = createCommunicationListing(dependencies);
  const writes = createCommunicationWrites(dependencies);
  return {
    communicationOptions: listing.communicationOptions,
    listCommunications: listing.listCommunications,
    recordCommunication: writes.recordCommunication,
  };
}

export type CommunicationManagement = ReturnType<
  typeof createCommunicationManagement
>;
