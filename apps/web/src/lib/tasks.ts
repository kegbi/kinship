import {
  changeTask,
  createTask,
  getTodayAttention,
  listPeople,
  listTasks,
  setTaskCompletion,
  type Task,
  type TaskChangeInput,
  type TodayAttentionItem,
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

export async function mountTodayAttention(): Promise<void> {
  const state = document.querySelector<HTMLElement>("#today-attention-state");
  const retry = document.querySelector<HTMLButtonElement>(
    "#today-attention-retry",
  );
  const onboarding = document.querySelector<HTMLElement>("#today-onboarding");
  const lists = {
    nextSevenDays: document.querySelector<HTMLUListElement>(
      "#today-next-seven-list",
    ),
    overdue: document.querySelector<HTMLUListElement>("#today-overdue-list"),
    today: document.querySelector<HTMLUListElement>("#today-due-today-list"),
  };
  const upcomingState = document.querySelector<HTMLElement>(
    "#today-upcoming-state",
  );
  const upcomingList = document.querySelector<HTMLUListElement>(
    "#today-upcoming-list",
  );
  const upcomingRetry = document.querySelector<HTMLButtonElement>(
    "#today-upcoming-retry",
  );
  if (
    !state || !retry || !onboarding || !upcomingState || !upcomingList ||
    !upcomingRetry || Object.values(lists).some((value) => !value)
  ) return;
  todayAbort?.abort();
  const abort = new AbortController();
  todayAbort = abort;
  let generation = 0;
  let renderedGeneration = 0;
  let completionOwner:
    | {
      readonly button: HTMLButtonElement;
      readonly retryHidden: boolean;
      readonly upcomingRetryHidden: boolean;
    }
    | undefined;
  const completedStale = new WeakSet<HTMLButtonElement>();
  type Trigger = "attention" | "initial" | "upcoming";
  const statusFor = (trigger: Trigger) =>
    trigger === "upcoming" ? upcomingState : state;
  const retryFor = (trigger: Trigger) =>
    trigger === "upcoming" ? upcomingRetry : retry;
  const format = (value: string, timezone: string) =>
    new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: timezone,
    }).format(new Date(value));
  const todayDate = document.querySelector<HTMLTimeElement>(
    "[data-today-date]",
  );
  const settleUnavailableDate = () => {
    if (!todayDate || todayDate.hasAttribute("datetime")) return;
    todayDate.removeAttribute("datetime");
    todayDate.textContent = "Date unavailable";
  };
  const destination = (item: TodayAttentionItem) => {
    if (item.person?.unavailable) return undefined;
    if (!item.person) return item.kind === "task" ? "/app/tasks" : undefined;
    const section = item.kind === "task"
      ? "tasks"
      : item.kind === "important-date"
      ? "important-dates"
      : item.kind === "life-event"
      ? "life-events"
      : item.kind === "reminder"
      ? "reminders"
      : "stay-in-touch";
    return `/app/people/${
      encodeURIComponent(item.person.id)
    }?section=${section}`;
  };
  const title = (
    item: TodayAttentionItem,
  ): HTMLAnchorElement | HTMLParagraphElement => {
    const href = destination(item);
    const element = document.createElement(href ? "a" : "p");
    element.textContent = item.title;
    element.className = "attention-title";
    if (href) {
      element.classList.add("today-touch-target");
      (element as HTMLAnchorElement).href = href;
    }
    return element;
  };
  const refresh = async (trigger: Trigger, restoreFocus = false) => {
    const current = ++generation;
    const initiatingRegions = trigger === "initial"
      ? [{ retry, status: state }, {
        retry: upcomingRetry,
        status: upcomingState,
      }]
      : [{ retry: retryFor(trigger), status: statusFor(trigger) }];
    const prior = initiatingRegions.map(({ retry, status }) => ({
      retry,
      retryHidden: retry.hidden,
      status,
      text: status.textContent,
    }));
    const superseded = () => {
      if (abort.signal.aborted) return true;
      if (current === generation) return false;
      if (renderedGeneration <= current) {
        for (const previous of prior) {
          previous.status.textContent = previous.text;
          previous.retry.hidden = previous.retryHidden;
        }
      }
      return true;
    };
    for (const { status } of initiatingRegions) {
      status.textContent = status === state
        ? "Loading relationship priorities…"
        : "Loading upcoming work…";
    }
    if (trigger === "initial") {
      retry.hidden = true;
      upcomingRetry.hidden = true;
    } else {
      retryFor(trigger).hidden = true;
    }
    const session = await resolveWorkspaceSession();
    if (superseded()) return false;
    const workspaceId = session.status === "ready"
      ? session.session.workspace.id
      : undefined;
    const result = workspaceId
      ? await getTodayAttention(workspaceId).catch(() => undefined)
      : undefined;
    if (superseded()) return false;
    if (!workspaceId || !result?.ok) {
      for (const { status } of initiatingRegions) {
        status.textContent = status === state
          ? "Attention could not be loaded. Other Today regions remain available."
          : "Upcoming work could not be loaded. Needs attention is unchanged.";
      }
      if (trigger === "initial") {
        retry.hidden = false;
        upcomingRetry.hidden = false;
      } else {
        retryFor(trigger).hidden = false;
      }
      if (restoreFocus) {
        const status = statusFor(trigger);
        status.tabIndex = -1;
        status.focus();
      }
      settleUnavailableDate();
      return false;
    }
    const snapshot = result.value;
    const complete = async (
      item: Extract<TodayAttentionItem, { kind: "task" }>,
      button: HTMLButtonElement,
    ) => {
      if (completionOwner) return;
      const owner = {
        button,
        retryHidden: retry.hidden === true,
        upcomingRetryHidden: upcomingRetry.hidden === true,
      };
      completionOwner = owner;
      for (
        const control of document.querySelectorAll<HTMLButtonElement>(
          "button[data-today-complete]",
        )
      ) control.disabled = true;
      retry.hidden = true;
      upcomingRetry.hidden = true;
      state.textContent = "Completing task…";
      const changed = await setTaskCompletion(
        item.id,
        true,
        workspaceId,
      ).catch(() => undefined);
      if (abort.signal.aborted || completionOwner !== owner) return;
      if (!changed?.ok) {
        completionOwner = undefined;
        state.textContent =
          "Task could not be completed. Nothing else changed.";
        retry.hidden = owner.retryHidden;
        upcomingRetry.hidden = owner.upcomingRetryHidden;
        for (
          const control of document.querySelectorAll<HTMLButtonElement>(
            "button[data-today-complete]",
          )
        ) control.disabled = completedStale.has(control);
        if (button.isConnected) button.focus();
        else {
          state.tabIndex = -1;
          state.focus();
        }
        return;
      }
      globalThis.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT));
      const refreshed = await refresh("attention", true);
      if (abort.signal.aborted || completionOwner !== owner) return;
      completionOwner = undefined;
      upcomingRetry.hidden = refreshed ? true : owner.upcomingRetryHidden;
      if (!refreshed) completedStale.add(button);
      for (
        const control of document.querySelectorAll<HTMLButtonElement>(
          "button[data-today-complete]",
        )
      ) control.disabled = completedStale.has(control);
    };
    const attentionRow = (item: TodayAttentionItem) => {
      const element = document.createElement("li");
      element.className = `attention-item attention-${item.kind}`;
      const meta = document.createElement("p");
      meta.textContent = `${item.kind === "cadence" ? "Reconnect by" : "Due"} ${
        format(item.dueAt, snapshot.timezone)
      }${item.person ? ` · ${item.person.name}` : ""}${
        item.kind === "cadence"
          ? ` · ${
            item.lastContactedAt
              ? `Last contact ${
                format(item.lastContactedAt, snapshot.timezone)
              }`
              : "No contact recorded"
          }${item.person.archived ? " · archived" : ""}`
          : ""
      }`;
      element.append(title(item), meta);
      if (
        item.kind === "task" && !item.person?.archived &&
        !item.person?.unavailable
      ) {
        const actions = document.createElement("div");
        actions.className = "form-actions";
        const button = document.createElement("button");
        button.type = "button";
        button.className = "button-secondary";
        button.dataset.todayComplete = "";
        button.disabled = completionOwner !== undefined;
        button.textContent = "Complete";
        button.addEventListener("click", () => void complete(item, button));
        actions.append(button);
        element.append(actions);
      }
      return element;
    };
    const upcomingRow = (item: TodayAttentionItem) => {
      const element = document.createElement("li");
      element.className = `attention-item attention-${item.kind}`;
      const heading = title(item);
      const meta = document.createElement("p");
      meta.textContent = `${format(item.dueAt, snapshot.timezone)}${
        item.person ? ` · ${item.person.name}` : ""
      }`;
      element.append(heading, meta);
      return element;
    };
    let attentionRows:
      | Readonly<Record<keyof typeof lists, readonly HTMLLIElement[]>>
      | undefined;
    let upcomingRows: readonly HTMLLIElement[] | undefined;
    let todayText: string | undefined;
    try {
      attentionRows = {
        nextSevenDays: snapshot.attention.nextSevenDays.map(attentionRow),
        overdue: snapshot.attention.overdue.map(attentionRow),
        today: snapshot.attention.today.map(attentionRow),
      };
      upcomingRows = snapshot.upcoming.map(upcomingRow);
      todayText = new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeZone: "UTC",
      }).format(new Date(`${snapshot.date}T12:00:00Z`));
    } catch {
      for (const { status } of initiatingRegions) {
        status.textContent = status === state
          ? "Attention could not be loaded. Other Today regions remain available."
          : "Upcoming work could not be loaded. Needs attention is unchanged.";
      }
      if (trigger === "initial") {
        retry.hidden = false;
        upcomingRetry.hidden = false;
      } else {
        retryFor(trigger).hidden = false;
      }
      settleUnavailableDate();
      if (restoreFocus) {
        const status = statusFor(trigger);
        status.tabIndex = -1;
        status.focus();
      }
      return false;
    }
    if (superseded()) return false;
    renderedGeneration = current;
    for (const key of Object.keys(lists) as (keyof typeof lists)[]) {
      lists[key]!.replaceChildren(...attentionRows[key]);
    }
    upcomingList.replaceChildren(...upcomingRows);
    const attentionCount = Object.values(snapshot.attention).flat().length;
    const upcomingCount = snapshot.upcoming.length;
    onboarding.hidden = attentionCount + upcomingCount !== 0;
    state.textContent = attentionCount === 0
      ? "All clear. No relationship work needs attention."
      : `${attentionCount} relationship priorit${
        attentionCount === 1 ? "y" : "ies"
      }.`;
    upcomingState.textContent = upcomingCount
      ? `${upcomingCount} upcoming item${upcomingCount === 1 ? "" : "s"}.`
      : "No upcoming relationship work in the next 30 days.";
    retry.hidden = true;
    upcomingRetry.hidden = true;
    if (todayDate && todayText) {
      todayDate.dateTime = snapshot.date;
      todayDate.textContent = todayText;
    }
    if (restoreFocus) {
      const status = statusFor(trigger);
      status.tabIndex = -1;
      status.focus();
    }
    return true;
  };
  retry.addEventListener(
    "click",
    () => {
      if (!completionOwner) void refresh("attention", true);
    },
    { signal: abort.signal },
  );
  upcomingRetry.addEventListener(
    "click",
    () => {
      if (!completionOwner) void refresh("upcoming", true);
    },
    {
      signal: abort.signal,
    },
  );
  await refresh("initial");
}

export const mountTodayTasks = mountTodayAttention;
