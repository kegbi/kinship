/**
 * Calendar-feed composition (GAP-052). Only a declared composition root
 * imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresCalendarFeedRepository } from "./adapters/postgres/calendar_feed_repository.ts";
import { createCalendarFeed } from "./public.ts";

export function composeCalendarFeed(shared: SharedComposition) {
  return createCalendarFeed({
    actors: shared.actors,
    clock: shared.clock,
    repository: new PostgresCalendarFeedRepository(shared.database),
    transaction: shared.peopleTransaction,
  });
}
