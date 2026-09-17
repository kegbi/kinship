import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/** What a workspace cascade destroys in interactions, table by table. */
export const PostgresInteractionWorkspaceLifecycleImpact =
  workspaceLifecycleImpact({
    counts: {
      activities: "crm.activities",
      calls: "crm.calls",
      messages: "crm.messages via crm.conversation_threads.conversation_id",
      notes: "crm.notes",
    },
    revision: {
      activities: "crm.activities@id",
      participants:
        "crm.activity_participants@activity_id,person_id via crm.activities.activity_id",
      activityEmotions:
        "crm.activity_emotions@activity_id,emotion_id via crm.activities.activity_id",
      calls: "crm.calls@id",
      callEmotions:
        "crm.call_emotions@call_id,emotion_id via crm.calls.call_id",
      threads: "crm.conversation_threads@id",
      messages: "crm.messages@id via crm.conversation_threads.conversation_id",
      notes: "crm.notes@id",
    },
  });
