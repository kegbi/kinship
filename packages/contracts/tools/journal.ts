/**
 * Journal tools: posts, day ratings, and activities on the journal timeline.
 *
 * The journal is workspace-wide, not private to its author: every member,
 * and so every token with the grant, reads, edits, and deletes every item.
 * Each description says so, because an agent writing on a user's behalf must
 * not assume the user alone will see it.
 */

import {
  createJournalPost,
  deleteJournalItem,
  getJournalItem,
  linkJournalActivity,
  listJournal,
  saveJournalDayRating,
  updateJournalPost,
} from "../routes/journal.ts";
import { type AgentTool, defineTool } from "./define.ts";

const SHARED =
  "The journal is workspace-wide, not private to its author: every member can read, edit, and delete it.";

const JOURNAL_READ =
  "list_journal_items and get_journal_item require journal:read; a token without it cannot obtain one.";

export const JOURNAL_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_journal_items",
    title: "List the journal",
    description:
      `Lists the workspace's journal timeline, newest first: posts with their bodies, day ratings, and activities put on the journal with their summaries and participants, each with its journal item id. It also lists recent activities that are not on the journal yet, for add_activity_to_journal. Pages with limit and nextCursor. ${SHARED}`,
    route: listJournal,
  }),
  defineTool({
    name: "get_journal_item",
    title: "Get a journal item",
    description:
      `Reads one journal item by its id from list_journal_items: a post with its body and updatedAt, a day rating, or an activity on the journal with its summary and participants. ${SHARED}`,
    route: getJournalItem,
  }),
  defineTool({
    name: "create_journal_post",
    title: "Write a journal post",
    description:
      `Writes a journal post — a body, the instant it is about (occurredAt), and an optional title — and returns it with its id, which is also its journal item id. ${SHARED} Pass your own requestId and reuse it when you retry: the same requestId and post return the post it created, and a changed body, title, or occurredAt under it is refused as a conflict. A deleted post leaves no record, so the same requestId after delete_journal_item writes it again.`,
    route: createJournalPost,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "update_journal_post",
    title: "Update a journal post",
    description:
      `Replaces a post's body, occurredAt, and title with the values sent; a title left out is cleared. itemId is the post's id from create_journal_post or list_journal_items. Send expectedUpdatedAt as the post's updatedAt from get_journal_item or list_journal_items to refuse a concurrent edit as a conflict; left out, the post is overwritten unchecked, losing any edit made since you read it. ${JOURNAL_READ} ${SHARED}`,
    route: updateJournalPost,
  }),
  defineTool({
    name: "set_day_rating",
    title: "Rate a day",
    description:
      `Rates a calendar day (ratedOn) from 1 to 5, with an optional comment. The workspace keeps one rating per date, shared by every member: rating a rated date replaces its rating, and a comment left out is cleared. Safe to repeat. ${SHARED}`,
    route: saveJournalDayRating,
  }),
  defineTool({
    name: "add_activity_to_journal",
    title: "Put an activity on the journal",
    description:
      `Puts an existing activity (activityId from record_activity, or from the activities list_journal_items offers, which requires journal:read) on the journal timeline and returns its journal item id. An activity already on the journal, or outside the workspace, is refused as not found. ${SHARED}`,
    route: linkJournalActivity,
  }),
  defineTool({
    name: "delete_journal_item",
    title: "Delete a journal item",
    description:
      `Permanently deletes one journal item by its id from list_journal_items: a post or a day rating is deleted, while for an activity only its place on the journal is removed and the activity itself stays. There is no revision check. ${JOURNAL_READ} ${SHARED}`,
    route: deleteJournalItem,
  }),
];
