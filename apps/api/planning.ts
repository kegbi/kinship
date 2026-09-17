/**
 * Tasks, reminders, cadences, and the Today regions built on them, over HTTP.
 *
 * Planning is the widest delivery surface in the API and the one with the most
 * to say when something is unavailable: each Today region degrades on its own,
 * and each write says whether anything was saved. Those sentences are the
 * reason the problem definitions below are named rather than inlined — they
 * are the contract the web app renders, and they are pinned in
 * `http/failures_test.ts`.
 *
 * The problem responder, the session cookie, the origin check, and the kernel
 * status map came from `http/` (GAP-019). The reminder routes still call the
 * origin check inside the handler rather than taking the middleware, because
 * a deployment without the reminders service answers "reminders unavailable"
 * before it looks at anything else, and that order is observable.
 */

import { Hono } from "hono";
import { z } from "zod";
import type {
  ChangeTaskInput,
  ReminderManagement,
  TaskManagement,
} from "../../packages/backend/modules/planning/public.ts";
import type {
  TodayAttention,
  TodayReminders,
  TodayTasks,
} from "../../packages/backend/read-models/today/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";
import { failureResponder, type FailureTable } from "./http/failures.ts";
import { rejectForeignOrigin, requireMatchingOrigin } from "./http/origin.ts";
import { definedProblem, type ProblemDefinition } from "./http/problem.ts";
import { type ActorEnv, requireActor, sessionActor } from "./http/session.ts";
import { parseJsonBody, parseQuery, parseValue } from "./http/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface PlanningHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly reminders?: ReminderManagement;
  readonly tasks: TaskManagement;
  readonly todayAttention?: TodayAttention;
  readonly todayTasks: TodayTasks;
  readonly todayReminders?: TodayReminders;
}

const id = z.uuid();
const createSchema = z.object({
  description: z.string().trim().min(1).max(10_000).optional(),
  dueAt: z.iso.datetime({ offset: true }).optional(),
  personId: id.optional(),
  requestId: id,
  title: z.string().trim().min(1).max(500),
}).strict();
const changeSchema = z.object({
  description: z.string().trim().min(1).max(10_000).nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  personId: id.nullable().optional(),
  status: z.enum(["cancelled", "open"]).optional(),
  title: z.string().trim().min(1).max(500).optional(),
}).strict().refine(
  (value) =>
    value.description !== undefined || value.dueAt !== undefined ||
    value.personId !== undefined || value.status !== undefined ||
    value.title !== undefined,
  { message: "At least one task field must change." },
);
const completionSchema = z.object({ completed: z.boolean() }).strict();
const listSchema = z.object({
  cursor: z.string().max(2_000).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(100),
  personId: id.optional(),
  status: z.enum(["cancelled", "completed", "open"]).optional(),
}).strict();
const reminderSchema = z.object({
  anchorOn: z.iso.date(),
  personId: id,
  recurrenceInterval: z.number().int().min(1).max(100),
  recurrenceUnit: z.enum(["none", "day", "week", "month", "year"]),
  requestId: id,
  sendTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/),
  title: z.string().trim().min(1).max(500),
}).strict();
const cadenceSchema = z.object({
  intervalCount: z.number().int().min(1).max(100),
  intervalUnit: z.enum(["day", "week", "month", "year"]),
  personId: id,
  requestId: id,
}).strict();
const activeSchema = z.object({ active: z.boolean() }).strict();

/** A task write or projection that the domain refused. */
export const TASK_FAILURES: FailureTable = {
  fallback: {
    code: "task_validation_failed",
    detail: "Review the task fields and try again.",
    status: 400,
    title: "Invalid task",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore the linked person before changing this task.",
      title: "Archived person is read-only",
    },
    forbidden: {
      code: "tasks_forbidden",
      detail: "Your active workspace membership no longer permits this action.",
      title: "Tasks unavailable",
    },
    "idempotency-conflict": {
      code: "task_request_conflict",
      detail: "Use a new request identifier when the task payload changes.",
      status: 409,
      title: "Request identifier already used",
    },
    "not-found": {
      code: "task_not_found",
      detail:
        "The task or linked person does not exist in the active workspace.",
      title: "Task unavailable",
    },
    stale: {
      code: "task_stale",
      detail: "Refresh the task before saving your edits.",
      status: 409,
      title: "Task changed",
    },
    "stale-cursor": {
      code: "task_cursor_stale",
      detail: "Reload the first task page before continuing.",
      status: 409,
      title: "Task list changed",
    },
  },
};

const taskFailure = failureResponder(TASK_FAILURES);

/** A reminder or cadence write or projection that the domain refused. */
export const REMINDER_FAILURES: FailureTable = {
  fallback: {
    code: "reminder_validation_failed",
    detail: "Review the calendar reminder fields.",
    status: 400,
    title: "Invalid reminder",
  },
  statuses: {
    "archived-write-rejected": {
      code: "archived_write_rejected",
      detail: "Restore the person before changing reminders.",
      title: "Archived person is read-only",
    },
    forbidden: {
      code: "reminders_forbidden",
      detail: "Your active membership no longer permits this action.",
      title: "Reminders unavailable",
    },
    "idempotency-conflict": {
      code: "reminder_request_conflict",
      detail: "Use a new request identifier when reminder fields change.",
      status: 409,
      title: "Request identifier already used",
    },
    "not-found": {
      code: "reminder_not_found",
      detail: "The reminder or person does not exist in the active workspace.",
      title: "Reminder unavailable",
    },
  },
};

const reminderFailure = failureResponder(REMINDER_FAILURES);

/**
 * The outages and rejected requests planning answers on its own.
 *
 * Every 503 names what did or did not happen — "Nothing was saved" is not the
 * same promise as "Nothing was changed" — and every Today region says that the
 * others are still there, because one unavailable region must not read as a
 * blank page.
 */
const TODAY_ATTENTION_UNAVAILABLE: ProblemDefinition = {
  code: "today_attention_unavailable",
  detail: "Other Today regions remain available. Retry the attention queue.",
  status: 503,
  title: "Attention unavailable",
};
const TODAY_REMINDERS_UNAVAILABLE: ProblemDefinition = {
  code: "today_reminders_unavailable",
  detail: "Other Today regions remain available.",
  status: 503,
  title: "Reminder region unavailable",
};
const TODAY_TASKS_UNAVAILABLE: ProblemDefinition = {
  code: "today_tasks_unavailable",
  detail: "Other Today regions remain available.",
  status: 503,
  title: "Due tasks unavailable",
};
const REMINDERS_SECTION_UNAVAILABLE: ProblemDefinition = {
  code: "reminders_unavailable",
  detail: "Other person sections remain available.",
  status: 503,
  title: "Reminders unavailable",
};
const REMINDERS_NOTHING_SAVED: ProblemDefinition = {
  code: "reminders_unavailable",
  detail: "Nothing was saved.",
  status: 503,
  title: "Reminders unavailable",
};
const REMINDERS_NOTHING_CHANGED: ProblemDefinition = {
  code: "reminders_unavailable",
  detail: "Nothing was changed.",
  status: 503,
  title: "Reminders unavailable",
};
const REMINDER_QUERY_INVALID: ProblemDefinition = {
  code: "reminder_query_invalid",
  detail: "Use a canonical person identifier.",
  status: 400,
  title: "Invalid reminder query",
};
const REMINDER_CALENDAR_INVALID: ProblemDefinition = {
  code: "reminder_request_invalid",
  detail: "Use supported calendar fields and canonical identifiers.",
  status: 400,
  title: "Invalid reminder",
};
const REMINDER_ACTIVE_INVALID: ProblemDefinition = {
  code: "reminder_request_invalid",
  detail: "Use a canonical reminder and explicit active state.",
  status: 400,
  title: "Invalid reminder",
};
const CADENCE_REQUEST_INVALID: ProblemDefinition = {
  code: "cadence_request_invalid",
  detail: "Use a supported calendar interval.",
  status: 400,
  title: "Invalid stay-in-touch cadence",
};
const TASK_QUERY_INVALID: ProblemDefinition = {
  code: "task_query_invalid",
  detail: "Use a canonical person, supported state, and bounded limit.",
  status: 400,
  title: "Invalid task query",
};
const TASK_FIELDS_INVALID: ProblemDefinition = {
  code: "task_request_invalid",
  detail: "Use supported task fields and canonical identifiers.",
  status: 400,
  title: "Invalid task",
};
const TASK_CHANGE_INVALID: ProblemDefinition = {
  code: "task_request_invalid",
  detail: "Use a canonical task and at least one supported change.",
  status: 400,
  title: "Invalid task",
};
const TASK_COMPLETION_INVALID: ProblemDefinition = {
  code: "task_request_invalid",
  detail: "Use a canonical task and explicit completion state.",
  status: 400,
  title: "Invalid task",
};
const TASKS_LIST_UNAVAILABLE: ProblemDefinition = {
  code: "tasks_unavailable",
  detail: "Saved tasks were not changed.",
  status: 503,
  title: "Tasks unavailable",
};
const TASKS_NOTHING_SAVED: ProblemDefinition = {
  code: "tasks_unavailable",
  detail: "Nothing was saved. Try again when the service is available.",
  status: 503,
  title: "Tasks unavailable",
};
const TASKS_NOTHING_CHANGED: ProblemDefinition = {
  code: "tasks_unavailable",
  detail: "Nothing was changed.",
  status: 503,
  title: "Tasks unavailable",
};

/** Every problem this file answers on its own, for the pinning suite. */
export const PLANNING_PROBLEMS: readonly ProblemDefinition[] = [
  CADENCE_REQUEST_INVALID,
  REMINDER_ACTIVE_INVALID,
  REMINDER_CALENDAR_INVALID,
  REMINDER_QUERY_INVALID,
  REMINDERS_NOTHING_CHANGED,
  REMINDERS_NOTHING_SAVED,
  REMINDERS_SECTION_UNAVAILABLE,
  TASK_CHANGE_INVALID,
  TASK_COMPLETION_INVALID,
  TASK_FIELDS_INVALID,
  TASK_QUERY_INVALID,
  TASKS_LIST_UNAVAILABLE,
  TASKS_NOTHING_CHANGED,
  TASKS_NOTHING_SAVED,
  TODAY_ATTENTION_UNAVAILABLE,
  TODAY_REMINDERS_UNAVAILABLE,
  TODAY_TASKS_UNAVAILABLE,
];

export function createPlanningRoutes(
  services: PlanningHttpServices,
): Hono<ActorEnv> {
  const routes = new Hono<ActorEnv>();
  const session = sessionActor(services.protectedSessions);
  const origin = requireMatchingOrigin(services.browserSecurity);

  routes.get("/api/v1/today/attention", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.todayAttention?.get(actor).catch(() =>
      undefined
    );
    if (!result) {
      return definedProblem(context, TODAY_ATTENTION_UNAVAILABLE);
    }
    if (result.status !== "ready") return taskFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.get(
    "/api/v1/people/:personId/reminders",
    session,
    async (context) => {
      const reminders = services.reminders;
      if (!reminders) {
        return definedProblem(context, REMINDERS_SECTION_UNAVAILABLE);
      }
      const personId = parseValue(id, context.req.param("personId"));
      if ("errors" in personId) {
        return definedProblem(context, REMINDER_QUERY_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await reminders.listPerson(actor, personId.data)
        .catch(() => undefined);
      if (!result) {
        return definedProblem(context, REMINDERS_SECTION_UNAVAILABLE);
      }
      if (result.status !== "ready") return reminderFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  routes.post("/api/v1/reminders", session, async (context) => {
    const reminders = services.reminders;
    if (!reminders) {
      return definedProblem(context, REMINDERS_NOTHING_SAVED);
    }
    const foreign = rejectForeignOrigin(context, services.browserSecurity);
    if (foreign) return foreign;
    const input = await parseJsonBody(context, reminderSchema);
    if ("errors" in input) {
      return definedProblem(context, REMINDER_CALENDAR_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await reminders.createReminder(actor, input.data)
      .catch(() => undefined);
    if (!result) {
      return definedProblem(context, REMINDERS_NOTHING_SAVED);
    }
    if (result.status !== "created") return reminderFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });

  routes.post("/api/v1/stay-in-touch-cadences", session, async (context) => {
    const reminders = services.reminders;
    if (!reminders) {
      return definedProblem(context, REMINDERS_NOTHING_SAVED);
    }
    const foreign = rejectForeignOrigin(context, services.browserSecurity);
    if (foreign) return foreign;
    const input = await parseJsonBody(context, cadenceSchema);
    if ("errors" in input) {
      return definedProblem(context, CADENCE_REQUEST_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await reminders.createCadence(actor, input.data)
      .catch(() => undefined);
    if (!result) {
      return definedProblem(context, REMINDERS_NOTHING_SAVED);
    }
    if (result.status !== "created") return reminderFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });

  routes.put(
    "/api/v1/reminders/:reminderId/active",
    session,
    async (context) => {
      const reminders = services.reminders;
      if (!reminders) {
        return definedProblem(context, REMINDERS_NOTHING_CHANGED);
      }
      const foreign = rejectForeignOrigin(context, services.browserSecurity);
      if (foreign) return foreign;
      const reminderId = parseValue(id, context.req.param("reminderId"));
      const input = await parseJsonBody(context, activeSchema);
      if ("errors" in reminderId || "errors" in input) {
        return definedProblem(context, REMINDER_ACTIVE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await reminders.setActive(
        actor,
        reminderId.data,
        input.data.active,
      ).catch(() => undefined);
      if (!result) {
        return definedProblem(context, REMINDERS_NOTHING_CHANGED);
      }
      if (result.status !== "saved") return reminderFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  routes.get("/api/v1/today/reminders", session, async (context) => {
    const todayReminders = services.todayReminders;
    if (!todayReminders) {
      return definedProblem(context, TODAY_REMINDERS_UNAVAILABLE);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await todayReminders.get(actor).catch(() => undefined);
    if (!result) {
      return definedProblem(context, TODAY_REMINDERS_UNAVAILABLE);
    }
    if (result.status !== "ready") return reminderFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.get("/api/v1/tasks", session, async (context) => {
    const input = parseQuery(context, listSchema);
    if ("errors" in input) {
      return definedProblem(context, TASK_QUERY_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.tasks.list(actor, {
      ...(input.data.cursor ? { cursor: input.data.cursor } : {}),
      limit: input.data.limit,
      ...(input.data.personId ? { personId: input.data.personId } : {}),
      ...(input.data.status ? { status: input.data.status } : {}),
    }).catch(() => undefined);
    if (!result) {
      return definedProblem(context, TASKS_LIST_UNAVAILABLE);
    }
    if (result.status !== "ready") return taskFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.post("/api/v1/tasks", origin, session, async (context) => {
    const input = await parseJsonBody(context, createSchema);
    if ("errors" in input) {
      return definedProblem(context, TASK_FIELDS_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.tasks.create(actor, {
      ...(input.data.description
        ? { description: input.data.description }
        : {}),
      ...(input.data.dueAt ? { dueAt: input.data.dueAt } : {}),
      ...(input.data.personId ? { personId: input.data.personId } : {}),
      requestId: input.data.requestId,
      title: input.data.title,
    }).catch(() => undefined);
    if (!result) {
      return definedProblem(context, TASKS_NOTHING_SAVED);
    }
    if (result.status !== "created") return taskFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });

  routes.patch("/api/v1/tasks/:taskId", origin, session, async (context) => {
    const taskId = parseValue(id, context.req.param("taskId"));
    const input = await parseJsonBody(context, changeSchema);
    if ("errors" in taskId || "errors" in input) {
      return definedProblem(context, TASK_CHANGE_INVALID);
    }
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.tasks.change(
      actor,
      taskId.data,
      input.data as ChangeTaskInput,
    ).catch(() => undefined);
    if (!result) {
      return definedProblem(context, TASKS_NOTHING_CHANGED);
    }
    if (result.status !== "saved" && result.status !== "unchanged") {
      return taskFailure(context, result);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  routes.put(
    "/api/v1/tasks/:taskId/completion",
    origin,
    session,
    async (context) => {
      const taskId = parseValue(id, context.req.param("taskId"));
      const input = await parseJsonBody(context, completionSchema);
      if ("errors" in taskId || "errors" in input) {
        return definedProblem(context, TASK_COMPLETION_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await services.tasks.setCompletion(
        actor,
        taskId.data,
        input.data.completed,
      ).catch(() => undefined);
      if (!result) {
        return definedProblem(context, TASKS_NOTHING_CHANGED);
      }
      if (result.status !== "saved" && result.status !== "unchanged") {
        return taskFailure(context, result);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  routes.get("/api/v1/today/tasks", session, async (context) => {
    const actor = await requireActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.todayTasks.getDueTasks(actor).catch(() =>
      undefined
    );
    if (!result) {
      return definedProblem(context, TODAY_TASKS_UNAVAILABLE);
    }
    if (result.status !== "ready") return taskFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  return routes;
}
