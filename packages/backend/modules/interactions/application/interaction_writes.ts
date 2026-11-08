/**
 * Recording an activity or a note, once.
 *
 * The write is idempotent by construction: the request's identifier derives
 * the aggregate's, the row under it is locked before anything else is read,
 * and a request that already landed is read back instead of written again.
 * Everything that decides — the derivation, what counts as the same request,
 * and what a replayed record looks like — is in `domain/interaction_rules.ts`;
 * what is left here is the order the ports are called in and the transaction
 * they share.
 */

import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import {
  deriveInteractionId,
  expectedInteraction,
  type InteractionRecord,
  matchesExpected,
  type RecordInteractionInput,
  replayedActivity,
  replayedNote,
  validateInteraction,
} from "../domain/interaction_rules.ts";
import type { InteractionActor } from "../ports/context.ts";
import {
  active,
  canonicalActor,
  type InteractionDependencies,
} from "./interaction_context.ts";

export type RecordInteractionResult =
  | { readonly record: InteractionRecord; readonly status: "created" }
  | Failure<
    "archived-write-rejected" | "forbidden" | "not-found",
    "hidden" | "idempotency-conflict"
  >
  | ValidationFailure;

export function createInteractionWrites(dependencies: InteractionDependencies) {
  return {
    record: async (
      actor: InteractionActor,
      input: RecordInteractionInput,
    ): Promise<RecordInteractionResult> => {
      const checked = validateInteraction(input);
      if ("errors" in checked) {
        return { errors: checked.errors, status: "validation-error" };
      }
      const canonical = canonicalActor(actor);
      return await dependencies.transaction.run(async (transaction) => {
        if (!await active(dependencies, canonical, transaction, true)) {
          return { status: "forbidden" as const };
        }
        const id = await deriveInteractionId(
          canonical.workspaceId,
          checked.requestId,
        );
        await dependencies.repository.lockRequest({ id, transaction });
        const expected = expectedInteraction(input, checked);
        const replay = await dependencies.repository.findRequest({
          id,
          transaction,
          workspaceId: canonical.workspaceId,
        });
        if (replay.status === "found") {
          if (
            !matchesExpected(replay.interaction, expected, canonical.memberId)
          ) {
            return { status: "idempotency-conflict" as const };
          }
          if (replay.interaction.kind === "activity") {
            const stored = replay.interaction;
            const [summaries, descriptors] = await Promise.all([
              dependencies.people.summarize({
                ...canonical,
                personIds: stored.participantIds,
                transaction,
              }),
              dependencies.workspace.describe({
                ...(stored.activityTypeId
                  ? { activityTypeId: stored.activityTypeId }
                  : {}),
                emotionIds: stored.emotionIds,
                transaction,
                workspaceId: canonical.workspaceId,
              }),
            ]);
            return {
              record: replayedActivity(stored, id, descriptors, summaries),
              status: "created" as const,
            };
          }
          const stored = replay.interaction;
          const summaries = await dependencies.people.summarize({
            ...canonical,
            personIds: [stored.personId],
            transaction,
          });
          const person = summaries[0];
          if (!person || person.id !== stored.personId) {
            return { status: "not-found" as const };
          }
          return {
            record: replayedNote(stored, id, person),
            status: "created" as const,
          };
        }
        const workspace = await dependencies.workspace.inspect({
          ...canonical,
          ...(input.kind === "activity" && checked.activityTypeId
            ? { activityTypeId: checked.activityTypeId }
            : {}),
          emotionIds: checked.emotionIds,
          kind: input.kind,
          lock: true,
          transaction,
        });
        if (workspace.status !== "ready") return workspace;
        const people = await dependencies.people.inspect({
          ...canonical,
          lock: true,
          personIds: checked.participantIds,
          transaction,
        });
        if (people.status !== "ready") {
          return people.status === "archived"
            ? { status: "archived-write-rejected" as const }
            : { status: "not-found" as const };
        }
        const summaries = await dependencies.people.summarize({
          ...canonical,
          personIds: checked.participantIds,
          transaction,
        });
        if (summaries.length !== checked.participantIds.length) {
          return { status: "not-found" as const };
        }
        const participants = summaries.map(({ id, name }) => ({ id, name }));
        const occurredAt = dependencies.clock.now();
        const record = input.kind === "activity"
          ? await dependencies.repository.createActivity({
            ...canonical,
            ...(workspace.activityType
              ? { activityType: workspace.activityType }
              : {}),
            ...(checked.description
              ? { description: checked.description }
              : {}),
            emotions: workspace.emotions,
            happenedAt: checked.happenedAt!,
            id,
            occurredAt,
            participantIds: checked.participantIds,
            participants,
            summary: checked.summary!,
            transaction,
          })
          : await dependencies.repository.createNote({
            ...canonical,
            body: checked.body!,
            id,
            isFavorited: input.isFavorited === true,
            occurredAt,
            person: participants[0]!,
            personId: checked.participantIds[0]!,
            transaction,
          });
        if (!record) return { status: "not-found" as const };
        const auditCommand = {
          actor: canonical,
          occurredAt,
          record,
          transaction,
        };
        const auditId = await dependencies.audit.record(auditCommand);
        await dependencies.repository.assertPostcondition({
          ...canonical,
          record,
          transaction,
        });
        await dependencies.audit.assertPostcondition({
          ...auditCommand,
          auditId,
        });
        if (record.kind === "activity") {
          await dependencies.publisher?.interactionRecorded({
            happenedAt: record.happenedAt,
            memberId: canonical.memberId,
            personIds: record.participants.map((person) => person.id),
            transaction,
            workspaceId: canonical.workspaceId,
          });
        }
        return { record, status: "created" as const };
      }, { workspaceId: actor.workspaceId });
    },
  };
}
