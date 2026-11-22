/**
 * Vocabulary tools: the workspace's tags, labels, types, genders, reminder
 * rules, and profile modules (the personalization settings).
 *
 * `createPersonalizationEntry` and `updatePersonalizationEntry` take a
 * different body for each section under one path, so each section is its own
 * tool with `section` fixed in the path and the fields that section takes.
 * Listing and deleting take the same input everywhere, so each is one tool
 * with a section argument. Emotions and pet categories are fixed lists and
 * take no new or changed entries. Profile modules are the workspace's person
 * page sections: they are renamed, reordered, or hidden, never invented.
 */

import { z } from "zod";
import {
  personalizationContactTypeCreate,
  personalizationContactTypeUpdate,
  personalizationGenderUpdate,
  personalizationNamedCreate,
  personalizationNamedUpdate,
  personalizationNameOnlyCreate,
  personalizationNameOnlyUpdate,
  personalizationRelationshipCreate,
  personalizationRelationshipUpdate,
  personalizationReminderCreate,
  personalizationReminderUpdate,
} from "../schemas/settings.ts";
import {
  createPersonalizationEntry,
  deletePersonalizationEntry,
  listPersonalizationEntries,
  updatePersonalizationEntry,
} from "../routes/settings.ts";
import { type AgentTool, defineTool } from "./define.ts";

const ADMIN =
  "Vocabularies are administrative: the token's member must currently be an owner or admin of the workspace, or the call is refused as forbidden.";

const CONFLICT = "A name already used in the section is refused as a conflict.";

const REVISION =
  "id and expectedUpdatedAt are the entry's id and updatedAt from list_vocabulary_entries, whose capabilities say which changes the entry allows; a stale revision is refused as a conflict. list_vocabulary_entries requires vocabularies:read; a token without it cannot obtain one. Change at least one field.";

/** A create tool for one vocabulary section. */
function createEntry(
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
      `${what} Returns the new entry with its id. There is no retry key. ${CONFLICT} ${ADMIN}`,
    route: createPersonalizationEntry,
    body,
    fixed: { section },
  });
}

/** An update tool for one vocabulary section. */
function updateEntry(
  name: string,
  title: string,
  section: string,
  body: z.ZodObject,
  what: string,
): AgentTool {
  return defineTool({
    name,
    title,
    description: `${what} ${REVISION} ${ADMIN}`,
    route: updatePersonalizationEntry,
    body,
    fixed: { section },
  });
}

const DISABLE =
  "isActive false disables (archives) the entry so it is no longer offered, and true re-enables it.";

export const VOCABULARY_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_vocabulary_entries",
    title: "List a vocabulary",
    description:
      `Lists one vocabulary section's entries with their ids, names or labels, order, active and default flags, updatedAt, how many records use each (referenceCount), and capabilities saying what each entry allows; the section's capabilities say whether it takes new entries. Sections: tags, contact-labels, contact-method-types, activity-types, life-event-types, gender-options, relationship-types, reminder-rules, profile-modules, and the fixed emotion-options and pet-categories. ${ADMIN}`,
    route: listPersonalizationEntries,
  }),
  createEntry(
    "create_tag",
    "Create a tag",
    "tags",
    personalizationNameOnlyCreate,
    "Creates a workspace tag to put on people with add_tag_to_people or update_person_tags.",
  ),
  updateEntry(
    "update_tag",
    "Rename a tag",
    "tags",
    personalizationNameOnlyUpdate,
    "Renames a tag everywhere it is used.",
  ),
  createEntry(
    "create_contact_label",
    "Create a contact label",
    "contact-labels",
    personalizationNameOnlyCreate,
    "Creates a label (such as work or home) for contact methods and addresses.",
  ),
  updateEntry(
    "update_contact_label",
    "Rename a contact label",
    "contact-labels",
    personalizationNameOnlyUpdate,
    "Renames a contact label everywhere it is used.",
  ),
  createEntry(
    "create_contact_method_type",
    "Create a contact method type",
    "contact-method-types",
    personalizationContactTypeCreate,
    "Creates a type of contact method, with an optional contactKind (email, phone, url, social, im, username, or custom by default) and position (sortOrder).",
  ),
  updateEntry(
    "update_contact_method_type",
    "Update a contact method type",
    "contact-method-types",
    personalizationContactTypeUpdate,
    `Renames, reorders, or changes the contactKind of a contact method type. ${DISABLE}`,
  ),
  createEntry(
    "create_activity_type",
    "Create an activity type",
    "activity-types",
    personalizationNamedCreate,
    "Creates a type that record_activity can name, with an optional position (sortOrder).",
  ),
  updateEntry(
    "update_activity_type",
    "Update an activity type",
    "activity-types",
    personalizationNamedUpdate,
    `Renames or reorders an activity type. ${DISABLE}`,
  ),
  createEntry(
    "create_life_event_type",
    "Create a life event type",
    "life-event-types",
    personalizationNamedCreate,
    "Creates a type that record_life_event can name, with an optional position (sortOrder).",
  ),
  updateEntry(
    "update_life_event_type",
    "Update a life event type",
    "life-event-types",
    personalizationNamedUpdate,
    `Renames or reorders a life event type. ${DISABLE}`,
  ),
  createEntry(
    "create_gender",
    "Create a gender option",
    "gender-options",
    personalizationNamedCreate,
    "Creates a gender option that update_person can set, with an optional position (sortOrder).",
  ),
  updateEntry(
    "update_gender",
    "Update a gender option",
    "gender-options",
    personalizationGenderUpdate,
    `Renames or reorders a gender option, or makes it the default (isDefault true). ${DISABLE}`,
  ),
  createEntry(
    "create_relationship_type",
    "Create a relationship type",
    "relationship-types",
    personalizationRelationshipCreate,
    "Creates a relationship type with the label read from the first person (forwardLabel, such as parent of) and from the second (reverseLabel, such as child of), and an optional position (sortOrder).",
  ),
  updateEntry(
    "update_relationship_type",
    "Update a relationship type",
    "relationship-types",
    personalizationRelationshipUpdate,
    `Relabels (forwardLabel and reverseLabel together) or reorders a relationship type; every relationship of the type shows the new labels. ${DISABLE}`,
  ),
  createEntry(
    "create_reminder_rule",
    "Create a reminder rule",
    "reminder-rules",
    personalizationReminderCreate,
    "Creates a notification lead-time rule: how many days before a reminder falls due (daysBefore) the workspace is notified.",
  ),
  updateEntry(
    "update_reminder_rule",
    "Update a reminder rule",
    "reminder-rules",
    personalizationReminderUpdate,
    `Changes a lead-time rule's number of days (daysBefore). ${DISABLE}`,
  ),
  updateEntry(
    "update_profile_module",
    "Update a profile module",
    "profile-modules",
    personalizationNamedUpdate,
    "Renames or reorders one section of every person's page, or hides it for the whole workspace with isActive false (true shows it again); a hidden section's tools return nothing and refuse writes.",
  ),
  defineTool({
    name: "delete_vocabulary_entry",
    title: "Delete a vocabulary entry",
    description:
      `Permanently deletes one entry; id and expectedUpdatedAt are its id and updatedAt from list_vocabulary_entries, which requires vocabularies:read; a token without it cannot obtain one. While records still use the entry the call is refused as replacement required, and succeeds only with replacementId, another entry of the same section, to which those records move. Required and seeded entries, emotions, and pet categories cannot be deleted. ${ADMIN}`,
    route: deletePersonalizationEntry,
  }),
];
