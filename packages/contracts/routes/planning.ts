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
  workspaceHeaders,
} from "./common.ts";
import {
  cadenceCreated,
  cadenceCreateInput,
  notificationsPage,
  personReminders,
  reminderActiveInput,
  reminderCreated,
  reminderCreateInput,
  reminderSaved,
  taskChanged,
  taskChangeInput,
  taskCompletionInput,
  taskCreated,
  taskCreateInput,
  taskList,
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
  security: [{ kinship_session: [] }],
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
    ...problemResponses(400, 401, 403, 503),
  },
});

export const createReminder = defineRoute({
  method: "post",
  path: "/api/v1/reminders",
  operationId: "createReminder",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
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
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      reminderId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
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

export const createStayInTouchCadence = defineRoute({
  method: "post",
  path: "/api/v1/stay-in-touch-cadences",
  operationId: "createStayInTouchCadence",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
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

/**
 * What `listTasks` accepts in the query string.
 *
 * GAP-023 replaced its own `limit` with the shared one, so the page a task
 * listing serves is bounded the way every other list is: one to fifty, twenty
 * by default, where it used to accept and default to a hundred.
 */
export const listTasksQuery = pageQuery.extend({
  personId: z.uuid().optional(),
  status: z.enum(["cancelled", "completed", "open"]).optional(),
});

export const listTasks = defineRoute({
  method: "get",
  path: "/api/v1/tasks",
  operationId: "listTasks",
  security: [{ kinship_session: [] }],
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

export const createTask = defineRoute({
  method: "post",
  path: "/api/v1/tasks",
  operationId: "createTask",
  security: [{ kinship_session: [] }],
  request: {
    headers: originAndWorkspaceHeaders,
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
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      taskId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
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

export const setTaskCompletion = defineRoute({
  method: "put",
  path: "/api/v1/tasks/{taskId}/completion",
  operationId: "setTaskCompletion",
  security: [{ kinship_session: [] }],
  request: {
    params: z.object({
      taskId: uuid,
    }),
    headers: originAndWorkspaceHeaders,
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
  security: [{ kinship_session: [] }],
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
  security: [{ kinship_session: [] }],
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
  security: [{ kinship_session: [] }],
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
  createStayInTouchCadence,
  listTasks,
  createTask,
  changeTask,
  setTaskCompletion,
  getTodayAttention,
  getTodayReminders,
  getTodayTasks,
  listNotifications,
];
