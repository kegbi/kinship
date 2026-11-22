/**
 * What an activity or a note is, and what a client has to say to record one.
 *
 * Recording an interaction is idempotent: the client names the request and the
 * module derives the aggregate's identifier from it, so a retry lands on the
 * row it already wrote instead of creating a second one. That makes three
 * rules inseparable and all three live here — how the identifier is derived,
 * what a stored row has to look like for a retry to count as the same request,
 * and what the input has to satisfy before either question is asked.
 *
 * The derivation is a replay contract: an identifier written months ago must
 * still be reproduced byte for byte today, so it is pinned by fixed vectors in
 * the suite beside this file rather than by the shape of the code that
 * produces it.
 */

import { deterministicId } from "../../../shared-kernel/ids.ts";
import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import { boundedText, isUuid } from "../../../shared-kernel/validation.ts";

/**
 * A person an interaction names, as the people module summarised them.
 *
 * The rules never resolve a name; they only carry the pair a summary already
 * established, so the record reads without a second lookup.
 */
export interface InteractionParticipant {
  readonly id: string;
  readonly name: string;
}

/**
 * One entry of the workspace's vocabulary — an activity type or an emotion.
 *
 * The workspace owns the vocabulary and answers with its own option shape;
 * this is the minimum an interaction needs from it, declared here so the rules
 * stay inside this module while the workspace's record stays authoritative.
 */
export interface InteractionOption {
  readonly id: string;
  readonly name: string;
}

/** Which of the two kinds the workspace currently offers. */
export interface InteractionAvailability {
  readonly activity: boolean;
  readonly note: boolean;
}

export interface ActivityRecord {
  readonly activityType?: string;
  readonly createdAt: string;
  readonly description?: string;
  readonly emotions: readonly InteractionOption[];
  readonly happenedAt: string;
  readonly id: string;
  readonly kind: "activity";
  readonly participants: readonly InteractionParticipant[];
  readonly summary: string;
  /** The revision an edit or a removal names (MCP-D1). */
  readonly updatedAt?: string;
}

export interface NoteRecord {
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
  readonly isFavorited: boolean;
  readonly kind: "note";
  readonly person: InteractionParticipant;
  /** The revision an edit or a removal names (MCP-D1). */
  readonly updatedAt?: string;
}

export type InteractionRecord = ActivityRecord | NoteRecord;

/** An activity as the repository keeps it, before any name is resolved. */
export interface StoredActivity {
  readonly activityTypeId?: string;
  readonly createdAt: string;
  readonly createdByMemberId?: string;
  readonly description?: string;
  readonly emotionIds: readonly string[];
  readonly happenedAt: string;
  readonly id: string;
  readonly kind: "activity";
  readonly participantIds: readonly string[];
  readonly summary: string;
  readonly updatedAt?: string;
}

/** A note as the repository keeps it. */
export interface StoredNote {
  readonly body: string;
  readonly createdAt: string;
  readonly createdByMemberId?: string;
  readonly id: string;
  readonly isFavorited: boolean;
  readonly kind: "note";
  readonly personId: string;
  readonly updatedAt?: string;
}

export type StoredInteraction = StoredActivity | StoredNote;

export type RecordInteractionInput =
  | {
    readonly activityTypeId?: string;
    readonly description?: string;
    readonly emotionIds?: readonly string[];
    readonly happenedAt: string;
    readonly kind: "activity";
    readonly participantIds: readonly string[];
    readonly requestId: string;
    readonly summary: string;
  }
  | {
    readonly body: string;
    readonly isFavorited?: boolean;
    readonly kind: "note";
    readonly personId: string;
    readonly requestId: string;
  };

/** The lower-case form of an identifier that already passed `isUuid`. */
export function canonicalUuid(value: string): string {
  return value.toLowerCase();
}

/**
 * The aggregate identifier a request derives.
 *
 * The namespace is fixed for all time: it names the derivation, not the code,
 * so the identifier a request produced before this rule moved out of the use
 * case is the identifier it still produces. `interaction_rules_test.ts` pins
 * it against literal vectors for exactly that reason.
 */
export function deriveInteractionId(
  workspaceId: string,
  requestId: string,
): Promise<string> {
  return deterministicId("kinship.interactions.aggregate-id.v1", [
    workspaceId,
    requestId,
  ]);
}

/** The canonical input a validated request carries into the write. */
export interface CheckedInteraction {
  readonly activityTypeId?: string;
  readonly body?: string;
  readonly description?: string;
  readonly emotionIds: readonly string[];
  readonly happenedAt?: Date;
  readonly participantIds: readonly string[];
  readonly requestId: string;
  readonly summary?: string;
}

/** Either the rejected fields, or the canonical input. */
export type InteractionValidation =
  | { readonly errors: ValidationErrors }
  | CheckedInteraction;

/**
 * What a stored row has to say for a retry to be the same request.
 *
 * A note and an activity carry different evidence, so the comparison is
 * declared over both shapes rather than over the stored row alone.
 */
export type ExpectedInteraction =
  | {
    readonly activityTypeId?: string;
    readonly description?: string;
    readonly emotionIds: readonly string[];
    readonly happenedAt: Date;
    readonly kind: "activity";
    readonly participantIds: readonly string[];
    readonly summary: string;
  }
  | {
    readonly body: string;
    readonly isFavorited: boolean;
    readonly kind: "note";
    readonly personId: string;
  };

/**
 * Validates and canonicalises a request.
 *
 * Every identifier is lower-cased and every list deduplicated and sorted, so
 * two spellings of the same request compare equal both here and in the derived
 * identifier. A note answers with the person as its single participant, which
 * is what lets the write path treat both kinds the same way afterwards.
 */
export function validateInteraction(
  input: RecordInteractionInput,
): InteractionValidation {
  const errors: Record<string, string> = {};
  if (!isUuid(input.requestId)) {
    errors.requestId = "Use a canonical request identifier.";
  }
  if (input.kind === "note") {
    const body = boundedText(input.body, 10_000);
    if (!body) errors.body = "Write a note of at most 10,000 characters.";
    if (!isUuid(input.personId)) {
      errors.personId = "Choose one person from this workspace.";
    }
    return Object.keys(errors).length > 0 ? { errors } : {
      body: body!,
      emotionIds: [],
      participantIds: [canonicalUuid(input.personId)],
      requestId: canonicalUuid(input.requestId),
    };
  }
  const summary = boundedText(input.summary, 500);
  if (!summary) errors.summary = "Add a summary of at most 500 characters.";
  const description = input.description === undefined
    ? undefined
    : boundedText(input.description, 10_000);
  if (input.description !== undefined && !description) {
    errors.description = "Details must be at most 10,000 characters.";
  }
  const happenedAt = new Date(input.happenedAt);
  if (!Number.isFinite(happenedAt.getTime())) {
    errors.happenedAt = "Choose a valid occurrence time.";
  }
  const participantIds = [
    ...new Set(input.participantIds.map(canonicalUuid)),
  ].sort();
  if (
    input.participantIds.length === 0 || input.participantIds.length > 50 ||
    participantIds.some((id) => !isUuid(id))
  ) {
    errors.participantIds = "Choose between 1 and 50 valid people.";
  }
  const rawEmotions = input.emotionIds ?? [];
  const emotionIds = [...new Set(rawEmotions.map(canonicalUuid))].sort();
  if (
    rawEmotions.length > 20 ||
    emotionIds.some((id) => !isUuid(id))
  ) {
    errors.emotionIds = "Choose at most 20 active emotions.";
  }
  if (input.activityTypeId && !isUuid(input.activityTypeId)) {
    errors.activityTypeId = "Choose an active activity type.";
  }
  return Object.keys(errors).length > 0 ? { errors } : {
    ...(input.activityTypeId
      ? { activityTypeId: canonicalUuid(input.activityTypeId) }
      : {}),
    ...(description ? { description } : {}),
    emotionIds,
    happenedAt,
    participantIds,
    requestId: canonicalUuid(input.requestId),
    summary: summary!,
  };
}

/** The evidence a replay of this request would have to match. */
export function expectedInteraction(
  input: RecordInteractionInput,
  checked: CheckedInteraction,
): ExpectedInteraction {
  if (input.kind === "activity") {
    return {
      ...(checked.activityTypeId
        ? { activityTypeId: checked.activityTypeId }
        : {}),
      ...(checked.description ? { description: checked.description } : {}),
      emotionIds: checked.emotionIds,
      happenedAt: checked.happenedAt!,
      kind: "activity",
      participantIds: checked.participantIds,
      summary: checked.summary!,
    };
  }
  return {
    body: checked.body!,
    isFavorited: input.isFavorited === true,
    kind: "note",
    personId: checked.participantIds[0]!,
  };
}

/**
 * Whether the row already under the derived identifier is this request.
 *
 * A different member, a different kind, or any differing field means the
 * identifier was reused for something else, and the caller reports a conflict
 * rather than handing back somebody else's interaction.
 */
export function matchesExpected(
  stored: StoredInteraction,
  expected: ExpectedInteraction,
  memberId: string,
): boolean {
  if (stored.createdByMemberId !== memberId || stored.kind !== expected.kind) {
    return false;
  }
  return stored.kind === "activity" && expected.kind === "activity"
    ? stored.activityTypeId === expected.activityTypeId &&
      stored.description === expected.description &&
      stored.happenedAt === expected.happenedAt.toISOString() &&
      stored.summary === expected.summary &&
      stored.participantIds.join(",") === expected.participantIds.join(",") &&
      stored.emotionIds.join(",") === expected.emotionIds.join(",")
    : stored.kind === "note" && expected.kind === "note" &&
      stored.personId === expected.personId && stored.body === expected.body &&
      stored.isFavorited === expected.isFavorited;
}

/**
 * The activity a replay reads back, with the names resolved for it.
 *
 * The stored row keeps identifiers; the vocabulary and the people summaries
 * the caller just read supply the names, so a replayed record reads exactly
 * like the one the original request returned.
 */
export function replayedActivity(
  stored: StoredActivity,
  id: string,
  descriptors: {
    readonly activityType?: InteractionOption;
    readonly emotions: readonly InteractionOption[];
  },
  participants: readonly InteractionParticipant[],
): ActivityRecord {
  return {
    ...(descriptors.activityType
      ? { activityType: descriptors.activityType.name }
      : {}),
    createdAt: stored.createdAt,
    ...(stored.description ? { description: stored.description } : {}),
    emotions: descriptors.emotions,
    happenedAt: stored.happenedAt,
    id,
    kind: "activity",
    participants: participants.map(({ id, name }) => ({ id, name })),
    summary: stored.summary,
    ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
  };
}

/** The note a replay reads back, against the person it was written about. */
export function replayedNote(
  stored: StoredNote,
  id: string,
  person: InteractionParticipant,
): NoteRecord {
  return {
    body: stored.body,
    createdAt: stored.createdAt,
    id,
    isFavorited: stored.isFavorited,
    kind: "note",
    person: { id: person.id, name: person.name },
    ...(stored.updatedAt ? { updatedAt: stored.updatedAt } : {}),
  };
}
