/**
 * Planning composition.
 *
 * Only a declared composition root imports this file. Two roots do: the API
 * builds tasks and reminders, and the worker builds the delivery loop, so both
 * halves live here rather than being spelled out twice.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresPersonDateReminderPublisher } from "./adapters/postgres/person_date_reminders.ts";
import {
  PostgresInAppReminderEffectStore,
  PostgresReminderDeliveryRepository,
  PostgresReminderRepository,
  PostgresReminderWorkspaceBoundary,
} from "./adapters/postgres/reminder_repository.ts";
import { PostgresReminderRulePersonalization } from "./adapters/postgres/reminder_rule_personalization.ts";
import { PostgresTaskRepository } from "./adapters/postgres/task_repository.ts";
import { PostgresPlanningWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import type { TaskCursorKeyset } from "./application/task_management.ts";
import type { RelationshipPersonBoundary } from "../people/public.ts";
import {
  createReminderDeliveryWorker,
  createReminderManagement,
  createTaskManagement,
  InAppReminderDelivery,
  reminderAuditFrom,
  reminderDeliveryAuditFrom,
  taskAuditFrom,
} from "./public.ts";

/**
 * The reminders a person's important dates imply. People publishes through it,
 * and it depends on nothing planning composes, so a root can build it first.
 */
export function personDateReminderPublisher(
  shared: SharedComposition,
): PostgresPersonDateReminderPublisher {
  return new PostgresPersonDateReminderPublisher(shared.actors);
}

export interface PlanningPorts {
  /** The keyset the task list's opaque cursors are sealed with. */
  readonly cursorKeyset: TaskCursorKeyset;
  readonly people: RelationshipPersonBoundary;
}

export function composePlanning(
  shared: SharedComposition,
  ports: PlanningPorts,
) {
  return {
    lifecycleImpact: PostgresPlanningWorkspaceLifecycleImpact,
    personalizationReferences: new PostgresReminderRulePersonalization(),
    reminders: createReminderManagement({
      actors: shared.actors,
      audit: reminderAuditFrom(shared.audit),
      clock: shared.clock,
      people: ports.people,
      repository: new PostgresReminderRepository(shared.actors),
      transaction: shared.peopleTransaction,
      workspace: new PostgresReminderWorkspaceBoundary(),
    }),
    tasks: createTaskManagement({
      actors: shared.actors,
      audit: taskAuditFrom(shared.audit),
      clock: shared.clock,
      cursorKeyset: ports.cursorKeyset,
      people: ports.people,
      repository: new PostgresTaskRepository(),
      transaction: shared.peopleTransaction,
    }),
  };
}

/** The worker half: the loop that claims due occurrences and delivers them. */
export function composeReminderDelivery(shared: SharedComposition) {
  return createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(shared.audit),
    clock: shared.clock,
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(shared.database, shared.clock),
    ),
    repository: new PostgresReminderDeliveryRepository(
      shared.database,
      shared.actors,
    ),
    transaction: shared.peopleTransaction,
  });
}
