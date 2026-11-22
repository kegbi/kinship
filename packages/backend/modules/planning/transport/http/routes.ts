/**
 * Tasks, reminders, cadences, and the Today regions built on them, over HTTP.
 *
 * Planning is the widest delivery surface in the API and the one with the most
 * to say when something is unavailable: each Today region degrades on its own,
 * and each write says whether anything was saved. Those sentences are the
 * reason the problem definitions below are named rather than inlined — they
 * are the contract the web app renders, and they are pinned in
 * `apps/api/failures_test.ts`.
 *
 * The problem responder, the session cookie, the origin check, and the kernel
 * status map came from `packages/http-kit` (GAP-019). The reminder routes still call the
 * origin check inside the handler rather than taking the middleware, because
 * a deployment without the reminders service answers "reminders unavailable"
 * before it looks at anything else, and that order is observable.
 *
 * MCP-B5 admits personal tokens on the reminder routes and the three planning
 * Today regions through `scopedRouteActor`. A reminder write still answers
 * the outage first. Then a cookie write answers its Origin, its body, and
 * only then its session, exactly the order it always had, while a bearer
 * write is admitted or refused before its body is read, as every token write
 * is: a refused token learns nothing about the payload it sent.
 */

import { type Context, Hono } from "hono";
import type {
  ChangeTaskInput,
  ReminderManagement,
  TaskManagement,
} from "../../public.ts";
import type {
  TodayAttention,
  TodayReminders,
  TodayTasks,
} from "../../../../read-models/today/public.ts";
import type { Notifications } from "../../../../read-models/notifications/public.ts";
import type { createProtectedSessionCoordinator } from "../../../workspaces/public.ts";
import { mountNotificationRoutes } from "./notifications.ts";
import {
  acknowledgeReminderOccurrence,
  changeTask,
  createReminder,
  createStayInTouchCadence,
  createTask,
  getTask,
  getTodayAttention,
  getTodayReminders,
  getTodayTasks,
  listPersonReminders,
  listPersonRemindersQuery,
  listTasks,
  listTasksQuery,
  setReminderActive,
  setTaskCompletion,
} from "../../../../../contracts/routes/planning.ts";
import {
  cadenceCreateInput,
  reminderActiveInput,
  reminderCreateInput,
  taskChangeInput,
  taskCompletionInput,
  taskCreateInput,
} from "../../../../../contracts/schemas/planning.ts";
import { uuid } from "../../../../../contracts/schemas/shared.ts";
import type { BrowserSecurityPolicy } from "../../../../../http-kit/security_policy.ts";
import {
  failureResponder,
  type FailureTable,
} from "../../../../../http-kit/failures.ts";
import { rejectForeignOrigin } from "../../../../../http-kit/origin.ts";
import {
  type PersonalTokenAuthority,
  scopedRouteActor,
} from "../../../../../http-kit/scoped_actor.ts";
import {
  definedProblem,
  type ProblemDefinition,
} from "../../../../../http-kit/problem.ts";
import { mount } from "../../../../../http-kit/route.ts";
import {
  type ActorEnv,
  requireActor,
  type SessionActor,
  sessionActor,
} from "../../../../../http-kit/session.ts";
import {
  parseJsonBody,
  parseQuery,
  parseValue,
} from "../../../../../http-kit/validate.ts";

type ProtectedSessions = ReturnType<typeof createProtectedSessionCoordinator>;

export interface PlanningHttpServices {
  readonly apiTokens?: PersonalTokenAuthority;
  readonly browserSecurity: BrowserSecurityPolicy;
  /** The member's notification feed (GAP-053); without it, 503. */
  readonly notifications?: Notifications;
  readonly protectedSessions: Pick<ProtectedSessions, "resolve">;
  readonly reminders?: ReminderManagement;
  readonly tasks: TaskManagement;
  readonly todayAttention?: TodayAttention;
  readonly todayTasks: TodayTasks;
  readonly todayReminders?: TodayReminders;
}

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
    stale: {
      code: "reminder_occurrence_stale",
      detail: "Only an undelivered reminder can be dismissed. Refresh Today.",
      status: 409,
      title: "Reminder changed",
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
  detail:
    "Use a canonical person identifier, a current page cursor, and a bounded limit.",
  status: 400,
  title: "Invalid reminder query",
};
/** The person a reminder listing names is not in the active workspace. */
const REMINDER_PERSON_NOT_FOUND: ProblemDefinition = {
  code: "person_not_found",
  detail: "No person with this identifier exists in the current workspace.",
  status: 404,
  title: "Person not found",
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
const REMINDER_OCCURRENCE_INVALID: ProblemDefinition = {
  code: "reminder_request_invalid",
  detail: "Use a canonical reminder occurrence.",
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
  REMINDER_OCCURRENCE_INVALID,
  REMINDER_PERSON_NOT_FOUND,
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
  const session = sessionActor(services);
  const tokens = {
    browserSecurity: services.browserSecurity,
    tokens: services.apiTokens,
  };
  const listTasksActor = scopedRouteActor(listTasks, tokens);
  const getTaskActor = scopedRouteActor(getTask, tokens);
  const createTaskActor = scopedRouteActor(createTask, tokens);
  const changeTaskActor = scopedRouteActor(changeTask, tokens);
  const completionActor = scopedRouteActor(setTaskCompletion, tokens);
  const personRemindersActor = scopedRouteActor(listPersonReminders, tokens);
  const createReminderActor = scopedRouteActor(createReminder, tokens);
  const reminderActiveActor = scopedRouteActor(setReminderActive, tokens);
  const cadenceActor = scopedRouteActor(createStayInTouchCadence, tokens);
  const attentionActor = scopedRouteActor(getTodayAttention, tokens);
  const todayRemindersActor = scopedRouteActor(getTodayReminders, tokens);
  const todayTasksActor = scopedRouteActor(getTodayTasks, tokens);
  /**
   * What a reminder write answers before its body: a bearer's admission, or
   * a cookie write's Origin refusal. Nothing means a cookie write that is
   * resolved after its body, where it always was.
   */
  const beforeBody = async (
    context: Context<ActorEnv>,
    admit: (context: Context<ActorEnv>) => Promise<SessionActor | Response>,
  ): Promise<SessionActor | Response | undefined> =>
    context.req.header("Authorization") === undefined
      ? rejectForeignOrigin(context, services.browserSecurity)
      : await admit(context);

  mount(routes, getTodayAttention, session, async (context) => {
    const actor = await attentionActor(context);
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

  mount(
    routes,
    listPersonReminders,
    session,
    async (context) => {
      const reminders = services.reminders;
      if (!reminders) {
        return definedProblem(context, REMINDERS_SECTION_UNAVAILABLE);
      }
      const personId = parseValue(uuid, context.req.param("personId"));
      const query = parseQuery(context, listPersonRemindersQuery);
      if ("errors" in personId || "errors" in query) {
        return definedProblem(context, REMINDER_QUERY_INVALID);
      }
      const actor = await personRemindersActor(context);
      if (actor instanceof Response) return actor;
      const result = await reminders.listPerson(actor, personId.data, {
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
        limit: query.data.limit,
      }).catch(() => undefined);
      if (!result) {
        return definedProblem(context, REMINDERS_SECTION_UNAVAILABLE);
      }
      if (result.status === "validation-error") {
        return definedProblem(context, REMINDER_QUERY_INVALID);
      }
      if (result.status === "not-found") {
        return definedProblem(context, REMINDER_PERSON_NOT_FOUND);
      }
      if (result.status !== "ready") return reminderFailure(context, result);
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(routes, createReminder, session, async (context) => {
    const reminders = services.reminders;
    if (!reminders) {
      return definedProblem(context, REMINDERS_NOTHING_SAVED);
    }
    const early = await beforeBody(context, createReminderActor);
    if (early instanceof Response) return early;
    const input = await parseJsonBody(context, reminderCreateInput);
    if ("errors" in input) {
      return definedProblem(context, REMINDER_CALENDAR_INVALID);
    }
    const actor = early ?? await createReminderActor(context);
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

  mount(routes, createStayInTouchCadence, session, async (context) => {
    const reminders = services.reminders;
    if (!reminders) {
      return definedProblem(context, REMINDERS_NOTHING_SAVED);
    }
    const early = await beforeBody(context, cadenceActor);
    if (early instanceof Response) return early;
    const input = await parseJsonBody(context, cadenceCreateInput);
    if ("errors" in input) {
      return definedProblem(context, CADENCE_REQUEST_INVALID);
    }
    const actor = early ?? await cadenceActor(context);
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

  mount(
    routes,
    setReminderActive,
    session,
    async (context) => {
      const reminders = services.reminders;
      if (!reminders) {
        return definedProblem(context, REMINDERS_NOTHING_CHANGED);
      }
      const early = await beforeBody(context, reminderActiveActor);
      if (early instanceof Response) return early;
      const reminderId = parseValue(uuid, context.req.param("reminderId"));
      const input = await parseJsonBody(context, reminderActiveInput);
      if ("errors" in reminderId || "errors" in input) {
        return definedProblem(context, REMINDER_ACTIVE_INVALID);
      }
      const actor = early ?? await reminderActiveActor(context);
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

  mount(
    routes,
    acknowledgeReminderOccurrence,
    session,
    async (context) => {
      const reminders = services.reminders;
      if (!reminders) {
        return definedProblem(context, REMINDERS_NOTHING_CHANGED);
      }
      const foreign = rejectForeignOrigin(context, services.browserSecurity);
      if (foreign) return foreign;
      const occurrenceId = parseValue(
        uuid,
        context.req.param("occurrenceId"),
      );
      if ("errors" in occurrenceId) {
        return definedProblem(context, REMINDER_OCCURRENCE_INVALID);
      }
      const actor = await requireActor(context);
      if (actor instanceof Response) return actor;
      const result = await reminders.acknowledgeOccurrence(
        actor,
        occurrenceId.data,
      ).catch(() => undefined);
      if (!result) {
        return definedProblem(context, REMINDERS_NOTHING_CHANGED);
      }
      if (result.status !== "acknowledged") {
        return reminderFailure(context, result);
      }
      context.header("Cache-Control", "private, no-store");
      return context.json(result);
    },
  );

  mount(routes, getTodayReminders, session, async (context) => {
    const todayReminders = services.todayReminders;
    if (!todayReminders) {
      return definedProblem(context, TODAY_REMINDERS_UNAVAILABLE);
    }
    const actor = await todayRemindersActor(context);
    if (actor instanceof Response) return actor;
    const result = await todayReminders.get(actor).catch(() => undefined);
    if (!result) {
      return definedProblem(context, TODAY_REMINDERS_UNAVAILABLE);
    }
    if (result.status !== "ready") return reminderFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(routes, listTasks, session, async (context) => {
    const input = parseQuery(context, listTasksQuery);
    if ("errors" in input) {
      return definedProblem(context, TASK_QUERY_INVALID);
    }
    const actor = await listTasksActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.tasks.list(actor, {
      ...(input.data.cursor ? { cursor: input.data.cursor } : {}),
      ...(input.data.dueBefore ? { dueBefore: input.data.dueBefore } : {}),
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

  mount(routes, getTask, session, async (context) => {
    const taskId = parseValue(uuid, context.req.param("taskId"));
    if ("errors" in taskId) return definedProblem(context, TASK_FIELDS_INVALID);
    const actor = await getTaskActor(context);
    if (actor instanceof Response) return actor;
    const result = await services.tasks.get(actor, taskId.data).catch(() =>
      undefined
    );
    if (!result) return definedProblem(context, TASKS_LIST_UNAVAILABLE);
    if (result.status !== "ready") return taskFailure(context, result);
    context.header("Cache-Control", "private, no-store");
    return context.json(result);
  });

  mount(routes, createTask, session, async (context) => {
    const actor = await createTaskActor(context);
    if (actor instanceof Response) return actor;
    const input = await parseJsonBody(context, taskCreateInput);
    if ("errors" in input) {
      return definedProblem(context, TASK_FIELDS_INVALID);
    }
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

  mount(routes, changeTask, session, async (context) => {
    const actor = await changeTaskActor(context);
    if (actor instanceof Response) return actor;
    const taskId = parseValue(uuid, context.req.param("taskId"));
    const input = await parseJsonBody(context, taskChangeInput);
    if ("errors" in taskId || "errors" in input) {
      return definedProblem(context, TASK_CHANGE_INVALID);
    }
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

  mount(
    routes,
    setTaskCompletion,
    session,
    async (context) => {
      const actor = await completionActor(context);
      if (actor instanceof Response) return actor;
      const taskId = parseValue(uuid, context.req.param("taskId"));
      const input = await parseJsonBody(context, taskCompletionInput);
      if ("errors" in taskId || "errors" in input) {
        return definedProblem(context, TASK_COMPLETION_INVALID);
      }
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

  mount(routes, getTodayTasks, session, async (context) => {
    const actor = await todayTasksActor(context);
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

  mountNotificationRoutes(routes, session, services.notifications);

  return routes;
}
