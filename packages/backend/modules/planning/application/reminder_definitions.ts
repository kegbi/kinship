/**
 * Creating a reminder, enabling or disabling one, editing or deleting one,
 * and reading a person's.
 *
 * Creation is idempotent by derivation: the request identifier derives the
 * reminder identifier, an advisory lock serializes retries of the same
 * request, and a reminder already stored under that identifier is returned
 * when it is the same proposal and refused as a conflict when it is not.
 *
 * Enabling and disabling are not symmetric. Disabling cancels the future
 * occurrences the window had already minted, for every member, because a
 * reminder turned off must stop sending; re-enabling mints a fresh window
 * from now, and only when the reminder was actually off, so toggling a live
 * reminder on again neither duplicates occurrences nor audits a generation.
 * The fresh window is every member's who held the reminder's work, not only
 * the actor's (MCP-D2): the others' cancelled rows would otherwise stay
 * cancelled.
 *
 * Editing and deleting (MCP-D2) take the reminder's `updatedAt` as their
 * revision. A reminder about a person is workspace data, so any member the
 * permission admits may change it; one an important date generated is
 * refused as `managed-reminder`, because the date would regenerate it. An
 * edit replaces the future the way disabling and then re-enabling would, for
 * every member who held it, so the occurrence rules stay the recurrence
 * domain's; a delete is a soft delete that disables the reminder and cancels
 * the same unattempted work, keeping every delivered or in-flight occurrence
 * as evidence. The deleted reminder keeps its derived identifier, so a create
 * retried with its request identifier is refused as `request-deleted`.
 *
 * Lock order. Every write here first revalidates the actor, which holds the
 * workspace row `FOR NO KEY UPDATE`; an edit or delete then locks the person;
 * each then writes the reminder row, and only then cancels or mints
 * occurrence rows. The refill of the other members adds no lock beyond those
 * occurrence rows; it reads their zones and channels unlocked. A member's
 * zone change and a workspace
 * schedule change take that same workspace row before they rewrite
 * occurrences, so they run wholly before or after this transaction; the
 * worker's top-up holds the reminder row `FOR SHARE` before it inserts, so
 * it waits for this one. A delivery-only change takes no workspace lock: a
 * window refilled while one commits may keep the old channel until the
 * worker's next replenishment re-channels it, as the actor's own window
 * already could.
 *
 * The two time-zone entry points are events, not requests: a member or a
 * workspace changed zone, and the occurrences already minted have to be
 * recomputed inside whichever transaction carried that change. A member's
 * new delivery choice is the same kind of event: their waiting notices move
 * onto the chosen channels in the transaction that saved it.
 *
 * Reading a person's reminders pages: the section serves one page of
 * definitions and the person's single cadence, and a cursor that does not
 * decode for this workspace and this person is a rejected query rather than an
 * empty page.
 */

import { deterministicId } from "../../../shared-kernel/ids.ts";
import { uuid } from "../../../shared-kernel/validation.ts";
import {
  decodeReminderCursor,
  encodeReminderCursor,
} from "../domain/cursors.ts";
import {
  type CreateReminderInput,
  type EditReminderInput,
  REMINDER_ID_NAMESPACE,
  type ReminderDefinitionRecord,
  reminderEditIsUnchanged,
  reminderIsManaged,
  reminderMatchesCreate,
  validateCreateReminder,
  validateEditReminder,
} from "../domain/reminder_rules.ts";
import type { PlanningActor, PlanningTransaction } from "../ports/context.ts";
import {
  actorIsActive,
  type DeleteReminderResult,
  type EditReminderResult,
  regenerateWindow,
  type ReminderChangeFailure,
  type ReminderManagementDependencies,
  type ReminderMutationResult,
  writablePerson,
} from "./reminder_context.ts";

/** The largest reminder page this section serves. */
export const REMINDER_PAGE_LIMIT_MAXIMUM = 50;
/** The page it serves when the caller names no size. */
export const REMINDER_PAGE_LIMIT_DEFAULT = 20;

/** Where a caller asked the section to resume, and how many rows. */
export interface ListPersonRemindersInput {
  readonly cursor?: string;
  readonly limit?: number;
}

/** The page size this section accepts, clamped to what it will serve. */
export function reminderPageLimit(limit: number | undefined): number {
  return Math.max(
    1,
    Math.min(
      REMINDER_PAGE_LIMIT_MAXIMUM,
      Math.trunc(limit ?? REMINDER_PAGE_LIMIT_DEFAULT),
    ),
  );
}

export function createReminderDefinitions(
  dependencies: ReminderManagementDependencies,
) {
  /**
   * The live reminder an edit or delete may change, read after
   * the actor stands and refused in a fixed order: missing, owned by its
   * source, read at another revision, then its person not writable. The
   * person is locked before the reminder row is written, as a create locks
   * them, so the two never take the same rows in opposite orders.
   */
  const changeableReminder = async (
    actor: PlanningActor,
    id: string,
    expectedUpdatedAt: string,
    transaction: PlanningTransaction,
  ): Promise<
    { readonly current: ReminderDefinitionRecord } | ReminderChangeFailure
  > => {
    if (!await actorIsActive(dependencies, actor, transaction)) {
      return { status: "forbidden" };
    }
    const found = await dependencies.repository.findReminderForChange({
      ...actor,
      id,
      transaction,
    });
    if (!found) return { status: "not-found" };
    if (reminderIsManaged(found.source)) return { status: "managed-reminder" };
    if (found.reminder.updatedAt !== expectedUpdatedAt) {
      return { status: "stale" };
    }
    const person = await writablePerson(
      dependencies,
      actor,
      found.reminder.personId,
      transaction,
    );
    return person === "ready"
      ? { current: found.reminder }
      : { status: person };
  };
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
        // A deleted reminder keeps its derived identifier, so retrying the
        // request that created it is refused rather than recreating it.
        if (
          await dependencies.repository.reminderDeleted({
            ...actor,
            id,
            transaction,
          })
        ) return { status: "request-deleted" };
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
      }, { workspaceId: actor.workspaceId });
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
          await dependencies.repository.refillOtherMembers({
            ...actor,
            now: occurredAt,
            reminderId: reminder.id,
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
            status: "saved" as const,
          };
        }
        return { reminder, status: "saved" as const };
      }, { workspaceId: actor.workspaceId }),
    editReminder: async (
      actor: PlanningActor,
      reminderId: string,
      input: EditReminderInput,
    ): Promise<EditReminderResult> => {
      const id = uuid(reminderId);
      const checked = validateEditReminder(input);
      if (id === undefined || Object.keys(checked.errors).length > 0) {
        return {
          errors: {
            ...checked.errors,
            ...(id === undefined
              ? { reminderId: "Use a canonical reminder identifier." }
              : {}),
          },
          status: "validation-error",
        };
      }
      return await dependencies.transaction.run(async (
        transaction,
      ): Promise<EditReminderResult> => {
        const target = await changeableReminder(
          actor,
          id,
          input.expectedUpdatedAt,
          transaction,
        );
        if ("status" in target) return target;
        const { current } = target;
        if (reminderEditIsUnchanged(current, checked.patch)) {
          return { reminder: current, status: "unchanged" };
        }
        const zone = await dependencies.workspace.effectiveTimezone({
          ...actor,
          transaction,
        });
        if (zone.status !== "ready") return { status: "forbidden" };
        const occurredAt = dependencies.clock.now();
        const saved = await dependencies.repository.saveReminder({
          ...actor,
          expectedUpdatedAt: input.expectedUpdatedAt,
          id,
          occurredAt,
          patch: checked.patch,
          transaction,
        });
        if (!saved) return { status: "stale" };
        // The future is replaced exactly as disabling and re-enabling would
        // replace it: unattempted work is cancelled for every member, a
        // delivered or claimed occurrence is left alone, and when the
        // reminder is live the window is minted again from now under the new
        // schedule, for every other member who held it and for the editor.
        await dependencies.repository.cancelFutureOccurrences({
          ...actor,
          now: occurredAt,
          reminderId: id,
          transaction,
        });
        if (saved.isActive) {
          await dependencies.repository.refillOtherMembers({
            ...actor,
            now: occurredAt,
            reminderId: id,
            transaction,
          });
        }
        await dependencies.audit.record({
          action: "edited",
          actor,
          occurredAt,
          subjectId: id,
          transaction,
        });
        return {
          reminder: saved.isActive
            ? await regenerateWindow(
              dependencies,
              actor,
              transaction,
              saved,
              id,
              occurredAt,
              zone.timezone,
            )
            : saved,
          status: "saved",
        };
      }, { workspaceId: actor.workspaceId });
    },
    deleteReminder: async (
      actor: PlanningActor,
      reminderId: string,
      input: { readonly expectedUpdatedAt: string },
    ): Promise<DeleteReminderResult> => {
      const id = uuid(reminderId);
      if (id === undefined) {
        return {
          errors: { reminderId: "Use a canonical reminder identifier." },
          status: "validation-error",
        };
      }
      return await dependencies.transaction.run(async (
        transaction,
      ): Promise<DeleteReminderResult> => {
        const target = await changeableReminder(
          actor,
          id,
          input.expectedUpdatedAt,
          transaction,
        );
        if ("status" in target) return target;
        const occurredAt = dependencies.clock.now();
        const deleted = await dependencies.repository.deleteReminder({
          ...actor,
          expectedUpdatedAt: input.expectedUpdatedAt,
          id,
          occurredAt,
          transaction,
        });
        if (!deleted) return { status: "stale" };
        await dependencies.repository.cancelFutureOccurrences({
          ...actor,
          now: occurredAt,
          reminderId: id,
          transaction,
        });
        await dependencies.audit.record({
          action: "deleted",
          actor,
          occurredAt,
          subjectId: id,
          transaction,
        });
        return { reminderId: id, status: "deleted" };
      }, { workspaceId: actor.workspaceId });
    },
    listPerson: async (
      actor: PlanningActor,
      personId: string,
      input: ListPersonRemindersInput = {},
    ) => {
      const subject = personId.toLowerCase();
      const after = input.cursor
        ? decodeReminderCursor(input.cursor, actor.workspaceId, subject)
        : undefined;
      if (input.cursor && !after) {
        return { status: "validation-error" as const };
      }
      return await dependencies.transaction.run(async (transaction) => {
        if (!await actorIsActive(dependencies, actor, transaction)) {
          return { status: "forbidden" as const };
        }
        // An archived person's reminders stay readable; only a person the
        // workspace does not hold answers as missing, like every person route.
        const person = await dependencies.people.inspect({
          ...actor,
          lock: false,
          personIds: [subject],
          transaction,
        });
        if (person.status === "not-found") {
          return { status: "not-found" as const };
        }
        const { next, ...result } = await dependencies.repository.listPerson({
          ...actor,
          ...(after ? { after } : {}),
          limit: reminderPageLimit(input.limit),
          personId: subject,
          transaction,
        });
        return {
          ...result,
          ...(next
            ? {
              nextCursor: encodeReminderCursor(
                next,
                actor.workspaceId,
                subject,
              ),
            }
            : {}),
          status: "ready" as const,
        };
      }, { workspaceId: actor.workspaceId });
    },
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
    deliveryChanged: async (
      actor: PlanningActor,
      transaction: PlanningTransaction,
    ): Promise<void> => {
      await dependencies.repository.rechannelMember({
        ...actor,
        now: dependencies.clock.now(),
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
