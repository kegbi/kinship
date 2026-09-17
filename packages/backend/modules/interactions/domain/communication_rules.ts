/**
 * What a call or a conversation is, and when two of them are the same request.
 *
 * A conversation carries messages, and messages arrive in whatever order a
 * client happened to serialise them. That makes ordering a rule rather than a
 * detail: the canonical order decides which message gets which derived
 * identifier, and comparing two requests for equality only means anything once
 * both sides are in that order. Ordering, canonicalisation, the identifier
 * derivations, the replay comparison, and the input rules therefore belong
 * together, and they belong away from the orchestration that used to hold
 * them.
 *
 * Both derivations are replay contracts — an identifier written months ago
 * must still be reproduced byte for byte — so the suite beside this file pins
 * them with literal vectors rather than with a re-implementation.
 */

import { deterministicId } from "../../../shared-kernel/ids.ts";
import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import { boundedText } from "../../../shared-kernel/validation.ts";
import {
  canonicalUuid,
  type InteractionOption,
  type InteractionParticipant,
  isClientUuid,
} from "./interaction_rules.ts";

/** One message inside a conversation, once it has its derived identifier. */
export interface CommunicationMessage {
  readonly content: string;
  readonly direction: "inbound" | "outbound";
  readonly id: string;
  readonly writtenAt: string;
}

export interface CallRecord {
  readonly calledAt: string;
  readonly contactWasCaller: boolean;
  readonly content?: string;
  readonly createdAt: string;
  readonly emotions: readonly InteractionOption[];
  readonly id: string;
  readonly kind: "call";
  readonly person: InteractionParticipant;
}

export interface ConversationRecord {
  readonly channelType?: InteractionOption;
  readonly contactMethod?: { readonly id: string; readonly value: string };
  readonly createdAt: string;
  readonly happenedAt: string;
  readonly id: string;
  readonly kind: "conversation";
  readonly messages: readonly CommunicationMessage[];
  readonly person: InteractionParticipant;
  readonly title?: string;
}

export type CommunicationRecord = CallRecord | ConversationRecord;

export type RecordCommunicationInput =
  | {
    readonly calledAt: string;
    readonly contactWasCaller: boolean;
    readonly content?: string;
    readonly emotionIds?: readonly string[];
    readonly kind: "call";
    readonly personId: string;
    readonly requestId: string;
  }
  | {
    readonly channelTypeId: string;
    readonly contactMethodId?: string;
    readonly happenedAt: string;
    readonly kind: "conversation";
    readonly messages?: readonly {
      readonly content: string;
      readonly direction: "inbound" | "outbound";
      readonly writtenAt: string;
    }[];
    readonly personId: string;
    readonly requestId: string;
    readonly title?: string;
  };

/** A call as the repository keeps it, before any name is resolved. */
export interface StoredCall {
  readonly calledAt: string;
  readonly contactWasCaller: boolean;
  readonly content?: string;
  readonly createdAt: string;
  readonly createdByMemberId?: string;
  readonly emotionIds: readonly string[];
  readonly id: string;
  readonly kind: "call";
  readonly personId: string;
}

/** A conversation as the repository keeps it. */
export interface StoredConversation {
  readonly channelTypeId?: string;
  readonly contactMethodId?: string;
  readonly createdAt: string;
  readonly happenedAt: string;
  readonly id: string;
  readonly kind: "conversation";
  readonly messages: readonly CommunicationMessage[];
  readonly personId: string;
  readonly title?: string;
}

export type StoredCommunication = StoredCall | StoredConversation;

/** A message before it has an identifier: the part two requests compare on. */
export type MessageValue = Omit<CommunicationMessage, "id">;

/**
 * The total order two messages are compared in.
 *
 * Time first, then direction, then content, so a client that sends the same
 * conversation twice in a different order still canonicalises to one sequence.
 */
export function compareMessageValues(
  left: MessageValue,
  right: MessageValue,
): number {
  for (
    const [a, b] of [
      [left.writtenAt, right.writtenAt],
      [left.direction, right.direction],
      [left.content, right.content],
    ] as const
  ) {
    if (a < b) return -1;
    if (a > b) return 1;
  }
  return 0;
}

/**
 * Stored messages in reading order.
 *
 * The identifier breaks a tie between two otherwise identical messages, so the
 * order is total and a record reads the same way on every load.
 */
export function orderMessages<T extends CommunicationMessage>(
  messages: readonly T[],
): readonly T[] {
  return [...messages].sort((left, right) =>
    compareMessageValues(left, right) || left.id.localeCompare(right.id)
  );
}

/**
 * The messages of a request, trimmed, in UTC, and in canonical order.
 *
 * This is what a message's derived identifier is indexed against, so the same
 * request always assigns the same identifier to the same message.
 */
export function canonicalMessages(
  messages: readonly {
    readonly content: string;
    readonly direction: "inbound" | "outbound";
    readonly writtenAt: string;
  }[],
): readonly MessageValue[] {
  return messages.map((message) => ({
    content: message.content.trim(),
    direction: message.direction,
    writtenAt: new Date(message.writtenAt).toISOString(),
  })).sort(compareMessageValues);
}

/**
 * The identifier a communication request derives.
 *
 * `namespace` is the request's kind for the aggregate and `message-<index>`
 * for each message, and it names the derivation for all time: the identifier a
 * request produced before this rule moved out of the use case is the
 * identifier it still produces. `communication_rules_test.ts` pins that
 * against literal vectors.
 */
export function deriveCommunicationId(
  namespace: string,
  workspaceId: string,
  requestId: string,
): Promise<string> {
  return deterministicId(`kinship.interactions.${namespace}.v1`, [
    workspaceId,
    requestId,
  ]);
}

/** The messages of a request with their derived identifiers, in order. */
export async function derivedMessages(
  input: readonly {
    readonly content: string;
    readonly direction: "inbound" | "outbound";
    readonly writtenAt: string;
  }[],
  workspaceId: string,
  requestId: string,
): Promise<readonly CommunicationMessage[]> {
  return orderMessages(
    await Promise.all(
      canonicalMessages(input).map(async (message, index) => ({
        content: message.content,
        direction: message.direction,
        id: await deriveCommunicationId(
          `message-${index}`,
          workspaceId,
          requestId,
        ),
        writtenAt: message.writtenAt,
      })),
    ),
  );
}

/**
 * The emotions a call request names, deduplicated and sorted.
 *
 * The stored row keeps them in this order, so the replay comparison can join
 * both sides and compare the text.
 */
export function canonicalEmotionIds(
  emotionIds: readonly string[] | undefined,
): readonly string[] {
  return [...new Set((emotionIds ?? []).map(canonicalUuid))].sort();
}

/**
 * Whether the row already under the derived identifier is this request.
 *
 * A call also compares the member who wrote it; a conversation does not,
 * because its identity is fully determined by the channel, the time, the
 * title, and the canonical messages.
 */
export function matchesStored(
  stored: StoredCommunication,
  input: RecordCommunicationInput,
  memberId: string,
): boolean {
  if (
    stored.kind !== input.kind ||
    stored.personId !== canonicalUuid(input.personId)
  ) return false;
  if (stored.kind === "call" && input.kind === "call") {
    return stored.createdByMemberId === memberId &&
      stored.calledAt === new Date(input.calledAt).toISOString() &&
      stored.contactWasCaller === input.contactWasCaller &&
      stored.content === boundedText(input.content, 10_000) &&
      stored.emotionIds.join(",") ===
        canonicalEmotionIds(input.emotionIds).join(",");
  }
  if (stored.kind !== "conversation" || input.kind !== "conversation") {
    return false;
  }
  const messages = canonicalMessages(input.messages ?? []);
  const storedMessages = canonicalMessages(stored.messages);
  return stored.channelTypeId === canonicalUuid(input.channelTypeId) &&
    stored.contactMethodId ===
      (input.contactMethodId
        ? canonicalUuid(input.contactMethodId)
        : undefined) &&
    stored.happenedAt === new Date(input.happenedAt).toISOString() &&
    stored.title === boundedText(input.title, 500) &&
    storedMessages.length === messages.length &&
    storedMessages.every((message, index) => {
      const expected = messages[index]!;
      return message.content === expected.content &&
        message.direction === expected.direction &&
        message.writtenAt === expected.writtenAt;
    });
}

/**
 * The fields a request must get right before anything is read or written.
 *
 * Over-long details and titles are the one asymmetry: a call's content and a
 * conversation's title are rejected outright, while the values that survive
 * trimming are simply kept, which is what `boundedText` already decides.
 */
export function validateCommunication(
  input: RecordCommunicationInput,
): ValidationErrors {
  const errors: Record<string, string> = {};
  if (!isClientUuid(input.requestId)) {
    errors.requestId = "Use a canonical request identifier.";
  }
  if (!isClientUuid(input.personId)) {
    errors.personId = "Choose one person from this workspace.";
  }
  const happenedAt = new Date(
    input.kind === "call" ? input.calledAt : input.happenedAt,
  );
  if (!Number.isFinite(happenedAt.getTime())) {
    errors.happenedAt = "Choose a valid occurrence time.";
  }
  if (input.kind === "call") {
    if (input.content !== undefined && !boundedText(input.content, 10_000)) {
      errors.content = "Details must be at most 10,000 characters.";
    }
    const emotions = canonicalEmotionIds(input.emotionIds);
    if (emotions.length > 20 || emotions.some((id) => !isClientUuid(id))) {
      errors.emotionIds = "Choose at most 20 active emotions.";
    }
  } else {
    if (!isClientUuid(input.channelTypeId)) {
      errors.channelTypeId = "Choose an active channel.";
    }
    if (input.contactMethodId && !isClientUuid(input.contactMethodId)) {
      errors.contactMethodId = "Choose a contact method for this person.";
    }
    if (input.title !== undefined && !boundedText(input.title, 500)) {
      errors.title = "Title must be at most 500 characters.";
    }
    const messages = input.messages ?? [];
    if (messages.length > 50) errors.messages = "Record at most 50 messages.";
    if (
      messages.some((message) =>
        !boundedText(message.content, 10_000) ||
        !Number.isFinite(new Date(message.writtenAt).getTime())
      )
    ) {
      errors.messages = "Each message needs bounded content and a valid time.";
    }
  }
  return errors;
}

/** The call a reader sees, with the person and the emotions resolved. */
export function callRecord(
  stored: StoredCall,
  person: InteractionParticipant,
  emotions: readonly InteractionOption[],
): CallRecord {
  return {
    calledAt: stored.calledAt,
    contactWasCaller: stored.contactWasCaller,
    ...(stored.content ? { content: stored.content } : {}),
    createdAt: stored.createdAt,
    emotions,
    id: stored.id,
    kind: "call",
    person: { id: person.id, name: person.name },
  };
}

/**
 * The conversation a reader sees, in canonical message order.
 *
 * A channel type or a contact method the workspace no longer resolves is left
 * out rather than guessed at, so a renamed or removed reference never invents
 * a label.
 */
export function conversationRecord(
  stored: StoredConversation,
  person: InteractionParticipant,
  channelType: InteractionOption | undefined,
  contactMethod: { readonly id: string; readonly value: string } | undefined,
): ConversationRecord {
  return {
    ...(channelType ? { channelType } : {}),
    ...(contactMethod
      ? { contactMethod: { id: contactMethod.id, value: contactMethod.value } }
      : {}),
    createdAt: stored.createdAt,
    happenedAt: stored.happenedAt,
    id: stored.id,
    kind: "conversation",
    messages: orderMessages(stored.messages),
    person: { id: person.id, name: person.name },
    ...(stored.title ? { title: stored.title } : {}),
  };
}
