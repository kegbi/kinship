import {
  changeTask,
  createTask,
  getTodayTasks,
  listPeople,
  listTasks,
  setTaskCompletion,
  type Task,
  type TaskChangeInput,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

export const TASK_CHANGED_EVENT = "kinship:task-changed";
let surfaceAbort: AbortController | undefined;
let todayAbort: AbortController | undefined;

function dueText(value: string | undefined): string {
  if (!value) return "No due time";
  return `Due ${
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(value))
  }`;
}

function localDateTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function renderTask(
  task: Task,
  mutable: boolean,
  onComplete: (task: Task, completed: boolean) => void,
  onEdit?: (task: Task) => void,
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "task-item";
  item.dataset.taskId = task.id;
  const heading = document.createElement("h3");
  heading.textContent = task.title;
  const meta = document.createElement("p");
  meta.className = "task-meta";
  meta.textContent = `${dueText(task.dueAt)}${
    task.person
      ? ` · ${task.person.name}${
        task.person.archived && !task.person.unavailable ? " (archived)" : ""
      }`
      : " · Workspace task"
  }`;
  item.append(heading, meta);
  if (task.description) {
    const description = document.createElement("p");
    description.textContent = task.description;
    item.append(description);
  }
  if (mutable) {
    const actions = document.createElement("div");
    actions.className = "form-actions";
    const completion = document.createElement("button");
    completion.type = "button";
    completion.className = "button-secondary";
    completion.textContent = task.status === "open" ? "Complete" : "Reopen";
    completion.addEventListener(
      "click",
      () => onComplete(task, task.status === "open"),
    );
    actions.append(completion);
    if (onEdit) {
      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "Edit task";
      edit.addEventListener("click", () => onEdit(task));
      actions.append(edit);
    }
    item.append(actions);
  }
  return item;
}

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

export async function mountTaskSurface(options: {
  readonly archived?: boolean;
  readonly hidden?: boolean;
  readonly personId?: string;
  readonly workspaceId?: string;
} = {}): Promise<void> {
  const state = document.querySelector<HTMLElement>("[data-task-state]");
  const openList = document.querySelector<HTMLUListElement>(
    "[data-task-open-list]",
  );
  const completedList = document.querySelector<HTMLUListElement>(
    "[data-task-completed-list]",
  );
  const cancelledList = document.querySelector<HTMLUListElement>(
    "[data-task-cancelled-list]",
  );
  const form = document.querySelector<HTMLFormElement>("[data-task-form]");
  const formState = document.querySelector<HTMLElement>(
    "[data-task-form-state]",
  );
  const add = document.querySelector<HTMLButtonElement>("[data-task-add]");
  const cancel = document.querySelector<HTMLButtonElement>(
    "[data-task-cancel]",
  );
  const retry = document.querySelector<HTMLButtonElement>("[data-task-retry]");
  const more = document.querySelector<HTMLButtonElement>("[data-task-more]");
  const peopleMore = document.querySelector<HTMLButtonElement>(
    "[data-task-people-more]",
  );
  if (
    !state || !openList || !completedList || !cancelledList || !form ||
    !formState || !add
  ) {
    return;
  }
  const region = state.closest<HTMLElement>("[data-profile-section]");
  if (options.hidden) {
    if (region) {
      region.hidden = true;
      region.dataset.sectionState = "hidden";
    }
    const directoryItem = document.querySelector<HTMLElement>(
      '[data-section-link="tasks"]',
    )?.closest<HTMLElement>("li");
    if (directoryItem) directoryItem.hidden = true;
    return;
  }
  surfaceAbort?.abort();
  const abort = new AbortController();
  surfaceAbort = abort;
  let archived = options.archived === true;
  let createRequestId: string | undefined;
  let dueDirty = false;
  let editingStatus: Task["status"] | undefined;
  let generation = 0;
  let loadedTasks: Task[] = [];
  let taskCursor: string | undefined;
  let peopleCursor: string | undefined;
  let submitting = false;
  let workspaceId = options.workspaceId;
  const session = workspaceId ? undefined : await resolveWorkspaceSession();
  if (abort.signal.aborted) return;
  if (!workspaceId) {
    if (session?.status !== "ready") {
      state.textContent = "Tasks are unavailable. Sign in again or retry.";
      if (retry) retry.hidden = false;
      return;
    }
    workspaceId = session.session.workspace.id;
  }
  const personSelect = form.querySelector<HTMLSelectElement>("[name=personId]");
  const filterPerson = document.querySelector<HTMLSelectElement>(
    "[data-task-person-filter]",
  );
  const filterStatus = document.querySelector<HTMLSelectElement>(
    "[data-task-status-filter]",
  );
  const appendPersonChoice = (
    select: HTMLSelectElement | null,
    person: {
      readonly familyName?: string;
      readonly givenName?: string;
      readonly id: string;
    },
    fallback?: string,
  ) => {
    if (!select || select.querySelector(`option[value='${person.id}']`)) return;
    const option = document.createElement("option");
    option.value = person.id;
    option.textContent = fallback ??
      ([person.givenName, person.familyName].filter(Boolean).join(" ") ||
        "Unnamed person");
    select.append(option);
  };
  const loadPeople = async (cursor?: string) => {
    const people = await listPeople({
      ...(cursor ? { cursor } : {}),
      limit: 50,
    }, workspaceId)
      .catch(() => undefined);
    if (!people?.ok || abort.signal.aborted) return;
    for (const person of people.value.people) {
      appendPersonChoice(personSelect, person);
      appendPersonChoice(filterPerson, person);
    }
    peopleCursor = people.value.nextCursor;
    if (peopleMore) peopleMore.hidden = !peopleCursor;
  };
  if (!options.personId && (personSelect || filterPerson)) {
    await loadPeople();
  }
  const setMutable = () => {
    add.hidden = archived;
    add.disabled = archived;
    if (archived) {
      form.hidden = true;
      formState.textContent =
        "Archived people are readable; restore this person before changing tasks.";
    }
  };
  setMutable();
  const load = async (reset = true) => {
    const current = ++generation;
    if (reset) {
      taskCursor = undefined;
      loadedTasks = [];
    }
    state.textContent = "Loading tasks…";
    if (region) region.dataset.sectionState = "loading";
    if (retry) retry.hidden = true;
    const result = await listTasks({
      ...(!reset && taskCursor ? { cursor: taskCursor } : {}),
      limit: 100,
      ...(options.personId
        ? { personId: options.personId }
        : filterPerson?.value
        ? { personId: filterPerson.value }
        : {}),
      ...(filterStatus?.value
        ? { status: filterStatus.value as Task["status"] }
        : {}),
    }, workspaceId).catch(() => undefined);
    if (abort.signal.aborted || current !== generation) return;
    if (!result?.ok) {
      state.textContent =
        "Tasks could not be loaded. Saved tasks are unchanged.";
      if (region) region.dataset.sectionState = "error";
      if (retry) retry.hidden = false;
      return;
    }
    loadedTasks = reset ? [...result.value.items] : [
      ...loadedTasks,
      ...result.value.items.filter((candidate) =>
        !loadedTasks.some((existing) => existing.id === candidate.id)
      ),
    ];
    taskCursor = result.value.nextCursor;
    if (more) more.hidden = !taskCursor;
    if (filterPerson) {
      for (const task of result.value.items) {
        if (task.person) {
          appendPersonChoice(
            filterPerson,
            { id: task.person.id },
            task.person.name,
          );
          if (!task.person.archived && !task.person.unavailable) {
            appendPersonChoice(
              personSelect,
              { id: task.person.id },
              task.person.name,
            );
          }
        }
      }
    }
    const complete = async (task: Task, completed: boolean) => {
      formState.textContent = completed
        ? "Completing task…"
        : "Reopening task…";
      const changed = await setTaskCompletion(task.id, completed, workspaceId)
        .catch(() => undefined);
      if (!changed?.ok) {
        formState.textContent = changed && !changed.ok &&
            changed.problem.code === "archived_write_rejected"
          ? "Restore the linked person before changing this task."
          : "Task state could not be changed.";
        return;
      }
      formState.textContent = completed ? "Task completed." : "Task reopened.";
      globalThis.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT));
      await load(true);
    };
    const edit = (task: Task) => {
      createRequestId = undefined;
      editingStatus = task.status;
      dueDirty = false;
      form.dataset.taskId = task.id;
      form.dataset.updatedAt = task.updatedAt;
      (form.elements.namedItem("title") as HTMLInputElement).value = task.title;
      (form.elements.namedItem("description") as HTMLTextAreaElement).value =
        task.description ?? "";
      (form.elements.namedItem("dueAt") as HTMLInputElement).value =
        localDateTime(task.dueAt);
      const status = form.elements.namedItem("status") as
        | HTMLSelectElement
        | null;
      if (status) {
        status.value = task.status === "cancelled" ? "cancelled" : "open";
      }
      if (personSelect) personSelect.value = task.person?.id ?? "";
      form.hidden = false;
      form.querySelector<HTMLInputElement>("[name=title]")?.focus();
    };
    const open = loadedTasks.filter((task) => task.status === "open");
    const completeTasks = loadedTasks.filter((task) =>
      task.status === "completed"
    );
    const cancelledTasks = loadedTasks.filter((task) =>
      task.status === "cancelled"
    );
    openList.replaceChildren(
      ...open.map((task) =>
        renderTask(
          task,
          !archived && task.person?.archived !== true,
          complete,
          edit,
        )
      ),
    );
    completedList.replaceChildren(
      ...completeTasks.map((task) =>
        renderTask(
          task,
          !archived && task.person?.archived !== true,
          complete,
          edit,
        )
      ),
    );
    cancelledList.replaceChildren(
      ...cancelledTasks.map((task) =>
        renderTask(
          task,
          !archived && task.person?.archived !== true,
          complete,
          edit,
        )
      ),
    );
    state.textContent = loadedTasks.length === 0
      ? "No tasks in this view."
      : `${loadedTasks.length} task${loadedTasks.length === 1 ? "" : "s"}.`;
    if (region) region.dataset.sectionState = "ready";
  };
  add.addEventListener("click", () => {
    form.reset();
    createRequestId = crypto.randomUUID();
    dueDirty = false;
    editingStatus = undefined;
    delete form.dataset.taskId;
    delete form.dataset.updatedAt;
    form.hidden = false;
    form.querySelector<HTMLInputElement>("[name=title]")?.focus();
  }, { signal: abort.signal });
  cancel?.addEventListener("click", () => {
    createRequestId = undefined;
    dueDirty = false;
    editingStatus = undefined;
    form.reset();
    delete form.dataset.taskId;
    delete form.dataset.updatedAt;
    form.hidden = true;
    add.focus();
  }, { signal: abort.signal });
  retry?.addEventListener("click", () => void load(true), {
    signal: abort.signal,
  });
  more?.addEventListener("click", () => {
    if (taskCursor) void load(false);
  }, { signal: abort.signal });
  peopleMore?.addEventListener("click", () => {
    if (peopleCursor) void loadPeople(peopleCursor);
  }, { signal: abort.signal });
  filterPerson?.addEventListener("change", () => void load(true), {
    signal: abort.signal,
  });
  filterStatus?.addEventListener("change", () => void load(true), {
    signal: abort.signal,
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (submitting) return;
    const title = formValue(form, "title");
    if (!title) {
      formState.textContent = "Add a task title.";
      return;
    }
    const description = formValue(form, "description");
    const dueValue = formValue(form, "dueAt");
    const dueAt = dueValue ? new Date(dueValue).toISOString() : undefined;
    const selectedPersonId = options.personId ??
      (formValue(form, "personId") || undefined);
    formState.textContent = form.dataset.taskId
      ? "Saving task…"
      : "Creating task…";
    submitting = true;
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]");
    if (submit) submit.disabled = true;
    if (cancel) cancel.disabled = true;
    add.disabled = true;
    const selectedStatus = formValue(form, "status") === "cancelled"
      ? "cancelled" as const
      : "open" as const;
    const result = await (form.dataset.taskId
      ? changeTask(
        form.dataset.taskId,
        {
          description: description || null,
          ...(dueDirty ? { dueAt: dueAt ?? null } : {}),
          expectedUpdatedAt: form.dataset.updatedAt!,
          ...(!options.personId ? { personId: selectedPersonId ?? null } : {}),
          ...(editingStatus === "completed" && selectedStatus === "open"
            ? {}
            : { status: selectedStatus }),
          title,
        } satisfies TaskChangeInput,
        workspaceId,
      )
      : createTask({
        ...(description ? { description } : {}),
        ...(dueAt ? { dueAt } : {}),
        ...(selectedPersonId ? { personId: selectedPersonId } : {}),
        requestId: createRequestId ??= crypto.randomUUID(),
        title,
      }, workspaceId)).catch(() => undefined);
    submitting = false;
    if (submit) submit.disabled = false;
    if (cancel) cancel.disabled = false;
    add.disabled = archived;
    if (!result?.ok) {
      formState.textContent = result && !result.ok &&
          result.problem.code === "archived_write_rejected"
        ? "Archived people are read-only."
        : "Task could not be saved. Review the fields and retry.";
      return;
    }
    formState.textContent = form.dataset.taskId
      ? "Task saved."
      : "Task created.";
    createRequestId = undefined;
    dueDirty = false;
    editingStatus = undefined;
    form.hidden = true;
    globalThis.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT));
    await load(true);
  }, { signal: abort.signal });
  form.querySelector<HTMLInputElement>("[name=dueAt]")?.addEventListener(
    "input",
    () => {
      dueDirty = true;
    },
    { signal: abort.signal },
  );
  document.addEventListener("person-lifecycle-changed", (event) => {
    const detail = (event as CustomEvent<
      { readonly archived?: unknown; readonly personId?: unknown }
    >).detail;
    if (
      detail?.personId === options.personId &&
      typeof detail.archived === "boolean"
    ) {
      archived = detail.archived;
      setMutable();
      void load(true);
    }
  }, { signal: abort.signal });
  await load(true);
}

export async function mountTodayTasks(): Promise<void> {
  const state = document.querySelector<HTMLElement>("#today-tasks-state");
  const list = document.querySelector<HTMLUListElement>("#today-tasks-list");
  const retry = document.querySelector<HTMLButtonElement>("#today-tasks-retry");
  if (!state || !list || !retry) return;
  todayAbort?.abort();
  const abort = new AbortController();
  todayAbort = abort;
  let generation = 0;
  const load = async () => {
    const current = ++generation;
    state.textContent = "Loading due tasks…";
    retry.hidden = true;
    const session = await resolveWorkspaceSession();
    if (abort.signal.aborted || current !== generation) return;
    if (session.status !== "ready") {
      state.textContent = "Due tasks are unavailable.";
      retry.hidden = false;
      return;
    }
    const result = await getTodayTasks(session.session.workspace.id).catch(() =>
      undefined
    );
    if (abort.signal.aborted || current !== generation) return;
    if (!result?.ok) {
      state.textContent =
        "Due tasks could not be loaded. Other Today regions are unchanged.";
      retry.hidden = false;
      return;
    }
    const complete = async (task: Task, completed: boolean) => {
      const changed = await setTaskCompletion(
        task.id,
        completed,
        session.session.workspace.id,
      ).catch(() => undefined);
      state.textContent = changed?.ok
        ? "Task completed."
        : "Task could not be completed.";
      if (changed?.ok) {
        globalThis.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT));
        await load();
      }
    };
    list.replaceChildren(
      ...result.value.items.map((task) =>
        renderTask(
          task,
          task.person?.archived !== true && task.person?.unavailable !== true,
          complete,
        )
      ),
    );
    state.textContent = result.value.items.length === 0
      ? "No tasks are due in the next 30 days."
      : `${result.value.items.length} due task${
        result.value.items.length === 1 ? "" : "s"
      }.`;
  };
  retry.addEventListener("click", () => void load(), { signal: abort.signal });
  globalThis.addEventListener(TASK_CHANGED_EVENT, () => void load(), {
    signal: abort.signal,
  });
  await load();
}
