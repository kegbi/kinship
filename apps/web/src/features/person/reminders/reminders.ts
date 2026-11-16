/**
 * The person reminders card and stay-in-touch rail block's pure half
 * (GAP-031): how a reminder and a cadence read, what their status lines say,
 * and the one reducer both sections' state moves through. The two sections
 * are one owner because one read answers both and every write refreshes
 * both, so they share one busy state: while a save, a disable, or a read
 * that holds the section is in flight, no second write may start in either.
 */

import type {
  PersonDueInformation,
  Reminder,
  StayInTouchCadence,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatCalendarDate,
  formatInstant,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";

// --- How the records read ---------------------------------------------------

/** The calendar date an instant falls on for the member, or nothing. */
function localDate(
  instant: string,
  preferences: TimePreferences | undefined,
): string | undefined {
  if (!preferences?.effectiveTimezone) return undefined;
  try {
    return new Intl.DateTimeFormat("en-CA", {
      calendar: "gregory",
      day: "2-digit",
      month: "2-digit",
      timeZone: preferences.effectiveTimezone,
      year: "numeric",
    }).format(new Date(instant));
  } catch {
    return undefined;
  }
}

/**
 * A reminder's next occurrence, or why it has none. An advance notice, sent
 * before the date it is for, also names that date, so it never reads as the
 * date itself.
 */
export function reminderStateText(
  reminder: Reminder,
  preferences: TimePreferences | undefined,
): string {
  const next = reminder.nextOccurrence;
  if (next) {
    const sentOn = localDate(next.deliverAt, preferences);
    const forDate = preferences && sentOn !== undefined &&
        sentOn < next.occursOn
      ? ` · notice for ${formatCalendarDate(next.occursOn, preferences.locale)}`
      : "";
    return `${
      next.visibleAt ? "Notification visible" : next.status.replaceAll("_", " ")
    } · ${formatInstant(next.deliverAt, preferences)}${forDate}`;
  }
  return reminder.isActive ? "No future occurrence" : "Disabled";
}

/**
 * The date a reminder is anchored on and how it repeats from there: "Every
 * year from Nov 16, 2025". The next-occurrence line only says when the next
 * notification goes out, so without this the reminder's own date is nowhere.
 */
export function reminderScheduleText(
  reminder: Reminder,
  preferences: TimePreferences | undefined,
): string {
  const anchor = formatCalendarDate(
    reminder.anchorOn,
    preferences?.locale ?? "en",
  );
  if (reminder.recurrenceUnit === "none") return `Once on ${anchor}`;
  const every = reminder.recurrenceInterval === 1
    ? `Every ${reminder.recurrenceUnit}`
    : intervalText(reminder.recurrenceInterval, reminder.recurrenceUnit);
  return `${every} from ${anchor}`;
}

/** "Every 2 weeks": a cadence's interval. */
export function intervalText(count: number, unit: string): string {
  return `Every ${count} ${unit}${count === 1 ? "" : "s"}`;
}

/** A cadence's row: its interval and when contact is next due. */
export function cadenceText(
  cadence: StayInTouchCadence,
  preferences: TimePreferences | undefined,
): string {
  return `${intervalText(cadence.intervalCount, cadence.intervalUnit)} · due ${
    formatInstant(cadence.nextDueAt, preferences)
  }`;
}

/** The hero's stay-in-touch due state for the active cadences. */
export function stayInTouchText(
  cadences: readonly StayInTouchCadence[],
): string {
  return cadences.length
    ? cadences.map((cadence) =>
      intervalText(cadence.intervalCount, cadence.intervalUnit)
    ).join(" · ")
    : "Not set";
}

/** The hero's next-reminder vital from a refreshed profile summary. */
export function nextReminderText(
  dueInformation: PersonDueInformation | undefined,
  preferences: TimePreferences | undefined,
): string {
  if (!dueInformation) return "Unavailable";
  return dueInformation.nextReminderAt
    ? formatInstant(dueInformation.nextReminderAt, preferences)
    : "Not recorded";
}

/** The reminders card's status line over a loaded list. */
export function reminderSummary(
  count: number,
  more: boolean,
): string {
  if (more) return `Showing first ${count} reminders.`;
  return count
    ? `${count} reminder${count === 1 ? "" : "s"}.`
    : "No reminders yet.";
}

export const REMINDERS_LOADING = "Loading reminders…";
export const CADENCE_LOADING = "Loading stay-in-touch cadence…";
export const REMINDERS_FAILED =
  "Reminders could not be loaded. Retry this section.";
export const CADENCE_FAILED =
  "Cadence could not be loaded. Other profile sections remain available.";
/** Both sections' line when the workspace refused the member (REL-127). */
export const REMINDERS_FORBIDDEN =
  "Your active workspace no longer permits this action.";

// --- The sections' state ----------------------------------------------------

export type RemindersStatus = "loading" | "ready" | "error" | "forbidden";

/** A save on its way: the muted row a list shows until it settles. */
export interface PendingRow {
  readonly title: string;
  readonly detail: string;
}

export type ReminderFocus =
  | "reminder-field"
  | "reminder-add"
  | "cadence-field"
  | "cadence-add"
  | "cadence-state";

export interface RemindersState {
  readonly status: RemindersStatus;
  readonly reminders: readonly Reminder[];
  readonly nextCursor?: string;
  /** The active cadences; an inactive one is not shown. */
  readonly cadences: readonly StayInTouchCadence[];
  readonly archived: boolean;
  /** Whether a write, or a read that holds both sections, is in flight. */
  readonly busy: boolean;
  /** What each status line says instead of its summary, until the next read. */
  readonly reminderNotice?: string;
  readonly cadenceNotice?: string;
  readonly reminderOpen: boolean;
  readonly cadenceOpen: boolean;
  readonly pendingReminder?: PendingRow;
  readonly pendingCadence?: PendingRow;
  readonly focus?: { readonly target: ReminderFocus; readonly tick: number };
}

export type RemindersAction =
  | { readonly type: "busy"; readonly busy: boolean }
  | { readonly type: "loading" }
  | {
    readonly type: "loaded";
    readonly reminders: readonly Reminder[];
    /** Whether the page continues the list on screen. */
    readonly continued: boolean;
    readonly nextCursor?: string | undefined;
    readonly cadences: readonly StayInTouchCadence[];
  }
  | {
    readonly type: "failed";
    /** Whether the workspace refused the member rather than failing. */
    readonly forbidden?: boolean;
  }
  | { readonly type: "lifecycle"; readonly archived: boolean }
  | { readonly type: "open"; readonly editor: "reminder" | "cadence" }
  | {
    readonly type: "close";
    readonly editor: "reminder" | "cadence";
    readonly focus?: boolean;
  }
  | {
    readonly type: "notice";
    readonly section: "reminder" | "cadence";
    readonly notice: string;
    readonly focus?: boolean;
  }
  | {
    readonly type: "pending";
    readonly section: "reminder" | "cadence";
    readonly row: PendingRow | undefined;
  };

export function initialRemindersState(archived: boolean): RemindersState {
  return {
    archived,
    busy: false,
    cadenceOpen: false,
    cadences: [],
    reminderOpen: false,
    reminders: [],
    status: "loading",
  };
}

function focus(
  state: RemindersState,
  target: ReminderFocus,
): { readonly target: ReminderFocus; readonly tick: number } {
  return { target, tick: (state.focus?.tick ?? 0) + 1 };
}

export function remindersReducer(
  state: RemindersState,
  action: RemindersAction,
): RemindersState {
  switch (action.type) {
    case "busy":
      return { ...state, busy: action.busy };
    case "loading": {
      const {
        cadenceNotice: _cadence,
        reminderNotice: _reminder,
        ...rest
      } = state;
      return { ...rest, status: "loading" };
    }
    case "loaded": {
      const { nextCursor: _cursor, ...rest } = state;
      return {
        ...rest,
        cadences: action.cadences.filter((cadence) => cadence.isActive),
        reminders: action.continued
          ? [...state.reminders, ...action.reminders]
          : action.reminders,
        status: "ready",
        ...(action.nextCursor ? { nextCursor: action.nextCursor } : {}),
      };
    }
    case "failed": {
      const { nextCursor: _cursor, ...rest } = state;
      // A refused member keeps nothing the workspace no longer shows them.
      return action.forbidden
        ? {
          ...rest,
          cadenceOpen: false,
          cadences: [],
          reminderOpen: false,
          reminders: [],
          status: "forbidden",
        }
        : { ...rest, status: "error" };
    }
    case "lifecycle":
      return { ...state, archived: action.archived };
    case "open":
      return action.editor === "reminder"
        ? {
          ...state,
          focus: focus(state, "reminder-field"),
          reminderOpen: true,
        }
        : { ...state, cadenceOpen: true, focus: focus(state, "cadence-field") };
    case "close": {
      const open = action.editor === "reminder"
        ? { reminderOpen: false }
        : { cadenceOpen: false };
      return action.focus
        ? {
          ...state,
          ...open,
          focus: focus(
            state,
            action.editor === "reminder" ? "reminder-add" : "cadence-add",
          ),
        }
        : { ...state, ...open };
    }
    case "notice": {
      const next = action.section === "reminder"
        ? { ...state, reminderNotice: action.notice }
        : { ...state, cadenceNotice: action.notice };
      return action.focus
        ? { ...next, focus: focus(state, "cadence-state") }
        : next;
    }
    case "pending": {
      const key = action.section === "reminder"
        ? "pendingReminder"
        : "pendingCadence";
      const { [key]: _previous, ...rest } = state;
      return action.row ? { ...rest, [key]: action.row } : rest;
    }
  }
}
