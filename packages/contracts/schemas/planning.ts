/**
 * Tasks, reminders, and the day's plan: the shapes this surface accepts and
 * answers with.
 *
 * Every schema here is the one the route parses with and the one the
 * generator documents, so a shape cannot tighten in one place and stay loose
 * in the other. GAP-022 moved them out of `apps/api/planning` and out of the
 * hand-encoded OpenAPI literals that used to sit beside them in
 * `tools/contracts/generate.ts`.
 *
 * A schema with an `id` becomes a named component of the published document;
 * anything without one is inlined where it is used.
 */

import { z } from "zod";
import { oneOf } from "./shared.ts";

export const cadenceCreateInput = z.strictObject({
  intervalCount: z.number().int().min(1).max(100),
  intervalUnit: z.enum(["day", "week", "month", "year"]),
  personId: z.uuid(),
  requestId: z.uuid(),
}).meta({ id: "CadenceCreateInput" });

/**
 * The active state a reminder is put into.
 *
 * `setReminderActive` inlines this shape rather than naming a component, so it
 * carries no `id`.
 */
export const reminderActiveInput = z.strictObject({
  active: z.boolean(),
});

export const stayInTouchCadence = z.strictObject({
  id: z.uuid(),
  intervalCount: z.number().int().min(1).max(100),
  intervalUnit: z.enum(["day", "week", "month", "year"]),
  isActive: z.boolean(),
  lastContactedAt: z.iso.datetime({ offset: true }).optional(),
  nextDueAt: z.iso.datetime({ offset: true }),
  personId: z.uuid(),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "StayInTouchCadence" });

export const cadenceCreated = z.strictObject({
  cadence: stayInTouchCadence,
  status: z.literal("created"),
}).meta({ id: "CadenceCreated" });

export const reminderOccurrence = z.strictObject({
  attemptCount: z.number().int().min(0),
  deliverAt: z.iso.datetime({ offset: true }),
  error: z.string().optional(),
  id: z.uuid(),
  occursOn: z.iso.date(),
  providerEffectAt: z.iso.datetime({ offset: true }).optional(),
  sentAt: z.iso.datetime({ offset: true }).optional(),
  status: z.enum([
    "pending",
    "claimed",
    "retry",
    "sent",
    "skipped",
    "failed",
    "cancelled",
    "manual_attention",
  ]),
  visibleAt: z.iso.datetime({ offset: true }).optional(),
}).meta({ id: "ReminderOccurrence" });

export const reminder = z.strictObject({
  anchorOn: z.iso.date(),
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  isActive: z.boolean(),
  nextOccurrence: reminderOccurrence.optional(),
  personId: z.uuid(),
  recurrenceInterval: z.number().int().min(1).max(100),
  recurrenceUnit: z.enum(["none", "day", "week", "month", "year"]),
  sendTime: z.string(),
  title: z.string(),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "Reminder" });

export const personReminders = z.strictObject({
  cadences: z.array(stayInTouchCadence).max(1),
  nextCursor: z.string().optional(),
  reminders: z.array(reminder).max(50),
  status: z.literal("ready"),
}).meta({ id: "PersonReminders" });

export const reminderCreateInput = z.strictObject({
  anchorOn: z.iso.date(),
  personId: z.uuid(),
  recurrenceInterval: z.number().int().min(1).max(100),
  recurrenceUnit: z.enum(["none", "day", "week", "month", "year"]),
  requestId: z.uuid(),
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  title: z.string().trim().min(1).max(500),
}).meta({ id: "ReminderCreateInput" });

export const reminderCreated = z.strictObject({
  reminder: reminder,
  status: z.literal("created"),
}).meta({ id: "ReminderCreated" });

export const reminderSaved = z.strictObject({
  reminder: reminder,
  status: z.literal("saved"),
}).meta({ id: "ReminderSaved" });

/** An undelivered occurrence the member cleared from Today (REL-088). */
export const reminderOccurrenceAcknowledged = z.strictObject({
  occurrenceId: z.uuid(),
  status: z.literal("acknowledged"),
}).meta({ id: "ReminderOccurrenceAcknowledged" });

export const taskPerson = z.strictObject({
  archived: z.boolean(),
  id: z.uuid(),
  name: z.string(),
  unavailable: z.boolean().optional(),
}).meta({ id: "TaskPerson" });

export const task = z.strictObject({
  completedAt: z.iso.datetime({ offset: true }).optional(),
  completedByMemberId: z.uuid().optional(),
  createdAt: z.iso.datetime({ offset: true }),
  createdByMemberId: z.uuid().optional(),
  description: z.string().optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  id: z.uuid(),
  person: taskPerson.optional(),
  status: z.enum(["cancelled", "completed", "open"]),
  title: z.string(),
  updatedAt: z.iso.datetime({ offset: true }),
}).meta({ id: "Task" });

export const taskChangeInput = z.strictObject({
  description: z.string().trim().min(1).max(10000).regex(/\S/).nullable()
    .optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  personId: z.uuid().nullable().optional(),
  status: z.enum(["cancelled", "open"]).optional(),
  title: z.string().trim().min(1).max(500).regex(/\S/).optional(),
}).refine(
  (value) =>
    value.description !== undefined || value.dueAt !== undefined ||
    value.personId !== undefined || value.status !== undefined ||
    value.title !== undefined,
  { message: "At least one task field must change." },
).meta({ id: "TaskChangeInput" });

export const taskChanged = z.strictObject({
  status: z.enum(["saved", "unchanged"]),
  task: task,
}).meta({ id: "TaskChanged" });

export const taskCompletionInput = z.strictObject({
  completed: z.boolean(),
}).meta({ id: "TaskCompletionInput" });

export const taskCreateInput = z.strictObject({
  description: z.string().trim().min(1).max(10000).regex(/\S/).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  personId: z.uuid().optional(),
  requestId: z.uuid(),
  title: z.string().trim().min(1).max(500).regex(/\S/),
}).meta({ id: "TaskCreateInput" });

export const taskCreated = z.strictObject({
  status: z.literal("created"),
  task: task,
}).meta({ id: "TaskCreated" });

export const taskList = z.strictObject({
  items: z.array(task).max(50),
  nextCursor: z.string().optional(),
  status: z.literal("ready"),
}).meta({ id: "TaskList" });

export const todayAttentionPerson = z.strictObject({
  archived: z.boolean(),
  id: z.uuid(),
  name: z.string(),
  unavailable: z.boolean().optional(),
}).meta({ id: "TodayAttentionPerson" });

/**
 * The channel of the listed delivery. An email delivery is listed only once it
 * failed or needs attention, so `email` always names a delivery problem.
 */
const todayAttentionChannel = z.enum(["email", "in_app"]);

export const todayCadenceAttentionItem = z.strictObject({
  dueAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  kind: z.literal("cadence"),
  person: todayAttentionPerson,
  lastContactedAt: z.iso.datetime({ offset: true }).optional(),
  title: z.string(),
}).meta({ id: "TodayCadenceAttentionItem" });

export const todayImportantDateAttentionItem = z.strictObject({
  dueAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  kind: z.literal("important-date"),
  person: todayAttentionPerson.optional(),
  occursOn: z.iso.date(),
  title: z.string(),
}).meta({ id: "TodayImportantDateAttentionItem" });

export const todayLifeEventAttentionItem = z.strictObject({
  dueAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  kind: z.literal("life-event"),
  person: todayAttentionPerson.optional(),
  occursOn: z.iso.date(),
  title: z.string(),
}).meta({ id: "TodayLifeEventAttentionItem" });

export const todayReminderAttentionItem = z.strictObject({
  dueAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  kind: z.literal("reminder"),
  person: todayAttentionPerson.optional(),
  occursOn: z.iso.date(),
  channel: todayAttentionChannel,
  reminderStatus: z.enum(["failed", "manual_attention", "pending", "retry"]),
  title: z.string(),
}).meta({ id: "TodayReminderAttentionItem" });

export const todayTaskAttentionItem = z.strictObject({
  dueAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  kind: z.literal("task"),
  person: todayAttentionPerson.optional(),
  title: z.string(),
}).meta({ id: "TodayTaskAttentionItem" });

export const todayAttentionItem = oneOf([
  todayTaskAttentionItem,
  todayReminderAttentionItem,
  todayImportantDateAttentionItem,
  todayLifeEventAttentionItem,
  todayCadenceAttentionItem,
]).meta({ id: "TodayAttentionItem" });

export const todayAttentionGroup = z.strictObject({
  nextSevenDays: z.array(todayAttentionItem).max(20),
  overdue: z.array(todayAttentionItem).max(20),
  today: z.array(todayAttentionItem).max(20),
}).meta({ id: "TodayAttentionGroup" });

export const todayAttention = z.strictObject({
  attention: todayAttentionGroup,
  date: z.iso.date(),
  status: z.literal("ready"),
  timezone: z.string().min(1),
  upcoming: z.array(todayAttentionItem).max(30),
}).meta({ id: "TodayAttention" });

export const todayReminderPerson = z.strictObject({
  archived: z.boolean(),
  id: z.uuid(),
  name: z.string(),
}).meta({ id: "TodayReminderPerson" });

export const todayCadenceItem = z.strictObject({
  dueAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  lastContactedAt: z.iso.datetime({ offset: true }).optional(),
  person: todayReminderPerson,
}).meta({ id: "TodayCadenceItem" });

export const todayReminderItem = z.strictObject({
  attemptCount: z.number().int().min(0),
  deliverAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
  nextAttemptAt: z.iso.datetime({ offset: true }).optional(),
  person: todayReminderPerson,
  status: z.enum([
    "pending",
    "claimed",
    "retry",
    "sent",
    "failed",
    "manual_attention",
  ]),
  title: z.string(),
  visibleAt: z.iso.datetime({ offset: true }).optional(),
}).meta({
  id: "TodayReminderItem",
  oneOf: [{
    "required": ["nextAttemptAt"],
    "properties": { "status": { "const": "retry" } },
  }, {
    "not": { "required": ["nextAttemptAt"] },
    "properties": {
      "status": {
        "enum": ["pending", "claimed", "sent", "failed", "manual_attention"],
      },
    },
  }],
});

export const todayReminders = z.strictObject({
  cadences: z.array(todayCadenceItem).max(100),
  reminders: z.array(todayReminderItem).max(100),
  status: z.literal("ready"),
  timezone: z.string(),
}).meta({ id: "TodayReminders" });

export const todayTasks = z.strictObject({
  items: z.array(task).max(20),
  status: z.literal("ready"),
}).meta({ id: "TodayTasks" });

/**
 * The member's notification feed (GAP-053, `TODAY-002`): delivered in-app
 * reminders, undeliverable email reminders, finished exports and imports,
 * and accepted invitations, newest first. `unread` compares the item's time
 * with the member's read-through watermark.
 */
export const notificationItem = z.strictObject({
  href: z.string().regex(/^\/app(?:[/?].*)?$/),
  id: z.uuid(),
  kind: z.enum([
    "reminder",
    "reminder-email-failed",
    "export-ready",
    "import-finished",
    "invitation-accepted",
  ]),
  occurredAt: z.iso.datetime(),
  person: todayReminderPerson.optional(),
  title: z.string().optional(),
  unread: z.boolean(),
}).meta({ id: "NotificationItem" });

export const notificationsPage = z.strictObject({
  items: z.array(notificationItem).max(50),
  nextCursor: z.string().optional(),
  readThrough: z.iso.datetime().optional(),
  status: z.literal("ready"),
  unreadCount: z.number().int().min(0).max(100).meta({
    description: "Unread items, counted no further than 100: show 99+ there.",
  }),
}).meta({ id: "NotificationsPage" });
