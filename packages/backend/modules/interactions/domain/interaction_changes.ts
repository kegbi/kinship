/**
 * Editing or removing a note, an activity, a call, or a conversation (MCP-D1).
 *
 * A change is partial: a field the client omits stays as stored, an explicit
 * `null` clears a field the record may leave empty, and at least one field has
 * to be named. A list — participants, emotions, a conversation's messages —
 * replaces the stored list whole when it is supplied. Every bound the create
 * applies applies here as well, because an edit must never store a record the
 * create would have refused.
 *
 * Both writes name the revision the client last read (`expectedUpdatedAt`). It
 * is canonicalised to the six fractional digits the schema stores, so the
 * comparison against the stored revision is exact without being sensitive to
 * how a client spelled the same instant.
 */

import type { ValidationErrors } from "../../../shared-kernel/result.ts";
import {
  boundedText,
  instant,
  isUuid,
  uuid,
} from "../../../shared-kernel/validation.ts";
import {
  canonicalEmotionIds,
  canonicalMessages,
  type MessageValue,
  type StoredCommunication,
} from "./communication_rules.ts";
import { canonicalUuid, type StoredInteraction } from "./interaction_rules.ts";

/** The four kinds of record a change can name. */
export type InteractionKind = "activity" | "call" | "conversation" | "note";

/** A stored record of any kind, as the repositories read it back. */
export type StoredRecord = StoredCommunication | StoredInteraction;

interface MessageInput {
  readonly content: string;
  readonly direction: "inbound" | "outbound";
  readonly writtenAt: string;
}

export type InteractionChangeInput =
  | {
    readonly body?: string;
    readonly expectedUpdatedAt: string;
    readonly isFavorited?: boolean;
    readonly kind: "note";
  }
  | {
    readonly activityTypeId?: string | null;
    readonly description?: string | null;
    readonly emotionIds?: readonly string[];
    readonly expectedUpdatedAt: string;
    readonly happenedAt?: string;
    readonly kind: "activity";
    readonly participantIds?: readonly string[];
    readonly summary?: string;
  }
  | {
    readonly calledAt?: string;
    readonly contactWasCaller?: boolean;
    readonly content?: string | null;
    readonly emotionIds?: readonly string[];
    readonly expectedUpdatedAt: string;
    readonly kind: "call";
  }
  | {
    readonly channelTypeId?: string;
    readonly contactMethodId?: string | null;
    readonly expectedUpdatedAt: string;
    readonly happenedAt?: string;
    readonly kind: "conversation";
    readonly messages?: readonly MessageInput[];
    readonly title?: string | null;
  };

/** The canonical fields a validated change carries into the write. */
export type CheckedChange =
  | {
    readonly body?: string;
    readonly isFavorited?: boolean;
    readonly kind: "note";
  }
  | {
    readonly activityTypeId?: string | null;
    readonly description?: string | null;
    readonly emotionIds?: readonly string[];
    readonly happenedAt?: Date;
    readonly kind: "activity";
    readonly participantIds?: readonly string[];
    readonly summary?: string;
  }
  | {
    readonly calledAt?: Date;
    readonly contactWasCaller?: boolean;
    readonly content?: string | null;
    readonly emotionIds?: readonly string[];
    readonly kind: "call";
  }
  | {
    readonly channelTypeId?: string;
    readonly contactMethodId?: string | null;
    readonly happenedAt?: Date;
    readonly kind: "conversation";
    readonly messages?: readonly MessageValue[];
    readonly title?: string | null;
  };

export interface CheckedInteractionChange {
  readonly change: CheckedChange;
  readonly expectedUpdatedAt: string;
  readonly id: string;
}

export interface CheckedInteractionRemoval {
  readonly expectedUpdatedAt: string;
  readonly id: string;
}

const REFRESH = "Refresh this interaction before saving.";

function occurrence(
  value: string | undefined,
  errors: Record<string, string>,
  field: string,
): Date | undefined {
  if (value === undefined) return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    errors[field] = "Choose a valid occurrence time.";
    return undefined;
  }
  return parsed;
}

function emotions(
  value: readonly string[] | undefined,
  errors: Record<string, string>,
): readonly string[] | undefined {
  if (value === undefined) return undefined;
  const ids = canonicalEmotionIds(value);
  if (value.length > 20 || ids.some((entry) => !isUuid(entry))) {
    errors.emotionIds = "Choose at most 20 active emotions.";
  }
  return ids;
}

/** A nullable text field: absent, cleared, or bounded. */
function nullableText(
  value: string | null | undefined,
  maximum: number,
  errors: Record<string, string>,
  field: string,
  message: string,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  const text = boundedText(value, maximum);
  if (!text) errors[field] = message;
  return text;
}

/** A nullable client identifier: absent, cleared, or canonical. */
function nullableId(
  value: string | null | undefined,
  errors: Record<string, string>,
  field: string,
  message: string,
): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (!isUuid(value)) errors[field] = message;
  return canonicalUuid(value);
}

/** `T` with every possibly-undefined member made optional instead. */
type Defined<T> =
  & { [K in keyof T as undefined extends T[K] ? never : K]: T[K] }
  & {
    [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<
      T[K],
      undefined
    >;
  };

/** The members the client supplied, without the ones it left out. */
function definedOnly<const T extends object>(value: T): Defined<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Defined<T>;
}

function checkChange(
  input: InteractionChangeInput,
  errors: Record<string, string>,
): CheckedChange {
  switch (input.kind) {
    case "note": {
      const body = input.body === undefined
        ? undefined
        : boundedText(input.body, 10_000);
      if (input.body !== undefined && !body) {
        errors.body = "Write a note of at most 10,000 characters.";
      }
      return definedOnly({
        body,
        isFavorited: input.isFavorited,
        kind: "note" as const,
      });
    }
    case "activity": {
      const summary = input.summary === undefined
        ? undefined
        : boundedText(input.summary, 500);
      if (input.summary !== undefined && !summary) {
        errors.summary = "Add a summary of at most 500 characters.";
      }
      let participantIds: readonly string[] | undefined;
      if (input.participantIds !== undefined) {
        participantIds = [
          ...new Set(input.participantIds.map(canonicalUuid)),
        ].sort();
        if (
          input.participantIds.length === 0 ||
          input.participantIds.length > 50 ||
          participantIds.some((entry) => !isUuid(entry))
        ) errors.participantIds = "Choose between 1 and 50 valid people.";
      }
      return definedOnly({
        activityTypeId: nullableId(
          input.activityTypeId,
          errors,
          "activityTypeId",
          "Choose an active activity type.",
        ),
        description: nullableText(
          input.description,
          10_000,
          errors,
          "description",
          "Details must be at most 10,000 characters.",
        ),
        emotionIds: emotions(input.emotionIds, errors),
        happenedAt: occurrence(input.happenedAt, errors, "happenedAt"),
        kind: "activity" as const,
        participantIds,
        summary,
      });
    }
    case "call":
      return definedOnly({
        calledAt: occurrence(input.calledAt, errors, "calledAt"),
        contactWasCaller: input.contactWasCaller,
        content: nullableText(
          input.content,
          10_000,
          errors,
          "content",
          "Details must be at most 10,000 characters.",
        ),
        emotionIds: emotions(input.emotionIds, errors),
        kind: "call" as const,
      });
    case "conversation": {
      if (
        input.channelTypeId !== undefined && !isUuid(input.channelTypeId)
      ) errors.channelTypeId = "Choose an active channel.";
      let messages: readonly MessageValue[] | undefined;
      if (input.messages !== undefined) {
        if (input.messages.length > 50) {
          errors.messages = "Record at most 50 messages.";
        } else if (
          input.messages.some((message) =>
            !boundedText(message.content, 10_000) ||
            !Number.isFinite(new Date(message.writtenAt).getTime())
          )
        ) {
          errors.messages =
            "Each message needs bounded content and a valid time.";
        } else messages = canonicalMessages(input.messages);
      }
      return definedOnly({
        channelTypeId: input.channelTypeId === undefined
          ? undefined
          : canonicalUuid(input.channelTypeId),
        contactMethodId: nullableId(
          input.contactMethodId,
          errors,
          "contactMethodId",
          "Choose a contact method for this person.",
        ),
        happenedAt: occurrence(input.happenedAt, errors, "happenedAt"),
        kind: "conversation" as const,
        messages,
        title: nullableText(
          input.title,
          500,
          errors,
          "title",
          "Title must be at most 500 characters.",
        ),
      });
    }
  }
}

/**
 * Validates and canonicalises an edit. Identifiers are lower-cased, lists are
 * deduplicated and sorted, text is trimmed, and messages are put in the
 * canonical order a conversation reads in.
 */
export function validateInteractionChange(
  interactionId: string,
  input: InteractionChangeInput,
): { readonly errors: ValidationErrors } | CheckedInteractionChange {
  const errors: Record<string, string> = {};
  const id = uuid(interactionId);
  if (!id) errors.interactionId = "Use a canonical interaction identifier.";
  const expectedUpdatedAt = instant(input.expectedUpdatedAt);
  if (!expectedUpdatedAt) errors.expectedUpdatedAt = REFRESH;
  const change = checkChange(input, errors);
  if (changedFields(change).length === 0) {
    errors.change = "Change at least one field.";
  }
  return Object.keys(errors).length > 0
    ? { errors }
    : { change, expectedUpdatedAt: expectedUpdatedAt!, id: id! };
}

/** Validates the record and the revision a removal names. */
export function validateInteractionRemoval(
  interactionId: string,
  expectedUpdatedAt: string,
): { readonly errors: ValidationErrors } | CheckedInteractionRemoval {
  const errors: Record<string, string> = {};
  const id = uuid(interactionId);
  if (!id) errors.interactionId = "Use a canonical interaction identifier.";
  const revision = instant(expectedUpdatedAt);
  if (!revision) errors.expectedUpdatedAt = REFRESH;
  return Object.keys(errors).length > 0
    ? { errors }
    : { expectedUpdatedAt: revision!, id: id! };
}

/** The names of the fields a change supplies, sorted. */
export function changedFields(change: CheckedChange): readonly string[] {
  return Object.keys(change).filter((key) => key !== "kind").sort();
}

/**
 * The people a stored record names, whether or not each is still visible. A
 * change that supplies an activity's participants replaces this list whole.
 */
export function participantsOf(stored: StoredRecord): readonly string[] {
  return stored.kind === "activity" ? stored.participantIds : [stored.personId];
}

/**
 * When the record happened once the change is applied: what a stay-in-touch
 * cadence is told about. A note has no occurrence and advances no cadence.
 */
export function occurrenceOf(
  stored: StoredRecord,
  change: CheckedChange,
): string | undefined {
  switch (stored.kind) {
    case "note":
      return undefined;
    case "call":
      return change.kind === "call" && change.calledAt
        ? change.calledAt.toISOString()
        : stored.calledAt;
    default:
      return (change.kind === "activity" || change.kind === "conversation") &&
          change.happenedAt
        ? change.happenedAt.toISOString()
        : stored.happenedAt;
  }
}
