import {
  changeTask,
  createTask,
  getTodayAttention,
  listPeople,
  listTasks,
  setTaskCompletion,
  type Task,
  type TaskChangeInput,
  type TodayAttention,
  type TodayAttentionItem,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

export const TASK_CHANGED_EVENT = "kinship:task-changed";
let surfaceAbort: AbortController | undefined;
let todayAbort: AbortController | undefined;
type CompletionOwner = {
  readonly taskId: string;
  phase: "confirmed" | "pending";
  afterProjectionSequence: number;
};
type CompletionFailure = {
  readonly taskId: string;
  readonly afterProjectionSequence: number;
};
type FocusToken = {
  readonly epoch: number;
  readonly region: "attention" | "upcoming";
  readonly taskId?: string;
};
type TodaySurface = {
  readonly epoch: number;
  refresh: (
    trigger: "attention" | "initial" | "upcoming",
    focus?: FocusToken,
  ) => Promise<boolean>;
  present: (focus?: FocusToken) => void;
  workspaceId: string | undefined;
};
const completionOwners = new Map<string, CompletionOwner>();
const completionFailures = new Map<string, CompletionFailure>();
const projectionSequences = new Map<string, number>();
const upcomingRetryStates = new Map<string, boolean>();
let todayPrincipalId: string | undefined;
let todayEpoch = 0;
let currentTodaySurface: TodaySurface | undefined;

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
  const epoch = ++todayEpoch;
  let generation = 0;
  let renderedGeneration = 0;
  let workspaceId: string | undefined;
  let attentionSummary = "";
  const stages = new Map<number, {
    readonly actionableTaskIds: ReadonlySet<string>;
    readonly attentionRows: Readonly<
      Record<
        keyof typeof lists,
        readonly HTMLLIElement[]
      >
    >;
    readonly attentionText: string;
    readonly snapshot: TodayAttention;
    readonly todayText: string;
    readonly upcomingRows: readonly HTMLLIElement[];
    readonly upcomingText: string;
  }>();
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
  const clearProjection = () => {
    for (const list of Object.values(lists)) list!.replaceChildren();
    upcomingList.replaceChildren();
    onboarding.hidden = true;
    attentionSummary = "";
    settleUnavailableDate();
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
  const present = (focus?: FocusToken) => {
    if (!workspaceId) return;
    const owner = completionOwners.get(workspaceId);
    const failure = completionFailures.get(workspaceId);
    const controls = [...document.querySelectorAll<HTMLButtonElement>(
      "button[data-today-complete]",
    )];
    for (const control of controls) control.disabled = owner !== undefined;
    const exact = failure
      ? controls.find((control) => control.dataset.taskId === failure.taskId)
      : undefined;
    const summary = attentionSummary ||
      "Relationship priorities are unchanged.";
    if (owner?.phase === "pending") {
      state.textContent = "Completing task…";
      retry.hidden = true;
      upcomingRetry.hidden = true;
    } else if (owner) {
      state.textContent =
        `${summary} Task completion is confirmed; the projection has not caught up.`;
      retry.hidden = false;
      upcomingRetry.hidden = upcomingRetryStates.get(workspaceId)!;
    } else if (failure) {
      state.textContent = `${summary} Task could not be completed. ${
        exact ? "Retry Complete." : "Retry the attention projection."
      }`;
      retry.hidden = exact !== undefined;
      upcomingRetry.hidden = upcomingRetryStates.get(workspaceId)!;
    }
    if (
      !focus || focus.epoch !== epoch || currentTodaySurface?.epoch !== epoch
    ) return;
    const focusTarget = focus.taskId
      ? controls.find((control) =>
        control.dataset.taskId === focus.taskId && !control.disabled
      )
      : undefined;
    const target = focusTarget ?? statusFor(focus.region);
    if (target === state || target === upcomingState) target.tabIndex = -1;
    target.focus();
  };
  const refresh = async (trigger: Trigger, focus?: FocusToken) => {
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
        present();
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
    present();
    const session = await resolveWorkspaceSession();
    if (superseded()) return false;
    const activeWorkspaceId = session.status === "ready"
      ? session.session.workspace.id
      : undefined;
    if (!activeWorkspaceId) {
      clearProjection();
    } else {
      const ready = session as Extract<typeof session, { status: "ready" }>;
      const principalId = ready.session.principal.userId;
      if (todayPrincipalId !== principalId) {
        completionOwners.clear();
        completionFailures.clear();
        projectionSequences.clear();
        upcomingRetryStates.clear();
        todayPrincipalId = principalId;
      }
      const memberships = new Set([
        activeWorkspaceId,
        ...ready.session.workspaces.map((candidate) => candidate.id),
      ]);
      for (
        const store of [
          completionOwners,
          completionFailures,
          projectionSequences,
          upcomingRetryStates,
        ]
      ) {
        for (const id of store.keys()) {
          if (!memberships.has(id)) store.delete(id);
        }
      }
      if (workspaceId !== activeWorkspaceId) {
        clearProjection();
        workspaceId = activeWorkspaceId;
        surface.workspaceId = activeWorkspaceId;
      }
    }
    present();
    const projectionSequence = activeWorkspaceId
      ? (projectionSequences.get(activeWorkspaceId) ?? 0) + 1
      : 0;
    if (activeWorkspaceId) {
      projectionSequences.set(activeWorkspaceId, projectionSequence);
    }
    const result = activeWorkspaceId
      ? await getTodayAttention(activeWorkspaceId).catch(() => undefined)
      : undefined;
    if (superseded()) return false;
    if (!activeWorkspaceId || !result?.ok) {
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
      if (activeWorkspaceId && trigger !== "attention") {
        upcomingRetryStates.set(activeWorkspaceId, !!upcomingRetry.hidden);
      }
      present(focus);
      settleUnavailableDate();
      return false;
    }
    const snapshot = result.value;
    const complete = async (
      item: Extract<TodayAttentionItem, { kind: "task" }>,
    ) => {
      if (completionOwners.has(activeWorkspaceId)) return;
      completionFailures.delete(activeWorkspaceId);
      const owner: CompletionOwner = {
        afterProjectionSequence: projectionSequences.get(activeWorkspaceId) ??
          0,
        phase: "pending",
        taskId: item.id,
      };
      completionOwners.set(activeWorkspaceId, owner);
      const focusToken: FocusToken = {
        epoch,
        region: "attention",
        taskId: item.id,
      };
      present();
      const changed = await setTaskCompletion(
        item.id,
        true,
        activeWorkspaceId,
      ).catch(() => undefined);
      if (completionOwners.get(activeWorkspaceId) !== owner) return;
      if (!changed?.ok) {
        completionOwners.delete(activeWorkspaceId);
        completionFailures.set(activeWorkspaceId, {
          afterProjectionSequence: projectionSequences.get(activeWorkspaceId) ??
            0,
          taskId: item.id,
        });
        if (currentTodaySurface?.workspaceId === activeWorkspaceId) {
          currentTodaySurface.present(focusToken);
        }
        return;
      }
      owner.phase = "confirmed";
      owner.afterProjectionSequence = projectionSequences.get(
        activeWorkspaceId,
      ) ?? 0;
      globalThis.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT));
      if (currentTodaySurface?.workspaceId === activeWorkspaceId) {
        await currentTodaySurface.refresh("initial", focusToken);
        if (
          currentTodaySurface?.workspaceId === activeWorkspaceId &&
          currentTodaySurface.epoch === focusToken.epoch
        ) currentTodaySurface.present(focusToken);
      }
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
        button.dataset.taskId = item.id;
        button.disabled = completionOwners.has(activeWorkspaceId);
        button.textContent = "Complete";
        button.addEventListener("click", () => void complete(item));
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
    try {
      const attentionRows = {
        nextSevenDays: snapshot.attention.nextSevenDays.map(attentionRow),
        overdue: snapshot.attention.overdue.map(attentionRow),
        today: snapshot.attention.today.map(attentionRow),
      };
      const upcomingRows = snapshot.upcoming.map(upcomingRow);
      const todayText = new Intl.DateTimeFormat(undefined, {
        dateStyle: "full",
        timeZone: "UTC",
      }).format(new Date(`${snapshot.date}T12:00:00Z`));
      const attentionCount = Object.values(snapshot.attention).flat().length;
      const upcomingCount = snapshot.upcoming.length;
      stages.set(current, {
        actionableTaskIds: new Set(
          Object.values(snapshot.attention).flat().filter((item) =>
            item.kind === "task" && !item.person?.archived &&
            !item.person?.unavailable
          ).map((item) => item.id),
        ),
        attentionRows,
        attentionText: attentionCount === 0
          ? "All clear. No relationship work needs attention."
          : `${attentionCount} relationship priorit${
            attentionCount === 1 ? "y" : "ies"
          }.`,
        snapshot,
        todayText,
        upcomingRows,
        upcomingText: upcomingCount
          ? `${upcomingCount} upcoming item${upcomingCount === 1 ? "" : "s"}.`
          : "No upcoming relationship work in the next 30 days.",
      });
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
      if (trigger !== "attention") {
        upcomingRetryStates.set(activeWorkspaceId, !!upcomingRetry.hidden);
      }
      settleUnavailableDate();
      present(focus);
      return false;
    }
    if (superseded()) {
      stages.delete(current);
      return false;
    }
    const stage = stages.get(current)!;
    renderedGeneration = current;
    for (const key of Object.keys(lists) as (keyof typeof lists)[]) {
      lists[key]!.replaceChildren(...stage.attentionRows[key]);
    }
    upcomingList.replaceChildren(...stage.upcomingRows);
    const attentionCount = Object.values(stage.snapshot.attention).flat()
      .length;
    const upcomingCount = stage.snapshot.upcoming.length;
    onboarding.hidden = attentionCount + upcomingCount !== 0;
    attentionSummary = stage.attentionText;
    state.textContent = stage.attentionText;
    upcomingState.textContent = stage.upcomingText;
    retry.hidden = true;
    upcomingRetry.hidden = true;
    upcomingRetryStates.set(activeWorkspaceId, true);
    if (todayDate) {
      todayDate.dateTime = stage.snapshot.date;
      todayDate.textContent = stage.todayText;
    }
    const owner = completionOwners.get(activeWorkspaceId);
    const failure = completionFailures.get(activeWorkspaceId);
    if (
      owner?.phase === "confirmed" &&
      projectionSequence > owner.afterProjectionSequence &&
      !stage.actionableTaskIds.has(owner.taskId)
    ) {
      completionOwners.delete(activeWorkspaceId);
    }
    if (
      failure && projectionSequence > failure.afterProjectionSequence &&
      !stage.actionableTaskIds.has(failure.taskId)
    ) {
      completionFailures.delete(activeWorkspaceId);
    }
    stages.delete(current);
    present(focus);
    return true;
  };
  retry.addEventListener(
    "click",
    () => {
      if (
        !workspaceId || completionOwners.get(workspaceId)?.phase !== "pending"
      ) {
        void refresh("attention", { epoch, region: "attention" });
      }
    },
    { signal: abort.signal },
  );
  upcomingRetry.addEventListener(
    "click",
    () => {
      if (
        !workspaceId || completionOwners.get(workspaceId)?.phase !== "pending"
      ) {
        void refresh("upcoming", { epoch, region: "upcoming" });
      }
    },
    {
      signal: abort.signal,
    },
  );
  const surface: TodaySurface = { epoch, present, refresh, workspaceId };
  currentTodaySurface = surface;
  await refresh("initial");
}

export const mountTodayTasks = mountTodayAttention;
