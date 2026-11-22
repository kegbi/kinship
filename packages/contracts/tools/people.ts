/**
 * People tools: finding a person and reading what the profile records.
 *
 * Every tool here reads. A person's id comes from `list_people`, and the other
 * tools take it; none of them returns the aggregate profile, notes, or the
 * timeline, which stay session-only.
 */

import {
  getPersonIdentity,
  listImportantDates,
  listPeople,
  listProfileFacts,
} from "../routes/people.ts";
import { type AgentTool, defineTool } from "./define.ts";

export const PEOPLE_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_people",
    title: "List people",
    description:
      "Searches and pages through the people in the token's workspace directory. Use it first to find a person's id by name (search), tag, or starred flag; archived people need lifecycle=archived. Returns at most limit people (default 20, at most 50) and a nextCursor; pass that cursor with the same filters to read the next page.",
    route: listPeople,
  }),
  defineTool({
    name: "get_person_identity",
    title: "Get a person's name",
    description:
      "Reads one person's id and display name, archived people included. Use it to confirm which person an id names before writing about them.",
    route: getPersonIdentity,
  }),
  defineTool({
    name: "list_important_dates",
    title: "List a person's important dates",
    description:
      "Reads a person's important dates (birthday, anniversaries, and the other dates the workspace records), keeping the precision each was stored with: a date may lack its year or its day.",
    route: listImportantDates,
  }),
  defineTool({
    name: "list_profile_facts",
    title: "List a person's profile facts",
    description:
      "Reads one section of a person's profile facts: addresses, contact-methods, first-meeting, food-preferences, pets, tags, or work. Set includeOptions to \"true\" to also receive the workspace's choices for that section (optionSearch filters them). A section the workspace hides returns nothing.",
    route: listProfileFacts,
  }),
];
