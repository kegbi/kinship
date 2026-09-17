/**
 * How the module stores an interaction, and what it needs from the workspace.
 *
 * Recording is idempotent, so the write discipline is fixed: `lockRequest`
 * takes the derived identifier before anything is read, `findRequest` says
 * whether that request already landed, and only then does a create run.
 * `assertPostcondition` closes it — the row is read back inside the same
 * transaction, so a write that silently did nothing fails loudly instead of
 * being audited as a success.
 *
 * The workspace boundary and the recorded-interaction publisher are here for
 * the same reason: both are contracts this module declares and somebody else
 * fills at a composition root. Planning fills the publisher, because recording
 * an interaction is what settles a stay-in-touch.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  ActivityRecord,
  InteractionAvailability,
  InteractionOption,
  InteractionParticipant,
  InteractionRecord,
  NoteRecord,
  StoredInteraction,
} from "../domain/interaction_rules.ts";
import type { InteractionActor, InteractionTransaction } from "./context.ts";

/**
 * The workspace vocabulary an interaction refers to. The actor's standing is
 * established with `ActorRevalidation` before any of these are asked.
 */
export interface InteractionWorkspaceBoundary {
  describe(
    command: {
      readonly activityTypeId?: string;
      readonly emotionIds: readonly string[];
      readonly transaction: InteractionTransaction;
      readonly workspaceId: string;
    },
  ): Promise<{
    readonly activityType?: InteractionOption;
    readonly emotions: readonly InteractionOption[];
  }>;
  inspect(
    command: InteractionActor & {
      readonly activityTypeId?: string;
      readonly emotionIds: readonly string[];
      readonly kind: "activity" | "note";
      readonly lock: boolean;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<
    | {
      readonly activityType?: InteractionOption;
      readonly emotions: readonly InteractionOption[];
      readonly status: "ready";
    }
    | Failure<"forbidden" | "not-found", "hidden">
  >;
  options(
    command: InteractionActor & {
      readonly activityTypeCursor?: string;
      readonly activityTypeSearch?: string;
      readonly emotionCursor?: string;
      readonly emotionSearch?: string;
      readonly limit: number;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<
    | {
      readonly activityTypes: readonly InteractionOption[];
      readonly activityTypesNextCursor?: string;
      readonly availability: InteractionAvailability;
      readonly emotions: readonly InteractionOption[];
      readonly emotionsNextCursor?: string;
      readonly status: "ready";
    }
    | Failure<"forbidden", "stale-cursor">
  >;
}

export interface InteractionRepository {
  lockRequest(command: {
    readonly id: string;
    readonly transaction: InteractionTransaction;
  }): Promise<void>;
  findRequest(
    command: {
      readonly id: string;
      readonly transaction: InteractionTransaction;
      readonly workspaceId: string;
    },
  ): Promise<
    | { readonly status: "absent" }
    | { readonly interaction: StoredInteraction; readonly status: "found" }
  >;
  createActivity(
    command: InteractionActor & {
      readonly activityType?: InteractionOption;
      readonly description?: string;
      readonly emotions: readonly InteractionOption[];
      readonly happenedAt: Date;
      readonly id: string;
      readonly occurredAt: Date;
      readonly participantIds: readonly string[];
      readonly participants: readonly InteractionParticipant[];
      readonly summary: string;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<ActivityRecord | undefined>;
  createNote(
    command: InteractionActor & {
      readonly body: string;
      readonly id: string;
      readonly isFavorited: boolean;
      readonly occurredAt: Date;
      readonly person: InteractionParticipant;
      readonly personId: string;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<NoteRecord | undefined>;
  assertPostcondition(
    command: InteractionActor & {
      readonly record: InteractionRecord;
      readonly transaction: InteractionTransaction;
    },
  ): Promise<void>;
}

/**
 * Planning's hook into this module.
 *
 * Recording an interaction settles a stay-in-touch, and planning owns that
 * rule, so the event is published across the boundary rather than reached for
 * through planning's tables.
 */
export interface InteractionRecordedPublisher {
  interactionRecorded(event: {
    readonly happenedAt: string;
    readonly memberId: string;
    readonly personIds: readonly string[];
    readonly transaction: InteractionTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
}
