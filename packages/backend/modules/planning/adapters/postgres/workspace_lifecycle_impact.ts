import { workspaceLifecycleImpact } from "../../../../platform/postgres/lifecycle_impact.ts";

/** What a workspace cascade destroys in planning, table by table. */
export const PostgresPlanningWorkspaceLifecycleImpact =
  workspaceLifecycleImpact({
    counts: { reminders: "crm.reminders", tasks: "crm.tasks" },
    revision: {
      tasks: "crm.tasks@id",
      rules: "crm.reminder_rules@id",
      reminders: "crm.reminders@id",
      occurrences: "crm.reminder_occurrences@id via crm.reminders.reminder_id",
      cadences: "crm.stay_in_touch_cadences@id via crm.people.person_id",
      requests: "crm.stay_in_touch_cadence_requests@request_id",
    },
  });
