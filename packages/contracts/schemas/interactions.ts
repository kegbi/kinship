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
  updatedAt: z.iso.datetime({ offset: true }).optional().meta({
    description:
      "The record's revision; send it back as expectedUpdatedAt to edit or delete it.",
  }),
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
  updatedAt: z.iso.datetime({ offset: true }).optional().meta({
    description:
      "The record's revision; send it back as expectedUpdatedAt to edit or delete it.",
  }),
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
  updatedAt: z.iso.datetime({ offset: true }).optional().meta({
    description:
      "The record's revision; send it back as expectedUpdatedAt to edit or delete it.",
  }),
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
  updatedAt: z.iso.datetime({ offset: true }).optional().meta({
    description:
      "The record's revision; send it back as expectedUpdatedAt to edit or delete it.",
  }),
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

const conversationMessageInput = z.strictObject({
  content: z.string().trim().min(1).max(10000),
  direction: z.enum(["inbound", "outbound"]),
  writtenAt: z.iso.datetime({ offset: true }),
});

export const conversationInteractionInput = z.strictObject({
  channelTypeId: z.uuid(),
  contactMethodId: z.uuid().optional(),
  happenedAt: z.iso.datetime({ offset: true }),
  kind: z.literal("conversation"),
  messages: z.array(conversationMessageInput).max(50).optional(),
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

/**
 * Editing a note, an activity, a call, or a conversation (MCP-D1).
 *
 * Every edit is partial and uses one convention: an omitted field stays as
 * stored, an explicit `null` clears a field the record may leave empty, a
 * supplied list replaces the stored list whole, and at least one field must be
 * named. `expectedUpdatedAt` is the record's `updatedAt` as last read; a stale
 * one is refused with 409.
 */
const expectedUpdatedAt = z.iso.datetime({ offset: true }).meta({
  description:
    "The updatedAt the client last read for this record; a changed record answers 409.",
});

/** True when an edit names at least one field besides its revision. */
function changesSomething(value: Record<string, unknown>): boolean {
  return Object.entries(value).some(([key, entry]) =>
    key !== "expectedUpdatedAt" && entry !== undefined
  );
}

const AT_LEAST_ONE = { message: "Change at least one field." };

export const noteChangeInput = z.strictObject({
  body: z.string().trim().min(1).max(10000).optional(),
  expectedUpdatedAt,
  isFavorited: z.boolean().optional().meta({
    description: "Whether the note is one of Today's favorite notes.",
  }),
}).refine(changesSomething, AT_LEAST_ONE).meta({ id: "NoteChangeInput" });

export const activityChangeInput = z.strictObject({
  activityTypeId: z.uuid().nullable().optional(),
  description: z.string().trim().min(1).max(10000).nullable().optional(),
  emotionIds: z.array(z.uuid()).max(20).optional(),
  expectedUpdatedAt,
  happenedAt: z.iso.datetime({ offset: true }).optional(),
  participantIds: z.array(z.uuid()).min(1).max(50).optional(),
  summary: z.string().trim().min(1).max(500).optional(),
}).refine(changesSomething, AT_LEAST_ONE).meta({
  id: "ActivityChangeInput",
});

export const callChangeInput = z.strictObject({
  calledAt: z.iso.datetime({ offset: true }).optional(),
  contactWasCaller: z.boolean().optional(),
  content: z.string().trim().min(1).max(10000).nullable().optional(),
  emotionIds: z.array(z.uuid()).max(20).optional(),
  expectedUpdatedAt,
}).refine(changesSomething, AT_LEAST_ONE).meta({ id: "CallChangeInput" });

export const conversationChangeInput = z.strictObject({
  channelTypeId: z.uuid().optional(),
  contactMethodId: z.uuid().nullable().optional(),
  expectedUpdatedAt,
  happenedAt: z.iso.datetime({ offset: true }).optional(),
  messages: z.array(conversationMessageInput).max(50).optional().meta({
    description:
      "Replaces every message of the conversation; an empty list removes them all.",
  }),
  title: z.string().trim().min(1).max(500).nullable().optional(),
}).refine(changesSomething, AT_LEAST_ONE).meta({
  id: "ConversationChangeInput",
});

export const interactionRemovalInput = z.strictObject({
  expectedUpdatedAt,
}).meta({ id: "InteractionRemovalInput" });

export const interactionSaved = z.strictObject({
  record: interaction,
  status: z.literal("saved"),
}).meta({ id: "InteractionSaved" });

export const interactionDeleted = z.strictObject({
  id: z.uuid(),
  kind: z.enum(["activity", "call", "conversation", "note"]),
  status: z.literal("deleted"),
}).meta({ id: "InteractionDeleted" });
