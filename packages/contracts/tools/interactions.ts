/**
 * Interaction tools: recording a note, an activity, a call, or a
 * conversation, the vocabulary each names, reading them back, and editing and
 * deleting them.
 *
 * `recordInteraction` takes four different bodies under one path. A tool's
 * argument schema must be one plain object, so each kind is its own tool with
 * `kind` fixed, and each mints the `requestId` retry key an agent leaves out.
 * Recording, reading, and changing are three grants: `interactions:create`
 * records, `interactions:read` lists, and `interactions:write` edits and
 * deletes, one route per kind, so each kind has its own update and delete
 * tool. A change needs the revision only a read returns, and each description
 * says which read and grant that is.
 */

import {
  activityInteractionInput,
  callInteractionInput,
  conversationInteractionInput,
  noteInteractionInput,
} from "../schemas/interactions.ts";
import {
  deleteActivity,
  deleteCall,
  deleteConversation,
  deleteNote,
  getActivityReport,
  listCommunicationOptions,
  listInteractionOptions,
  listPersonCommunications,
  recordInteraction,
  updateActivity,
  updateCall,
  updateConversation,
  updateNote,
} from "../routes/interactions.ts";
import { type AgentTool, defineTool } from "./define.ts";

const RETRY =
  "Pass your own requestId (a UUID v4) and reuse it when you retry, so the retry returns the original record instead of adding a second one. Once that record is deleted, its requestId stays used: replaying the create is refused as a conflict (interaction_request_deleted) rather than recording it again.";

/** How every interaction edit reads its fields. */
const EDIT =
  "Send only what changes: an omitted field stays as stored, null clears an optional field, a supplied list replaces the stored list whole, and at least one field besides expectedUpdatedAt is required.";

/** Where a note's or an activity's revision comes from. */
const activityRevision = (today: string) =>
  `expectedUpdatedAt is the record's updatedAt from list_notes_and_activities, which requires interactions:read, or from ${today}, which requires today:read, or from the last edit's answer; a token with neither grant cannot obtain one. A stale revision is refused as a conflict: read it again.`;

const NOTE_REVISION = activityRevision(
  "get_today_recent_activity or get_today_favorite_notes",
);

const ACTIVITY_REVISION = activityRevision("get_today_recent_activity");

/** Where a call's or a conversation's revision comes from. */
const COMMUNICATION_REVISION =
  "expectedUpdatedAt is the record's updatedAt from list_calls_and_conversations or the last edit's answer; list_calls_and_conversations requires interactions:read, and a token without it cannot obtain one. A stale revision is refused as a conflict: read it again.";

const ARCHIVED = "A record about an archived person is read-only.";

const NO_TOMBSTONE =
  "There is no undo. Its requestId stays used: replaying the record call that made it is refused as a conflict (interaction_request_deleted) rather than recording it again.";

const MOVES_CADENCE =
  "Moving it later advances the person's stay-in-touch cadence as recording it would.";

const KEEPS_CADENCE = "A stay-in-touch cadence it advanced is not moved back.";

const CADENCE =
  "It counts as being in touch: when it happened after a person's last contact, their stay-in-touch cadence's last contact moves to it and its next due date follows.";

export const INTERACTION_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_activity_options",
    title: "List activity types and emotions",
    description:
      "Lists the workspace's activity types and emotions with their ids, for record_activity (activityTypeId, emotionIds) and record_call (emotionIds), and whether notes and activities may be recorded. Each list has its own search and cursor (activityTypeSearch and activityTypeCursor, emotionSearch and emotionCursor).",
    route: listInteractionOptions,
  }),
  defineTool({
    name: "list_conversation_options",
    title: "List conversation channels",
    description:
      "Lists the workspace's conversation channel types and emotions with their ids, and whether calls and conversations may be recorded. Read it before record_conversation, which needs a channelTypeId.",
    route: listCommunicationOptions,
  }),
  defineTool({
    name: "record_note",
    title: "Record a note",
    description:
      `Adds a note to one person's profile and returns it with its id. isFavorited pins it to the Today page's favourite notes. ${RETRY} update_note and delete_note change it under interactions:write.`,
    route: recordInteraction,
    body: noteInteractionInput,
    fixed: { kind: "note" },
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "record_activity",
    title: "Record an activity",
    description:
      `Records something done together with one or more people (participantIds from list_people): when it happened (an ISO instant with offset), a short summary, and optionally a description, an activity type, and emotions from list_activity_options. ${CADENCE} ${RETRY}`,
    route: recordInteraction,
    body: activityInteractionInput,
    fixed: { kind: "activity" },
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "record_call",
    title: "Record a call",
    description:
      `Records a phone call with one person: when it happened (calledAt), whether they called you (contactWasCaller), and optionally what was said and emotions from list_activity_options. ${CADENCE} ${RETRY}`,
    route: recordInteraction,
    body: callInteractionInput,
    fixed: { kind: "call" },
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "record_conversation",
    title: "Record a conversation",
    description:
      `Records a written conversation with one person on a channel (channelTypeId from list_conversation_options), optionally with a title, the contact method used (contactMethodId from list_profile_facts, section contact-methods, which requires people:profile:read), and its messages in order. ${CADENCE} ${RETRY}`,
    route: recordInteraction,
    body: conversationInteractionInput,
    fixed: { kind: "conversation" },
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "list_notes_and_activities",
    title: "List a person's notes and activities",
    description:
      "Lists one person's notes and activities, newest first, with their full content: note bodies, activity summaries and descriptions, and participants, each with the id and updatedAt its update and delete tools need. kind narrows to note or activity and year to one calendar year; pages with limit and nextCursor, which stays bound to the person and filters.",
    route: getActivityReport,
  }),
  defineTool({
    name: "list_calls_and_conversations",
    title: "List a person's calls and conversations",
    description:
      "Lists up to 50 of one person's calls and conversations with their full content: what was said on each call, and each conversation's messages, each with the id and updatedAt its update and delete tools need.",
    route: listPersonCommunications,
  }),
  defineTool({
    name: "update_note",
    title: "Edit a note",
    description:
      `Edits one note's body or isFavorited (whether it is one of Today's favourite notes) and returns it at its new revision; interactionId is the note's id. ${EDIT} ${NOTE_REVISION} ${ARCHIVED}`,
    route: updateNote,
  }),
  defineTool({
    name: "delete_note",
    title: "Delete a note",
    description:
      `Permanently deletes one note: it leaves the person's notes, timeline, search, and Today's favourite notes. interactionId is the note's id. ${NOTE_REVISION} ${NO_TOMBSTONE} ${ARCHIVED}`,
    route: deleteNote,
  }),
  defineTool({
    name: "update_activity",
    title: "Edit an activity",
    description:
      `Edits one activity — happenedAt, summary, description, activityTypeId and emotionIds (from list_activity_options), or participantIds (from list_people, every person active) — and returns it at its new revision. ${EDIT} Moving it later, or adding people, advances their stay-in-touch cadences as recording it would. ${ACTIVITY_REVISION} ${ARCHIVED}`,
    route: updateActivity,
  }),
  defineTool({
    name: "delete_activity",
    title: "Delete an activity",
    description:
      `Permanently deletes one activity for every participant, not only the person you found it through, with its emotions and its journal entry: it leaves every participant's activities and timeline, search, the journal, and Today. Stay-in-touch cadences it advanced are not moved back. ${ACTIVITY_REVISION} ${NO_TOMBSTONE} ${ARCHIVED}`,
    route: deleteActivity,
  }),
  defineTool({
    name: "update_call",
    title: "Edit a call",
    description:
      `Edits one call — calledAt, contactWasCaller, content, or emotionIds (from list_activity_options) — and returns it at its new revision. ${EDIT} ${MOVES_CADENCE} ${COMMUNICATION_REVISION} ${ARCHIVED}`,
    route: updateCall,
  }),
  defineTool({
    name: "delete_call",
    title: "Delete a call",
    description:
      `Permanently deletes one call and its emotions: it leaves the person's calls, last-contact date, and timeline. ${KEEPS_CADENCE} ${COMMUNICATION_REVISION} ${NO_TOMBSTONE} ${ARCHIVED}`,
    route: deleteCall,
  }),
  defineTool({
    name: "update_conversation",
    title: "Edit a conversation",
    description:
      `Edits one conversation — channelTypeId (from list_conversation_options), contactMethodId (one of the person's contact methods on that channel), happenedAt, title, or messages, which replace every message (an empty list removes them all) — and returns it at its new revision. ${EDIT} ${MOVES_CADENCE} ${COMMUNICATION_REVISION} ${ARCHIVED}`,
    route: updateConversation,
  }),
  defineTool({
    name: "delete_conversation",
    title: "Delete a conversation",
    description:
      `Permanently deletes one conversation and its messages: it leaves the person's conversations, last-contact date, and timeline. ${KEEPS_CADENCE} ${COMMUNICATION_REVISION} ${NO_TOMBSTONE} ${ARCHIVED}`,
    route: deleteConversation,
  }),
];
