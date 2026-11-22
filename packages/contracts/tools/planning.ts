/**
 * Planning tools: tasks, reminders, and the stay-in-touch cadence. Reading,
 * creating, and editing tasks are three separate grants, and reminders two,
 * so a token sees only the tools for the grants it holds.
 */

import {
  changeTask,
  createReminder,
  createStayInTouchCadence,
  createTask,
  getTask,
  listPersonReminders,
  listTasks,
  setReminderActive,
  setTaskCompletion,
} from "../routes/planning.ts";
import { type AgentTool, defineTool } from "./define.ts";

const RETRY =
  "Pass your own requestId (a UUID v4) and reuse it when you retry: the same requestId and payload return the original, and a changed payload under it is refused as a conflict.";

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
      `Creates an open task with a title and optionally a description, a due instant (dueAt), and a linked person (personId from list_people), and returns it with its id and updatedAt. ${RETRY}`,
    route: createTask,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "update_task",
    title: "Update a task",
    description:
      "Changes a task's title, description, due instant, linked person, or status (open or cancelled; use set_task_completion to complete it). Send expectedUpdatedAt as the updatedAt from get_task or list_tasks: if the task changed since, the call is refused as a conflict, so read it again. Send null to clear description, dueAt, or personId, and change at least one field.",
    route: changeTask,
  }),
  defineTool({
    name: "set_task_completion",
    title: "Complete or reopen a task",
    description:
      "Marks a task completed (completed: true) or reopens it (completed: false); taskId comes from list_tasks. Safe to repeat: setting the state it already has changes nothing.",
    route: setTaskCompletion,
  }),
  defineTool({
    name: "list_reminders",
    title: "List a person's reminders",
    description:
      "Lists one person's calendar reminders, each with its id, schedule, whether it is active, and its next occurrence, and the person's stay-in-touch cadence if they have one (interval, last contact, and next due instant). Pages reminders with limit and nextCursor.",
    route: listPersonReminders,
  }),
  defineTool({
    name: "create_reminder",
    title: "Create a reminder",
    description:
      `Creates a calendar reminder about one person (personId from list_people) and schedules its occurrences: a title, the date it starts from (anchorOn), a local time of day to send it (sendTime, HH:MM), and how it repeats (recurrenceUnit none for once, or every recurrenceInterval days, weeks, months, or years). ${RETRY} Archived people are read-only.`,
    route: createReminder,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "set_reminder_active",
    title: "Pause or resume a reminder",
    description:
      "Disables (active: false) or re-enables (active: true) a reminder; reminderId comes from list_reminders. Disabling cancels its future occurrences that have not been attempted, and re-enabling schedules them again. Safe to repeat: setting the current state changes nothing.",
    route: setReminderActive,
  }),
  defineTool({
    name: "set_stay_in_touch_cadence",
    title: "Set a stay-in-touch cadence",
    description:
      `Sets how often to stay in touch with one person (every intervalCount days, weeks, months, or years). A person has one cadence: setting it again with a new requestId replaces it and restarts its due date. Recording a later activity, call, or conversation with the person moves its next due date on. ${RETRY} Archived people are read-only.`,
    route: createStayInTouchCadence,
    minted: { requestId: "uuid" },
  }),
];
