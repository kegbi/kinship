/**
 * Planning tools: tasks, reminders, and the stay-in-touch cadence. Reading,
 * creating, and editing tasks are three separate grants, and reminders two,
 * so a token sees only the tools for the grants it holds. Every change after
 * a create needs an id and a revision only the read grant answers, and each
 * description says so.
 */

import {
  changeTask,
  createReminder,
  createStayInTouchCadence,
  createTask,
  deleteReminder,
  deleteStayInTouchCadence,
  deleteTask,
  getTask,
  listPersonReminders,
  listTasks,
  setReminderActive,
  setTaskCompletion,
  updateReminder,
} from "../routes/planning.ts";
import { type AgentTool, defineTool } from "./define.ts";

const RETRY =
  "Pass your own requestId (a UUID v4) and reuse it when you retry: the same requestId and payload return the original, and a changed payload under it is refused as a conflict.";

/** Where a task's id and revision come from, for every change after create. */
const TASK_READ =
  "get_task and list_tasks require tasks:read; a token without it cannot obtain a task's id or revision.";

/** Where a reminder's or a cadence's id and revision come from. */
const REMINDER_READ =
  "list_reminders requires reminders:read; a token without it cannot obtain a reminder's or a cadence's id or revision.";

const STALE = "A stale revision is refused as a conflict: read it again.";

export const PLANNING_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_tasks",
    title: "List tasks",
    description:
      "Lists the workspace's tasks with their ids, status, due instant, linked person, and updatedAt, optionally only one person's (personId), one status (open, completed, or cancelled), or those due by dueBefore (an inclusive ISO instant). Pages with limit and nextCursor; a cursor is bound to its filters, so changing a filter starts again from the first page.",
    route: listTasks,
  }),
  defineTool({
    name: "get_task",
    title: "Get a task",
    description:
      "Reads one task, with its linked person if it has one. Its updatedAt is the expectedUpdatedAt update_task needs.",
    route: getTask,
  }),
  defineTool({
    name: "create_task",
    title: "Create a task",
    description:
      `Creates an open task with a title and optionally a description, a due instant (dueAt), and a linked person (personId from list_people), and returns it with its id and updatedAt. ${RETRY} Once the task is deleted its requestId stays used: replaying the create is refused as a conflict (task_request_deleted) rather than recreating it.`,
    route: createTask,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "update_task",
    title: "Update a task",
    description:
      `Changes a task's title, description, due instant, linked person, or status (open or cancelled; use set_task_completion to complete it). Send expectedUpdatedAt as the updatedAt from get_task or list_tasks: if the task changed since, the call is refused as a conflict, so read it again. ${TASK_READ} Send null to clear description, dueAt, or personId, and change at least one field.`,
    route: changeTask,
  }),
  defineTool({
    name: "set_task_completion",
    title: "Complete or reopen a task",
    description:
      `Marks a task completed (completed: true) or reopens it (completed: false); taskId comes from list_tasks. ${TASK_READ} Safe to repeat: setting the state it already has changes nothing.`,
    route: setTaskCompletion,
  }),
  defineTool({
    name: "list_reminders",
    title: "List a person's reminders",
    description:
      "Lists one person's calendar reminders, each with its id, schedule, whether it is active, its next occurrence, and the updatedAt its changes need, and the person's stay-in-touch cadence if they have one (its id, interval, last contact, next due instant, and updatedAt). Pages reminders with limit and nextCursor.",
    route: listPersonReminders,
  }),
  defineTool({
    name: "create_reminder",
    title: "Create a reminder",
    description:
      `Creates a calendar reminder about one person (personId from list_people) and schedules its occurrences: a title, the date it starts from (anchorOn), a local time of day to send it (sendTime, HH:MM), and how it repeats (recurrenceUnit none for once, or every recurrenceInterval days, weeks, months, or years). ${RETRY} Once the reminder is deleted its requestId stays used: replaying the create is refused as a conflict (reminder_request_deleted) rather than recreating it. Archived people are read-only.`,
    route: createReminder,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "set_reminder_active",
    title: "Pause or resume a reminder",
    description:
      `Disables (active: false) or re-enables (active: true) a reminder; reminderId comes from list_reminders. ${REMINDER_READ} Disabling cancels its future occurrences that have not been attempted, for every member, and re-enabling schedules them again. Safe to repeat: setting the current state changes nothing.`,
    route: setReminderActive,
  }),
  defineTool({
    name: "set_stay_in_touch_cadence",
    title: "Set a stay-in-touch cadence",
    description:
      `Sets how often to stay in touch with one person (every intervalCount days, weeks, months, or years). A person has one cadence: setting it again with a new requestId replaces it and restarts its due date. Recording a later activity, call, or conversation with the person moves its next due date on. ${RETRY} After delete_stay_in_touch_cadence an earlier requestId creates the cadence again. Archived people are read-only.`,
    route: createStayInTouchCadence,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "delete_task",
    title: "Delete a task",
    description:
      `Permanently deletes a task: get_task then answers not found, and it leaves list_tasks, Today, the attention queue, and search. Send expectedUpdatedAt as the task's updatedAt from get_task or list_tasks; a task changed since is refused as a conflict (task_stale), so read it again. ${TASK_READ} The task's requestId stays used: replaying the create_task call that made it is refused as a conflict (task_request_deleted) rather than recreating it. Archived linked people are read-only.`,
    route: deleteTask,
  }),
  defineTool({
    name: "update_reminder",
    title: "Edit a reminder",
    description:
      `Edits a reminder's title, anchorOn, sendTime, recurrenceUnit, or recurrenceInterval, at least one of them; any member may edit any reminder about a workspace person. expectedUpdatedAt is the reminder's updatedAt from list_reminders (reminder_stale when it changed since). ${REMINDER_READ} Its unattempted future occurrences are replaced from the new schedule for every member who had them, each in their own time zone and channels; delivered and in-flight ones are kept, and a disabled reminder stays disabled. A reminder made from an important date is refused (reminder_managed_by_source): change the date with update_important_date instead. Archived people are read-only.`,
    route: updateReminder,
  }),
  defineTool({
    name: "delete_reminder",
    title: "Delete a reminder",
    description:
      `Deletes a reminder about a person: its unattempted future occurrences stop as disabling stops them, delivered and in-flight ones are kept as evidence, and it leaves list_reminders and Today. expectedUpdatedAt is its updatedAt from list_reminders. ${STALE} ${REMINDER_READ} Its requestId stays used: replaying the create_reminder call that made it is refused as a conflict (reminder_request_deleted). A reminder made from an important date is refused (reminder_managed_by_source): change or delete the date instead. Archived people are read-only.`,
    route: deleteReminder,
  }),
  defineTool({
    name: "delete_stay_in_touch_cadence",
    title: "Remove a stay-in-touch cadence",
    description:
      `Removes a person's stay-in-touch cadence. cadenceId is its id from list_reminders or set_stay_in_touch_cadence (replacing a cadence keeps its id), and expectedUpdatedAt its updatedAt from list_reminders; recording an interaction moves it, so read just before. ${STALE} ${REMINDER_READ} Its due item leaves Today and the attention queue, and later interactions do not bring it back. Deleting also removes its request receipts, so replaying an earlier set_stay_in_touch_cadence requestId creates the cadence again. Archived people are read-only.`,
    route: deleteStayInTouchCadence,
  }),
];
