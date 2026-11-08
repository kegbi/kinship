/**
 * Workspace search (GAP-048, `SEARCH-001`): what one query over people,
 * notes, activities, journal posts, and tasks answers with.
 *
 * Every group is always present, in one fixed order, so a reader can draw the
 * group headings without deciding which exist. A blank query answers the
 * member's recent people in the people group (FEQ-05). A snippet is plain text cut
 * from what the member wrote; nothing in it is markup to be interpreted.
 */

import { z } from "zod";
import { personAvatar } from "./people.ts";
import { oneOf } from "./shared.ts";

/** The most results one group answers, and how many it answers by default. */
export const SEARCH_GROUP_LIMIT_MAXIMUM = 10;
export const SEARCH_GROUP_LIMIT_DEFAULT = 5;

/** A person the entity belongs to, named by the display-name rule. */
export const searchPersonReference = z.strictObject({
  archived: z.boolean(),
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "SearchPersonReference" });

/**
 * A person the active directory lists for the query, or, for a blank query,
 * one the member viewed recently. Only a recent person says whether it is
 * archived, because a search lists active people alone.
 */
export const searchPersonResult = z.strictObject({
  archived: z.boolean().optional(),
  avatar: personAvatar.optional(),
  familyName: z.string().optional(),
  givenName: z.string(),
  href: z.string().regex(/^\/app\/people\/[0-9a-f-]{36}$/),
  id: z.uuid(),
  kind: z.literal("person"),
  middleName: z.string().optional(),
  nickname: z.string().optional(),
}).meta({ id: "SearchPersonResult" });

/**
 * A note, activity, journal post, or task. `href` is the person workspace
 * section it lives in, its journal item, or the tasks page.
 */
export const searchEntityResult = z.strictObject({
  href: z.string().regex(
    /^\/app\/(?:people\/[0-9a-f-]{36}\?section=(?:notes|activities|tasks)|journal\/[0-9a-f-]{36}|tasks)$/,
  ),
  id: z.uuid(),
  kind: z.enum(["note", "activity", "journal-post", "task"]),
  person: searchPersonReference.optional(),
  // 160 code points, each up to two UTF-16 units, and two ellipses.
  snippet: z.string().max(322),
  title: z.string().optional(),
}).meta({ id: "SearchEntityResult" });

export const searchPeopleGroup = z.strictObject({
  kind: z.literal("people"),
  results: z.array(searchPersonResult).max(SEARCH_GROUP_LIMIT_MAXIMUM),
}).meta({ id: "SearchPeopleGroup" });

/**
 * A text group. `unavailable` marks one the search could not answer in time;
 * its results are then empty, and the people group still answered.
 */
export const searchEntityGroup = z.strictObject({
  kind: z.enum(["notes", "activities", "journal-posts", "tasks"]),
  results: z.array(searchEntityResult).max(SEARCH_GROUP_LIMIT_MAXIMUM),
  unavailable: z.literal(true).optional(),
}).meta({ id: "SearchEntityGroup" });

/** The five groups: people, notes, activities, journal posts, then tasks. */
export const searchResults = z.strictObject({
  groups: z.array(oneOf([searchPeopleGroup, searchEntityGroup])).length(5),
  query: z.string(),
  status: z.literal("ready"),
}).meta({ id: "SearchResults" });
