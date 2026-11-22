/**
 * Profile tools: a person's important dates, profile facts, and life events.
 *
 * `createProfileFact` and `updateProfileFact` take a different body for each
 * of the seven sections under one path, so each section is its own tool with
 * `section` fixed in both the path and the body, and the fields that section
 * takes. An update repeats the path's fact id in the body; the tool sends its
 * `factId` argument there too. First meeting, food preferences, and tags hold
 * one record per person whose id is the person's, so their updates take only
 * the person. Listing and deleting take the same input for every section, so
 * each is one tool with a section argument.
 */

import { z } from "zod";
import {
  addressFactCreateInput,
  addressFactUpdateInput,
  contactMethodFactCreateInput,
  contactMethodFactUpdateInput,
  firstMeetingFactCreateInput,
  firstMeetingFactUpdateInput,
  foodPreferencesFactCreateInput,
  foodPreferencesFactUpdateInput,
  occupationFactCreateInput,
  occupationFactUpdateInput,
  petFactCreateInput,
  petFactUpdateInput,
  tagsFactUpdateInput,
} from "../schemas/people.ts";
import {
  createImportantDate,
  createPersonLifeEvent,
  createProfileFact,
  deleteImportantDate,
  deletePersonLifeEvent,
  deleteProfileFact,
  listImportantDates,
  listPersonLifeEvents,
  listProfileFacts,
  updateImportantDate,
  updatePersonLifeEvent,
  updateProfileFact,
} from "../routes/people.ts";
import { type AgentTool, defineTool } from "./define.ts";

/** The person revision every profile-fact write is checked against. */
const FACT_REVISION =
  "expectedPersonUpdatedAt is personUpdatedAt from list_profile_facts or from the last profile-fact write on this person; every fact write changes it, so use the newest. A stale one is refused as a conflict.";

/** The record revision an update or delete of a fact is checked against. */
const RECORD_REVISION =
  "expectedUpdatedAt is the record's updatedAt from list_profile_facts.";

const READ_ONLY_ARCHIVED =
  "Archived people and sections the workspace hides are refused.";

const DATE_PRECISION =
  "precision says which of year, month, and day the date has — full (all three), year_month, month_day, year, month, day, or unknown (none) — and exactly those must be sent.";

/** An add tool for one profile section whose records are many. */
function addFact(
  name: string,
  title: string,
  section: string,
  body: z.ZodObject,
  what: string,
): AgentTool {
  return defineTool({
    name,
    title,
    description:
      `${what} ${FACT_REVISION} ${READ_ONLY_ARCHIVED} There is no retry key: repeating it adds a second record.`,
    route: createProfileFact,
    body,
    fixed: { section },
  });
}

/** An update tool for one profile section whose records are many. */
function updateFact(
  name: string,
  title: string,
  section: string,
  body: z.ZodObject,
  what: string,
): AgentTool {
  return defineTool({
    name,
    title,
    description:
      `${what} factId is the record's id from list_profile_facts (section ${section}). ${RECORD_REVISION} ${FACT_REVISION} ${READ_ONLY_ARCHIVED}`,
    route: updateProfileFact,
    body,
    fixed: { section },
    aliases: { id: "factId" },
  });
}

/** An update tool for a section holding one record, whose id is the person's. */
function updateSingleFact(
  name: string,
  title: string,
  section: string,
  body: z.ZodObject,
  what: string,
): AgentTool {
  return defineTool({
    name,
    title,
    description:
      `${what} The person holds one such record; expectedUpdatedAt is its updatedAt from list_profile_facts (section ${section}). ${FACT_REVISION} ${READ_ONLY_ARCHIVED}`,
    route: updateProfileFact,
    body,
    fixed: { section },
    aliases: { factId: "personId", id: "personId" },
  });
}

export const PROFILE_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_important_dates",
    title: "List a person's important dates",
    description:
      "Lists a person's important dates — birthday, deceased date, first-met date, and custom dates — archived people included, each with its id, updatedAt, and the precision it was stored with: a date may lack its year, month, or day. scheduling says whether it can drive a yearly reminder. Use the id and updatedAt with update_important_date and delete_important_date.",
    route: listImportantDates,
  }),
  defineTool({
    name: "add_important_date",
    title: "Add an important date",
    description:
      `Adds an important date to a person and returns it with its id. ${DATE_PRECISION} A person has at most one birthday, one deceased date, and one first-met date; any other date is kind custom and needs a label, which the other kinds must not have. isYearApproximate marks a guessed year and isAgeBased shows the date as an age; both need a year. There is no retry key: repeating a custom date adds a second one. Archived people are read-only.`,
    route: createImportantDate,
  }),
  defineTool({
    name: "update_important_date",
    title: "Update an important date",
    description:
      `Replaces an important date with the value sent (fields left out are cleared). dateId and expectedUpdatedAt are the date's id and updatedAt from list_important_dates; a stale revision is refused as a conflict. ${DATE_PRECISION} Archived people are read-only.`,
    route: updateImportantDate,
  }),
  defineTool({
    name: "delete_important_date",
    title: "Delete an important date",
    description:
      "Permanently removes one important date. dateId and expectedUpdatedAt are the date's id and updatedAt from list_important_dates; a stale revision is refused as a conflict. Archived people are read-only.",
    route: deleteImportantDate,
  }),
  defineTool({
    name: "list_profile_facts",
    title: "List a person's profile facts",
    description:
      "Reads one section of a person's profile facts — contact-methods, addresses, work, pets, first-meeting, food-preferences, or tags — archived people included. Each record has the id and updatedAt its update and delete need, and the answer's personUpdatedAt is the expectedPersonUpdatedAt every fact write needs. Set includeOptions to \"true\" to also get the ids that section's writes may name (contact types and labels, organizations, pet categories); optionSearch filters them, and nextOptionsCursor goes back as optionCursor for more. Records page with nextCursor and cursor. A section the workspace hides returns nothing.",
    route: listProfileFacts,
  }),
  addFact(
    "add_contact_method",
    "Add a contact method",
    "contact-methods",
    contactMethodFactCreateInput,
    'Adds a contact method — an email address, phone number, website, social or messaging handle — to a person. typeId and labelIds come from list_profile_facts with section contact-methods and includeOptions "true"; isPrimary makes it the person\'s main one.',
  ),
  updateFact(
    "update_contact_method",
    "Update a contact method",
    "contact-methods",
    contactMethodFactUpdateInput,
    "Replaces one of a person's contact methods with the value sent; notes left out are cleared.",
  ),
  addFact(
    "add_address",
    "Add an address",
    "addresses",
    addressFactCreateInput,
    'Adds a postal address to a person; send at least one of street, city, region, postalCode, country, or displayName. labelIds come from list_profile_facts with section addresses and includeOptions "true"; isPrimary makes it the main address.',
  ),
  updateFact(
    "update_address",
    "Update an address",
    "addresses",
    addressFactUpdateInput,
    "Replaces one of a person's addresses with the value sent; parts left out are cleared, and at least one must remain.",
  ),
  addFact(
    "add_job",
    "Add a job",
    "work",
    occupationFactCreateInput,
    'Adds a job to a person\'s work history: a title, and optionally an organization (organizationId from list_profile_facts with section work and includeOptions "true", or organizationName), dates, and whether it is current.',
  ),
  updateFact(
    "update_job",
    "Update a job",
    "work",
    occupationFactUpdateInput,
    "Replaces one job in a person's work history with the value sent; optional fields left out are cleared.",
  ),
  addFact(
    "add_pet",
    "Add a pet",
    "pets",
    petFactCreateInput,
    'Adds a pet to a person: a name, a category (categoryId from list_profile_facts with section pets and includeOptions "true"), or both, and optional notes.',
  ),
  updateFact(
    "update_pet",
    "Update a pet",
    "pets",
    petFactUpdateInput,
    "Replaces one of a person's pets with the value sent; fields left out are cleared, and a name or category must remain.",
  ),
  defineTool({
    name: "add_first_meeting",
    title: "Record how you first met",
    description:
      `Records how a person was first met: where (placeText), notes, and who introduced you (introducedByPersonId, another person from list_people); send at least one. A person holds one first meeting, so when one exists this is refused as stale; change it with update_first_meeting. ${FACT_REVISION} ${READ_ONLY_ARCHIVED}`,
    route: createProfileFact,
    body: firstMeetingFactCreateInput,
    fixed: { section: "first-meeting" },
  }),
  updateSingleFact(
    "update_first_meeting",
    "Update how you first met",
    "first-meeting",
    firstMeetingFactUpdateInput,
    "Replaces a person's first meeting with the value sent; fields left out are cleared, and at least one must remain.",
  ),
  defineTool({
    name: "add_food_preferences",
    title: "Record food preferences",
    description:
      `Records a person's food preferences as free text. A person holds one such record, so when one exists this is refused as stale; change it with update_food_preferences. ${FACT_REVISION} ${READ_ONLY_ARCHIVED}`,
    route: createProfileFact,
    body: foodPreferencesFactCreateInput,
    fixed: { section: "food-preferences" },
  }),
  updateSingleFact(
    "update_food_preferences",
    "Update food preferences",
    "food-preferences",
    foodPreferencesFactUpdateInput,
    "Replaces a person's food preferences text.",
  ),
  updateSingleFact(
    "update_person_tags",
    "Set a person's tags",
    "tags",
    tagsFactUpdateInput,
    "Replaces a person's whole set of tags with tagIds (from list_tags); an empty list removes every tag. To add or remove one tag across people without replacing the rest, use add_tag_to_people or remove_tag_from_people.",
  ),
  defineTool({
    name: "delete_profile_fact",
    title: "Delete a profile fact",
    description:
      `Permanently removes one profile-fact record — a contact method, address, job, or pet — or clears a person's first meeting or food preferences. factId and expectedUpdatedAt are the record's id and updatedAt from list_profile_facts in the same section; for first-meeting and food-preferences the id is the person's. Tags cannot be deleted here: clear them with update_person_tags and an empty list. ${FACT_REVISION} ${READ_ONLY_ARCHIVED}`,
    route: deleteProfileFact,
    shared: ["section"],
  }),
  defineTool({
    name: "list_life_events",
    title: "List a person's life events",
    description:
      "Lists up to 100 of a person's life events — a move, a new job, a wedding, a loss — archived people included, each with its id, updatedAt, name or type, note, and date with the precision it was stored with, and the workspace's life-event types with the ids record_life_event takes. A section the workspace hides returns no events.",
    route: listPersonLifeEvents,
  }),
  defineTool({
    name: "record_life_event",
    title: "Record a life event",
    description:
      `Records a life event on a person and returns it with its id: a name, a type (typeId from list_life_events), or both, an optional note, and a date. ${DATE_PRECISION} There is no retry key: repeating it records a second event. Archived people are read-only.`,
    route: createPersonLifeEvent,
  }),
  defineTool({
    name: "update_life_event",
    title: "Update a life event",
    description:
      `Replaces a life event with the value sent (fields left out are cleared). lifeEventId and expectedUpdatedAt are the event's id and updatedAt from list_life_events; a stale revision is refused as a conflict. ${DATE_PRECISION} Archived people are read-only.`,
    route: updatePersonLifeEvent,
  }),
  defineTool({
    name: "delete_life_event",
    title: "Delete a life event",
    description:
      "Permanently removes a life event. lifeEventId and expectedUpdatedAt are the event's id and updatedAt from list_life_events; a stale revision is refused as a conflict. Archived people are read-only.",
    route: deletePersonLifeEvent,
  }),
];
