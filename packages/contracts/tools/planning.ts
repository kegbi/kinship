/**
 * Task tools. Reading, creating, and editing tasks are three separate grants,
 * and a token sees only the tools for the ones it holds.
 */

import {
  changeTask,
  createTask,
  getTask,
  listTasks,
  setTaskCompletion,
} from "../routes/planning.ts";
import { type AgentTool, defineTool } from "./define.ts";

export const PLANNING_TOOLS: readonly AgentTool[] = [
  defineTool({
    name: "list_tasks",
    title: "List tasks",
    description:
      "Lists the workspace's tasks, optionally only one person's (personId), one status (open, completed, or cancelled), or those due by dueBefore (an inclusive ISO instant). Pages with limit and nextCursor; a cursor is bound to its filters, so changing a filter starts again from the first page.",
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
      "Creates a task with a title and optionally a description, a due instant (dueAt), and a linked person (personId). Pass your own requestId (a UUID v4) and reuse it when you retry: the same requestId and payload return the original task, and a changed payload under it is refused as a conflict.",
    route: createTask,
    minted: { requestId: "uuid" },
  }),
  defineTool({
    name: "update_task",
    title: "Update a task",
    description:
      "Changes a task's title, description, due instant, linked person, or status (open or cancelled; use set_task_completion to complete it). Send expectedUpdatedAt as the updatedAt you last read: if the task changed since, the call is refused as a conflict, so read it again with get_task. Send null to clear description, dueAt, or personId. Change at least one field.",
    route: changeTask,
  }),
  defineTool({
    name: "set_task_completion",
    title: "Complete or reopen a task",
    description:
      "Marks a task completed (completed: true) or reopens it (completed: false). Safe to repeat: setting the state it already has changes nothing.",
    route: setTaskCompletion,
  }),
];
