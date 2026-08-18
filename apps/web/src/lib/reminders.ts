import {
  createReminder,
  createStayInTouchCadence,
  getTodayReminders,
  listPersonReminders,
  type Reminder,
  setReminderActive,
  type TodayCadenceItem,
  type TodayReminderItem,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";

function formValue(form: HTMLFormElement, name: string): string {
  return String(new FormData(form).get(name) ?? "").trim();
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
  const cadenceState = document.querySelector<HTMLElement>(
    "[data-cadence-state]",
  );
  const cadenceList = document.querySelector<HTMLUListElement>(
    "[data-cadence-list]",
  );
  const cadenceForm = document.querySelector<HTMLFormElement>(
    "[data-cadence-form]",
  );
  if (
    !reminderState || !reminderList || !reminderForm || !cadenceState ||
    !cadenceList || !cadenceForm
  ) return;
  const reminderSubmit = reminderForm.querySelector<HTMLButtonElement>(
    "[type=submit]",
  );
  const cadenceSubmit = cadenceForm.querySelector<HTMLButtonElement>(
    "[type=submit]",
  );
  let lifecycleArchived = options.archived;
  if (lifecycleArchived) {
    reminderSubmit?.setAttribute("disabled", "");
    cadenceSubmit?.setAttribute("disabled", "");
  }
  let reminderRequestId: string | undefined;
  let cadenceRequestId: string | undefined;
  let reminderSaving = false;
  let cadenceSaving = false;
  const load = async () => {
    reminderState.textContent = "Loading reminders…";
    cadenceState.textContent = "Loading stay-in-touch cadence…";
    const result = await listPersonReminders(
      options.personId,
      options.workspaceId,
    ).catch(() => undefined);
    if (!result?.ok) {
      reminderState.textContent =
        "Reminders could not be loaded. Retry this section.";
      cadenceState.textContent =
        "Cadence could not be loaded. Other profile sections remain available.";
      return;
    }
    const disable = async (id: string) => {
      if (lifecycleArchived) return;
      const changed = await setReminderActive(id, false, options.workspaceId)
        .catch(() => undefined);
      reminderState.textContent = changed?.ok
        ? "Reminder disabled."
        : "Reminder could not be disabled.";
      if (changed?.ok) await load();
    };
    reminderList.replaceChildren(
      ...result.value.reminders.map((item) =>
        reminderItem(item, !lifecycleArchived, (id) => void disable(id))
      ),
    );
    reminderState.textContent = result.value.reminders.length
      ? `${result.value.reminders.length} reminder${
        result.value.reminders.length === 1 ? "" : "s"
      }.`
      : "No reminders yet.";
    cadenceList.replaceChildren(...result.value.cadences.map((cadence) => {
      const item = document.createElement("li");
      item.textContent =
        `Every ${cadence.intervalCount} ${cadence.intervalUnit}${
          cadence.intervalCount === 1 ? "" : "s"
        } · due ${new Date(cadence.nextDueAt).toLocaleString()}`;
      return item;
    }));
    cadenceState.textContent = result.value.cadences.length
      ? "Stay-in-touch cadence is active."
      : "No stay-in-touch cadence yet.";
  };
  reminderForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (lifecycleArchived || reminderSaving) return;
    reminderSaving = true;
    reminderSubmit?.setAttribute("disabled", "");
    reminderState.textContent = "Saving reminder…";
    reminderRequestId ??= crypto.randomUUID();
    const result = await createReminder({
      anchorOn: formValue(reminderForm, "anchorOn"),
      personId: options.personId,
      recurrenceInterval: Number(formValue(reminderForm, "recurrenceInterval")),
      recurrenceUnit: formValue(
        reminderForm,
        "recurrenceUnit",
      ) as Reminder["recurrenceUnit"],
      requestId: reminderRequestId,
      sendTime: formValue(reminderForm, "sendTime"),
      title: formValue(reminderForm, "title"),
    }, options.workspaceId).catch(() => undefined);
    reminderState.textContent = result?.ok
      ? "Reminder created."
      : "Reminder could not be saved. Review the calendar fields.";
    if (result?.ok) {
      reminderRequestId = undefined;
      reminderForm.reset();
      await load();
    }
    reminderSaving = false;
    if (!lifecycleArchived) reminderSubmit?.removeAttribute("disabled");
  });
  cadenceForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (lifecycleArchived || cadenceSaving) return;
    cadenceSaving = true;
    cadenceSubmit?.setAttribute("disabled", "");
    cadenceState.textContent = "Saving cadence…";
    cadenceRequestId ??= crypto.randomUUID();
    const result = await createStayInTouchCadence({
      intervalCount: Number(formValue(cadenceForm, "intervalCount")),
      intervalUnit: formValue(cadenceForm, "intervalUnit") as
        | "day"
        | "week"
        | "month"
        | "year",
      personId: options.personId,
      requestId: cadenceRequestId,
    }, options.workspaceId).catch(() => undefined);
    cadenceState.textContent = result?.ok
      ? "Cadence saved."
      : "Cadence could not be saved.";
    if (result?.ok) {
      cadenceRequestId = undefined;
      await load();
    }
    cadenceSaving = false;
    if (!lifecycleArchived) cadenceSubmit?.removeAttribute("disabled");
  });
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
    reminderSubmit?.toggleAttribute(
      "disabled",
      lifecycleArchived || reminderSaving,
    );
    cadenceSubmit?.toggleAttribute(
      "disabled",
      lifecycleArchived || cadenceSaving,
    );
    if (lifecycleArchived) {
      reminderList.querySelectorAll("button").forEach((button) =>
        button.remove()
      );
    } else {
      void load();
    }
  });
  await load();
}

function todayReminder(item: TodayReminderItem): HTMLLIElement {
  const row = document.createElement("li");
  row.className = `reminder-item reminder-${item.status}`;
  const link = document.createElement("a");
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
    ? `Notification visible · ${new Date(item.visibleAt).toLocaleString()}`
    : `${item.status} · ${new Date(item.deliverAt).toLocaleString()}`;
  row.append(link, state);
  return row;
}

function todayCadence(item: TodayCadenceItem): HTMLLIElement {
  const row = document.createElement("li");
  const link = document.createElement("a");
  link.href = `/app/people/${
    encodeURIComponent(item.person.id)
  }?section=stay-in-touch`;
  link.textContent = item.person.name;
  const state = document.createElement("p");
  state.textContent = `Reconnect by ${new Date(item.dueAt).toLocaleString()}`;
  row.append(link, state);
  return row;
}

export async function mountTodayReminders(): Promise<void> {
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
  const retry = document.querySelector<HTMLButtonElement>(
    "#today-reminders-retry",
  );
  if (
    !reminderState || !reminderList || !cadenceState || !cadenceList || !retry
  ) return;
  const load = async () => {
    const session = await resolveWorkspaceSession();
    if (session.status !== "ready") return;
    const result = await getTodayReminders(session.session.workspace.id).catch(
      () => undefined,
    );
    if (!result?.ok) {
      reminderState.textContent =
        "Reminder state is unavailable. Other Today regions remain available.";
      cadenceState.textContent = "Reconnect suggestions are unavailable.";
      retry.hidden = false;
      return;
    }
    retry.hidden = true;
    reminderList.replaceChildren(...result.value.reminders.map(todayReminder));
    cadenceList.replaceChildren(...result.value.cadences.map(todayCadence));
    reminderState.textContent = result.value.reminders.length
      ? `${result.value.reminders.length} reminder state${
        result.value.reminders.length === 1 ? "" : "s"
      }.`
      : "No reminders in the next 30 days.";
    cadenceState.textContent = result.value.cadences.length
      ? `${result.value.cadences.length} people to reconnect with.`
      : "No one is due for contact.";
  };
  retry.addEventListener("click", () => void load());
  await load();
}
