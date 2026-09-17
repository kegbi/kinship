/**
 * How the module stores reminders, their occurrences, and stay-in-touch
 * cadences, and where the rules that surround them come from.
 *
 * Three ports meet here. The repository owns the reminder rows and the
 * occurrence window derived from them, including the two regenerations a
 * time-zone change forces. The workspace boundary answers the one question
 * every generation needs — which zone the member's local send time is read in
 * — and the recipients boundary answers the set-based half of the actor
 * question, which a per-actor revalidation cannot express because the delivery
 * scans reach many actors at once.
 */

import type { Failure } from "../../../shared-kernel/result.ts";
import type {
  CadenceUnit,
  StayInTouchCadenceRecord,
} from "../domain/cadence.ts";
import type {
  CalendarOccurrence,
  RecurrenceUnit,
} from "../domain/recurrence.ts";
import type {
  ReminderDefinitionRecord,
  ReminderOccurrenceRecord,
} from "../domain/reminder_rules.ts";
import type { PlanningActor, PlanningTransaction } from "./context.ts";

/**
 * The members a scan may deliver to.
 *
 * This is declared as a planning port so the repository adapters, which may
 * not import another module, can be handed the one approved implementation at
 * the composition root.
 */
export interface ReminderRecipients {
  listEligible(command: {
    readonly transaction: PlanningTransaction;
    readonly workspaceId: string;
  }): Promise<
    readonly { readonly memberId: string; readonly workspaceId: string }[]
  >;
  filterEligible(command: {
    readonly memberIds: readonly string[];
    readonly transaction: PlanningTransaction;
  }): Promise<
    readonly { readonly memberId: string; readonly workspaceId: string }[]
  >;
}

/** The zone a member's local send times are read in. */
export interface ReminderWorkspaceBoundary {
  effectiveTimezone(
    command: PlanningActor & {
      readonly transaction: PlanningTransaction;
    },
  ): Promise<
    | Failure<"forbidden">
    | { readonly status: "ready"; readonly timezone: string }
  >;
}

/** What a reminder and its cadences look like for one person. */
export interface PersonReminders {
  readonly cadences: readonly StayInTouchCadenceRecord[];
  readonly reminders: readonly ReminderDefinitionRecord[];
}

export interface ReminderRepository {
  lockRequest(command: {
    readonly id: string;
    readonly transaction: PlanningTransaction;
  }): Promise<void>;
  findReminder(
    command: PlanningActor & {
      readonly id: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<ReminderDefinitionRecord | undefined>;
  createReminder(
    command: PlanningActor & {
      readonly anchorOn: string;
      readonly id: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly recurrenceInterval: number;
      readonly recurrenceUnit: RecurrenceUnit;
      readonly sendTime: string;
      readonly title: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<ReminderDefinitionRecord | undefined>;
  upsertOccurrences(
    command: PlanningActor & {
      readonly occurrences: readonly CalendarOccurrence[];
      readonly reminder: ReminderDefinitionRecord;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<readonly ReminderOccurrenceRecord[]>;
  setReminderActive(
    command: PlanningActor & {
      readonly active: boolean;
      readonly id: string;
      readonly occurredAt: Date;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<
    | {
      readonly reminder: ReminderDefinitionRecord;
      readonly wasActive: boolean;
    }
    | undefined
  >;
  cancelFutureOccurrences(
    command: PlanningActor & {
      readonly now: Date;
      readonly reminderId: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<void>;
  upsertCadence(
    command: PlanningActor & {
      readonly id: string;
      readonly intervalCount: number;
      readonly intervalUnit: CadenceUnit;
      readonly nextDueAt: string;
      readonly occurredAt: Date;
      readonly personId: string;
      readonly requestFingerprint: string;
      readonly requestId: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<StayInTouchCadenceRecord | undefined>;
  findCadenceRequest(
    command: PlanningActor & {
      readonly requestId: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<
    | {
      readonly cadence: StayInTouchCadenceRecord;
      readonly requestFingerprint: string;
    }
    | undefined
  >;
  updateCadenceFromInteraction(command: {
    readonly happenedAt: string;
    readonly memberId: string;
    readonly personIds: readonly string[];
    readonly transaction: PlanningTransaction;
    readonly workspaceId: string;
  }): Promise<void>;
  regenerateForTimezone(
    command: PlanningActor & {
      readonly memberId: string;
      readonly now: Date;
      readonly timezone: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<void>;
  regenerateForWorkspaceTimezone(
    command: {
      readonly now: Date;
      readonly timezone: string;
      readonly transaction: PlanningTransaction;
      readonly workspaceId: string;
    },
  ): Promise<void>;
  listPerson(
    command: PlanningActor & {
      readonly personId: string;
      readonly transaction: PlanningTransaction;
    },
  ): Promise<PersonReminders>;
}
