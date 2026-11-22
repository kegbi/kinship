/**
 * Tasks, reminders, and the day's plan: every route of this surface, once.
 *
 * Each descriptor is what `apps/api` mounts and what
 * `tools/contracts/build.ts` documents. A route the document does not describe
 * fails `deno task contracts:check`, and one that is mounted and not here, or
 * here and never mounted, fails `apps/api/routes_test.ts`.
 */

import { z } from "zod";
import { defineRoute, type RouteDescriptor } from "../registry.ts";
import {
  originAndWorkspaceHeaders,
  problemResponses,
  tokenOrSessionWriteHeaders,
  workspaceHeaders,
} from "./common.ts";
import {
  cadenceCreated,
  cadenceCreateInput,
  cadenceDeleted,
  notificationsPage,
  personReminders,
  planningRevisionInput,
  reminderActiveInput,
  reminderChanged,
  reminderCreated,
  reminderCreateInput,
  reminderDeleted,
  reminderEditInput,
  reminderOccurrenceAcknowledged,
  reminderSaved,
  taskChanged,
  taskChangeInput,
  taskCompletionInput,
  taskCreated,
  taskCreateInput,
  taskDeleted,
  taskList,
  taskReady,
  todayAttention,
  todayReminders,
  todayTasks,
} from "../schemas/planning.ts";
import { pageQuery, uuid } from "../schemas/shared.ts";

/** What `listPersonReminders` accepts in the query string. */
export const listPersonRemindersQuery = pageQuery;

export const listPersonReminders = defineRoute({
  method: "get",
  path: "/api/v1/people/{personId}/reminders",
  operationId: "listPersonReminders",
  description:
    "Personal tokens require reminders:read. Lists one person's calendar reminders, each with its next occurrence, and the person's stay-in-touch cadence, a page at a time. A person outside the token's workspace is not found. Grants are independent; reminders:write does not imply read access.",
  tokenScope: "reminders:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      personId: uuid,
    }),
    query: listPersonRemindersQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Person reminder and cadence section",
      content: {
        "application/json": personReminders,
      },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const createReminder = defineRoute({
  method: "post",
  path: "/api/v1/reminders",
  operationId: "createReminder",
  description:
    "Personal tokens require reminders:write. Creates a calendar reminder for one person and schedules its future occurrences. Retry the same requestId and payload to receive the original reminder, so the call is retry-safe; a changed payload under the same requestId conflicts. Archived people are read-only. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "reminders:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": reminderCreateInput,
      },
    },
  },
  responses: {
    201: {
      description: "Calendar reminder created with unique future occurrences",
      content: {
        "application/json": reminderCreated,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const setReminderActive = defineRoute({
  method: "put",
  path: "/api/v1/reminders/{reminderId}/active",
  operationId: "setReminderActive",
  description:
    "Personal tokens require reminders:write. Disables or re-enables one reminder with active false or true; setting the current state again changes nothing. Disabling cancels its unattempted future occurrences and re-enabling regenerates them. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "reminders:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      reminderId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": reminderActiveInput,
      },
    },
  },
  responses: {
    200: {
      description:
        "Reminder active state changed; safe unattempted work is cancelled when disabled, in-flight delivery is preserved, and future work is regenerated when re-enabled",
      content: {
        "application/json": reminderSaved,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const updateReminder = defineRoute({
  method: "patch",
  path: "/api/v1/reminders/{reminderId}",
  operationId: "updateReminder",
  description:
    "Personal tokens require reminders:write. Edits one of a member's own calendar reminders: its title, anchorOn, sendTime, recurrenceUnit, or recurrenceInterval, at least one of them. Read the person's reminders first (listPersonReminders) and send that reminder's updatedAt as expectedUpdatedAt; a reminder changed since answers 409 reminder_stale. Its unattempted future occurrences are replaced from the new schedule, exactly as disabling and re-enabling it would; delivered and in-flight occurrences are kept as they are, and a disabled reminder stays disabled. A reminder generated from an important date answers 409 reminder_managed_by_source: change the date on the person instead. Archived people are read-only. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "reminders:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      reminderId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": reminderEditInput,
      },
    },
  },
  responses: {
    200: {
      description:
        "Reminder edited, with its next occurrence under the new schedule, or already equal",
      content: {
        "application/json": reminderChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deleteReminder = defineRoute({
  method: "delete",
  path: "/api/v1/reminders/{reminderId}",
  operationId: "deleteReminder",
  description:
    "Personal tokens require reminders:write. Deletes one of a member's own calendar reminders. Read the person's reminders first (listPersonReminders) and send that reminder's updatedAt as expectedUpdatedAt; a reminder changed since answers 409 reminder_stale. Its unattempted future occurrences stop exactly as disabling stops them, while delivered and in-flight occurrences are kept as delivery evidence; afterwards it no longer appears in the person's reminders or in Today. Retrying the createReminder request that made it answers 409 reminder_request_deleted rather than recreating it. A reminder generated from an important date answers 409 reminder_managed_by_source: delete or change the date on the person instead. Archived people are read-only. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "reminders:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      reminderId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": planningRevisionInput,
      },
    },
  },
  responses: {
    200: {
      description:
        "Reminder deleted; unattempted future work cancelled and delivery evidence kept",
      content: {
        "application/json": reminderDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const acknowledgeReminderOccurrence = defineRoute({
  method: "put",
  path: "/api/v1/reminder-occurrences/{occurrenceId}/acknowledgement",
  operationId: "acknowledgeReminderOccurrence",
  description:
    "Clears the signed-in member's own undelivered reminder (failed or needing attention) from Today, with the other undelivered channel of the same occurrence. It is never resent; acknowledging it again changes nothing.",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      occurrenceId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
  },
  responses: {
    200: {
      description: "The undelivered reminder is acknowledged",
      content: {
        "application/json": reminderOccurrenceAcknowledged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const createStayInTouchCadence = defineRoute({
  method: "post",
  path: "/api/v1/stay-in-touch-cadences",
  operationId: "createStayInTouchCadence",
  description:
    "Personal tokens require reminders:write. Sets how often to stay in touch with one person. A person has one cadence, so calling this again with a new requestId replaces it and restarts its due date. Retry the same requestId and payload to receive the original answer, so the call is retry-safe; a changed payload under the same requestId conflicts. Archived people are read-only. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "reminders:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": cadenceCreateInput,
      },
    },
  },
  responses: {
    201: {
      description: "Stay-in-touch cadence created or changed",
      content: {
        "application/json": cadenceCreated,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deleteStayInTouchCadence = defineRoute({
  method: "delete",
  path: "/api/v1/stay-in-touch-cadences/{cadenceId}",
  operationId: "deleteStayInTouchCadence",
  description:
    "Personal tokens require reminders:write. Removes a person's stay-in-touch cadence, named by the id createStayInTouchCadence and listPersonReminders answer; the id stays the same when the cadence is replaced. Send the cadence's updatedAt from listPersonReminders as expectedUpdatedAt; recording an interaction moves it, so a cadence changed since answers 409 reminder_stale. Its due item leaves Today and the attention queue, and recording an interaction afterwards does not bring it back; set a new cadence with createStayInTouchCadence and a new requestId. Archived people are read-only. Does not grant read access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "reminders:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      cadenceId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": planningRevisionInput,
      },
    },
  },
  responses: {
    200: {
      description: "Stay-in-touch cadence removed",
      content: {
        "application/json": cadenceDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

/**
 * What `listTasks` accepts in the query string.
 *
 * GAP-023 replaced its own `limit` with the shared one, so the page a task
 * listing serves is bounded the way every other list is: one to fifty, twenty
 * by default, where it used to accept and default to a hundred.
 */
export const listTasksQuery = pageQuery.extend({
  dueBefore: z.iso.datetime({ offset: true }).optional(),
  personId: z.uuid().optional(),
  status: z.enum(["cancelled", "completed", "open"]).optional(),
});

export const listTasks = defineRoute({
  method: "get",
  path: "/api/v1/tasks",
  operationId: "listTasks",
  description:
    "Personal tokens require tasks:read. Lists tasks in the active workspace, optionally filtered by personId, status, and dueBefore (inclusive ISO instant). Continuation cursors are bound to the workspace and all filters; changing a filter requires a new first page. Grants are independent; create and write grants do not imply read access.",
  tokenScope: "tasks:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    query: listTasksQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Bounded tenant-scoped task list",
      content: {
        "application/json": taskList,
      },
    },
    ...problemResponses(400, 401, 403, 409, 503),
  },
});

export const getTask = defineRoute({
  method: "get",
  path: "/api/v1/tasks/{taskId}",
  operationId: "getTask",
  description:
    "Personal tokens require tasks:read. Reads one task through planning's public use case with current membership and workspace validation, including its archived or unavailable linked-person projection.",
  tokenScope: "tasks:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({ taskId: uuid }),
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "One task in the active workspace",
      content: { "application/json": taskReady },
    },
    ...problemResponses(400, 401, 403, 404, 503),
  },
});

export const createTask = defineRoute({
  method: "post",
  path: "/api/v1/tasks",
  operationId: "createTask",
  description:
    "Personal tokens require tasks:create. Retry the same requestId and payload to receive the original task; a changed payload conflicts. Does not grant listing, detail, or editing. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "tasks:create",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": taskCreateInput,
      },
    },
  },
  responses: {
    201: {
      description: "Task created idempotently",
      content: {
        "application/json": taskCreated,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const changeTask = defineRoute({
  method: "patch",
  path: "/api/v1/tasks/{taskId}",
  operationId: "changeTask",
  description:
    "Personal tokens require tasks:write. Edits an existing task using expectedUpdatedAt; nullable fields may be explicitly cleared. Archived linked people remain read-only. Does not grant read or create access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "tasks:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      taskId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": taskChangeInput,
      },
    },
  },
  responses: {
    200: {
      description: "Task changed or already equal",
      content: {
        "application/json": taskChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const deleteTask = defineRoute({
  method: "delete",
  path: "/api/v1/tasks/{taskId}",
  operationId: "deleteTask",
  description:
    "Personal tokens require tasks:write. Deletes an existing task. Read it first (getTask or listTasks) and send its updatedAt as expectedUpdatedAt; a task changed since answers 409 task_stale. Afterwards it is not found by getTask and no longer appears in listTasks, Today, the attention queue, or search. Retrying the createTask request that made it answers 409 task_request_deleted rather than recreating it. Archived linked people remain read-only. Does not grant read or create access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "tasks:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      taskId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": planningRevisionInput,
      },
    },
  },
  responses: {
    200: {
      description: "Task deleted",
      content: {
        "application/json": taskDeleted,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const setTaskCompletion = defineRoute({
  method: "put",
  path: "/api/v1/tasks/{taskId}/completion",
  operationId: "setTaskCompletion",
  description:
    "Personal tokens require tasks:write. Completes or reopens an existing task idempotently with completed true or false. Archived linked people remain read-only. Does not grant read or create access. Cookie-authenticated writes require the exact configured Origin; bearer writes require no Cookie or Origin.",
  tokenScope: "tasks:write",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    params: z.object({
      taskId: uuid,
    }),
    headers: tokenOrSessionWriteHeaders,
    body: {
      required: true,
      content: {
        "application/json": taskCompletionInput,
      },
    },
  },
  responses: {
    200: {
      description: "Idempotent task completion state",
      content: {
        "application/json": taskChanged,
      },
    },
    ...problemResponses(400, 401, 403, 404, 409, 503),
  },
});

export const getTodayAttention = defineRoute({
  method: "get",
  path: "/api/v1/today/attention",
  operationId: "getTodayAttention",
  description:
    "Personal tokens require today:read. A read-only dashboard projection in the member's time zone: overdue, today, and next-seven-days groups plus an upcoming list of open tasks, undelivered or failing reminders, important dates, life events, and stay-in-touch cadences, each with its person. today:read is a deliberate Today grant: it reads these items here without tasks:read, reminders:read, or people grants, and grants no other route.",
  tokenScope: "today:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description:
        "Unified member-local Today attention and upcoming projection",
      content: {
        "application/json": todayAttention,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const getTodayReminders = defineRoute({
  method: "get",
  path: "/api/v1/today/reminders",
  operationId: "getTodayReminders",
  description:
    "Personal tokens require today:read. A read-only dashboard projection: reminder occurrences that are due within thirty days, being retried, failed, or need attention, recently sent ones, and stay-in-touch cadences due within thirty days, each with its person. today:read is a deliberate Today grant: it reads these items here without reminders:read, and grants no other route.",
  tokenScope: "today:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Independent Today reminder and cadence regions",
      content: {
        "application/json": todayReminders,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

export const getTodayTasks = defineRoute({
  method: "get",
  path: "/api/v1/today/tasks",
  operationId: "getTodayTasks",
  description:
    "Personal tokens require today:read. A read-only dashboard projection: up to twenty open tasks due within thirty days, overdue ones included, earliest first. today:read is a deliberate Today grant: it reads these tasks here without tasks:read, and grants no other route.",
  tokenScope: "today:read",
  security: [{ kinship_session: [] }, { kinship_api_token: [] }],
  request: {
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "Read-only due-task Today region",
      content: {
        "application/json": todayTasks,
      },
    },
    ...problemResponses(401, 403, 503),
  },
});

/** What `listNotifications` accepts in the query string. */
export const listNotificationsQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
});

export const listNotifications = defineRoute({
  method: "get",
  path: "/api/v1/notifications",
  operationId: "listNotifications",
  description:
    "The signed-in member's notifications in the active workspace, newest first, fifty at a time, with the unread count after their read-through watermark. Marking read saves `notificationsReadThrough` through `PATCH /api/v1/member/ui-state`.",
  security: [{ kinship_session: [] }],
  request: {
    query: listNotificationsQuery,
    headers: workspaceHeaders,
  },
  responses: {
    200: {
      description: "One page of the member's notifications",
      content: {
        "application/json": notificationsPage,
      },
    },
    ...problemResponses(400, 401, 403, 503),
  },
});

/** Every planning route, in the order the surface mounts them. */
export const PLANNING_ROUTES: readonly RouteDescriptor[] = [
  listPersonReminders,
  createReminder,
  setReminderActive,
  updateReminder,
  deleteReminder,
  acknowledgeReminderOccurrence,
  createStayInTouchCadence,
  deleteStayInTouchCadence,
  listTasks,
  getTask,
  createTask,
  changeTask,
  deleteTask,
  setTaskCompletion,
  getTodayAttention,
  getTodayReminders,
  getTodayTasks,
  listNotifications,
];
