/**
 * Keeping a person's life events (JOURNAL-002).
 *
 * Every write follows one order, and the order is the point: the value is
 * normalized and judged (`domain/life_event_rules.ts`) before a transaction
 * opens at all; inside it the actor's standing is re-established under lock,
 * then the person — present in this workspace and not archived — then the
 * workspace's life-events module and the type the value names. Only then is
 * the row read under lock, checked against the revision the caller saw, and
 * changed, with the audit event written in the same transaction.
 *
 * The type vocabulary is the workspace's and the person is the people
 * module's: both answer through their owners' public boundaries, so a type or
 * a person of another workspace is simply not there. An archived type is
 * retired for new choices but stays on the events that already carry it.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type { IdGenerator } from "../../../shared-kernel/ids.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import { runOrUnavailable } from "../../../shared-kernel/transaction.ts";
import { isInstant } from "../../../shared-kernel/validation.ts";
import {
  keepsRecordedInstant,
  type LifeEventValue,
  normalizeLifeEvent,
  type StoredLifeEvent,
  validateLifeEvent,
} from "../domain/life_event_rules.ts";
import type { LifeEventAudit } from "../ports/audit.ts";
import type {
  JournalActor,
  JournalTransaction,
  JournalTransactionRunner,
} from "../ports/context.ts";
import type { LifeEventRepository } from "../ports/life_event_repository.ts";
import type { RelationshipPersonBoundary } from "../../people/public.ts";
import type {
  ActorRevalidation,
  LifeEventWorkspaceBoundary,
} from "../../workspaces/public.ts";

export interface LifeEventManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: LifeEventAudit;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  /** Whether the person is in the actor's workspace, and not archived. */
  readonly people: Pick<RelationshipPersonBoundary, "inspect">;
  readonly repository: LifeEventRepository;
  readonly transaction: JournalTransactionRunner;
  /** The life-events module switch and the type vocabulary. */
  readonly workspace: LifeEventWorkspaceBoundary;
}

export interface LifeEventUpdateInput extends LifeEventValue {
  readonly expectedUpdatedAt: string;
}

export interface LifeEventDeleteInput {
  readonly expectedUpdatedAt: string;
}

type LifeEventFailure =
  | Failure<
    | "archived-write-rejected"
    | "forbidden"
    | "not-found"
    | "unavailable",
    "hidden" | "stale"
  >
  | ValidationFailure;

export type LifeEventCreateResult = LifeEventFailure | {
  readonly event: StoredLifeEvent;
  readonly status: "created";
};
export type LifeEventUpdateResult = LifeEventFailure | {
  readonly event: StoredLifeEvent;
  readonly status: "updated";
};
export type LifeEventDeleteResult = LifeEventFailure | {
  readonly lifeEventId: string;
  readonly status: "deleted";
};

const FOREIGN_TYPE = "Choose a life-event type from this workspace.";
const ARCHIVED_TYPE = "This life-event type is archived. Choose another type.";

function invalid(errors: Readonly<Record<string, string>>) {
  return { errors, status: "validation-error" as const };
}

function unversioned(action: "deleting" | "saving") {
  return invalid({
    expectedUpdatedAt: `Refresh this life event before ${action} it.`,
  });
}

export function createLifeEventManagement(
  dependencies: LifeEventManagementDependencies,
) {
  /**
   * The standing, person, and module checks every write shares, in that
   * order; `undefined` when the write may go on.
   */
  const context = async (
    actor: JournalActor,
    personId: string,
    transaction: JournalTransaction,
  ): Promise<LifeEventFailure | undefined> => {
    const standing = await dependencies.actors.revalidate({
      ...actor,
      lock: true,
      transaction,
    });
    if (standing === "revoked") return { status: "forbidden" };
    const person = await dependencies.people.inspect({
      ...actor,
      lock: true,
      personIds: [personId],
      transaction,
    });
    if (person.status === "archived") {
      return { status: "archived-write-rejected" };
    }
    if (person.status !== "ready") return { status: "not-found" };
    const workspace = await dependencies.workspace.inspect({
      lock: false,
      transaction,
      workspaceId: actor.workspaceId,
    });
    return workspace.status === "hidden" ? { status: "hidden" } : undefined;
  };

  /**
   * The type a value names, judged for this write: it must be one of this
   * workspace's, and a retired one only on an event already carrying it.
   * Answers the name the saved event is shown with, or the refusal.
   */
  const chosenType = async (
    actor: JournalActor,
    value: LifeEventValue,
    transaction: JournalTransaction,
    currentTypeId?: string,
  ): Promise<ValidationFailure | { readonly typeName?: string }> => {
    if (value.typeId === undefined) return {};
    const inspected = await dependencies.workspace.inspect({
      lock: true,
      transaction,
      typeId: value.typeId,
      workspaceId: actor.workspaceId,
    });
    if (inspected.status !== "ready" || !inspected.type) {
      return invalid({ typeId: FOREIGN_TYPE });
    }
    return inspected.type.archived && inspected.type.id !== currentTypeId
      ? invalid({ typeId: ARCHIVED_TYPE })
      : { typeName: inspected.type.name };
  };

  const record = (
    action: "created" | "deleted" | "updated",
    actor: JournalActor,
    personId: string,
    lifeEventId: string,
    occurredAt: Date,
    transaction: JournalTransaction,
  ) =>
    dependencies.audit.record({
      action,
      actor,
      lifeEventId,
      occurredAt,
      personId,
      transaction,
    });

  return {
    create: async (
      actor: JournalActor,
      personId: string,
      input: LifeEventValue,
    ): Promise<LifeEventCreateResult> => {
      const value = normalizeLifeEvent(input);
      const errors = validateLifeEvent(value);
      if (Object.keys(errors).length > 0) return invalid(errors);
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction): Promise<LifeEventCreateResult> => {
          const refused = await context(actor, personId, transaction);
          if (refused) return refused;
          const type = await chosenType(actor, value, transaction);
          if ("status" in type) return type;
          const now = dependencies.clock.now();
          const event = await dependencies.repository.create({
            ...actor,
            id: dependencies.ids.create(),
            now,
            personId,
            transaction,
            value,
          });
          await record("created", actor, personId, event.id, now, transaction);
          return { event: { ...event, ...type }, status: "created" };
        },
      );
    },
    update: async (
      actor: JournalActor,
      personId: string,
      lifeEventId: string,
      input: LifeEventUpdateInput,
    ): Promise<LifeEventUpdateResult> => {
      const { expectedUpdatedAt, ...raw } = input;
      if (!isInstant(expectedUpdatedAt)) return unversioned("saving");
      const value = normalizeLifeEvent(raw);
      const errors = validateLifeEvent(value);
      if (Object.keys(errors).length > 0) return invalid(errors);
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction): Promise<LifeEventUpdateResult> => {
          const refused = await context(actor, personId, transaction);
          if (refused) return refused;
          const before = await dependencies.repository.lock({
            ...actor,
            lifeEventId,
            personId,
            transaction,
          });
          if (!before) return { status: "not-found" };
          if (before.updatedAt !== expectedUpdatedAt) {
            return { status: "stale" };
          }
          const type = await chosenType(
            actor,
            value,
            transaction,
            before.typeId,
          );
          if ("status" in type) return type;
          const now = dependencies.clock.now();
          const event = await dependencies.repository.update({
            ...actor,
            expectedUpdatedAt,
            keepHappenedAt: keepsRecordedInstant(before, value),
            lifeEventId,
            now,
            personId,
            transaction,
            value,
          });
          if (!event) return { status: "stale" };
          await record("updated", actor, personId, event.id, now, transaction);
          return { event: { ...event, ...type }, status: "updated" };
        },
      );
    },
    delete: async (
      actor: JournalActor,
      personId: string,
      lifeEventId: string,
      input: LifeEventDeleteInput,
    ): Promise<LifeEventDeleteResult> => {
      if (!isInstant(input.expectedUpdatedAt)) return unversioned("deleting");
      return await runOrUnavailable(
        dependencies.transaction,
        async (transaction): Promise<LifeEventDeleteResult> => {
          const refused = await context(actor, personId, transaction);
          if (refused) return refused;
          const before = await dependencies.repository.lock({
            ...actor,
            lifeEventId,
            personId,
            transaction,
          });
          if (!before) return { status: "not-found" };
          if (before.updatedAt !== input.expectedUpdatedAt) {
            return { status: "stale" };
          }
          // The canonical v7 `reminders.life_event_id` foreign key is
          // ON DELETE CASCADE: removing the event also deletes the reminders
          // attached to it (JOURNAL-002 alternate outcome; the card warns).
          const deleted = await dependencies.repository.delete({
            ...actor,
            expectedUpdatedAt: input.expectedUpdatedAt,
            lifeEventId,
            personId,
            transaction,
          });
          if (!deleted) return { status: "stale" };
          const now = dependencies.clock.now();
          await record(
            "deleted",
            actor,
            personId,
            lifeEventId,
            now,
            transaction,
          );
          return { lifeEventId, status: "deleted" };
        },
      );
    },
  };
}

export type LifeEventManagement = ReturnType<typeof createLifeEventManagement>;
