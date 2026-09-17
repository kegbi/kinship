/**
 * Creating a reminder, enabling or disabling one, and reading a person's.
 *
 * Creation is idempotent by derivation: the request identifier derives the
 * reminder identifier, an advisory lock serializes retries of the same
 * request, and a reminder already stored under that identifier is returned
 * when it is the same proposal and refused as a conflict when it is not.
 *
 * Enabling and disabling are not symmetric. Disabling cancels the future
 * occurrences the window had already minted, because a member who turned a
 * reminder off must stop hearing from it; re-enabling mints a fresh window
 * from now, and only when the reminder was actually off, so toggling a live
 * reminder on again neither duplicates occurrences nor audits a generation.
 *
 * The two time-zone entry points are events, not requests: a member or a
 * workspace changed zone, and the occurrences already minted have to be
 * recomputed inside whichever transaction carried that change.
 */

import { deterministicId } from "../../../shared-kernel/ids.ts";
import {
  type CreateReminderInput,
  REMINDER_ID_NAMESPACE,
  reminderMatchesCreate,
  validateCreateReminder,
} from "../domain/reminder_rules.ts";
import type { PlanningActor, PlanningTransaction } from "../ports/context.ts";
import {
  actorIsActive,
  regenerateWindow,
  type ReminderManagementDependencies,
  type ReminderMutationResult,
  writablePerson,
} from "./reminder_context.ts";

export function createReminderDefinitions(
  dependencies: ReminderManagementDependencies,
) {
  return {
    createReminder: async (
      actor: PlanningActor,
      input: CreateReminderInput,
    ): Promise<ReminderMutationResult> => {
      const checked = validateCreateReminder(input);
      if (Object.keys(checked.errors).length > 0) {
        return { errors: checked.errors, status: "validation-error" };
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
        const id = await deterministicId(REMINDER_ID_NAMESPACE, [
          actor.workspaceId,
          input.requestId,
        ]);
        await dependencies.repository.lockRequest({ id, transaction });
        const replay = await dependencies.repository.findReminder({
          ...actor,
          id,
          transaction,
        });
        if (replay) {
          return reminderMatchesCreate(replay, input, checked)
            ? { reminder: replay, status: "created" }
            : { status: "idempotency-conflict" };
        }
        const occurredAt = dependencies.clock.now();
        const reminder = await dependencies.repository.createReminder({
          ...actor,
          anchorOn: input.anchorOn,
          id,
          occurredAt,
          personId: input.personId.toLowerCase(),
          recurrenceInterval: input.recurrenceInterval,
          recurrenceUnit: input.recurrenceUnit,
          // The validation above proved the send time canonical.
          sendTime: checked.sendTime!,
          title: checked.title!,
          transaction,
        });
        if (!reminder) return { status: "not-found" };
        await dependencies.audit.record({
          action: "created",
          actor,
          occurredAt,
          subjectId: id,
          transaction,
        });
        return {
          reminder: await regenerateWindow(
            dependencies,
            actor,
            transaction,
            reminder,
            id,
            occurredAt,
            zone.timezone,
          ),
          status: "created",
        };
      });
    },
    setActive: async (actor: PlanningActor, id: string, active: boolean) =>
      await dependencies.transaction.run(async (transaction) => {
        if (!await actorIsActive(dependencies, actor, transaction)) {
          return { status: "forbidden" as const };
        }
        const occurredAt = dependencies.clock.now();
        const zone = active
          ? await dependencies.workspace.effectiveTimezone({
            ...actor,
            transaction,
          })
          : undefined;
        if (zone?.status === "forbidden") {
          return { status: "forbidden" as const };
        }
        const changed = await dependencies.repository.setReminderActive({
          ...actor,
          active,
          id,
          occurredAt,
          transaction,
        });
        if (!changed) return { status: "not-found" as const };
        const reminder = changed.reminder;
        if (!active) {
          await dependencies.repository.cancelFutureOccurrences({
            ...actor,
            now: occurredAt,
            reminderId: reminder.id,
            transaction,
          });
          await dependencies.audit.record({
            action: "disabled",
            actor,
            occurredAt,
            subjectId: id,
            transaction,
          });
        } else if (!changed.wasActive && zone?.status === "ready") {
          return {
            reminder: await regenerateWindow(
              dependencies,
              actor,
              transaction,
              reminder,
              id,
              occurredAt,
              zone.timezone,
            ),
            status: "saved" as const,
          };
        }
        return { reminder, status: "saved" as const };
      }),
    listPerson: async (actor: PlanningActor, personId: string) =>
      await dependencies.transaction.run(async (transaction) => {
        if (!await actorIsActive(dependencies, actor, transaction)) {
          return { status: "forbidden" as const };
        }
        const result = await dependencies.repository.listPerson({
          ...actor,
          personId: personId.toLowerCase(),
          transaction,
        });
        return { ...result, status: "ready" as const };
      }),
    timezoneChanged: async (
      actor: PlanningActor,
      transaction: PlanningTransaction,
    ): Promise<void> => {
      if (!await actorIsActive(dependencies, actor, transaction)) return;
      const zone = await dependencies.workspace.effectiveTimezone({
        ...actor,
        transaction,
      });
      if (zone.status !== "ready") return;
      await dependencies.repository.regenerateForTimezone({
        ...actor,
        now: dependencies.clock.now(),
        timezone: zone.timezone,
        transaction,
      });
    },
    workspaceTimezoneChanged: async (
      actor: PlanningActor,
      timezone: string,
      transaction: PlanningTransaction,
    ): Promise<void> => {
      await dependencies.repository.regenerateForWorkspaceTimezone({
        now: dependencies.clock.now(),
        timezone,
        transaction,
        workspaceId: actor.workspaceId,
      });
    },
  };
}
