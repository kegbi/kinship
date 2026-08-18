import { type Context, Hono } from "hono";
import { z } from "zod";
import type {
  ChangeTaskInput,
  ReminderManagement,
  TaskManagement,
} from "../../packages/backend/modules/planning/public.ts";
import type {
  TodayReminders,
  TodayTasks,
} from "../../packages/backend/read-models/today/public.ts";
import type { createProtectedSessionCoordinator } from "../../packages/backend/modules/workspaces/public.ts";
import type { BrowserSecurityPolicy } from "./security_config.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface PlanningHttpServices {
  readonly browserSecurity: BrowserSecurityPolicy;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly reminders?: ReminderManagement;
  readonly tasks: TaskManagement;
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

function problem(
  context: Context,
  status: 400 | 401 | 403 | 404 | 409 | 503,
  code: string,
  title: string,
  detail: string,
  errors?: Readonly<Record<string, string>>,
) {
  return context.body(
    JSON.stringify({
      type: `https://kinship.test/problems/${code}`,
      title,
      status,
      detail,
      code,
      ...(errors ? { errors } : {}),
    }),
    status,
    {
      "Cache-Control": "no-store",
      "Content-Type": "application/problem+json",
    },
  );
}

function cookieValue(header: string | undefined, name: string) {
  return header?.split(";").map((value) => value.trim()).find((value) =>
    value.startsWith(`${name}=`)
  )?.slice(name.length + 1);
}

async function actor(context: Context, services: PlanningHttpServices) {
  const sessionToken = cookieValue(
    context.req.header("Cookie"),
    "kinship_session",
  );
  if (!sessionToken) return undefined;
  const requestedWorkspaceId = context.req.header("X-Workspace-Id");
  const resolved = await services.protectedSessions.resolve({
    sessionToken,
    ...(requestedWorkspaceId ? { requestedWorkspaceId } : {}),
  }).catch(() => undefined);
  return resolved && {
    memberId: resolved.memberId,
    role: resolved.role,
    userId: resolved.userId,
    workspaceId: resolved.workspaceId,
  };
}

function authenticationRequired(context: Context) {
  return problem(
    context,
    401,
    "session_invalid",
    "Authentication required",
    "Sign in with an active workspace membership.",
  );
}

function mutationFailure(
  context: Context,
  result: {
    readonly errors?: Readonly<Record<string, string>>;
    readonly status: string;
  },
) {
  if (result.status === "forbidden") {
    return problem(
      context,
      403,
      "tasks_forbidden",
      "Tasks unavailable",
      "Your active workspace membership no longer permits this action.",
    );
  }
  if (result.status === "not-found") {
    return problem(
      context,
      404,
      "task_not_found",
      "Task unavailable",
      "The task or linked person does not exist in the active workspace.",
    );
  }
  if (result.status === "archived-write-rejected") {
    return problem(
      context,
      409,
      "archived_write_rejected",
      "Archived person is read-only",
      "Restore the linked person before changing this task.",
    );
  }
  if (result.status === "stale") {
    return problem(
      context,
      409,
      "task_stale",
      "Task changed",
      "Refresh the task before saving your edits.",
    );
  }
  if (result.status === "stale-cursor") {
    return problem(
      context,
      409,
      "task_cursor_stale",
      "Task list changed",
      "Reload the first task page before continuing.",
    );
  }
  if (result.status === "idempotency-conflict") {
    return problem(
      context,
      409,
      "task_request_conflict",
      "Request identifier already used",
      "Use a new request identifier when the task payload changes.",
    );
  }
  return problem(
    context,
    400,
    "task_validation_failed",
    "Invalid task",
    "Review the task fields and try again.",
    result.errors,
  );
}

function reminderFailure(
  context: Context,
  result: {
    readonly errors?: Readonly<Record<string, string>>;
    readonly status: string;
  },
) {
  if (result.status === "forbidden") {
    return problem(
      context,
      403,
      "reminders_forbidden",
      "Reminders unavailable",
      "Your active membership no longer permits this action.",
    );
  }
  if (result.status === "not-found") {
    return problem(
      context,
      404,
      "reminder_not_found",
      "Reminder unavailable",
      "The reminder or person does not exist in the active workspace.",
    );
  }
  if (result.status === "archived-write-rejected") {
    return problem(
      context,
      409,
      "archived_write_rejected",
      "Archived person is read-only",
      "Restore the person before changing reminders.",
    );
  }
  if (result.status === "idempotency-conflict") {
    return problem(
      context,
      409,
      "reminder_request_conflict",
      "Request identifier already used",
      "Use a new request identifier when reminder fields change.",
    );
  }
  return problem(
    context,
    400,
    "reminder_validation_failed",
    "Invalid reminder",
    "Review the calendar reminder fields.",
    result.errors,
  );
}

function validOrigin(context: Context, services: PlanningHttpServices) {
  return context.req.header("Origin") === services.browserSecurity.origin;
}

function originFailure(context: Context) {
  return problem(
    context,
    403,
    "origin_invalid",
    "Request forbidden",
    "This request did not come from the configured application origin.",
  );
}

export function createPlanningRoutes(services: PlanningHttpServices): Hono {
  const routes = new Hono();
  routes.get("/api/v1/people/:personId/reminders", async (context) => {
    if (!services.reminders) {
      return problem(
        context,
        503,
        "reminders_unavailable",
        "Reminders unavailable",
        "Other person sections remain available.",
      );
    }
    const personId = id.safeParse(context.req.param("personId"));
    if (!personId.success) {
      return problem(
        context,
        400,
        "reminder_query_invalid",
        "Invalid reminder query",
        "Use a canonical person identifier.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.reminders.listPerson(resolved, personId.data)
      .catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "reminders_unavailable",
        "Reminders unavailable",
        "Other person sections remain available.",
      );
    }
    if (result.status !== "ready") return reminderFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.post("/api/v1/reminders", async (context) => {
    if (!services.reminders) {
      return problem(
        context,
        503,
        "reminders_unavailable",
        "Reminders unavailable",
        "Nothing was saved.",
      );
    }
    if (!validOrigin(context, services)) return originFailure(context);
    const input = reminderSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!input.success) {
      return problem(
        context,
        400,
        "reminder_request_invalid",
        "Invalid reminder",
        "Use supported calendar fields and canonical identifiers.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.reminders.createReminder(resolved, input.data)
      .catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "reminders_unavailable",
        "Reminders unavailable",
        "Nothing was saved.",
      );
    }
    if (result.status !== "created") return reminderFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });
  routes.post("/api/v1/stay-in-touch-cadences", async (context) => {
    if (!services.reminders) {
      return problem(
        context,
        503,
        "reminders_unavailable",
        "Reminders unavailable",
        "Nothing was saved.",
      );
    }
    if (!validOrigin(context, services)) return originFailure(context);
    const input = cadenceSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!input.success) {
      return problem(
        context,
        400,
        "cadence_request_invalid",
        "Invalid stay-in-touch cadence",
        "Use a supported calendar interval.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.reminders.createCadence(resolved, input.data)
      .catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "reminders_unavailable",
        "Reminders unavailable",
        "Nothing was saved.",
      );
    }
    if (result.status !== "created") return reminderFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });
  routes.put("/api/v1/reminders/:reminderId/active", async (context) => {
    if (!services.reminders) {
      return problem(
        context,
        503,
        "reminders_unavailable",
        "Reminders unavailable",
        "Nothing was changed.",
      );
    }
    if (!validOrigin(context, services)) return originFailure(context);
    const reminderId = id.safeParse(context.req.param("reminderId"));
    const input = activeSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!reminderId.success || !input.success) {
      return problem(
        context,
        400,
        "reminder_request_invalid",
        "Invalid reminder",
        "Use a canonical reminder and explicit active state.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.reminders.setActive(
      resolved,
      reminderId.data,
      input.data.active,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "reminders_unavailable",
        "Reminders unavailable",
        "Nothing was changed.",
      );
    }
    if (result.status !== "saved") return reminderFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.get("/api/v1/today/reminders", async (context) => {
    if (!services.todayReminders) {
      return problem(
        context,
        503,
        "today_reminders_unavailable",
        "Reminder region unavailable",
        "Other Today regions remain available.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.todayReminders.get(resolved).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "today_reminders_unavailable",
        "Reminder region unavailable",
        "Other Today regions remain available.",
      );
    }
    if (result.status !== "ready") return reminderFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.get("/api/v1/tasks", async (context) => {
    const input = listSchema.safeParse(context.req.query());
    if (!input.success) {
      return problem(
        context,
        400,
        "task_query_invalid",
        "Invalid task query",
        "Use a canonical person, supported state, and bounded limit.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.tasks.list(resolved, {
      ...(input.data.cursor ? { cursor: input.data.cursor } : {}),
      limit: input.data.limit,
      ...(input.data.personId ? { personId: input.data.personId } : {}),
      ...(input.data.status ? { status: input.data.status } : {}),
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "tasks_unavailable",
        "Tasks unavailable",
        "Saved tasks were not changed.",
      );
    }
    if (result.status !== "ready") return mutationFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.post("/api/v1/tasks", async (context) => {
    if (!validOrigin(context, services)) return originFailure(context);
    const input = createSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!input.success) {
      return problem(
        context,
        400,
        "task_request_invalid",
        "Invalid task",
        "Use supported task fields and canonical identifiers.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.tasks.create(resolved, {
      ...(input.data.description
        ? { description: input.data.description }
        : {}),
      ...(input.data.dueAt ? { dueAt: input.data.dueAt } : {}),
      ...(input.data.personId ? { personId: input.data.personId } : {}),
      requestId: input.data.requestId,
      title: input.data.title,
    }).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "tasks_unavailable",
        "Tasks unavailable",
        "Nothing was saved. Try again when the service is available.",
      );
    }
    if (result.status !== "created") return mutationFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result, 201);
  });
  routes.patch("/api/v1/tasks/:taskId", async (context) => {
    if (!validOrigin(context, services)) return originFailure(context);
    const taskId = id.safeParse(context.req.param("taskId"));
    const input = changeSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!taskId.success || !input.success) {
      return problem(
        context,
        400,
        "task_request_invalid",
        "Invalid task",
        "Use a canonical task and at least one supported change.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.tasks.change(
      resolved,
      taskId.data,
      input.data as ChangeTaskInput,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "tasks_unavailable",
        "Tasks unavailable",
        "Nothing was changed.",
      );
    }
    if (result.status !== "saved" && result.status !== "unchanged") {
      return mutationFailure(context, result);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.put("/api/v1/tasks/:taskId/completion", async (context) => {
    if (!validOrigin(context, services)) return originFailure(context);
    const taskId = id.safeParse(context.req.param("taskId"));
    const input = completionSchema.safeParse(
      await context.req.json().catch(() => undefined),
    );
    if (!taskId.success || !input.success) {
      return problem(
        context,
        400,
        "task_request_invalid",
        "Invalid task",
        "Use a canonical task and explicit completion state.",
      );
    }
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.tasks.setCompletion(
      resolved,
      taskId.data,
      input.data.completed,
    ).catch(() => undefined);
    if (!result) {
      return problem(
        context,
        503,
        "tasks_unavailable",
        "Tasks unavailable",
        "Nothing was changed.",
      );
    }
    if (result.status !== "saved" && result.status !== "unchanged") {
      return mutationFailure(context, result);
    }
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  routes.get("/api/v1/today/tasks", async (context) => {
    const resolved = await actor(context, services);
    if (!resolved) return authenticationRequired(context);
    const result = await services.todayTasks.getDueTasks(resolved).catch(() =>
      undefined
    );
    if (!result) {
      return problem(
        context,
        503,
        "today_tasks_unavailable",
        "Due tasks unavailable",
        "Other Today regions remain available.",
      );
    }
    if (result.status !== "ready") return mutationFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });
  return routes;
}
