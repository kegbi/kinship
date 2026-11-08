/**
 * The person rail in one read (AUD-Q3, FEQ-04 step 4).
 *
 * `GET /api/v1/people/{personId}?include=rail` answers the person, the
 * summary, and the first page of every rail section: the seven profile
 * facts, the relationships with the first page of their types, the
 * important dates, and the reminders with the stay-in-touch cadence. Each
 * section's `value` is exactly what that section's own endpoint answers for
 * its first page, so the island that renders it needs no second shape, and
 * every later page, refresh, and write still goes to that endpoint.
 *
 * Each section answers on its own: `hidden` when the member may not see it
 * (the workspace turned its module off), `unavailable` when its module could
 * not answer, so one failed section never blanks the profile — the search
 * read model's `unavailable` group, per section.
 *
 * It lives apart from `people.ts` because the relationships and planning
 * schemas it composes already import that file.
 */

import { z } from "zod";
import {
  importantDateList,
  personReadyFields,
  profileFactSection,
} from "./people.ts";
import { personReminders } from "./planning.ts";
import { relationshipList, relationshipTypeList } from "./relationships.ts";
import { oneOf } from "./shared.ts";

const hidden = z.strictObject({ status: z.literal("hidden") }).meta({
  id: "PersonRailSectionHidden",
});
const unavailable = z.strictObject({ status: z.literal("unavailable") })
  .meta({ id: "PersonRailSectionUnavailable" });

function railSection<const Value extends z.ZodType>(id: string, value: Value) {
  return oneOf([
    z.strictObject({ status: z.literal("ready"), value }),
    hidden,
    unavailable,
  ]).meta({ id });
}

export const personRailFacts = railSection(
  "PersonRailFacts",
  profileFactSection,
);

export const personRailRelationships = railSection(
  "PersonRailRelationships",
  z.strictObject({ list: relationshipList, types: relationshipTypeList }),
);

export const personRailImportantDates = railSection(
  "PersonRailImportantDates",
  importantDateList,
);

export const personRailReminders = railSection(
  "PersonRailReminders",
  personReminders,
);

export const personRail = z.strictObject({
  "contact-methods": personRailFacts,
  addresses: personRailFacts,
  "first-meeting": personRailFacts,
  work: personRailFacts,
  "food-preferences": personRailFacts,
  pets: personRailFacts,
  tags: personRailFacts,
  relationships: personRailRelationships,
  "important-dates": personRailImportantDates,
  reminders: personRailReminders,
}).meta({ id: "PersonRail" });

export const personReady = personReadyFields.extend({
  rail: personRail.optional(),
}).meta({ id: "PersonReady" });
