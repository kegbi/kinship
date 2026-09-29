/**
 * The reminder facade.
 *
 * A reminder definition and a stay-in-touch cadence are different promises —
 * one fires on a calendar, the other on how long it has been since somebody
 * was contacted — but they share a person, a workspace zone, and the same
 * idempotent-write discipline. They are assembled here so a composition root
 * still builds a single object, and so the split between
 * `reminder_definitions.ts` and `reminder_cadences.ts` stays an internal
 * matter rather than something every caller has to know about.
 */

import { createReminderCadences } from "./reminder_cadences.ts";
import { createReminderDefinitions } from "./reminder_definitions.ts";
import { createReminderOccurrences } from "./reminder_occurrences.ts";
import type { ReminderManagementDependencies } from "./reminder_context.ts";

export function createReminderManagement(
  dependencies: ReminderManagementDependencies,
) {
  const definitions = createReminderDefinitions(dependencies);
  const cadences = createReminderCadences(dependencies);
  const occurrences = createReminderOccurrences(dependencies);
  return {
    acknowledgeOccurrence: occurrences.acknowledge,
    createReminder: definitions.createReminder,
    createCadence: cadences.createCadence,
    setActive: definitions.setActive,
    listPerson: definitions.listPerson,
    interactionRecorded: cadences.interactionRecorded,
    timezoneChanged: definitions.timezoneChanged,
    workspaceTimezoneChanged: definitions.workspaceTimezoneChanged,
  };
}

export type ReminderManagement = ReturnType<typeof createReminderManagement>;
