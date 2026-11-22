/**
 * Interaction tools: recording a note, an activity, a call, or a
 * conversation, and the vocabulary each one names.
 *
 * `recordInteraction` takes four different bodies under one path. A tool's
 * argument schema must be one plain object, so each kind is its own tool with
 * `kind` fixed, and each mints the `requestId` retry key an agent leaves out.
 * Recording grants no read of what was recorded before.
 */

import {
  activityInteractionInput,
  callInteractionInput,
  conversationInteractionInput,
  noteInteractionInput,
} from "../schemas/interactions.ts";
import {
  listCommunicationOptions,
  listInteractionOptions,
  recordInteraction,
} from "../routes/interactions.ts";
import { type AgentTool, defineTool } from "./define.ts";

const RETRY =
  "Pass your own requestId (a UUID v4) and reuse it when you retry, so the retry returns the original record instead of adding a second one.";

export const INTERACTION_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_interaction_options",
    title: "List activity types and emotions",
    description:
      "Reads the workspace's activity types and emotions, with the ids record_activity and record_call take. Each list pages with its own cursor and search.",
    route: listInteractionOptions,
  }),
  defineTool({
    name: "list_communication_options",
    title: "List conversation channels",
    description:
      "Reads the workspace's conversation channel types and emotions, with their ids, and whether calls and conversations may be recorded. Read it before record_conversation, which needs a channelTypeId.",
    route: listCommunicationOptions,
  }),
  defineTool({
    name: "record_note",
    title: "Record a note",
    description:
      `Adds a note to one person's profile. isFavorited pins it to the Today page. ${RETRY}`,
    route: recordInteraction,
    body: noteInteractionInput,
    fixed: { kind: "note" },
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "record_activity",
    title: "Record an activity",
    description:
      `Records something done together with one or more people (participantIds): when it happened (an ISO instant with offset), a short summary, and optionally a description, an activity type, and emotions from list_interaction_options. ${RETRY}`,
    route: recordInteraction,
    body: activityInteractionInput,
    fixed: { kind: "activity" },
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "record_call",
    title: "Record a call",
    description:
      `Records a phone call with one person: when it happened, whether they called (contactWasCaller), and optionally what was said and emotions. ${RETRY}`,
    route: recordInteraction,
    body: callInteractionInput,
    fixed: { kind: "call" },
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "record_conversation",
    title: "Record a conversation",
    description:
      `Records a written conversation with one person on a channel (channelTypeId from list_communication_options), optionally with a title, the contact method used, and its messages in order. ${RETRY}`,
    route: recordInteraction,
    body: conversationInteractionInput,
    fixed: { kind: "conversation" },
    minted: { requestId: "uuid" },
  }),
];
