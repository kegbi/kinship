/**
 * Interactions, communications, and the activity report: the shapes this
 * surface accepts and answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/interactions` and out of
 * the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { oneOf } from "./shared.ts";

export const interactionOption = z.strictObject({
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "InteractionOption" });

export const interactionParticipant = z.strictObject({
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "InteractionParticipant" });

export const activityInteraction = z.strictObject({
  activityType: z.string().optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
  description: z.string().optional(),
  emotions: z.array(interactionOption).max(20),
  happenedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  kind: z.literal("activity"),
  participants: z.array(interactionParticipant).max(50),
  summary: z.string(),
}).meta({ id: "ActivityInteraction" });

export const activityInteractionInput = z.strictObject({
  activityTypeId: z.uuid().optional(),
  description: z.string().trim().min(1).max(10000).optional(),
  emotionIds: z.array(z.uuid()).max(20).optional(),
  happenedAt: z.iso.datetime({ offset: true }),
  kind: z.literal("activity"),
  participantIds: z.array(z.uuid()).min(1).max(50),
  requestId: z.uuid().meta({
    description:
      "Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.",
  }),
  summary: z.string().trim().min(1).max(500),
}).meta({ id: "ActivityInteractionInput" });

export const noteInteraction = z.strictObject({
  body: z.string(),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  isFavorited: z.boolean(),
  kind: z.literal("note"),
  person: interactionParticipant.optional(),
  participants: z.array(interactionParticipant).min(1).max(1).optional(),
}).meta({ id: "NoteInteraction" });

export const activityOrNoteInteraction = oneOf([
  activityInteraction,
  noteInteraction,
]).meta({ id: "ActivityOrNoteInteraction" });

export const activityReport = z.strictObject({
  items: z.array(activityOrNoteInteraction).max(50),
  nextCursor: z.string().optional(),
  person: interactionParticipant,
  status: z.enum(["archived", "ready"]),
}).meta({ id: "ActivityReport" });

export const callInteraction = z.strictObject({
  calledAt: z.iso.datetime({ offset: true }),
  contactWasCaller: z.boolean(),
  content: z.string().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  emotions: z.array(interactionOption).max(20),
  id: z.uuid(),
  kind: z.literal("call"),
  person: interactionParticipant,
}).meta({ id: "CallInteraction" });

export const callInteractionInput = z.strictObject({
  calledAt: z.iso.datetime({ offset: true }),
  contactWasCaller: z.boolean(),
  content: z.string().trim().min(1).max(10000).optional(),
  emotionIds: z.array(z.uuid()).max(20).optional(),
  kind: z.literal("call"),
  personId: z.uuid(),
  requestId: z.uuid().meta({
    description:
      "Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.",
  }),
}).meta({ id: "CallInteractionInput" });

export const communicationMessage = z.strictObject({
  content: z.string(),
  direction: z.enum(["inbound", "outbound"]),
  id: z.uuid(),
  writtenAt: z.iso.datetime({ offset: true }),
}).meta({ id: "CommunicationMessage" });

export const conversationInteraction = z.strictObject({
  channelType: interactionOption.optional(),
  contactMethod: z.strictObject({
    id: z.uuid(),
    value: z.string(),
  }).optional(),
  createdAt: z.iso.datetime({ offset: true }),
  happenedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  kind: z.literal("conversation"),
  messages: z.array(communicationMessage).max(50),
  person: interactionParticipant,
  title: z.string().optional(),
}).meta({ id: "ConversationInteraction" });

export const communicationList = z.strictObject({
  items: z.array(oneOf([callInteraction, conversationInteraction])).max(50),
  status: z.literal("ready"),
}).meta({ id: "CommunicationList" });

export const communicationOptions = z.strictObject({
  availability: z.strictObject({
    call: z.boolean(),
    conversation: z.boolean(),
  }),
  channelTypes: z.array(interactionOption).max(100),
  emotions: z.array(interactionOption).max(100),
  status: z.literal("ready"),
}).meta({ id: "CommunicationOptions" });

export const conversationInteractionInput = z.strictObject({
  channelTypeId: z.uuid(),
  contactMethodId: z.uuid().optional(),
  happenedAt: z.iso.datetime({ offset: true }),
  kind: z.literal("conversation"),
  messages: z.array(z.strictObject({
    content: z.string().trim().min(1).max(10000),
    direction: z.enum(["inbound", "outbound"]),
    writtenAt: z.iso.datetime({ offset: true }),
  })).max(50).optional(),
  personId: z.uuid(),
  requestId: z.uuid().meta({
    description:
      "Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.",
  }),
  title: z.string().trim().min(1).max(500).optional(),
}).meta({ id: "ConversationInteractionInput" });

export const interaction = oneOf([
  activityInteraction,
  noteInteraction,
  callInteraction,
  conversationInteraction,
]).meta({ id: "Interaction" });

export const interactionCreated = z.strictObject({
  record: interaction,
  status: z.literal("created"),
}).meta({ id: "InteractionCreated" });

export const noteInteractionInput = z.strictObject({
  body: z.string().trim().min(1).max(10000),
  isFavorited: z.boolean().optional(),
  kind: z.literal("note"),
  personId: z.uuid(),
  requestId: z.uuid().meta({
    description:
      "Client retry key mapped deterministically to a distinct workspace-scoped aggregate identifier; it is not the returned record id.",
  }),
}).meta({ id: "NoteInteractionInput" });

export const interactionInput = oneOf([
  activityInteractionInput,
  noteInteractionInput,
  callInteractionInput,
  conversationInteractionInput,
]).meta({ id: "InteractionInput" });

export const interactionOptions = z.strictObject({
  activityTypes: z.array(interactionOption).max(20),
  activityTypesNextCursor: z.string().optional(),
  availability: z.strictObject({
    activity: z.boolean(),
    note: z.boolean(),
  }),
  emotions: z.array(interactionOption).max(20),
  emotionsNextCursor: z.string().optional(),
  status: z.literal("ready"),
}).meta({ id: "InteractionOptions" });

export const todayFavoriteNotes = z.strictObject({
  items: z.array(noteInteraction).max(8),
  status: z.literal("ready"),
}).meta({ id: "TodayFavoriteNotes" });

export const todayRecentActivity = z.strictObject({
  items: z.array(activityOrNoteInteraction).max(20),
  status: z.literal("ready"),
}).meta({ id: "TodayRecentActivity" });
