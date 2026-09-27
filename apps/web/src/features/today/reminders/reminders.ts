/**
 * Today's reminder-delivery and reconnect regions as one pure state
 * (GAP-033).
 *
 * Both lists come from one read, `GET /today/reminders`, which
 * `TodayReminders` (`today-reminders.tsx`) asks through one latest-request
 * slot: the first load, each region's retry, and a recorded reconnect. A read
 * marks the regions it was asked for as loading and the answer that lands
 * settles every region still loading (`regions.ts`), keeping a failed
 * region's last good rows. A retry, and a reconnect, move focus to the status
 * of the region they asked about once the answer lands.
 */

import type {
  TodayCadenceItem,
  TodayReminderItem,
  TodayReminders,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatInstant,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";
import {
  type FocusRequest,
  focusRequest,
  initialRegion,
  loadingRegion,
  type Region,
  settleRegion,
} from "../regions.ts";

export type RemindersRegion = "reminder" | "cadence";

export interface RemindersAnswer {
  readonly value: TodayReminders;
  readonly preferences: TimePreferences | undefined;
}

export interface RemindersState {
  readonly reminder: Region<TodayReminders["reminders"]>;
  readonly cadence: Region<TodayReminders["cadences"]>;
  readonly preferences?: TimePreferences | undefined;
  readonly pendingFocus?: RemindersRegion | undefined;
  readonly focus?: FocusRequest<RemindersRegion> | undefined;
}

export type RemindersAction =
  | {
    readonly type: "read";
    readonly regions: readonly RemindersRegion[];
    readonly focus?: RemindersRegion;
  }
  | { readonly type: "answered"; readonly answer: RemindersAnswer | undefined };

export const initialRemindersState: RemindersState = {
  cadence: initialRegion(),
  reminder: initialRegion(),
};

export function remindersReducer(
  state: RemindersState,
  action: RemindersAction,
): RemindersState {
  if (action.type === "read") {
    return {
      ...state,
      cadence: action.regions.includes("cadence")
        ? loadingRegion(state.cadence)
        : state.cadence,
      pendingFocus: action.focus,
      reminder: action.regions.includes("reminder")
        ? loadingRegion(state.reminder)
        : state.reminder,
    };
  }
  const { answer } = action;
  return {
    ...state,
    cadence: settleRegion(state.cadence, answer?.value.cadences),
    focus: focusRequest(state.focus, state.pendingFocus),
    pendingFocus: undefined,
    preferences: answer ? answer.preferences : state.preferences,
    reminder: settleRegion(state.reminder, answer?.value.reminders),
  };
}

export interface RemindersView {
  readonly reminderStatus: string;
  readonly reminderRetry: boolean;
  readonly cadenceStatus: string;
  readonly cadenceRetry: boolean;
}

export function remindersView(state: RemindersState): RemindersView {
  const { cadence, reminder } = state;
  const reminders = reminder.value?.length ?? 0;
  const cadences = cadence.value?.length ?? 0;
  return {
    cadenceRetry: cadence.status === "failed",
    cadenceStatus: cadence.status === "loading"
      ? "Loading reconnect suggestions…"
      : cadence.status === "failed"
      ? "Reconnect suggestions are unavailable."
      : cadences
      ? `${cadences} people to reconnect with.`
      : "No one is due for contact.",
    reminderRetry: reminder.status === "failed",
    reminderStatus: reminder.status === "loading"
      ? "Loading reminder state…"
      : reminder.status === "failed"
      ? "Reminder state is unavailable. Other Today regions remain available."
      : reminders
      ? `${reminders} reminder state${reminders === 1 ? "" : "s"}.`
      : "No reminders in the next 30 days.",
  };
}

/** Where one reminder's delivery stands, in the member's time. */
export function reminderLine(
  item: TodayReminderItem,
  preferences: TimePreferences | undefined,
): string {
  if (item.status === "manual_attention") {
    return "Delivery needs manual attention";
  }
  if (item.status === "failed") return "Delivery failed";
  if (item.visibleAt) {
    return `Notification visible · ${
      formatInstant(item.visibleAt, preferences)
    }`;
  }
  if (item.status === "pending") {
    return `Scheduled for ${formatInstant(item.deliverAt, preferences)}`;
  }
  if (item.status === "retry") {
    return `Retry scheduled for ${
      formatInstant(item.nextAttemptAt, preferences)
    }`;
  }
  if (item.status === "claimed") return "Delivery in progress";
  return `Delivered · ${formatInstant(item.deliverAt, preferences)}`;
}

/** When a person is due for contact and when they were last reached. */
export function cadenceLine(
  item: TodayCadenceItem,
  preferences: TimePreferences | undefined,
): string {
  return `Reconnect by ${formatInstant(item.dueAt, preferences)} · ${
    item.lastContactedAt
      ? `Last contact ${formatInstant(item.lastContactedAt, preferences)}`
      : "No contact recorded"
  }${item.person.archived ? " · archived" : ""}`;
}
