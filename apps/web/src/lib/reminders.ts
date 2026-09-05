import { markFormSaved, saveWithLockedForm } from "./unsaved-changes.ts";
import {
  createReminder,
  createStayInTouchCadence,
  getPerson,
  getTodayReminders,
  listPersonReminders,
  type Reminder,
  setReminderActive,
  type TodayCadenceItem,
  type TodayReminderItem,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import { setRailCount, setRailEmpty } from "./person-facts-rail.ts";
import { registerRailEditors, requestRailEditorOpen } from "./rail-editors.ts";

let todayRemindersAbort: AbortController | undefined;
const TODAY_RECONNECT_RECORDED_EVENT = "kinship:today-reconnect-recorded";

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
}

function optimisticSaveRow(title: string, detail: string): HTMLLIElement {
  const row = document.createElement("li");
  row.className = "optimistic-save";
  row.setAttribute("aria-busy", "true");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const state = document.createElement("p");
  state.textContent = detail;
  row.append(heading, state);
  return row;
}

function reminderItem(
  reminder: Reminder,
  mutable: boolean,
  disable: (id: string) => void,
): HTMLLIElement {
  const item = document.createElement("li");
  item.className = "reminder-item";
  const heading = document.createElement("h3");
  heading.textContent = reminder.title;
  const state = document.createElement("p");
  state.textContent = reminder.nextOccurrence
    ? `${
      reminder.nextOccurrence.visibleAt
        ? "Notification visible"
        : reminder.nextOccurrence.status.replaceAll("_", " ")
    } · ${new Date(reminder.nextOccurrence.deliverAt).toLocaleString()}`
    : reminder.isActive
    ? "No future occurrence"
    : "Disabled";
  item.append(heading, state);
  if (mutable && reminder.isActive) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button-secondary";
    button.textContent = "Disable reminder";
    button.addEventListener("click", () => disable(reminder.id));
    item.append(button);
  }
  return item;
}

export async function mountPersonReminders(options: {
  readonly archived: boolean;
  readonly personId: string;
  readonly workspaceId: string;
}): Promise<void> {
  const reminderState = document.querySelector<HTMLElement>(
    "[data-reminder-state]",
  );
  const reminderList = document.querySelector<HTMLUListElement>(
    "[data-reminder-list]",
  );
  const reminderForm = document.querySelector<HTMLFormElement>(
    "[data-reminder-form]",
  );
  const reminderAdd = document.querySelector<HTMLButtonElement>(
    "[data-reminder-add]",
  );
  const reminderCancel = document.querySelector<HTMLButtonElement>(
    "[data-reminder-cancel]",
  );
  const cadenceState = document.querySelector<HTMLElement>(
    "[data-cadence-state]",
  );
  const cadenceList = document.querySelector<HTMLUListElement>(
    "[data-cadence-list]",
  );
  const cadenceForm = document.querySelector<HTMLFormElement>(
    "[data-cadence-form]",
  );
  const cadenceAdd = document.querySelector<HTMLButtonElement>(
    "[data-cadence-add]",
  );
  const cadenceCancel = document.querySelector<HTMLButtonElement>(
    "[data-cadence-cancel]",
  );
  const cadenceHero = document.querySelector<HTMLElement>(
    "#person-profile-due-state",
  );
  const nextReminderHero = document.querySelector<HTMLElement>(
    '[data-person-vital-value="next-reminder"]',
  );
  const reminderSection = reminderState?.closest<HTMLElement>(
    '[data-profile-section="reminders"]',
  );
  const cadenceSection = cadenceState?.closest<HTMLElement>(
    '[data-profile-section="stay-in-touch"]',
  );
  if (
    !reminderState || !reminderList || !reminderForm || !cadenceState ||
    !cadenceList || !cadenceForm
  ) return;
  registerRailEditors([cadenceForm], (form) => {
    form.hidden = true;
    form.reset();
  });
  const reminderSubmit = reminderForm.querySelector<HTMLButtonElement>(
    "[type=submit]",
  );
  const cadenceSubmit = cadenceForm.querySelector<HTMLButtonElement>(
    "[type=submit]",
  );
  let lifecycleArchived = options.archived;
  let reminderRequestId: string | undefined;
  let cadenceRequestId: string | undefined;
  let busy = false;
  const setBusy = (value: boolean) => {
    busy = value;
    for (
      const control of [
        reminderSubmit,
        cadenceSubmit,
        reminderAdd,
        cadenceAdd,
        ...reminderList.querySelectorAll<HTMLButtonElement>("button"),
      ]
    ) control?.toggleAttribute("disabled", busy || lifecycleArchived);
    for (const section of [reminderSection, cadenceSection]) {
      if (busy) section?.setAttribute("aria-busy", "true");
      else section?.removeAttribute("aria-busy");
    }
  };
  const beginMutation = () => {
    if (lifecycleArchived || busy) return false;
    setBusy(true);
    return true;
  };
  const load = async (refreshSummary = false) => {
    reminderAdd?.setAttribute("hidden", "");
    cadenceAdd?.setAttribute("hidden", "");
    if (reminderSection) reminderSection.dataset.sectionState = "loading";
    if (cadenceSection) cadenceSection.dataset.sectionState = "loading";
    reminderState.textContent = "Loading reminders…";
    cadenceState.textContent = "Loading stay-in-touch cadence…";
    if (cadenceHero) cadenceHero.textContent = "Loading cadence…";
    if (refreshSummary && nextReminderHero) {
      nextReminderHero.textContent = "Refreshing…";
    }
    setRailEmpty("stay-in-touch", false);
    const [result, summary] = await Promise.all([
      listPersonReminders(options.personId, options.workspaceId).catch(() =>
        undefined
      ),
      // The list is bounded and includes delivery history; only the profile
      // summary knows the next pending reminder across all records.
      refreshSummary
        ? getPerson(options.personId, options.workspaceId, "summary").catch(
          () => undefined,
        )
        : undefined,
    ]);
    if (refreshSummary && nextReminderHero) {
      nextReminderHero.textContent = summary?.ok
        ? summary.value.dueInformation.nextReminderAt
          ? new Date(summary.value.dueInformation.nextReminderAt)
            .toLocaleString()
          : "Not recorded"
        : "Unavailable";
    }
    if (!result?.ok) {
      if (cadenceHero) cadenceHero.textContent = "Unavailable";
      if (reminderSection) reminderSection.dataset.sectionState = "error";
      if (cadenceSection) cadenceSection.dataset.sectionState = "error";
      reminderState.textContent =
        "Reminders could not be loaded. Retry this section.";
      cadenceState.textContent =
        "Cadence could not be loaded. Other profile sections remain available.";
      setRailCount("stay-in-touch", undefined);
      setRailEmpty("stay-in-touch", false);
      return;
    }
    const disable = async (id: string) => {
      if (!beginMutation()) return;
      reminderState.textContent = "Disabling reminder…";
      try {
        const changed = await setReminderActive(id, false, options.workspaceId)
          .catch(() => undefined);
        reminderState.textContent = changed?.ok
          ? "Reminder disabled."
          : "Reminder could not be disabled.";
        if (changed?.ok) await load(true);
      } finally {
        setBusy(false);
      }
    };
    reminderList.replaceChildren(
      ...result.value.reminders.map((item) =>
        reminderItem(item, !lifecycleArchived, (id) => void disable(id))
      ),
    );
    reminderState.textContent = result.value.reminders.length >= 100
      ? `Showing first ${result.value.reminders.length} reminders.`
      : result.value.reminders.length
      ? `${result.value.reminders.length} reminder${
        result.value.reminders.length === 1 ? "" : "s"
      }.`
      : "No reminders yet.";
    if (reminderSection) {
      reminderSection.dataset.sectionState = result.value.reminders.length === 0
        ? "empty"
        : "ready";
    }
    const cadences = result.value.cadences.filter((cadence) =>
      cadence.isActive
    );
    if (cadenceHero) {
      cadenceHero.textContent = cadences.length
        ? cadences.map((cadence) =>
          `Every ${cadence.intervalCount} ${cadence.intervalUnit}${
            cadence.intervalCount === 1 ? "" : "s"
          }`
        ).join(" · ")
        : "Not set";
    }
    cadenceList.replaceChildren(...cadences.map((cadence) => {
      const item = document.createElement("li");
      item.textContent =
        `Every ${cadence.intervalCount} ${cadence.intervalUnit}${
          cadence.intervalCount === 1 ? "" : "s"
        } · due ${new Date(cadence.nextDueAt).toLocaleString()}`;
      return item;
    }));
    cadenceState.textContent = cadences.length
      ? "Stay-in-touch cadence is active."
      : "No stay-in-touch cadence yet.";
    if (cadenceSection) {
      cadenceSection.dataset.sectionState = cadences.length === 0
        ? "empty"
        : "ready";
    }
    setRailCount("stay-in-touch", cadences.length);
    setRailEmpty(
      "stay-in-touch",
      cadences.length === 0,
    );
    reminderAdd?.toggleAttribute("hidden", lifecycleArchived);
    cadenceAdd?.toggleAttribute("hidden", lifecycleArchived);
  };
  reminderAdd?.addEventListener("click", () => {
    reminderForm.hidden = false;
    reminderForm.querySelector<HTMLElement>("input, select, textarea")?.focus();
  });
  reminderCancel?.addEventListener("click", () => {
    reminderForm.hidden = true;
    reminderForm.reset();
    reminderAdd?.focus();
  });
  cadenceAdd?.addEventListener("click", () => {
    if (!requestRailEditorOpen(cadenceForm, false, cadenceAdd)) return;
    cadenceForm.hidden = false;
    cadenceForm.querySelector<HTMLElement>("input, select, textarea")?.focus();
  });
  cadenceCancel?.addEventListener("click", () => {
    cadenceForm.hidden = true;
    cadenceForm.reset();
    cadenceAdd?.focus();
  });
  reminderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!beginMutation()) return;
    reminderState.textContent = "Saving reminder…";
    reminderRequestId ??= crypto.randomUUID();
    const title = formValue(reminderForm, "title");
    const anchorOn = formValue(reminderForm, "anchorOn");
    const recurrenceInterval = Number(
      formValue(reminderForm, "recurrenceInterval"),
    );
    const recurrenceUnit = formValue(
      reminderForm,
      "recurrenceUnit",
    ) as Reminder["recurrenceUnit"];
    const sendTime = formValue(reminderForm, "sendTime");
    const optimisticRow = optimisticSaveRow(
      title || "Untitled reminder",
      `Saving for ${anchorOn || "the selected date"} at ${
        sendTime || "the selected time"
      }…`,
    );
    reminderList.append(optimisticRow);
    try {
      const result = await createReminder({
        anchorOn,
        personId: options.personId,
        recurrenceInterval,
        recurrenceUnit,
        requestId: reminderRequestId,
        sendTime,
        title,
      }, options.workspaceId).catch(() => undefined);
      reminderState.textContent = result?.ok
        ? "Reminder created."
        : "Reminder could not be saved. Review the calendar fields.";
      if (result?.ok) {
        reminderRequestId = undefined;
        reminderForm.reset();
        reminderForm.hidden = true;
        await load(true);
      }
    } finally {
      optimisticRow.remove();
      setBusy(false);
    }
  });
  cadenceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!beginMutation()) return;
    cadenceState.textContent = "Saving cadence…";
    const requestId = cadenceRequestId ??= crypto.randomUUID();
    const intervalCount = Number(formValue(cadenceForm, "intervalCount"));
    const intervalUnit = formValue(cadenceForm, "intervalUnit") as
      | "day"
      | "week"
      | "month"
      | "year";
    const optimisticRow = optimisticSaveRow(
      `Every ${intervalCount} ${intervalUnit}${intervalCount === 1 ? "" : "s"}`,
      "Saving stay-in-touch cadence…",
    );
    cadenceList.append(optimisticRow);
    try {
      const result = await saveWithLockedForm(
        cadenceForm,
        () =>
          createStayInTouchCadence({
            intervalCount,
            intervalUnit,
            personId: options.personId,
            requestId,
          }, options.workspaceId),
      ).catch(() => undefined);
      cadenceState.textContent = result?.ok
        ? "Cadence saved."
        : "Cadence could not be saved.";
      if (result?.ok) {
        cadenceRequestId = undefined;
        markFormSaved(cadenceForm);
        cadenceForm.hidden = true;
        await load(true);
      } else cadenceState.focus();
    } finally {
      optimisticRow.remove();
      setBusy(false);
    }
  });
  const reload = async () => {
    // Initial/lifecycle reads share the mutation owner. A pending mutation
    // already refreshes using the current lifecycle state before releasing it.
    if (busy) return;
    setBusy(true);
    try {
      await load();
    } finally {
      setBusy(false);
    }
  };
  document.addEventListener("person-lifecycle-changed", (event) => {
    const detail = (event as CustomEvent<{
      readonly archived?: unknown;
      readonly personId?: unknown;
    }>).detail;
    if (
      detail?.personId !== options.personId ||
      typeof detail.archived !== "boolean"
    ) return;
    lifecycleArchived = detail.archived;
    setBusy(busy);
    reminderAdd?.toggleAttribute("hidden", lifecycleArchived);
    cadenceAdd?.toggleAttribute("hidden", lifecycleArchived);
    if (lifecycleArchived) {
      reminderList.querySelectorAll("button").forEach((button) =>
        button.remove()
      );
    } else {
      void reload();
    }
  });
  await reload();
}

function formatToday(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  }).format(new Date(value));
}

function todayReminder(
  item: TodayReminderItem,
  timezone: string,
): HTMLLIElement {
  const row = document.createElement("li");
  row.className = `reminder-item reminder-${item.status}`;
  const link = document.createElement("a");
  link.className = "today-touch-target";
  link.href = `/app/people/${
    encodeURIComponent(item.person.id)
  }?section=reminders`;
  link.textContent = `${item.title} · ${item.person.name}`;
  const state = document.createElement("p");
  state.textContent = item.status === "manual_attention"
    ? "Delivery needs manual attention"
    : item.status === "failed"
    ? "Delivery failed"
    : item.visibleAt
    ? `Notification visible · ${formatToday(item.visibleAt, timezone)}`
    : item.status === "pending"
    ? `Scheduled for ${formatToday(item.deliverAt, timezone)}`
    : item.status === "retry"
    ? `Retry scheduled for ${formatToday(item.nextAttemptAt, timezone)}`
    : item.status === "claimed"
    ? "Delivery in progress"
    : `Delivered · ${formatToday(item.deliverAt, timezone)}`;
  row.append(link, state);
  return row;
}

function todayCadence(
  item: TodayCadenceItem,
  timezone: string,
): HTMLLIElement {
  const row = document.createElement("li");
  if (!item.person) {
    row.textContent = "Reconnect person unavailable";
    return row;
  }
  const link = document.createElement("a");
  link.className = "today-touch-target";
  link.href = `/app/people/${
    encodeURIComponent(item.person.id)
  }?section=stay-in-touch`;
  link.textContent = item.person.name;
  const state = document.createElement("p");
  state.textContent = `Reconnect by ${formatToday(item.dueAt, timezone)} · ${
    item.lastContactedAt
      ? `Last contact ${formatToday(item.lastContactedAt, timezone)}`
      : "No contact recorded"
  }${item.person.archived ? " · archived" : ""}`;
  row.append(link, state);
  if (!item.person.archived) {
    const capture = document.createElement("button");
    capture.type = "button";
    capture.className = "button-secondary today-touch-target";
    capture.disabled = true;
    capture.dataset.quickCapture = "";
    capture.dataset.todayReconnectCapture = "";
    capture.dataset.interactionCaptureReady = "false";
    capture.dataset.interactionIntendedKind = "activity";
    capture.dataset.interactionPersonId = item.person.id;
    capture.textContent = "Log interaction";
    row.append(capture);
  }
  return row;
}

export async function mountTodayReminders(): Promise<void> {
  todayRemindersAbort?.abort();
  const reminderState = document.querySelector<HTMLElement>(
    "#today-reminders-state",
  );
  const reminderList = document.querySelector<HTMLUListElement>(
    "#today-reminders-list",
  );
  const cadenceState = document.querySelector<HTMLElement>(
    "#today-cadences-state",
  );
  const cadenceList = document.querySelector<HTMLUListElement>(
    "#today-cadences-list",
  );
  const reminderRetry = document.querySelector<HTMLButtonElement>(
    "#today-reminders-retry",
  );
  const cadenceRetry = document.querySelector<HTMLButtonElement>(
    "#today-cadences-retry",
  );
  if (
    !reminderState || !reminderList || !cadenceState || !cadenceList ||
    !reminderRetry || !cadenceRetry
  ) return;
  const abort = new AbortController();
  todayRemindersAbort = abort;
  let reminderGeneration = 0;
  let cadenceGeneration = 0;
  type LoadScope = "cadence" | "full" | "reminder";
  const focusState = (target: HTMLElement, restoreFocus: boolean) => {
    if (!restoreFocus) return;
    target.tabIndex = -1;
    target.focus();
  };
  const failReminder = (restoreFocus: boolean) => {
    reminderState.textContent =
      "Reminder state is unavailable. Other Today regions remain available.";
    reminderRetry.hidden = false;
    focusState(reminderState, restoreFocus);
  };
  const failCadence = (restoreFocus: boolean) => {
    cadenceState.textContent = "Reconnect suggestions are unavailable.";
    cadenceRetry.hidden = false;
    focusState(cadenceState, restoreFocus);
  };
  const load = async (
    scope: LoadScope,
    restoreFocus = false,
  ) => {
    const ownsReminder = scope !== "cadence";
    const ownsCadence = scope !== "reminder";
    const reminderCurrent = ownsReminder ? ++reminderGeneration : 0;
    const cadenceCurrent = ownsCadence ? ++cadenceGeneration : 0;
    if (ownsReminder) {
      reminderState.textContent = "Loading reminder state…";
      reminderRetry.hidden = true;
    }
    if (ownsCadence) {
      cadenceState.textContent = "Loading reconnect suggestions…";
      cadenceRetry.hidden = true;
    }
    const session = await resolveWorkspaceSession();
    if (abort.signal.aborted) return;
    if (session.status !== "ready") {
      if (ownsReminder && reminderCurrent === reminderGeneration) {
        failReminder(restoreFocus);
      }
      if (ownsCadence && cadenceCurrent === cadenceGeneration) {
        failCadence(restoreFocus);
      }
      return;
    }
    const result = await getTodayReminders(session.session.workspace.id).catch(
      () => undefined,
    );
    if (abort.signal.aborted) return;
    if (!result?.ok) {
      if (ownsReminder && reminderCurrent === reminderGeneration) {
        failReminder(restoreFocus);
      }
      if (ownsCadence && cadenceCurrent === cadenceGeneration) {
        failCadence(restoreFocus);
      }
      return;
    }
    if (ownsReminder && reminderCurrent === reminderGeneration) {
      try {
        const rows = result.value.reminders.map((item) =>
          todayReminder(item, result.value.timezone)
        );
        reminderRetry.hidden = true;
        reminderList.replaceChildren(...rows);
        reminderState.textContent = result.value.reminders.length
          ? `${result.value.reminders.length} reminder state${
            result.value.reminders.length === 1 ? "" : "s"
          }.`
          : "No reminders in the next 30 days.";
        focusState(reminderState, restoreFocus);
      } catch {
        failReminder(restoreFocus);
      }
    }
    if (ownsCadence && cadenceCurrent === cadenceGeneration) {
      try {
        const rows = result.value.cadences.map((item) =>
          todayCadence(item, result.value.timezone)
        );
        cadenceRetry.hidden = true;
        cadenceList.replaceChildren(...rows);
        cadenceState.textContent = result.value.cadences.length
          ? `${result.value.cadences.length} people to reconnect with.`
          : "No one is due for contact.";
        focusState(cadenceState, restoreFocus);
      } catch {
        failCadence(restoreFocus);
      }
    }
  };
  reminderRetry.addEventListener("click", () => void load("reminder", true), {
    signal: abort.signal,
  });
  cadenceRetry.addEventListener("click", () => void load("cadence", true), {
    signal: abort.signal,
  });
  globalThis.addEventListener(TODAY_RECONNECT_RECORDED_EVENT, () => {
    void load("cadence", true);
  }, { signal: abort.signal });
  await load("full");
}
