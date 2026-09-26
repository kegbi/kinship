/**
 * The task surface's pure half (GAP-031): how a task reads, which list it
 * sits in, what an editor's values send, and the one reducer the surface's
 * state moves through. One surface serves both the person tasks card and
 * the `/app/tasks` page; the page adds its filters and the people a task
 * can be linked to. Nothing here touches the DOM.
 */

import type {
  Task,
  TaskChangeInput,
  TaskCreateInput,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatInstant,
  type TimePreferences,
} from "../../lib/time-presentation.ts";

/**
 * The document event a task write sends on `globalThis`, without a payload,
 * so other surfaces refresh what they show about tasks.
 */
export const TASK_CHANGED_EVENT = "kinship:task-changed";

/** The largest page the task contract serves, which is what this surface asks for. */
export const TASK_PAGE_SIZE = 50;

// --- How a task reads -------------------------------------------------------

/** "Due …" in the member's time zone, or that there is no due time. */
export function dueText(
  value: string | undefined,
  preferences: TimePreferences | undefined,
): string {
  return value ? `Due ${formatInstant(value, preferences)}` : "No due time";
}

/** The line under a task's title: when it is due and whom it concerns. */
export function taskMeta(
  task: Task,
  preferences: TimePreferences | undefined,
): string {
  const person = task.person
    ? ` · ${task.person.name}${
      task.person.archived && !task.person.unavailable ? " (archived)" : ""
    }`
    : " · Workspace task";
  return `${dueText(task.dueAt, preferences)}${person}`;
}

/** The value a `datetime-local` field shows for an instant, in local time. */
export function localDateTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** The surface's status line over a loaded view. */
export function taskCount(count: number): string {
  return count === 0
    ? "No tasks in this view."
    : `${count} task${count === 1 ? "" : "s"}.`;
}

export type TaskColumn = Task["status"];

/**
 * The tasks each column shows. A task being completed or reopened already
 * shows in the column it is moving to, after the tasks there.
 */
export function taskColumns(
  tasks: readonly Task[],
  moving: Readonly<Record<string, TaskColumn>>,
): Readonly<Record<TaskColumn, readonly Task[]>> {
  const columns: Record<TaskColumn, Task[]> = {
    cancelled: [],
    completed: [],
    open: [],
  };
  const moved: Record<TaskColumn, Task[]> = {
    cancelled: [],
    completed: [],
    open: [],
  };
  for (const task of tasks) {
    const to = moving[task.id];
    if (to) moved[to].push(task);
    else columns[task.status].push(task);
  }
  return {
    cancelled: [...columns.cancelled, ...moved.cancelled],
    completed: [...columns.completed, ...moved.completed],
    open: [...columns.open, ...moved.open],
  };
}

/** Whether a task's row offers its controls. */
export function taskMutable(task: Task, archived: boolean): boolean {
  return !archived && task.person?.archived !== true;
}

// --- People a task can name -------------------------------------------------

export interface PersonChoice {
  readonly id: string;
  readonly name: string;
}

/** A directory person's name as a choice reads it. */
export function directoryName(
  person: { readonly givenName?: string; readonly familyName?: string },
): string {
  return [person.givenName, person.familyName].filter(Boolean).join(" ") ||
    "Unnamed person";
}

function withChoices(
  choices: readonly PersonChoice[],
  added: readonly PersonChoice[],
): readonly PersonChoice[] {
  const known = new Set(choices.map((choice) => choice.id));
  const next = [...choices];
  for (const choice of added) {
    if (known.has(choice.id)) continue;
    known.add(choice.id);
    next.push(choice);
  }
  return next;
}

// --- What an editor sends ---------------------------------------------------

export interface TaskFormValues {
  readonly title: string;
  readonly description: string;
  /** The `datetime-local` value, in local time. */
  readonly dueAt: string;
  readonly personId: string;
  readonly status: string;
}

function instant(value: string): string | undefined {
  return value ? new Date(value).toISOString() : undefined;
}

/** The request a new task's values make; blank text is left out. */
export function createInput(
  values: TaskFormValues,
  personId: string | undefined,
  requestId: string,
): TaskCreateInput {
  const description = values.description.trim();
  const dueAt = instant(values.dueAt.trim());
  const person = personId ?? (values.personId.trim() || undefined);
  return {
    ...(description ? { description } : {}),
    ...(dueAt ? { dueAt } : {}),
    ...(person ? { personId: person } : {}),
    requestId,
    title: values.title.trim(),
  };
}

/**
 * The change an edited task's values make. The due time is sent only when
 * the reader changed it, so a title edit keeps its exact precision; the
 * person only on the tasks page, where it can be chosen; and a completed
 * task left "open" keeps its completion, since only Reopen reopens it.
 */
export function changeInput(
  values: TaskFormValues,
  task: Task,
  options: { readonly dueChanged: boolean; readonly personFixed: boolean },
): TaskChangeInput {
  const description = values.description.trim();
  const status = values.status.trim() === "cancelled" ? "cancelled" : "open";
  return {
    description: description || null,
    ...(options.dueChanged
      ? { dueAt: instant(values.dueAt.trim()) ?? null }
      : {}),
    expectedUpdatedAt: task.updatedAt,
    ...(options.personFixed
      ? {}
      : { personId: values.personId.trim() || null }),
    ...(task.status === "completed" && status === "open" ? {} : { status }),
    title: values.title.trim(),
  };
}

// --- The surface's state ----------------------------------------------------

/**
 * Where the surface stands: `context` while it resolves the workspace, time
 * preferences, and people it needs; `unavailable` when the session could not
 * be resolved; then the list's own status.
 */
export type TaskStatus =
  | "context"
  | "unavailable"
  | "loading"
  | "ready"
  | "error";

export type TaskFocus = "title" | "add";

export interface TaskEditor {
  /** Bumped on every open, so the fields start from the opened task. */
  readonly generation: number;
  /** The task being edited; absent for a new one. */
  readonly task?: Task;
  /** A new task's idempotency key, reused when a save's outcome is unknown. */
  readonly requestId?: string;
  /** Whether the reader changed the due time. */
  readonly dueChanged: boolean;
}

export interface TaskFilters {
  readonly status: string;
  readonly personId: string;
}

export interface TaskState {
  readonly status: TaskStatus;
  /** The workspace the surface reads, once resolved. */
  readonly workspaceId?: string;
  /** The member's time presentation, when it loaded. */
  readonly preferences?: TimePreferences;
  readonly tasks: readonly Task[];
  readonly nextCursor?: string;
  readonly archived: boolean;
  readonly filters: TaskFilters;
  /** The people a task can be linked to: active directory people. */
  readonly formChoices: readonly PersonChoice[];
  /** The people the filter offers, including ones only past tasks name. */
  readonly filterChoices: readonly PersonChoice[];
  readonly peopleCursor?: string;
  readonly editor?: TaskEditor;
  /** Whether a save holds the editor. */
  readonly saving: boolean;
  /** The editor's status line. */
  readonly notice?: string;
  /** Tasks being completed or reopened, and the column each moves to. */
  readonly moving: Readonly<Record<string, TaskColumn>>;
  readonly focus?: { readonly target: TaskFocus; readonly tick: number };
}

export type TaskAction =
  | {
    readonly type: "context";
    readonly workspaceId: string;
    readonly preferences?: TimePreferences | undefined;
    readonly people?: readonly PersonChoice[];
    readonly peopleCursor?: string | undefined;
  }
  | { readonly type: "unavailable" }
  | {
    readonly type: "people";
    readonly people: readonly PersonChoice[];
    readonly peopleCursor?: string | undefined;
  }
  | { readonly type: "loading"; readonly reset: boolean }
  | {
    readonly type: "loaded";
    readonly tasks: readonly Task[];
    readonly reset: boolean;
    readonly nextCursor?: string | undefined;
  }
  | { readonly type: "failed" }
  | { readonly type: "filter"; readonly filters: TaskFilters }
  | { readonly type: "lifecycle"; readonly archived: boolean }
  | {
    readonly type: "open";
    readonly task?: Task;
    readonly requestId?: string;
  }
  | { readonly type: "close"; readonly focus?: boolean }
  | { readonly type: "due-changed" }
  | { readonly type: "notice"; readonly notice: string }
  | { readonly type: "saving"; readonly saving: boolean }
  | { readonly type: "saved"; readonly notice: string }
  | { readonly type: "move"; readonly taskId: string; readonly to: TaskColumn }
  | { readonly type: "settle"; readonly taskId: string };

export const ARCHIVED_NOTICE =
  "Archived people are readable; restore this person before changing tasks.";

export function initialTaskState(archived: boolean): TaskState {
  return {
    archived,
    filterChoices: [],
    filters: { personId: "", status: "" },
    formChoices: [],
    moving: {},
    saving: false,
    status: "context",
    tasks: [],
    ...(archived ? { notice: ARCHIVED_NOTICE } : {}),
  };
}

function focus(
  state: TaskState,
  target: TaskFocus,
): { readonly target: TaskFocus; readonly tick: number } {
  return { target, tick: (state.focus?.tick ?? 0) + 1 };
}

function without<K extends keyof TaskState>(
  state: TaskState,
  key: K,
): TaskState {
  const { [key]: _removed, ...rest } = state;
  return rest as TaskState;
}

/** The tasks of a page merged into those on screen, each once. */
function merged(
  current: readonly Task[],
  page: readonly Task[],
  reset: boolean,
): readonly Task[] {
  if (reset) return page;
  const known = new Set(current.map((task) => task.id));
  return [...current, ...page.filter((task) => !known.has(task.id))];
}

export function taskReducer(state: TaskState, action: TaskAction): TaskState {
  switch (action.type) {
    case "context":
    case "people": {
      const people = action.people ?? [];
      const next = {
        ...without(state, "peopleCursor"),
        filterChoices: withChoices(state.filterChoices, people),
        formChoices: withChoices(state.formChoices, people),
        ...(action.peopleCursor ? { peopleCursor: action.peopleCursor } : {}),
      };
      if (action.type === "people") return next;
      return {
        ...next,
        status: "loading",
        workspaceId: action.workspaceId,
        ...(action.preferences ? { preferences: action.preferences } : {}),
      };
    }
    case "unavailable":
      return { ...state, status: "unavailable" };
    case "loading":
      return {
        ...(action.reset ? without(state, "nextCursor") : state),
        status: "loading",
      };
    case "loaded": {
      const people = action.tasks.flatMap((task) =>
        task.person ? [{ id: task.person.id, name: task.person.name }] : []
      );
      const linkable = action.tasks.flatMap((task) =>
        task.person && !task.person.archived && !task.person.unavailable
          ? [{ id: task.person.id, name: task.person.name }]
          : []
      );
      return {
        ...without(state, "nextCursor"),
        filterChoices: withChoices(state.filterChoices, people),
        formChoices: state.archived
          ? state.formChoices
          : withChoices(state.formChoices, linkable),
        status: "ready",
        tasks: merged(state.tasks, action.tasks, action.reset),
        ...(action.nextCursor ? { nextCursor: action.nextCursor } : {}),
      };
    }
    case "failed":
      return { ...state, status: "error" };
    case "filter":
      return { ...state, filters: action.filters };
    case "lifecycle": {
      if (!action.archived) return { ...state, archived: false };
      return {
        ...without(state, "editor"),
        archived: true,
        notice: ARCHIVED_NOTICE,
      };
    }
    case "open":
      return {
        ...state,
        editor: {
          dueChanged: false,
          generation: (state.editor?.generation ?? 0) + 1,
          ...(action.task ? { task: action.task } : {}),
          ...(action.requestId ? { requestId: action.requestId } : {}),
        },
        focus: focus(state, "title"),
      };
    case "close": {
      const next = without(state, "editor");
      return action.focus ? { ...next, focus: focus(state, "add") } : next;
    }
    case "due-changed":
      return state.editor
        ? { ...state, editor: { ...state.editor, dueChanged: true } }
        : state;
    case "notice":
      return { ...state, notice: action.notice };
    case "saving":
      return { ...state, saving: action.saving };
    case "saved":
      return { ...without(state, "editor"), notice: action.notice };
    case "move":
      return {
        ...state,
        moving: { ...state.moving, [action.taskId]: action.to },
      };
    case "settle": {
      const { [action.taskId]: _settled, ...moving } = state.moving;
      return { ...state, moving };
    }
  }
}
