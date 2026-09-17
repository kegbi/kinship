import { referenceCounter } from "../../../../platform/postgres/reference_counter.ts";

/**
 * Where interactions name a workspace personalization entry. Emotions are
 * reported to the operator but never re-pointed: an interaction's recorded
 * feeling is history, not a classification the workspace may restate.
 */
export const PostgresInteractionPersonalizationReferences = referenceCounter({
  "activity-types": {
    sites: [{ column: "activity_type_id", source: "crm.activities" }],
  },
  "contact-method-types": {
    sites: [{ column: "channel_type_id", source: "crm.conversation_threads" }],
  },
  "emotion-options": {
    sites: [
      {
        column: "emotion_id",
        countOnly: true,
        source: "crm.activity_emotions via crm.activities.activity_id",
      },
      {
        column: "emotion_id",
        countOnly: true,
        source: "crm.call_emotions via crm.calls.call_id",
      },
    ],
  },
});
