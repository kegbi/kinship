/**
 * The task surface as one island (GAP-031): the person tasks card and the
 * `/app/tasks` page are the same component in two variants. The person card
 * lists one person's tasks; the page lists the workspace's, with filters by
 * state and person and an editor that can link a task to anyone in the
 * directory.
 *
 * Its state moves through one pure reducer (`tasks.ts`). It has two read
 * slots, never more: one for the context it needs before anything else —
 * the workspace, when the page must resolve it from the session, the time
 * preferences, and the directory's pages of people — and one for every read
 * of the task list, so only the latest list answer lands. Saves are never
 * optimistic: a save refreshes the list and only then shows it. Completing
 * or reopening a task moves its row at once, busy, and puts it back exactly
 * where it was if the server refuses.
 *
 * Every write tells other surfaces through `TASK_CHANGED_EVENT`. Every
 * control renders with its handler attached; Add task stays disabled until
 * the surface knows the workspace it writes to.
 */

import {
  type ReactNode,
  type SyntheticEvent,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  changeTask,
  createTask,
  listPeople,
  listTasks,
  setTaskCompletion,
  type Task,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { formActionsVariants } from "@/components/ui/variants.ts";
import {
  LoadMore,
  mountIsland,
  settle,
  useDocumentEvent,
  useLatestRequest,
} from "../../islands/core/index.ts";
import {
  loadTimePreferences,
  type TimePreferences,
} from "../../lib/time-presentation.ts";
import {
  markFormSaved,
  saveWithLockedForm,
} from "../../lib/unsaved-changes.ts";
import { resolveWorkspaceSession } from "../../lib/workspace-context.ts";
import { sectionHidden, type SectionMount } from "../person/section-mounts.ts";
import {
  statusRegion,
  type StatusRegionProps,
} from "../person/status-region.ts";
import {
  changeInput,
  createInput,
  directoryName,
  initialTaskState,
  localDateTime,
  type PersonChoice,
  TASK_CHANGED_EVENT,
  TASK_PAGE_SIZE,
  taskColumns,
  taskCount,
  type TaskEditor,
  type TaskFilters,
  type TaskFormValues,
  taskMeta,
  taskMutable,
  taskReducer,
} from "./tasks.ts";

export const PERSON_TASKS_ISLAND = "person-tasks";
export const TASKS_PAGE_ISLAND = "tasks-page";

export interface TaskSurfaceProps {
  /** The person card, or the workspace's tasks page. */
  readonly variant: "person" | "page";
  /** The person whose tasks the card lists. */
  readonly personId?: string | undefined;
  /** The workspace, when the page already knows it. */
  readonly workspaceId?: string | undefined;
  readonly archived: boolean;
  readonly timePreferences?: TimePreferences | undefined;
  /** The person section the card renders into; it carries the section state. */
  readonly section?: HTMLElement | undefined;
  /** The heading Add task renders into. */
  readonly heading?: HTMLElement | undefined;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
  /**
   * What the person card's state lines spread to be live regions, if
   * anything; the page's lines always are.
   */
  readonly statusRegion?: StatusRegionProps | undefined;
}

const UNAVAILABLE = "Tasks are unavailable. Sign in again or retry.";
const FAILED = "Tasks could not be loaded. Saved tasks are unchanged.";
const LOADING = "Loading tasks…";
const PEOPLE_PAGE = 50;

/** The workspace, preferences, and first people the surface needs first. */
interface Context {
  readonly workspaceId: string;
  readonly preferences?: TimePreferences | undefined;
  readonly people?: readonly PersonChoice[];
  readonly peopleCursor?: string | undefined;
}

function announceTaskChange(): void {
  globalThis.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT));
}

export function TaskSurface(props: TaskSurfaceProps) {
  const { personId, section, variant } = props;
  const page = variant === "page";
  const [state, dispatch] = useReducer(
    taskReducer,
    props.archived,
    initialTaskState,
  );
  const contextRequest = useLatestRequest();
  const listRequest = useLatestRequest();
  const form = useRef<HTMLFormElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const saving = useRef(false);
  const settled = useRef(props.onSettled);
  // What the list reads with, as it stands when a read starts: a refresh a
  // write asks for honours a filter the reader changed while it was in flight.
  const reading = useRef<{
    filters: TaskFilters;
    workspaceId: string | undefined;
  }>({ filters: state.filters, workspaceId: props.workspaceId });

  /** Reads the list, from its start or continuing after `cursor`. */
  const load = (
    reset: boolean,
    options: { readonly cursor?: string } = {},
  ): Promise<void> => {
    const { filters, workspaceId } = reading.current;
    const filterPerson = personId ?? (filters.personId || undefined);
    dispatch({ reset, type: "loading" });
    return listRequest(() =>
      listTasks({
        ...(!reset && options.cursor ? { cursor: options.cursor } : {}),
        limit: TASK_PAGE_SIZE,
        ...(filterPerson ? { personId: filterPerson } : {}),
        ...(filters.status ? { status: filters.status as Task["status"] } : {}),
      }, workspaceId)
    ).then((answer) => {
      if (!answer) return;
      if (answer.status !== "ready" || !answer.data) {
        dispatch({ type: "failed" });
        return;
      }
      dispatch({
        nextCursor: answer.data.nextCursor,
        reset,
        tasks: answer.data.items,
        type: "loaded",
      });
    });
  };

  /** Resolves what the surface needs, then reads the first page. */
  const start = async (): Promise<void> => {
    const answer = await contextRequest<Context>(async () => {
      let workspaceId = props.workspaceId;
      let preferences = props.timePreferences;
      if (!workspaceId) {
        const session = await resolveWorkspaceSession();
        if (session.status !== "ready") throw new Error("No session");
        workspaceId = session.session.workspace.id;
        preferences ??= session.session.preferences;
      } else {
        preferences ??= await loadTimePreferences(workspaceId);
      }
      const directory = page
        ? await settle(() => listPeople({ limit: PEOPLE_PAGE }, workspaceId))
        : undefined;
      return {
        ok: true,
        value: {
          preferences,
          workspaceId,
          ...(directory?.data
            ? {
              people: directory.data.people.map((person) => ({
                id: person.id,
                name: directoryName(person),
              })),
              peopleCursor: directory.data.nextCursor,
            }
            : {}),
        },
      };
    });
    if (!answer) return;
    if (!answer.data) {
      dispatch({ type: "unavailable" });
      return;
    }
    reading.current.workspaceId = answer.data.workspaceId;
    dispatch({ ...answer.data, type: "context" });
    await load(true);
  };

  const first = useEffectEvent(() => start());
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  useLayoutEffect(() => {
    if (!section) return;
    const status = state.status;
    section.setAttribute(
      "data-section-state",
      status === "ready" || status === "error" ? status : "loading",
    );
  }, [section, state.status]);

  useLayoutEffect(() => {
    const target = state.focus?.target;
    if (target === "add") addButton.current?.focus();
    else if (target === "title") {
      form.current?.querySelector<HTMLElement>("[name=title]")?.focus();
    }
  }, [state.focus]);

  useDocumentEvent<
    CustomEvent<{ readonly archived?: unknown; readonly personId?: unknown }>
  >("person-lifecycle-changed", (event) => {
    const detail = event.detail;
    if (detail?.personId !== personId || typeof detail.archived !== "boolean") {
      return;
    }
    dispatch({ archived: detail.archived, type: "lifecycle" });
    void load(true);
  });

  const retry = () => {
    if (state.status === "unavailable") void start();
    else void load(true);
  };

  const morePeople = async () => {
    const cursor = state.peopleCursor;
    if (!cursor) return;
    const answer = await contextRequest(() =>
      listPeople({ cursor, limit: PEOPLE_PAGE }, reading.current.workspaceId)
    );
    if (!answer?.data) return;
    dispatch({
      people: answer.data.people.map((person) => ({
        id: person.id,
        name: directoryName(person),
      })),
      peopleCursor: answer.data.nextCursor,
      type: "people",
    });
  };

  const filter = (filters: TaskFilters) => {
    reading.current.filters = filters;
    dispatch({ filters, type: "filter" });
    void load(true);
  };

  const add = () => {
    form.current?.reset();
    dispatch({ requestId: crypto.randomUUID(), type: "open" });
  };

  const edit = (task: Task) => dispatch({ task, type: "open" });

  const cancel = () => {
    form.current?.reset();
    dispatch({ focus: true, type: "close" });
  };

  const complete = async (task: Task) => {
    if (state.moving[task.id]) return;
    const completed = task.status === "open";
    dispatch({
      taskId: task.id,
      to: completed ? "completed" : "open",
      type: "move",
    });
    dispatch({
      notice: completed ? "Completing task…" : "Reopening task…",
      type: "notice",
    });
    const answer = await settle(() =>
      setTaskCompletion(task.id, completed, reading.current.workspaceId)
    );
    if (answer.status !== "ready") {
      dispatch({
        notice: answer.problem?.code === "archived_write_rejected"
          ? "Restore the linked person before changing this task."
          : "Task state could not be changed.",
        type: "notice",
      });
      dispatch({ taskId: task.id, type: "settle" });
      return;
    }
    dispatch({
      notice: completed ? "Task completed." : "Task reopened.",
      type: "notice",
    });
    announceTaskChange();
    try {
      await load(true);
    } finally {
      dispatch({ taskId: task.id, type: "settle" });
    }
  };

  /** The one saving flag: the guard and the rendered lock move together. */
  const lock = (value: boolean) => {
    saving.current = value;
    dispatch({ saving: value, type: "saving" });
  };

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const element = form.current;
    const editor = state.editor;
    if (!element || !editor || saving.current) return;
    const data = new FormData(element);
    const text = (name: string) => String(data.get(name) ?? "");
    const values: TaskFormValues = {
      description: text("description"),
      dueAt: text("dueAt"),
      personId: text("personId"),
      status: text("status"),
      title: text("title"),
    };
    if (!values.title.trim()) {
      dispatch({ notice: "Add a task title.", type: "notice" });
      return;
    }
    const existing = editor.task;
    dispatch({
      notice: existing ? "Saving task…" : "Creating task…",
      type: "notice",
    });
    lock(true);
    const answer = await saveWithLockedForm(
      element,
      () =>
        settle<unknown>(() =>
          existing
            ? changeTask(
              existing.id,
              changeInput(values, existing, {
                dueChanged: editor.dueChanged,
                personFixed: personId !== undefined,
              }),
              reading.current.workspaceId,
            )
            : createTask(
              createInput(
                values,
                personId,
                editor.requestId ?? crypto.randomUUID(),
              ),
              reading.current.workspaceId,
            )
        ),
    );
    if (answer.status !== "ready") {
      lock(false);
      dispatch({
        notice: answer.problem?.code === "archived_write_rejected"
          ? "Archived people are read-only."
          : "Task could not be saved. Review the fields and retry.",
        type: "notice",
      });
      return;
    }
    dispatch({
      notice: existing ? "Task saved." : "Task created.",
      type: "saved",
    });
    markFormSaved(element);
    announceTaskChange();
    // The save holds the controls and the list until its refresh lands.
    try {
      await load(true);
    } finally {
      lock(false);
    }
  };

  const { archived, status } = state;
  const ready = status !== "context" && status !== "unavailable";
  const columns = taskColumns(state.tasks, state.moving);
  const listId = page ? "open-tasks" : "person-open-tasks";
  const line = status === "unavailable"
    ? UNAVAILABLE
    : status === "error"
    ? FAILED
    : status === "ready"
    ? taskCount(state.tasks.length)
    : LOADING;

  const row = (task: Task) => {
    const moving = state.moving[task.id] !== undefined;
    return (
      <li
        aria-busy={moving ? "true" : undefined}
        className="task-item"
        data-task-id={task.id}
        key={task.id}
      >
        <h3>{task.title}</h3>
        <p className="task-meta">{taskMeta(task, state.preferences)}</p>
        {task.description ? <p>{task.description}</p> : null}
        {taskMutable(task, archived)
          ? (
            <div
              className={formActionsVariants({
                className: "task-item-actions",
              })}
            >
              <Button
                disabled={moving}
                onClick={() => void complete(task)}
                type="button"
                variant="outline"
              >
                {task.status === "open" ? "Complete" : "Reopen"}
              </Button>
              <Button
                disabled={moving}
                onClick={() => edit(task)}
                type="button"
                variant="outline"
              >
                Edit task
              </Button>
            </div>
          )
          : null}
      </li>
    );
  };

  const list = (column: keyof typeof columns, label: string, id?: string) => (
    <ul
      aria-label={label}
      className="task-list"
      {...{ [`data-task-${column}-list`]: "" }}
      {...(id ? { id } : {})}
    >
      {columns[column].map(row)}
    </ul>
  );

  const addControl = (
    <Button
      {...(page ? {} : { className: "profile-section-cta" })}
      data-task-add=""
      disabled={!ready || state.saving || archived}
      hidden={archived}
      onClick={add}
      ref={addButton}
      type="button"
    >
      Add task
    </Button>
  );

  const fields = state.editor
    ? (
      <TaskFields
        choices={page ? state.formChoices : undefined}
        editor={state.editor}
        key={state.editor.generation}
        onDueChange={() => dispatch({ type: "due-changed" })}
      />
    )
    : null;
  const notice = state.notice;
  const loadMore = (
    <LoadMore
      controls={listId}
      // A write's refresh owns the list until it lands, so no page may
      // retire it or put a moving row back; the refresh brings the cursor back.
      cursor={state.saving || Object.keys(state.moving).length > 0
        ? undefined
        : state.nextCursor}
      label="Load more tasks"
      list="tasks"
      onLoad={(cursor) => load(false, { cursor })}
    />
  );
  const retryControl = (
    <Button
      data-task-retry=""
      hidden={status !== "unavailable" && status !== "error"}
      onClick={retry}
      type="button"
      variant="outline"
    >
      Retry tasks
    </Button>
  );
  const actions = (cancelVariant: "default" | "outline", extra: object) => (
    <div className={formActionsVariants()} {...extra}>
      <Button disabled={state.saving} type="submit">Save task</Button>
      <Button
        data-task-cancel=""
        disabled={state.saving}
        onClick={cancel}
        type="button"
        variant={cancelVariant}
      >
        Cancel
      </Button>
    </div>
  );
  const editorForm = (children: ReactNode) => (
    <form
      className="profile-fact-form task-form"
      data-task-form=""
      hidden={state.editor === undefined}
      method="post"
      noValidate
      onSubmit={(event) => void submit(event)}
      ref={form}
    >
      {children}
    </form>
  );

  return (
    <>
      {props.heading ? createPortal(addControl, props.heading) : null}
      {page
        ? (
          <>
            <section aria-label="Task filters" className="task-filters">
              <label>
                State{" "}
                <select
                  data-task-status-filter=""
                  onChange={(event) =>
                    filter({ ...state.filters, status: event.target.value })}
                  value={state.filters.status}
                >
                  <option value="">All states</option>
                  <option value="open">Open</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </label>
              <label>
                Person{" "}
                <select
                  data-task-person-filter=""
                  onChange={(event) =>
                    filter({ ...state.filters, personId: event.target.value })}
                  value={state.filters.personId}
                >
                  <option value="">All people and workspace tasks</option>
                  {state.filterChoices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.name}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                data-task-people-more=""
                hidden={!state.peopleCursor}
                onClick={() => void morePeople()}
                type="button"
                variant="outline"
              >
                Load more people
              </Button>
            </section>
            <p
              aria-live="polite"
              className="section-state"
              data-task-state=""
              role="status"
            >
              {line}
            </p>
            {retryControl}
            {editorForm(
              <>
                <h2>Task details</h2>
                {fields}
                <p
                  aria-live="polite"
                  className="section-state"
                  data-task-form-state=""
                  role="status"
                >
                  {notice}
                </p>
                {actions("default", {})}
              </>,
            )}
            <div className="task-columns">
              <section aria-labelledby="open-tasks-heading">
                <h2 id="open-tasks-heading">Open</h2>
                {list("open", "Open tasks", listId)}
              </section>
              <section aria-labelledby="completed-tasks-heading">
                <h2 id="completed-tasks-heading">Completed</h2>
                {list("completed", "Completed tasks")}
              </section>
              <section aria-labelledby="cancelled-tasks-heading">
                <h2 id="cancelled-tasks-heading">Cancelled</h2>
                {list("cancelled", "Cancelled tasks")}
              </section>
              {loadMore}
            </div>
          </>
        )
        : (
          <>
            <p
              className="section-state"
              data-task-state=""
              {...props.statusRegion}
            >
              {line}
            </p>
            {retryControl}
            {editorForm(
              <>
                {fields}
                <p
                  className="section-state"
                  data-task-form-state=""
                  {...props.statusRegion}
                >
                  {notice}
                </p>
                {actions("outline", { "data-form-actions": "" })}
              </>,
            )}
            <div className="task-columns">
              <div>
                <h4>Open</h4>
                {list("open", "Open person tasks", listId)}
              </div>
              <div>
                <h4>Completed</h4>
                {list("completed", "Completed person tasks")}
              </div>
              <div>
                <h4>Cancelled</h4>
                {list("cancelled", "Cancelled person tasks")}
              </div>
              {loadMore}
            </div>
          </>
        )}
    </>
  );
}

/**
 * The editor's fields, drawn from the opened task. They stay the form's
 * own until it is submitted; only a change to the due time is the
 * reducer's, since only a changed due time is sent.
 */
function TaskFields(
  props: {
    readonly editor: TaskEditor;
    /** The people a task can be linked to; the person card links its own. */
    readonly choices?: readonly PersonChoice[] | undefined;
    readonly onDueChange: () => void;
  },
) {
  const { task } = props.editor;
  return (
    <>
      <label>
        Title{" "}
        <input
          defaultValue={task?.title ?? ""}
          maxLength={500}
          name="title"
          required
        />
      </label>
      <label>
        Description (optional){" "}
        <textarea
          defaultValue={task?.description ?? ""}
          maxLength={10000}
          name="description"
          rows={3}
        />
      </label>
      <label>
        Due time (optional){" "}
        <input
          defaultValue={localDateTime(task?.dueAt)}
          name="dueAt"
          onInput={props.onDueChange}
          type="datetime-local"
        />
      </label>
      {props.choices
        ? (
          <label>
            Person (optional){" "}
            <select defaultValue={task?.person?.id ?? ""} name="personId">
              <option value="">Workspace task</option>
              {props.choices.map((choice) => (
                <option key={choice.id} value={choice.id}>{choice.name}</option>
              ))}
            </select>
          </label>
        )
        : null}
      <label>
        State{" "}
        <select
          defaultValue={task?.status === "cancelled" ? "cancelled" : "open"}
          name="status"
        >
          <option value="open">Open</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </label>
    </>
  );
}

/** The heading Add task renders into, without the shell's disabled copy. */
function headingOf(
  scope: ParentNode,
  selector: string,
): HTMLElement | undefined {
  const heading = scope.querySelector<HTMLElement>(selector) ?? undefined;
  heading?.querySelector("[data-task-add]")?.remove();
  return heading;
}

/**
 * Mounts the person tasks card over the section the shell drew and
 * resolves, once its first read has settled, with the function that
 * unmounts it. A workspace that turned the tasks module off sees no card
 * and no request is made. Without the section and its form, the markup the
 * shell always draws, there is nothing to own.
 */
export const mountPersonTasks: SectionMount = (container, props) => {
  const section = container.querySelector<HTMLElement>(
    "#profile-section-tasks",
  );
  if (!section?.querySelector("[data-task-form]")) {
    return Promise.resolve(() => undefined);
  }
  if (sectionHidden(props, "tasks")) {
    section.hidden = true;
    section.dataset.sectionState = "hidden";
    const link = document.querySelector<HTMLElement>(
      '[data-section-link="tasks"]',
    )?.closest<HTMLElement>("li");
    if (link) link.hidden = true;
    return Promise.resolve(() => undefined);
  }
  const heading = headingOf(section, ":scope > header");
  return new Promise((resolve) => {
    const unmount = mountIsland(
      section,
      PERSON_TASKS_ISLAND,
      <TaskSurface
        archived={props.archived}
        heading={heading}
        onSettled={() => resolve(unmount)}
        personId={props.personId}
        section={section}
        statusRegion={statusRegion(props)}
        timePreferences={props.preferences}
        variant="person"
        workspaceId={props.workspaceId}
      />,
    );
    if (heading) section.prepend(heading);
  });
};

/**
 * Mounts the `/app/tasks` page's surface over the region the page drew and
 * resolves, once its first read has settled, with the function that
 * unmounts it. The page's heading keeps its title; Add task renders there.
 */
export function mountTasksPage(
  root: ParentNode = document,
): Promise<() => void> {
  const surface = root.querySelector<HTMLElement>("[data-task-surface]");
  if (!surface) return Promise.resolve(() => undefined);
  const heading = headingOf(root, ".tasks-page > .page-heading");
  return new Promise((resolve) => {
    const unmount = mountIsland(
      surface,
      TASKS_PAGE_ISLAND,
      <TaskSurface
        archived={false}
        heading={heading}
        onSettled={() => resolve(unmount)}
        variant="page"
      />,
    );
  });
}
