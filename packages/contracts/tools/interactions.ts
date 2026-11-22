/**
 * Interaction tools: recording a note, an activity, a call, or a
 * conversation, the vocabulary each names, and reading them back.
 *
 * `recordInteraction` takes four different bodies under one path. A tool's
 * argument schema must be one plain object, so each kind is its own tool with
 * `kind` fixed, and each mints the `requestId` retry key an agent leaves out.
 * Recording grants no read of what was recorded before; the two list tools
 * are the separate `interactions:read` grant.
 */

import {
  activityInteractionInput,
  callInteractionInput,
  conversationInteractionInput,
  noteInteractionInput,
} from "../schemas/interactions.ts";
import {
  getActivityReport,
  listCommunicationOptions,
  listInteractionOptions,
  listPersonCommunications,
  recordInteraction,
} from "../routes/interactions.ts";
import { type AgentTool, defineTool } from "./define.ts";

const RETRY =
  "Pass your own requestId (a UUID v4) and reuse it when you retry, so the retry returns the original record instead of adding a second one.";

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
      `Adds a note to one person's profile and returns it with its id. isFavorited pins it to the Today page's favourite notes. ${RETRY} No tool edits or deletes a note yet.`,
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
      `Records a written conversation with one person on a channel (channelTypeId from list_conversation_options), optionally with a title, the contact method used (an id from list_profile_facts, section contact-methods), and its messages in order. ${CADENCE} ${RETRY}`,
    route: recordInteraction,
    body: conversationInteractionInput,
    fixed: { kind: "conversation" },
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "list_notes_and_activities",
    title: "List a person's notes and activities",
    description:
      "Lists one person's notes and activities, newest first, with their full content: note bodies, activity summaries and descriptions, and participants. kind narrows to note or activity and year to one calendar year; pages with limit and nextCursor, which stays bound to the person and filters.",
    route: getActivityReport,
  }),
  defineTool({
    name: "list_calls_and_conversations",
    title: "List a person's calls and conversations",
    description:
      "Lists up to 50 of one person's calls and conversations with their full content: what was said on each call, and each conversation's messages.",
    route: listPersonCommunications,
  }),
];
