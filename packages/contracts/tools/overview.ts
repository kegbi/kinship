/**
 * Overview tools: workspace search and the Today regions.
 *
 * `search:read` and `today:read` are deliberate composite grants (D6): each
 * returns content that several areas own — notes, activities, journal posts,
 * tasks, reminders — without the grants those areas' own tools need, and each
 * description says what crosses over.
 */

import { getTodayRecentPeople } from "../routes/people.ts";
import {
  getTodayFavoriteNotes,
  getTodayRecentActivity,
} from "../routes/interactions.ts";
import {
  getTodayAttention,
  getTodayReminders,
  getTodayTasks,
} from "../routes/planning.ts";
import { searchWorkspace } from "../routes/search.ts";
import { type AgentTool, defineTool } from "./define.ts";

const TODAY =
  "It is a read-only Today projection across people, readable with today:read alone.";

export const OVERVIEW_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "search_workspace",
    title: "Search the workspace",
    description:
      "Searches the workspace's people, notes, activities, journal posts, and tasks for q, answering each group separately with at most limit results (default 5, at most 10): people with their ids and names, and each note, activity, journal post, or task with its id, its person, and a short snippet of what matched. People are answered first; a text group that cannot be searched is marked unavailable while the others still answer. A blank q answers the member's recently viewed people and leaves every other group empty. Use list_people to page through people.",
    route: searchWorkspace,
  }),
  defineTool({
    name: "get_today_attention",
    title: "Get what needs attention today",
    description:
      `Reads what needs attention, in the member's time zone: overdue, today, and next-seven-days groups and an upcoming list of open tasks, undelivered or failing reminders, important dates, life events, and stay-in-touch cadences that are due, each with its person. ${TODAY}`,
    route: getTodayAttention,
  }),
  defineTool({
    name: "get_today_reminders",
    title: "Get upcoming reminders",
    description:
      `Reads reminder occurrences that are due within thirty days, being retried, failed, or need attention, the recently sent ones, and stay-in-touch cadences due within thirty days, each with its person. ${TODAY}`,
    route: getTodayReminders,
  }),
  defineTool({
    name: "get_today_tasks",
    title: "Get upcoming tasks",
    description:
      `Reads up to twenty open tasks due within thirty days, overdue ones included, earliest first, each with its linked person. ${TODAY} Use list_tasks for every task.`,
    route: getTodayTasks,
  }),
  defineTool({
    name: "get_today_favorite_notes",
    title: "Get favourite notes",
    description:
      `Reads the workspace's favourite notes — notes recorded or marked with isFavorited — with their full bodies and the people they are about. ${TODAY}`,
    route: getTodayFavoriteNotes,
  }),
  defineTool({
    name: "get_today_recent_activity",
    title: "Get recent notes and activities",
    description:
      `Reads up to twenty of the workspace's most recent notes and activities, with their content and participants. ${TODAY}`,
    route: getTodayRecentActivity,
  }),
  defineTool({
    name: "get_today_recent_people",
    title: "Get recently viewed people",
    description:
      `Reads the people the token's member most recently opened in the web app, newest first, with their ids, names, and whether they are archived. Tool calls do not count as views. ${TODAY}`,
    route: getTodayRecentPeople,
  }),
];
