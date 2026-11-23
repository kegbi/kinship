/**
 * Editing and removing a note, an activity, a call, or a conversation
 * (MCP-D1).
 *
 * Both writes follow the module's create discipline: the input is validated
 * before anything is opened, the actor is revalidated with a lock inside the
 * workspace-scoped transaction, the record's row is locked before its revision
 * is compared, and the audit event is written and read back in that same
 * transaction. They also keep the create's rules: a section the workspace
 * turned off refuses the write, every vocabulary entry and person the change
 * names must still be active in the workspace, a conversation's contact
 * method must belong to its person and sit on its channel, and a record that
 * names an archived person is read-only.
 *
 * Stay-in-touch cadences only ever move forward (planning keeps the latest
 * contact it heard of), so an edit that moves an activity, a call, or a
 * conversation, or changes who took part, tells planning again, exactly as a
 * create does, and planning ignores a time earlier than the one it holds. A
 * removal publishes nothing and pulls no cadence back. Nothing a cadence
 * stores points at the record, so neither leaves a dangling reference.
 *
 * A removal is permanent, so it leaves the record's request tombstone in the
 * same transaction (MCP-E3): the create that made it, re-sent with its
 * `requestId`, is then refused instead of recording it again.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { RequestTombstones } from "../../../shared-kernel/request_tombstone.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import type { CommunicationRecord } from "../domain/communication_rules.ts";
import {
  changedFields,
  type CheckedChange,
  type InteractionChangeInput,
  type InteractionKind,
  occurrenceOf,
  participantsOf,
  type StoredRecord,
  validateInteractionChange,
  validateInteractionRemoval,
} from "../domain/interaction_changes.ts";
import {
  type InteractionRecord,
  replayedActivity,
  replayedNote,
} from "../domain/interaction_rules.ts";
import type { InteractionChangeAudit } from "../ports/audit.ts";
import type {
  InteractionActor,
  InteractionTransaction,
  InteractionTransactionRunner,
} from "../ports/context.ts";
import type { InteractionChangeRepository } from "../ports/interaction_change_repository.ts";
import type {
  InteractionRecordedPublisher,
  InteractionWorkspaceBoundary,
} from "../ports/interaction_repository.ts";
import type { InteractionPersonBoundary } from "../../people/public.ts";
import type {
  ActorRevalidation,
  InteractionWorkspaceBoundary as CommunicationWorkspaceBoundary,
} from "../../workspaces/public.ts";
import { hydrate } from "./communication_context.ts";
import { active, canonicalActor } from "./interaction_context.ts";

export interface InteractionChangeDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: InteractionChangeAudit;
  readonly clock: Clock;
  readonly people: InteractionPersonBoundary;
  readonly publisher?: InteractionRecordedPublisher;
  readonly repository: InteractionChangeRepository;
  /** Governance's request tombstones, left by a removal (MCP-E3). */
  readonly tombstones: RequestTombstones;
  readonly transaction: InteractionTransactionRunner;
  readonly workspace:
    & CommunicationWorkspaceBoundary
    & InteractionWorkspaceBoundary;
}

type Refusal = Failure<
  "archived-write-rejected" | "forbidden" | "not-found",
  "hidden" | "stale"
>;

export type ChangeInteractionResult =
  | {
    readonly record: CommunicationRecord | InteractionRecord;
    readonly status: "saved";
  }
  | Refusal
  | ValidationFailure;

export type RemoveInteractionResult =
  | {
    readonly id: string;
    readonly kind: InteractionKind;
    readonly status: "deleted";
  }
  | Refusal
  | ValidationFailure;

/**
 * The workspace's answer for the section and for the vocabulary the change
 * names. Entries the change leaves alone are not re-checked, so an edit of a
 * summary never fails because an emotion was retired after the activity was
 * recorded.
 */
async function vocabularyStands(
  dependencies: InteractionChangeDependencies,
  actor: InteractionActor,
  change: CheckedChange,
  transaction: InteractionTransaction,
): Promise<"ready" | Refusal> {
  const emotionIds = "emotionIds" in change ? change.emotionIds ?? [] : [];
  const inspected = change.kind === "note" || change.kind === "activity"
    ? await dependencies.workspace.inspect({
      ...actor,
      ...(change.kind === "activity" && change.activityTypeId
        ? { activityTypeId: change.activityTypeId }
        : {}),
      emotionIds,
      kind: change.kind,
      lock: true,
      transaction,
    })
    : await dependencies.workspace.inspectCommunication({
      ...actor,
      ...(change.kind === "conversation" && change.channelTypeId
        ? { channelTypeId: change.channelTypeId }
        : {}),
      emotionIds,
      kind: change.kind,
      lock: true,
      transaction,
    });
  return inspected.status === "ready" ? "ready" : inspected;
}

/**
 * Whether the people the record names, before and after the change, may be
 * written, and who it names afterwards. A stored person who is no longer
 * visible (deleted) is ignored, so an activity is not frozen because one
 * participant was removed: that person's row stays untouched and is neither
 * audited nor told to planning. A record that names nobody visible is not
 * found, and every person the change itself supplies must be visible. Anyone
 * visible and archived makes the record read-only.
 */
async function peopleStand(
  dependencies: InteractionChangeDependencies,
  actor: InteractionActor,
  stored: readonly string[],
  supplied: readonly string[] | undefined,
  transaction: InteractionTransaction,
): Promise<{ readonly participants: readonly string[] } | Refusal> {
  const touched = [...new Set([...stored, ...supplied ?? []])].sort();
  const visible = new Set(
    (await dependencies.people.summarize({
      ...actor,
      personIds: touched,
      transaction,
    })).map((person) => person.id),
  );
  if (
    !stored.some((id) => visible.has(id)) ||
    supplied?.some((id) => !visible.has(id))
  ) return { status: "not-found" };
  const inspected = await dependencies.people.inspect({
    ...actor,
    lock: true,
    personIds: touched.filter((id) => visible.has(id)),
    transaction,
  });
  if (inspected.status === "ready") {
    return {
      participants: supplied ?? stored.filter((id) => visible.has(id)),
    };
  }
  return inspected.status === "archived"
    ? { status: "archived-write-rejected" }
    : { status: "not-found" };
}

/**
 * The contact method a conversation keeps after the change must still be one
 * of its person's, on the channel the conversation keeps. It is checked only
 * when the change touches either, so a conversation whose contact method the
 * person later removed (the schema clears it) can still be edited.
 */
async function contactMethodStands(
  dependencies: InteractionChangeDependencies,
  actor: InteractionActor,
  stored: StoredRecord,
  change: CheckedChange,
  transaction: InteractionTransaction,
): Promise<boolean> {
  if (stored.kind !== "conversation" || change.kind !== "conversation") {
    return true;
  }
  if (
    change.channelTypeId === undefined && change.contactMethodId === undefined
  ) return true;
  const contactMethodId = change.contactMethodId === undefined
    ? stored.contactMethodId
    : change.contactMethodId ?? undefined;
  if (!contactMethodId) return true;
  const inspected = await dependencies.people.inspectContactMethod({
    contactMethodId,
    personId: stored.personId,
    transaction,
    workspaceId: actor.workspaceId,
  });
  return inspected.status === "ready" &&
    inspected.contactMethod.typeId ===
      (change.channelTypeId ?? stored.channelTypeId);
}

/** The stored record as a reader sees it, names resolved. */
async function present(
  dependencies: InteractionChangeDependencies,
  actor: InteractionActor,
  stored: StoredRecord,
  transaction: InteractionTransaction,
): Promise<CommunicationRecord | InteractionRecord | undefined> {
  if (stored.kind === "call" || stored.kind === "conversation") {
    return await hydrate(dependencies, actor, stored, transaction);
  }
  const people = await dependencies.people.summarize({
    ...actor,
    personIds: stored.kind === "note"
      ? [stored.personId]
      : stored.participantIds,
    transaction,
  });
  if (stored.kind === "note") {
    return people[0] ? replayedNote(stored, stored.id, people[0]) : undefined;
  }
  const descriptors = await dependencies.workspace.describe({
    ...(stored.activityTypeId ? { activityTypeId: stored.activityTypeId } : {}),
    emotionIds: stored.emotionIds,
    transaction,
    workspaceId: actor.workspaceId,
  });
  return replayedActivity(stored, stored.id, descriptors, people);
}

/** Writes the audit event and proves it is there before the commit. */
async function audited(
  dependencies: InteractionChangeDependencies,
  command: Parameters<InteractionChangeAudit["record"]>[0],
): Promise<void> {
  const auditId = await dependencies.audit.record(command);
  await dependencies.audit.assertPostcondition({ ...command, auditId });
}

export function createInteractionChanges(
  dependencies: InteractionChangeDependencies,
) {
  return {
    changeInteraction: async (
      actor: InteractionActor,
      interactionId: string,
      input: InteractionChangeInput,
    ): Promise<ChangeInteractionResult> => {
      const checked = validateInteractionChange(interactionId, input);
      if ("errors" in checked) {
        return { errors: checked.errors, status: "validation-error" };
      }
      const canonical = canonicalActor(actor);
      const { change, expectedUpdatedAt, id } = checked;
      return await dependencies.transaction.run(async (
        transaction,
      ): Promise<ChangeInteractionResult> => {
        if (!await active(dependencies, canonical, transaction, true)) {
          return { status: "forbidden" };
        }
        const stored = await dependencies.repository.find({
          id,
          kind: change.kind,
          transaction,
          workspaceId: canonical.workspaceId,
        });
        if (!stored) return { status: "not-found" };
        if (stored.updatedAt !== expectedUpdatedAt) return { status: "stale" };
        const vocabulary = await vocabularyStands(
          dependencies,
          canonical,
          change,
          transaction,
        );
        if (vocabulary !== "ready") return vocabulary;
        const people = await peopleStand(
          dependencies,
          canonical,
          participantsOf(stored),
          change.kind === "activity" ? change.participantIds : undefined,
          transaction,
        );
        if ("status" in people) return people;
        const { participants } = people;
        if (
          !await contactMethodStands(
            dependencies,
            canonical,
            stored,
            change,
            transaction,
          )
        ) return { status: "not-found" };
        const occurredAt = dependencies.clock.now();
        const saved = await dependencies.repository.save({
          ...canonical,
          change,
          expectedUpdatedAt,
          id,
          occurredAt,
          transaction,
        });
        if (!saved) return { status: "stale" };
        const current = await dependencies.repository.find({
          id,
          kind: change.kind,
          transaction,
          workspaceId: canonical.workspaceId,
        });
        const record = current
          ? await present(dependencies, canonical, current, transaction)
          : undefined;
        if (!record) {
          throw new Error("Interaction change postcondition failed.");
        }
        await audited(dependencies, {
          action: "update",
          actor: canonical,
          fields: changedFields(change),
          kind: change.kind,
          occurredAt,
          participantIds: participants,
          subjectId: id,
          transaction,
        });
        const happenedAt = occurrenceOf(stored, change);
        const moved = ["calledAt", "happenedAt", "participantIds"].some((
          field,
        ) => field in change);
        if (happenedAt && moved) {
          await dependencies.publisher?.interactionRecorded({
            happenedAt,
            memberId: canonical.memberId,
            personIds: participants,
            transaction,
            workspaceId: canonical.workspaceId,
          });
        }
        return { record, status: "saved" };
      }, { workspaceId: canonical.workspaceId });
    },
    removeInteraction: async (
      actor: InteractionActor,
      kind: InteractionKind,
      interactionId: string,
      expectedRevision: string,
    ): Promise<RemoveInteractionResult> => {
      const checked = validateInteractionRemoval(
        interactionId,
        expectedRevision,
      );
      if ("errors" in checked) {
        return { errors: checked.errors, status: "validation-error" };
      }
      const canonical = canonicalActor(actor);
      const { expectedUpdatedAt, id } = checked;
      return await dependencies.transaction.run(async (
        transaction,
      ): Promise<RemoveInteractionResult> => {
        if (!await active(dependencies, canonical, transaction, true)) {
          return { status: "forbidden" };
        }
        const stored = await dependencies.repository.find({
          id,
          kind,
          transaction,
          workspaceId: canonical.workspaceId,
        });
        if (!stored) return { status: "not-found" };
        if (stored.updatedAt !== expectedUpdatedAt) return { status: "stale" };
        const nothing = { kind } as CheckedChange;
        const section = await vocabularyStands(
          dependencies,
          canonical,
          nothing,
          transaction,
        );
        if (section !== "ready") return section;
        const people = await peopleStand(
          dependencies,
          canonical,
          participantsOf(stored),
          undefined,
          transaction,
        );
        if ("status" in people) return people;
        const { participants } = people;
        const removed = await dependencies.repository.remove({
          expectedUpdatedAt,
          id,
          kind,
          transaction,
          workspaceId: canonical.workspaceId,
        });
        if (!removed) return { status: "stale" };
        const occurredAt = dependencies.clock.now();
        await dependencies.tombstones.record({
          deletedAt: occurredAt,
          kind,
          recordId: id,
          transaction,
          workspaceId: canonical.workspaceId,
        });
        await audited(dependencies, {
          action: "delete",
          actor: canonical,
          fields: [],
          kind,
          occurredAt,
          participantIds: participants,
          subjectId: id,
          transaction,
        });
        return { id, kind, status: "deleted" };
      }, { workspaceId: canonical.workspaceId });
    },
  };
}

export type InteractionChanges = ReturnType<typeof createInteractionChanges>;
