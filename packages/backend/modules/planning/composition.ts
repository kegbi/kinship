import { PostgresPlanningBusinessImportBoundary } from "./adapters/postgres/business_import_boundary.ts";
/**
 * Planning composition.
 *
 * Only a declared composition root imports this file. Two roots do: the API
 * builds tasks and reminders, and the worker builds the delivery loop, so both
 * halves live here rather than being spelled out twice.
 */

import type { SharedComposition } from "../../platform/composition.ts";
import { PostgresPlanningPersonMergeParticipant } from "./adapters/postgres/person_merge_participant.ts";
import type { Logger } from "../../shared-kernel/telemetry.ts";
import { InAppReminderDelivery } from "./adapters/in_app/reminder_delivery.ts";
import { PostgresPersonDateReminderPublisher } from "./adapters/postgres/person_date_reminders.ts";
import {
  PostgresInAppReminderEffectStore,
  PostgresPersonRestoreReminderPublisher,
  PostgresReminderDeliveryRepository,
  PostgresReminderRepository,
  PostgresReminderWorkspaceBoundary,
} from "./adapters/postgres/reminder_repository.ts";
import { PostgresReminderRulePersonalization } from "./adapters/postgres/reminder_rule_personalization.ts";
import { PostgresTaskRepository } from "./adapters/postgres/task_repository.ts";
import { PostgresPlanningWorkspaceLifecycleImpact } from "./adapters/postgres/workspace_lifecycle_impact.ts";
import type { RelationshipPersonBoundary } from "../people/public.ts";
import {
  createReminderDeliveryWorker,
  createReminderManagement,
  createTaskManagement,
  reminderAuditFrom,
  reminderDeliveryAuditFrom,
  type ReminderDeliveryChannel,
  type ReminderDeliveryPreferences,
  taskAuditFrom,
  type TaskCursorKeyset,
} from "./public.ts";

/**
 * The reminders a person's important dates imply. People publishes through it,
 * and it depends on nothing planning composes, so a root can build it first.
 */
export function personDateReminderPublisher(
  shared: SharedComposition,
  deliveryPreferences: ReminderDeliveryPreferences,
): PostgresPersonDateReminderPublisher {
  return new PostgresPersonDateReminderPublisher(
    shared.actors,
    deliveryPreferences,
  );
}

/**
 * The reminders a restored person resumes. Like the date publisher, people
 * publishes through it and a root can build it first.
 */
export function personRestoreReminderPublisher(
  shared: SharedComposition,
  deliveryPreferences: ReminderDeliveryPreferences,
): PostgresPersonRestoreReminderPublisher {
  return new PostgresPersonRestoreReminderPublisher(
    shared.actors,
    deliveryPreferences,
  );
}

export interface PlanningPorts {
  readonly importPeople: ConstructorParameters<
    typeof PostgresPlanningBusinessImportBoundary
  >[2];
  readonly importDateReference: ConstructorParameters<
    typeof PostgresPlanningBusinessImportBoundary
  >[3];
  /** The keyset the task list's opaque cursors are sealed with. */
  readonly cursorKeyset: TaskCursorKeyset;
  /** What members chose about reminder delivery, read from `workspaces`. */
  readonly deliveryPreferences: ReminderDeliveryPreferences;
  readonly people: RelationshipPersonBoundary;
}

export function composePlanning(
  shared: SharedComposition,
  ports: PlanningPorts,
) {
  return {
    businessImportBoundary: new PostgresPlanningBusinessImportBoundary(
      shared.actors,
      ports.deliveryPreferences,
      ports.importPeople,
      ports.importDateReference,
    ),
    lifecycleImpact: PostgresPlanningWorkspaceLifecycleImpact,
    personalizationReferences: new PostgresReminderRulePersonalization(),
    reminders: createReminderManagement({
      actors: shared.actors,
      audit: reminderAuditFrom(shared.audit),
      clock: shared.clock,
      people: ports.people,
      repository: new PostgresReminderRepository(
        shared.actors,
        ports.deliveryPreferences,
      ),
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

/**
 * The worker half: the loop that claims due occurrences and delivers them.
 * Given a logger, each run is logged as `worker.job` and correlated by an
 * identifier minted from the shared identifier source. Given an email channel
 * (PLANNING-003), email occurrences are delivered too, and the repository that
 * leases them is the ledger each email attempt is recorded in.
 */
export function composeReminderDelivery(
  shared: SharedComposition,
  options: {
    readonly deliveryPreferences: ReminderDeliveryPreferences;
    readonly email?: ReminderDeliveryChannel;
    readonly logger?: Logger;
  },
) {
  const repository = new PostgresReminderDeliveryRepository(
    shared.database,
    shared.actors,
    options.deliveryPreferences,
  );
  return createReminderDeliveryWorker({
    audit: reminderDeliveryAuditFrom(shared.audit),
    clock: shared.clock,
    ...(options.email
      ? { email: { channel: options.email, ledger: repository } }
      : {}),
    provider: new InAppReminderDelivery(
      new PostgresInAppReminderEffectStore(shared.database, shared.clock),
    ),
    repository,
    ...(options.logger
      ? { telemetry: { correlation: shared.ids, logger: options.logger } }
      : {}),
    transaction: shared.peopleTransaction,
  });
}

/**
 * This module's rows in a person merge (tasks, reminders, and the stay-in-touch cadence, GAP-049). It depends on
 * nothing the module composes, so the root registers it before composing
 * people.
 */
export function planningPersonMergeParticipant(): PostgresPlanningPersonMergeParticipant {
  return new PostgresPlanningPersonMergeParticipant();
}
