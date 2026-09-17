/**
 * Journal-timeline composition. Only a declared composition root imports it.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresJournalTimelineRepository } from "./adapters/postgres/journal_timeline_repository.ts";
import { createJournalTimeline } from "./public.ts";

export function composeJournalTimeline(shared: SharedComposition) {
  return createJournalTimeline({
    actors: shared.actors,
    repository: new PostgresJournalTimelineRepository(shared.database),
    transaction: shared.peopleTransaction,
  });
}
