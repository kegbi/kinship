/**
 * Tasks, reminders, and the day's plan, over fetch.
 *
 * Every shape these functions take and return is the one the document
 * publishes; what is written here is only how a caller spells the call.
 */

import type { ApiResult } from "./request.ts";
import { pageQuery, request } from "./request.ts";
import { parseTodayAttention, parseTodayReminders } from "./today.ts";
import type {
  CadenceCreateInput,
  PageInput,
  PersonReminders,
  Reminder,
  ReminderCreateInput,
  StayInTouchCadence,
  Task,
  TaskChangeInput,
  TaskCreateInput,
  TaskList,
  TodayAttention,
  TodayReminders,
} from "./types.ts";

export function listTasks(
  input: {
    readonly cursor?: string;
    readonly limit?: number;
    readonly personId?: string;
    readonly status?: Task["status"];
  } = {},
  workspaceId?: string,
): Promise<ApiResult<TaskList>> {
  const suffix = pageQuery(input, {
    personId: input.personId,
    status: input.status,
  });
  return request(`/api/v1/tasks${suffix}`, {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

export function createTask(
  input: TaskCreateInput,
  workspaceId?: string,
): Promise<ApiResult<{ readonly status: "created"; readonly task: Task }>> {
  return request("/api/v1/tasks", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function changeTask(
  taskId: string,
  input: TaskChangeInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "saved" | "unchanged"; readonly task: Task }>
> {
  return request(`/api/v1/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function setTaskCompletion(
  taskId: string,
  completed: boolean,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly status: "saved" | "unchanged"; readonly task: Task }>
> {
  return request(`/api/v1/tasks/${encodeURIComponent(taskId)}/completion`, {
    method: "PUT",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify({ completed }),
  });
}

export function getTodayTasks(
  workspaceId?: string,
): Promise<ApiResult<TaskList>> {
  return request("/api/v1/today/tasks", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  });
}

/**
 * One page of a person's reminders, with the person's cadence.
 *
 * The page argument trails the workspace so the two-argument call every
 * caller already made keeps its meaning; a first page names neither.
 */
export function listPersonReminders(
  personId: string,
  workspaceId?: string,
  input: PageInput = {},
): Promise<ApiResult<PersonReminders>> {
  return request(
    `/api/v1/people/${encodeURIComponent(personId)}/reminders${
      pageQuery(input)
    }`,
    { headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined },
  );
}

export function createReminder(
  input: ReminderCreateInput,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly reminder: Reminder; readonly status: "created" }>
> {
  return request("/api/v1/reminders", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function createStayInTouchCadence(
  input: CadenceCreateInput,
  workspaceId?: string,
): Promise<
  ApiResult<
    { readonly cadence: StayInTouchCadence; readonly status: "created" }
  >
> {
  return request("/api/v1/stay-in-touch-cadences", {
    method: "POST",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify(input),
  });
}

export function setReminderActive(
  reminderId: string,
  active: boolean,
  workspaceId?: string,
): Promise<
  ApiResult<{ readonly reminder: Reminder; readonly status: "saved" }>
> {
  return request(`/api/v1/reminders/${encodeURIComponent(reminderId)}/active`, {
    method: "PUT",
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
    body: JSON.stringify({ active }),
  });
}

export function getTodayReminders(
  workspaceId?: string,
): Promise<ApiResult<TodayReminders>> {
  return request<unknown>("/api/v1/today/reminders", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  }).then((result): ApiResult<TodayReminders> =>
    result.ok ? { ok: true, value: parseTodayReminders(result.value) } : result
  );
}

export function getTodayAttention(
  workspaceId?: string,
): Promise<ApiResult<TodayAttention>> {
  return request<unknown>("/api/v1/today/attention", {
    headers: workspaceId ? { "X-Workspace-Id": workspaceId } : undefined,
  }).then((result): ApiResult<TodayAttention> =>
    result.ok ? { ok: true, value: parseTodayAttention(result.value) } : result
  );
}
