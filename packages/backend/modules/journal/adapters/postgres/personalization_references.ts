import { referenceCounter } from "../../../../platform/postgres/reference_counter.ts";

/** Where the journal names a workspace life-event type. */
export const PostgresJournalPersonalizationReferences = referenceCounter({
  "life-event-types": {
    sites: [{ column: "life_event_type_id", source: "crm.life_events" }],
  },
});
