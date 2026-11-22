/**
 * Asking to stay in touch with somebody, and hearing that you did.
 *
 * A cadence is created the same way a reminder is — actor, zone, person, then
 * an idempotent write — but its replay check compares a fingerprint of what
 * was asked for rather than the stored row, because a cadence request is
 * recorded separately from the cadence it produced.
 *
 * `interactionRecorded` is the other half: interactions publishes it inside
 * its own transaction, so this pushes the due dates forward in that same unit
 * of work. It is deliberately tolerant — an event naming nobody, or carrying a
 * time nobody can parse, is ignored rather than failing the interaction that
 * caused it — and the person identifiers are deduplicated and sorted so two
 * concurrent interactions take the same rows in the same order.
 *
 * Deleting a cadence (MCP-D2) removes its row, with the request receipts that
 * only replayed its creation. A cadence mints no occurrences — Today and the
 * attention queue compute its due item from the row — so nothing delivered is
 * lost, and an interaction recorded afterwards updates no row and so cannot
 * bring it back. The schema gives the cadence no soft-delete column, and an
 * inactive row would still be listed as the person's one cadence and kept by
 * a merge in place of the duplicate's live one.
 */

import { deterministicId } from "../../../shared-kernel/ids.ts";
import { uuid } from "../../../shared-kernel/validation.ts";
import {
  CADENCE_ID_NAMESPACE,
  cadenceDueAt,
  cadenceFingerprint,
  type CreateCadenceInput,
  validateCreateCadence,
} from "../domain/cadence.ts";
import type { PlanningActor, PlanningTransaction } from "../ports/context.ts";
import {
  actorIsActive,
  type DeleteCadenceResult,
  type ReminderManagementDependencies,
  type ReminderMutationResult,
  writablePerson,
} from "./reminder_context.ts";

export interface InteractionRecordedEvent {
  readonly happenedAt: string;
  readonly memberId: string;
  readonly personIds: readonly string[];
  readonly transaction: PlanningTransaction;
  readonly workspaceId: string;
}

export function createReminderCadences(
  dependencies: ReminderManagementDependencies,
) {
  return {
    createCadence: async (
      actor: PlanningActor,
      input: CreateCadenceInput,
    ): Promise<ReminderMutationResult> => {
      const errors = validateCreateCadence(input);
      if (Object.keys(errors).length > 0) {
        return { errors, status: "validation-error" };
      }
      return await dependencies.transaction.run(async (transaction) => {
        if (!await actorIsActive(dependencies, actor, transaction)) {
          return { status: "forbidden" };
        }
        const zone = await dependencies.workspace.effectiveTimezone({
          ...actor,
          transaction,
        });
        if (zone.status !== "ready") return { status: "forbidden" };
        const person = await writablePerson(
          dependencies,
          actor,
          input.personId.toLowerCase(),
          transaction,
        );
        if (person !== "ready") return { status: person };
        const occurredAt = dependencies.clock.now();
        const id = await deterministicId(CADENCE_ID_NAMESPACE, [
          actor.workspaceId,
          input.requestId,
        ]);
        const requestFingerprint = await cadenceFingerprint(input);
        await dependencies.repository.lockRequest({ id, transaction });
        const replay = await dependencies.repository.findCadenceRequest({
          ...actor,
          requestId: input.requestId.toLowerCase(),
          transaction,
        });
        if (replay) {
          return replay.requestFingerprint === requestFingerprint
            ? { cadence: replay.cadence, status: "created" }
            : { status: "idempotency-conflict" };
        }
        const cadence = await dependencies.repository.upsertCadence({
          ...actor,
          id,
          intervalCount: input.intervalCount,
          intervalUnit: input.intervalUnit,
          nextDueAt: cadenceDueAt(
            occurredAt.toISOString(),
            input.intervalCount,
            input.intervalUnit,
            zone.timezone,
          ),
          occurredAt,
          personId: input.personId.toLowerCase(),
          requestFingerprint,
          requestId: input.requestId.toLowerCase(),
          transaction,
        });
        if (!cadence) return { status: "not-found" };
        await dependencies.audit.record({
          action: "cadence-created",
          actor,
          occurredAt,
          subjectId: cadence.id,
          transaction,
        });
        return { cadence, status: "created" };
      }, { workspaceId: actor.workspaceId });
    },
    deleteCadence: async (
      actor: PlanningActor,
      cadenceId: string,
      input: { readonly expectedUpdatedAt: string },
    ): Promise<DeleteCadenceResult> => {
      const id = uuid(cadenceId);
      if (id === undefined) {
        return {
          errors: { cadenceId: "Use a canonical cadence identifier." },
          status: "validation-error",
        };
      }
      return await dependencies.transaction.run(async (
        transaction,
      ): Promise<DeleteCadenceResult> => {
        if (!await actorIsActive(dependencies, actor, transaction)) {
          return { status: "forbidden" };
        }
        const cadence = await dependencies.repository.findCadence({
          ...actor,
          id,
          transaction,
        });
        if (!cadence) return { status: "not-found" };
        if (cadence.updatedAt !== input.expectedUpdatedAt) {
          return { status: "stale" };
        }
        const person = await writablePerson(
          dependencies,
          actor,
          cadence.personId,
          transaction,
        );
        if (person !== "ready") return { status: person };
        const deleted = await dependencies.repository.deleteCadence({
          ...actor,
          expectedUpdatedAt: input.expectedUpdatedAt,
          id,
          transaction,
        });
        if (!deleted) return { status: "stale" };
        await dependencies.audit.record({
          action: "cadence-deleted",
          actor,
          occurredAt: dependencies.clock.now(),
          subjectId: id,
          transaction,
        });
        return { cadenceId: id, status: "deleted" };
      }, { workspaceId: actor.workspaceId });
    },
    interactionRecorded: async (
      event: InteractionRecordedEvent,
    ): Promise<void> => {
      if (
        event.personIds.length === 0 ||
        !Number.isFinite(Date.parse(event.happenedAt))
      ) return;
      await dependencies.repository.updateCadenceFromInteraction({
        ...event,
        personIds: [...new Set(event.personIds.map((id) => id.toLowerCase()))]
          .sort(),
      });
    },
  };
}
