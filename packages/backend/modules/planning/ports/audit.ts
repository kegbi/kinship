/**
 * What the module promises to write into the audit history.
 *
 * The three ports differ in how much proof each write owes. A task write
 * records an event and then reads it back, so `record` hands the identifier it
 * wrote to `assertPostcondition` before the transaction is allowed to commit.
 * A reminder write and a delivery write record only: their own repositories
 * already assert their postconditions, and the delivery event travels with the
 * claim the worker holds rather than being re-read from the reminder row.
 *
 * These are contracts, not descriptions — `application/audit_events.ts` holds
 * the pure functions that turn each command into the row governance stores.
 */

import type { ClaimedReminderOccurrence } from "../domain/delivery_rules.ts";
import type { ReminderAuditAction } from "../domain/reminder_rules.ts";
import type { StoredTask, TaskAuditAction } from "../domain/task_rules.ts";
import type { PlanningActor, PlanningTransaction } from "./context.ts";

export interface TaskAudit {
  record(command: {
    readonly action: TaskAuditAction;
    readonly actor: PlanningActor;
    readonly occurredAt: Date;
    readonly task: StoredTask;
    readonly transaction: PlanningTransaction;
  }): Promise<string>;
  assertPostcondition(command: {
    readonly action: TaskAuditAction;
    readonly actor: PlanningActor;
    readonly auditId: string;
    readonly occurredAt: Date;
    readonly task: StoredTask;
    readonly transaction: PlanningTransaction;
  }): Promise<void>;
}

export interface ReminderAudit {
  record(command: {
    readonly action: ReminderAuditAction;
    readonly actor: PlanningActor;
    readonly occurredAt: Date;
    readonly subjectId: string;
    readonly transaction: PlanningTransaction;
  }): Promise<void>;
}

export interface ReminderDeliveryAudit {
  record(command: {
    readonly action: "delivered" | "failed";
    /**
     * The key a digest was sent under, when it ended needing attention: the
     * provider may have delivered it, and the key derives from the digest's
     * occurrence set, which nothing else keeps once `finalize` clears it.
     */
    readonly attemptKey?: string;
    /** How many occurrences the digest email carried, for a digest. */
    readonly digestSize?: number;
    readonly occurrence: ClaimedReminderOccurrence;
    readonly occurredAt: Date;
    /** The job run that delivered it, when the worker correlates its runs. */
    readonly requestId?: string | undefined;
    readonly transaction: PlanningTransaction;
  }): Promise<void>;
}
