/**
 * Today's attention and upcoming regions (`pages/app.astro`). The person
 * tasks card and the `/app/tasks` page are one island now
 * (`features/tasks/`, GAP-031); these regions move in GAP-033.
 */

import {
  formatCalendarDate,
  formatInstant,
  loadTimePreferences,
} from "./time-presentation.ts";
import {
  getTodayAttention,
  setTaskCompletion,
  type TodayAttention,
  type TodayAttentionItem,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import {
  buttonVariants,
  formActionsVariants,
} from "../components/ui/variants.ts";
import { TASK_CHANGED_EVENT } from "../features/tasks/tasks.ts";

export { TASK_CHANGED_EVENT };
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
  let workspaceId: string | undefined;
  type Trigger = "attention" | "initial" | "upcoming";
  type Region = Exclude<Trigger, "initial">;
  type Operation = {
    cancelled: boolean;
    readonly id: number;
    readonly regions: readonly Region[];
  };
  type AttentionTerminal = {
    readonly actionableTaskIds: readonly string[];
    readonly items: TodayAttention["attention"];
    readonly status: string;
    readonly timezone: string;
    readonly value: boolean;
    readonly retryHidden: boolean;
  };
  type UpcomingTerminal = {
    readonly items: TodayAttention["upcoming"];
    readonly status: string;
    readonly timezone: string;
    readonly value: boolean;
    readonly retryHidden: boolean;
  };
  let attentionTerminal: AttentionTerminal = {
    actionableTaskIds: [],
    items: { nextSevenDays: [], overdue: [], today: [] },
    retryHidden: true,
    status: "",
    timezone: "UTC",
    value: false,
  };
  let upcomingTerminal: UpcomingTerminal = {
    items: [],
    retryHidden: true,
    status: "",
    timezone: "UTC",
    value: false,
  };
  let operationId = 0;
  let contextOperationId = 0;
  let dateOperationId = 0;
  let focusOperationId = 0;
  const regionOwners = new Map<Region, Operation>();
  const statusFor = (trigger: Trigger) =>
    trigger === "upcoming" ? upcomingState : state;
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
    attentionTerminal = {
      ...attentionTerminal,
      actionableTaskIds: [],
      items: { nextSevenDays: [], overdue: [], today: [] },
      status: "",
      value: false,
    };
    upcomingTerminal = {
      ...upcomingTerminal,
      items: [],
      status: "",
      value: false,
    };
    dateOperationId = 0;
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
      if (item.kind === "task") element.dataset.taskId = item.id;
    }
    return element;
  };
  const present = (focus?: FocusToken) => {
    const owner = workspaceId ? completionOwners.get(workspaceId) : undefined;
    const failure = workspaceId
      ? completionFailures.get(workspaceId)
      : undefined;
    const controls = [...document.querySelectorAll<HTMLButtonElement>(
      "button[data-today-complete]",
    )];
    for (const control of controls) control.disabled = owner !== undefined;
    const exact = failure
      ? controls.find((control) => control.dataset.taskId === failure.taskId)
      : undefined;
    state.textContent = regionOwners.has("attention")
      ? "Loading relationship priorities…"
      : attentionTerminal.status;
    retry.hidden = regionOwners.has("attention") ||
      attentionTerminal.retryHidden;
    upcomingState.textContent = regionOwners.has("upcoming")
      ? "Loading upcoming work…"
      : upcomingTerminal.status;
    upcomingRetry.hidden = regionOwners.has("upcoming") ||
      upcomingTerminal.retryHidden;
    const summary = attentionTerminal.status ||
      "Relationship priorities are unchanged.";
    if (owner?.phase === "pending") {
      state.textContent = "Completing task…";
      retry.hidden = true;
      upcomingRetry.hidden = true;
    } else if (owner) {
      state.textContent =
        `${summary} Task completion is confirmed; the projection has not caught up.`;
      retry.hidden = false;
      upcomingRetry.hidden = upcomingRetryStates.get(workspaceId ?? "") ?? true;
    } else if (failure) {
      state.textContent = `${summary} Task could not be completed. ${
        exact ? "Retry Complete." : "Retry the attention projection."
      }`;
      retry.hidden = exact !== undefined;
      upcomingRetry.hidden = upcomingRetryStates.get(workspaceId ?? "") ?? true;
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
  const cancel = (operation: Operation) => {
    operation.cancelled = true;
    for (const region of operation.regions) {
      if (regionOwners.get(region) === operation) regionOwners.delete(region);
    }
  };
  const begin = (trigger: Trigger, focus?: FocusToken): Operation => {
    const regions: readonly Region[] = trigger === "initial"
      ? ["attention", "upcoming"]
      : [trigger];
    for (
      const prior of new Set(regions.map((region) => regionOwners.get(region)))
    ) {
      if (prior) cancel(prior);
    }
    const operation: Operation = {
      cancelled: false,
      id: ++operationId,
      regions,
    };
    for (const region of regions) regionOwners.set(region, operation);
    if (focus) focusOperationId = operation.id;
    present();
    return operation;
  };
  const owns = (operation: Operation) =>
    !abort.signal.aborted && !operation.cancelled &&
    operation.regions.every((region) => regionOwners.get(region) === operation);
  const settle = (operation: Operation, focus?: FocusToken) => {
    cancel(operation);
    present(focus && focusOperationId === operation.id ? focus : undefined);
  };
  const refresh = async (trigger: Trigger, focus?: FocusToken) => {
    const focusedTask = trigger === "initial" && !focus &&
        document.activeElement instanceof HTMLElement &&
        document.activeElement.dataset.taskId
      ? {
        id: document.activeElement.dataset.taskId,
        tag: document.activeElement.tagName,
      }
      : undefined;
    const operation = begin(trigger, focus);
    const session = await resolveWorkspaceSession();
    if (!owns(operation)) return false;
    const activeWorkspaceId = session.status === "ready"
      ? session.session.workspace.id
      : undefined;
    const activePrincipalId = session.status === "ready"
      ? session.session.principal.userId
      : undefined;
    const contextChanged = workspaceId !== activeWorkspaceId ||
      (activePrincipalId !== undefined &&
        todayPrincipalId !== activePrincipalId);
    if (contextChanged && operation.id < contextOperationId) {
      settle(operation);
      return false;
    }
    contextOperationId = Math.max(contextOperationId, operation.id);
    if (contextChanged) {
      for (const candidate of new Set(regionOwners.values())) {
        if (candidate !== operation) cancel(candidate);
      }
      clearProjection();
      workspaceId = activeWorkspaceId;
      surface.workspaceId = activeWorkspaceId;
    }
    if (activeWorkspaceId) {
      const ready = session as Extract<typeof session, { status: "ready" }>;
      if (todayPrincipalId !== activePrincipalId) {
        completionOwners.clear();
        completionFailures.clear();
        projectionSequences.clear();
        upcomingRetryStates.clear();
        todayPrincipalId = activePrincipalId;
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
    if (!owns(operation)) return false;
    if (!activeWorkspaceId || !result?.ok) {
      if (operation.regions.includes("attention")) {
        attentionTerminal = {
          ...attentionTerminal,
          retryHidden: false,
          status:
            "Attention could not be loaded. Other Today regions remain available.",
        };
      }
      if (operation.regions.includes("upcoming")) {
        upcomingTerminal = {
          ...upcomingTerminal,
          retryHidden: false,
          status:
            "Upcoming work could not be loaded. Needs attention is unchanged.",
        };
      }
      if (activeWorkspaceId && operation.regions.includes("upcoming")) {
        upcomingRetryStates.set(activeWorkspaceId, false);
      }
      settleUnavailableDate();
      settle(operation, focus);
      return false;
    }
    const timePreferences = await loadTimePreferences(activeWorkspaceId!);
    if (!owns(operation)) return false;
    const snapshot = result.value;
    const complete = async (
      item: Extract<TodayAttentionItem, { kind: "task" }>,
      row: HTMLLIElement,
      control: HTMLButtonElement,
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
      row.hidden = true;
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
        control.disabled = false;
        row.hidden = false;
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
      }
      if (!completionOwners.has(activeWorkspaceId)) control.disabled = false;
    };
    const attentionRow = (item: TodayAttentionItem) => {
      const element = document.createElement("li");
      element.className = `attention-item attention-${item.kind}`;
      const meta = document.createElement("p");
      meta.textContent = `${item.kind === "cadence" ? "Reconnect by" : "Due"} ${
        formatInstant(item.dueAt, timePreferences)
      }${item.person ? ` · ${item.person.name}` : ""}${
        item.kind === "cadence"
          ? ` · ${
            item.lastContactedAt
              ? `Last contact ${
                formatInstant(item.lastContactedAt, timePreferences)
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
        actions.className = formActionsVariants();
        const button = document.createElement("button");
        button.type = "button";
        button.className = buttonVariants({ variant: "outline" });
        button.dataset.todayComplete = "";
        button.dataset.taskId = item.id;
        button.disabled = completionOwners.has(activeWorkspaceId);
        button.textContent = "Complete";
        button.addEventListener(
          "click",
          () => void complete(item, element, button),
        );
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
      meta.textContent = `${formatInstant(item.dueAt, timePreferences)}${
        item.person ? ` · ${item.person.name}` : ""
      }`;
      element.append(heading, meta);
      return element;
    };
    try {
      const attentionCount = Object.values(snapshot.attention).flat().length;
      const upcomingCount = snapshot.upcoming.length;
      const stagedAttention: AttentionTerminal | undefined =
        operation.regions.includes("attention")
          ? {
            actionableTaskIds: Object.values(snapshot.attention).flat().filter(
              (item) =>
                item.kind === "task" && !item.person?.archived &&
                !item.person?.unavailable,
            ).map((item) => item.id),
            items: snapshot.attention,
            retryHidden: true,
            status: attentionCount === 0
              ? "All clear. No relationship work needs attention."
              : `${attentionCount} relationship priorit${
                attentionCount === 1 ? "y" : "ies"
              }.`,
            timezone: snapshot.timezone,
            value: true,
          }
          : undefined;
      const stagedUpcoming: UpcomingTerminal | undefined =
        operation.regions.includes("upcoming")
          ? {
            items: snapshot.upcoming,
            retryHidden: true,
            status: upcomingCount
              ? `${upcomingCount} upcoming item${
                upcomingCount === 1 ? "" : "s"
              }.`
              : "No upcoming relationship work in the next 30 days.",
            timezone: snapshot.timezone,
            value: true,
          }
          : undefined;
      const attentionRows = stagedAttention && {
        nextSevenDays: stagedAttention.items.nextSevenDays.map(attentionRow),
        overdue: stagedAttention.items.overdue.map(attentionRow),
        today: stagedAttention.items.today.map(attentionRow),
      };
      const upcomingRows = stagedUpcoming?.items.map(upcomingRow);
      new Intl.DateTimeFormat(undefined, {
        timeZone: snapshot.timezone,
      }).format(new Date(`${snapshot.date}T12:00:00Z`));
      const todayText = formatCalendarDate(
        snapshot.date,
        timePreferences?.locale ?? "en",
        { dateStyle: "full" },
      );
      if (!owns(operation)) return false;
      if (stagedAttention && attentionRows) {
        attentionTerminal = stagedAttention;
        for (const key of Object.keys(lists) as (keyof typeof lists)[]) {
          lists[key]!.replaceChildren(...attentionRows[key]);
        }
        const owner = completionOwners.get(activeWorkspaceId);
        const failure = completionFailures.get(activeWorkspaceId);
        if (
          owner?.phase === "confirmed" &&
          projectionSequence > owner.afterProjectionSequence &&
          !stagedAttention.actionableTaskIds.includes(owner.taskId)
        ) completionOwners.delete(activeWorkspaceId);
        if (
          failure && projectionSequence > failure.afterProjectionSequence &&
          !stagedAttention.actionableTaskIds.includes(failure.taskId)
        ) completionFailures.delete(activeWorkspaceId);
      }
      if (stagedUpcoming && upcomingRows) {
        upcomingTerminal = stagedUpcoming;
        upcomingList.replaceChildren(...upcomingRows);
        upcomingRetryStates.set(activeWorkspaceId, true);
      }
      onboarding.hidden = !attentionTerminal.value ||
        !upcomingTerminal.value ||
        Object.values(attentionTerminal.items).flat().length +
              upcomingTerminal.items.length !== 0;
      if (operation.id > dateOperationId && todayDate) {
        dateOperationId = operation.id;
        todayDate.dateTime = snapshot.date;
        todayDate.textContent = todayText;
      }
      if (focusedTask) {
        [...document.querySelectorAll<HTMLElement>("[data-task-id]")].find(
          (control) =>
            control.dataset.taskId === focusedTask.id &&
            control.tagName === focusedTask.tag,
        )?.focus();
      }
      settle(operation, focus);
      return true;
    } catch {
      if (!owns(operation)) return false;
      if (operation.regions.includes("attention")) {
        attentionTerminal = {
          ...attentionTerminal,
          retryHidden: false,
          status:
            "Attention could not be loaded. Other Today regions remain available.",
        };
      }
      if (operation.regions.includes("upcoming")) {
        upcomingTerminal = {
          ...upcomingTerminal,
          retryHidden: false,
          status:
            "Upcoming work could not be loaded. Needs attention is unchanged.",
        };
        upcomingRetryStates.set(activeWorkspaceId, false);
      }
      settleUnavailableDate();
      settle(operation, focus);
      return false;
    }
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
  globalThis.addEventListener("kinship:today-reconnect-recorded", () => {
    void refresh("initial");
  }, { signal: abort.signal });
  await refresh("initial");
}

export const mountTodayTasks = mountTodayAttention;
