/**
 * Today's attention queue and upcoming work as one pure state (GAP-033).
 *
 * Both lists come from one read, `GET /today/attention`, which also carries
 * the server's date for the page heading. `TodayAttention`
 * (`today-attention.tsx`) reads it through one latest-request slot; this
 * reducer is everything the island does with the answers. A read marks the
 * regions it was asked for as loading, and whichever answer lands settles
 * every region still loading (`regions.ts`), so the queue can never stay on
 * its loading status once a read has answered (REL-048).
 *
 * Completing a task and dismissing an undelivered reminder (REL-088) share
 * the one write. It is never optimistic about the lists: the row hides while
 * the save is pending, every Complete and Dismiss control is disabled while
 * one write is pending or confirmed, a refused save puts the row back and
 * says so, and a confirmed one holds the controls until an answer arrives
 * that no longer lists the item.
 */

import type {
  TodayAttention,
  TodayAttentionItem,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatCalendarDate,
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

export type AttentionRegion = "attention" | "upcoming";

/** A region's status line, or the Complete or Dismiss control of one item. */
export type AttentionFocus = AttentionRegion | { readonly itemId: string };

/** Which write the one slot holds: a task's completion or a dismissal. */
export type AttentionWrite = "acknowledge" | "complete";

type Groups = TodayAttention["attention"];

/** What one read answered with. */
export interface AttentionAnswer {
  readonly snapshot: TodayAttention;
  readonly preferences: TimePreferences | undefined;
  readonly workspaceId: string;
  /** The signed-in user the answer was read for. */
  readonly principalId: string;
}

export interface AttentionState {
  readonly attention: Region<Groups>;
  readonly upcoming: Region<TodayAttention["upcoming"]>;
  /** The server date of the latest answer. */
  readonly date?: string | undefined;
  /** Whether any read has answered, so a missing date is unavailable. */
  readonly answered: boolean;
  readonly preferences?: TimePreferences | undefined;
  readonly workspaceId?: string | undefined;
  readonly principalId?: string | undefined;
  readonly completion?: {
    readonly itemId: string;
    readonly phase: "pending" | "confirmed";
    readonly write: AttentionWrite;
  } | undefined;
  /** The write the server refused, until its item leaves the queue. */
  readonly failure?: {
    readonly itemId: string;
    readonly write: AttentionWrite;
  } | undefined;
  /** Where the read in flight moves focus once it lands. */
  readonly pendingFocus?: AttentionFocus | undefined;
  readonly focus?: FocusRequest<AttentionFocus> | undefined;
}

export type AttentionAction =
  | {
    readonly type: "read";
    readonly regions: readonly AttentionRegion[];
    readonly focus?: AttentionFocus;
  }
  | { readonly type: "answered"; readonly answer: AttentionAnswer | undefined }
  | { readonly type: "complete"; readonly taskId: string }
  | { readonly type: "acknowledge"; readonly occurrenceId: string }
  | { readonly type: "completion-failed" }
  /** The server said the item already changed: no retry, read it again. */
  | { readonly type: "completion-stale" }
  | { readonly type: "completion-confirmed" };

export const initialAttentionState: AttentionState = {
  answered: false,
  attention: initialRegion(),
  upcoming: initialRegion(),
};

/**
 * How many items the queue paints before the reader asks for the rest
 * (FER-06): a long queue never pushes the rest of Today out of view.
 */
export const ATTENTION_FIRST_PAINT = 5;

/**
 * The first `limit` items of `groups` in the queue's order (overdue, today,
 * then the next seven days), still grouped; a group past the limit is empty.
 */
export function firstPaint(groups: Groups, limit: number): Groups {
  let left = limit;
  const take = (items: Groups["overdue"]) => {
    const taken = items.slice(0, Math.max(left, 0));
    left -= taken.length;
    return taken;
  };
  const overdue = take(groups.overdue);
  const today = take(groups.today);
  return { nextSevenDays: take(groups.nextSevenDays), overdue, today };
}

/** How many items the queue holds across its groups. */
export function attentionCount(groups: Groups | undefined): number {
  return groups
    ? groups.overdue.length + groups.today.length +
      groups.nextSevenDays.length
    : 0;
}

/** Whether `item` renders a Complete control: an active person's task or a workspace task. */
export function completable(item: TodayAttentionItem): boolean {
  return item.kind === "task" && !item.person?.archived &&
    !item.person?.unavailable;
}

/**
 * Whether `item` renders a Dismiss control: a reminder occurrence whose
 * delivery failed or needs attention, which nothing else ever clears
 * (REL-088). Its person may be archived, as the queue still lists it.
 */
export function acknowledgeable(item: TodayAttentionItem): boolean {
  return item.kind === "reminder" &&
    (item.reminderStatus === "failed" ||
      item.reminderStatus === "manual_attention") &&
    !item.person?.unavailable;
}

/** The items the queue offers Complete or Dismiss for, in its order. */
export function actionableItemIds(groups: Groups | undefined): string[] {
  if (!groups) return [];
  return [...groups.overdue, ...groups.today, ...groups.nextSevenDays]
    .filter((item) => completable(item) || acknowledgeable(item))
    .map((item) => item.id);
}

function answered(
  state: AttentionState,
  answer: AttentionAnswer | undefined,
): AttentionState {
  const focus = focusRequest(state.focus, state.pendingFocus);
  if (!answer) {
    return {
      ...state,
      answered: true,
      attention: settleRegion(state.attention, undefined),
      focus,
      pendingFocus: undefined,
      upcoming: settleRegion(state.upcoming, undefined),
    };
  }
  const { snapshot } = answer;
  // Another workspace or another signed-in user starts the queue over.
  const moved = (state.workspaceId !== undefined &&
    state.workspaceId !== answer.workspaceId) ||
    (state.principalId !== undefined &&
      state.principalId !== answer.principalId);
  const attentionRead = moved || state.attention.status === "loading";
  const listed = actionableItemIds(snapshot.attention);
  const completion = moved ? undefined : state.completion;
  const failure = moved ? undefined : state.failure;
  return {
    ...state,
    answered: true,
    attention: attentionRead
      ? { status: "ready", value: snapshot.attention }
      : state.attention,
    completion: attentionRead && completion?.phase === "confirmed" &&
        !listed.includes(completion.itemId)
      ? undefined
      : completion,
    date: snapshot.date,
    failure: attentionRead && failure && !listed.includes(failure.itemId)
      ? undefined
      : failure,
    focus,
    pendingFocus: undefined,
    preferences: answer.preferences,
    principalId: answer.principalId,
    upcoming: moved || state.upcoming.status === "loading"
      ? { status: "ready", value: snapshot.upcoming }
      : state.upcoming,
    workspaceId: answer.workspaceId,
  };
}

export function attentionReducer(
  state: AttentionState,
  action: AttentionAction,
): AttentionState {
  switch (action.type) {
    case "read":
      return {
        ...state,
        attention: action.regions.includes("attention")
          ? loadingRegion(state.attention)
          : state.attention,
        pendingFocus: action.focus,
        upcoming: action.regions.includes("upcoming")
          ? loadingRegion(state.upcoming)
          : state.upcoming,
      };
    case "answered":
      return answered(state, action.answer);
    case "complete":
    case "acknowledge":
      if (state.completion) return state;
      return {
        ...state,
        completion: action.type === "complete"
          ? { itemId: action.taskId, phase: "pending", write: "complete" }
          : {
            itemId: action.occurrenceId,
            phase: "pending",
            write: "acknowledge",
          },
        failure: undefined,
      };
    case "completion-failed": {
      const completion = state.completion;
      if (!completion) return state;
      const { itemId, write } = completion;
      return {
        ...state,
        completion: undefined,
        failure: { itemId, write },
        focus: focusRequest(
          state.focus,
          actionableItemIds(state.attention.value).includes(itemId)
            ? { itemId }
            : "attention",
        ),
      };
    }
    case "completion-stale":
      if (!state.completion) return state;
      return { ...state, completion: undefined };
    case "completion-confirmed":
      if (!state.completion) return state;
      return {
        ...state,
        completion: { ...state.completion, phase: "confirmed" },
      };
  }
}

/** Where an item's title and person name lead: the person section that owns it. */
export function attentionDestination(
  item: TodayAttentionItem,
): string | undefined {
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
  return `/app/people/${encodeURIComponent(item.person.id)}?section=${section}`;
}

/**
 * What went wrong delivering an item by email, as the start of its line. The
 * queue lists an email delivery only once it failed or needs attention
 * (REL-059).
 */
function deliveryProblem(item: TodayAttentionItem): string {
  if (
    item.kind !== "reminder" ||
    item.channel !== "email"
  ) return "";
  return item.reminderStatus === "manual_attention"
    ? "Email reminder needs attention · "
    : item.reminderStatus === "failed"
    ? "Email reminder not delivered · "
    : "";
}

/** Delivery timing is independent of the occurrence's date, including retries. */
function reminderMeta(
  item: Exclude<TodayAttentionItem, { kind: "task" | "cadence" }>,
  preferences: TimePreferences | undefined,
): string {
  const dateLabel = item.kind === "important-date"
    ? "Important date"
    : item.kind === "life-event"
    ? "Event date"
    : "Occurs on";
  if (item.kind !== "reminder") {
    return `${dateLabel} ${
      formatCalendarDate(item.occursOn, preferences?.locale ?? "en")
    }`;
  }
  return `${deliveryProblem(item)}Reminder due ${
    formatInstant(item.dueAt, preferences)
  } · ${dateLabel} ${
    formatCalendarDate(item.occursOn, preferences?.locale ?? "en")
  }`;
}

/** Timing and context under a queued title; the person renders separately. */
export function attentionMeta(
  item: TodayAttentionItem,
  preferences: TimePreferences | undefined,
): string {
  if (item.kind !== "task" && item.kind !== "cadence") {
    return reminderMeta(item, preferences);
  }
  const due = `${item.kind === "cadence" ? "Reconnect by" : "Due"} ${
    formatInstant(item.dueAt, preferences)
  }`;
  if (item.kind !== "cadence") return due;
  const contact = item.lastContactedAt
    ? `Last contact ${formatInstant(item.lastContactedAt, preferences)}`
    : "No contact recorded";
  return `${due} · ${contact}${item.person.archived ? " · archived" : ""}`;
}

export interface AttentionWhen {
  readonly label: string;
  /** How urgent the item reads: the row's chip colours by it. */
  readonly tone: "overdue" | "today" | "soon" | "later";
}

/** The calendar date an instant falls on in `timeZone`, as YYYY-MM-DD. */
function localDate(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).format(new Date(instant));
}

const DAY_MS = 86_400_000;

/**
 * When `item` falls relative to the member's `today` (the snapshot's date in
 * their time zone): "Today", "Tomorrow", "In 3 days", or how long ago or how
 * overdue. A dated item counts its own calendar date; a task or cadence its
 * due instant's date in the member's time zone, so nothing until that is
 * known. Nothing without `today`.
 */
export function attentionWhen(
  item: TodayAttentionItem,
  today: string | undefined,
  preferences: TimePreferences | undefined,
): AttentionWhen | undefined {
  if (!today) return undefined;
  if (!("occursOn" in item) && !preferences) return undefined;
  const on = "occursOn" in item
    ? item.occursOn
    : localDate(item.dueAt, preferences!.effectiveTimezone);
  const days = Math.round((Date.parse(on) - Date.parse(today)) / DAY_MS);
  if (days === 0) return { label: "Today", tone: "today" };
  if (days === 1) return { label: "Tomorrow", tone: "soon" };
  if (days > 1) {
    return { label: `In ${days} days`, tone: days <= 7 ? "soon" : "later" };
  }
  const ago = -days;
  if (item.kind === "task" || item.kind === "cadence") {
    return {
      label: `${ago} day${ago === 1 ? "" : "s"} overdue`,
      tone: "overdue",
    };
  }
  return {
    label: ago === 1 ? "Yesterday" : `${ago} days ago`,
    tone: "overdue",
  };
}

/** Timing under an upcoming title; the person renders separately. */
export function upcomingMeta(
  item: TodayAttentionItem,
  preferences: TimePreferences | undefined,
): string {
  return item.kind === "task" || item.kind === "cadence"
    ? formatInstant(item.dueAt, preferences)
    : reminderMeta(item, preferences);
}

const ATTENTION_FAILED =
  "Attention could not be loaded. Other Today regions remain available.";
const UPCOMING_FAILED =
  "Upcoming work could not be loaded. Needs attention is unchanged.";

function attentionSummary(region: Region<Groups>): string {
  if (region.status === "failed") return ATTENTION_FAILED;
  const count = Object.values(region.value ?? {}).flat().length;
  return count === 0
    ? "All clear. No relationship work needs attention."
    : `${count} relationship priorit${count === 1 ? "y" : "ies"}.`;
}

function upcomingSummary(region: AttentionState["upcoming"]): string {
  if (region.status === "failed") return UPCOMING_FAILED;
  const count = region.value?.length ?? 0;
  return count
    ? `${count} upcoming item${count === 1 ? "" : "s"}.`
    : "No upcoming relationship work in the next 30 days.";
}

/** What the island renders from a state. */
export interface AttentionView {
  readonly attentionStatus: string;
  readonly attentionRetry: boolean;
  readonly upcomingStatus: string;
  readonly upcomingRetry: boolean;
  readonly onboarding: boolean;
  /** Every Complete and Dismiss control, while one write is owned. */
  readonly actionsDisabled: boolean;
  /** The row a pending write hides. */
  readonly hiddenItemId: string | undefined;
  readonly date: {
    readonly dateTime: string | undefined;
    readonly text: string;
  };
}

/** What each write says while it is pending, confirmed, or refused. */
const WRITE_COPY = {
  acknowledge: {
    confirmed: "Reminder dismissal is confirmed",
    control: "Dismiss",
    pending: "Dismissing reminder…",
    refused: "Reminder could not be dismissed.",
  },
  complete: {
    confirmed: "Task completion is confirmed",
    control: "Complete",
    pending: "Completing task…",
    refused: "Task could not be completed.",
  },
} as const;

export function attentionView(state: AttentionState): AttentionView {
  const { attention, completion, failure, upcoming } = state;
  const pending = completion?.phase === "pending";
  const attentionLoading = attention.status === "loading";
  const exact = failure !== undefined &&
    actionableItemIds(attention.value).includes(failure.itemId);
  const attentionStatus = pending
    ? WRITE_COPY[completion.write].pending
    : attentionLoading
    ? "Loading relationship priorities…"
    : completion
    ? `${attentionSummary(attention)} ${
      WRITE_COPY[completion.write].confirmed
    }; the projection has not caught up.`
    : failure
    ? `${attentionSummary(attention)} ${WRITE_COPY[failure.write].refused} ${
      exact
        ? `Retry ${WRITE_COPY[failure.write].control}.`
        : "Retry the attention projection."
    }`
    : attentionSummary(attention);
  const count = Object.values(attention.value ?? {}).flat().length +
    (upcoming.value?.length ?? 0);
  return {
    attentionRetry: !pending && !attentionLoading &&
      (completion !== undefined || (failure ? !exact : false) ||
        attention.status === "failed"),
    attentionStatus,
    actionsDisabled: completion !== undefined,
    date: state.date
      ? {
        dateTime: state.date,
        text: formatCalendarDate(
          state.date,
          state.preferences?.locale ?? "en",
          { dateStyle: "full" },
        ),
      }
      : {
        dateTime: undefined,
        text: state.answered ? "Date unavailable" : "Loading date…",
      },
    hiddenItemId: pending ? completion.itemId : undefined,
    onboarding: attention.value !== undefined &&
      upcoming.value !== undefined && count === 0,
    upcomingRetry: !pending && upcoming.status === "failed",
    upcomingStatus: upcoming.status === "loading"
      ? "Loading upcoming work…"
      : upcomingSummary(upcoming),
  };
}
