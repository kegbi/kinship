/**
 * Today's reminder and reconnect regions (`pages/app.astro`). The person
 * reminders card and stay-in-touch block are an island now
 * (`features/person/reminders/`, GAP-031); these regions move in GAP-033.
 */

import {
  formatInstant,
  loadTimePreferences,
  type TimePreferences,
} from "./time-presentation.ts";
import {
  getTodayReminders,
  type TodayCadenceItem,
  type TodayReminderItem,
} from "../../../../packages/contracts/generated/auth-client.ts";
import { resolveWorkspaceSession } from "./workspace-context.ts";
import { buttonVariants } from "../components/ui/variants.ts";

let todayRemindersAbort: AbortController | undefined;
const TODAY_RECONNECT_RECORDED_EVENT = "kinship:today-reconnect-recorded";

function todayReminder(
  item: TodayReminderItem,
  timePreferences: TimePreferences | undefined,
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
    ? `Notification visible · ${formatInstant(item.visibleAt, timePreferences)}`
    : item.status === "pending"
    ? `Scheduled for ${formatInstant(item.deliverAt, timePreferences)}`
    : item.status === "retry"
    ? `Retry scheduled for ${
      formatInstant(item.nextAttemptAt, timePreferences)
    }`
    : item.status === "claimed"
    ? "Delivery in progress"
    : `Delivered · ${formatInstant(item.deliverAt, timePreferences)}`;
  row.append(link, state);
  return row;
}

function todayCadence(
  item: TodayCadenceItem,
  timePreferences: TimePreferences | undefined,
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
  state.textContent = `Reconnect by ${
    formatInstant(item.dueAt, timePreferences)
  } · ${
    item.lastContactedAt
      ? `Last contact ${formatInstant(item.lastContactedAt, timePreferences)}`
      : "No contact recorded"
  }${item.person.archived ? " · archived" : ""}`;
  row.append(link, state);
  if (!item.person.archived) {
    const capture = document.createElement("button");
    capture.type = "button";
    capture.className = buttonVariants({
      variant: "outline",
      wrap: true,
    });
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
    const timePreferences = await loadTimePreferences(
      session.session.workspace.id,
    );
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
          todayReminder(item, timePreferences)
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
          todayCadence(item, timePreferences)
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
