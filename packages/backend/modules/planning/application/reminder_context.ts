/**
 * What a reminder or cadence write needs before it may proceed.
 *
 * Every path below starts the same way: revalidate the actor under lock inside
 * the caller's transaction, read the zone the workspace effectively uses, and
 * prove the person may be written to. Those three steps, and the occurrence
 * window that two of the paths regenerate, were written out repeatedly inside
 * one 757-line file; they are written once here.
 *
 * The zone is read before the person on purpose: a member whose workspace
 * refuses to name a zone is refused as forbidden without the person boundary
 * ever being asked about somebody they may not be allowed to see.
 */

import type { Clock } from "../../../shared-kernel/clock.ts";
import type {
  Failure,
  ValidationFailure,
} from "../../../shared-kernel/result.ts";
import type { StayInTouchCadenceRecord } from "../domain/cadence.ts";
import { generateCalendarOccurrences } from "../domain/recurrence.ts";
import {
  occurrenceCount,
  type ReminderDefinitionRecord,
} from "../domain/reminder_rules.ts";
import type { ReminderAudit } from "../ports/audit.ts";
import type {
  PlanningActor,
  PlanningTransaction,
  PlanningTransactionRunner,
} from "../ports/context.ts";
import type {
  ReminderRepository,
  ReminderWorkspaceBoundary,
} from "../ports/reminder_repository.ts";
import type { RelationshipPersonBoundary } from "../../people/public.ts";
import type { ActorRevalidation } from "../../workspaces/public.ts";

export interface ReminderManagementDependencies {
  readonly actors: ActorRevalidation;
  readonly audit: ReminderAudit;
  readonly clock: Clock;
  readonly people: RelationshipPersonBoundary;
  readonly repository: ReminderRepository;
  readonly transaction: PlanningTransactionRunner;
  readonly workspace: ReminderWorkspaceBoundary;
}

export type ReminderMutationResult =
  | { readonly reminder: ReminderDefinitionRecord; readonly status: "created" }
  | { readonly cadence: StayInTouchCadenceRecord; readonly status: "created" }
  | Failure<
    "archived-write-rejected" | "forbidden" | "not-found",
    "idempotency-conflict"
  >
  | ValidationFailure;

/**
 * The actor's standing, asked first inside the caller's transaction and under
 * lock, because every path below writes or reads on its behalf.
 */
export async function actorIsActive(
  dependencies: Pick<ReminderManagementDependencies, "actors">,
  actor: PlanningActor,
  transaction: PlanningTransaction,
): Promise<boolean> {
  return await dependencies.actors.revalidate({
    ...actor,
    lock: true,
    transaction,
  }) === "active";
}

/** Whether the person a reminder or cadence names may be written to. */
export async function writablePerson(
  dependencies: Pick<ReminderManagementDependencies, "people">,
  actor: PlanningActor,
  personId: string,
  transaction: PlanningTransaction,
): Promise<"archived-write-rejected" | "not-found" | "ready"> {
  const result = await dependencies.people.inspect({
    ...actor,
    lock: true,
    personIds: [personId],
    transaction,
  });
  return result.status === "archived"
    ? "archived-write-rejected" as const
    : result.status;
}

/**
 * Mints the rolling occurrence window a reminder keeps ahead of itself and
 * returns the reminder with its next firing attached.
 *
 * The generation audit is written only when something was actually minted, so
 * a reminder whose window is already full does not add noise to the history.
 */
export async function regenerateWindow(
  dependencies: Pick<
    ReminderManagementDependencies,
    "audit" | "repository"
  >,
  actor: PlanningActor,
  transaction: PlanningTransaction,
  reminder: ReminderDefinitionRecord,
  subjectId: string,
  occurredAt: Date,
  timezone: string,
): Promise<ReminderDefinitionRecord> {
  const occurrences = generateCalendarOccurrences({
    anchorOn: reminder.anchorOn,
    count: occurrenceCount(reminder.recurrenceUnit),
    from: occurredAt.toISOString(),
    recurrenceInterval: reminder.recurrenceInterval,
    recurrenceUnit: reminder.recurrenceUnit,
    sendTime: reminder.sendTime,
    timezone,
  });
  const generated = await dependencies.repository.upsertOccurrences({
    ...actor,
    occurrences,
    reminder,
    transaction,
  });
  if (generated.length > 0) {
    await dependencies.audit.record({
      action: "generated",
      actor,
      occurredAt,
      subjectId,
      transaction,
    });
  }
  return {
    ...reminder,
    ...(generated[0] ? { nextOccurrence: generated[0] } : {}),
  };
}
