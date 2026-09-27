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
 * Completing a task is the one write. It is never optimistic about the
 * lists: the row hides while the save is pending, every Complete control is
 * disabled while one completion is pending or confirmed, a refused save puts
 * the row back and says so, and a confirmed one holds the controls until an
 * answer arrives that no longer lists the task.
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

/** A region's status line, or the Complete control of one task. */
export type AttentionFocus = AttentionRegion | { readonly taskId: string };

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
    readonly taskId: string;
    readonly phase: "pending" | "confirmed";
  } | undefined;
  /** The completion the server refused, until the task leaves the queue. */
  readonly failure?: { readonly taskId: string } | undefined;
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
  | { readonly type: "completion-failed" }
  | { readonly type: "completion-confirmed" };

export const initialAttentionState: AttentionState = {
  answered: false,
  attention: initialRegion(),
  upcoming: initialRegion(),
};

/** Whether `item` renders a Complete control: an active person's task or a workspace task. */
export function completable(item: TodayAttentionItem): boolean {
  return item.kind === "task" && !item.person?.archived &&
    !item.person?.unavailable;
}

/** The tasks the queue offers Complete for, in the order it lists them. */
export function actionableTaskIds(groups: Groups | undefined): string[] {
  if (!groups) return [];
  return [...groups.overdue, ...groups.today, ...groups.nextSevenDays]
    .filter(completable).map((item) => item.id);
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
  const listed = actionableTaskIds(snapshot.attention);
  const completion = moved ? undefined : state.completion;
  const failure = moved ? undefined : state.failure;
  return {
    ...state,
    answered: true,
    attention: attentionRead
      ? { status: "ready", value: snapshot.attention }
      : state.attention,
    completion: attentionRead && completion?.phase === "confirmed" &&
        !listed.includes(completion.taskId)
      ? undefined
      : completion,
    date: snapshot.date,
    failure: attentionRead && failure && !listed.includes(failure.taskId)
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
      if (state.completion) return state;
      return {
        ...state,
        completion: { phase: "pending", taskId: action.taskId },
        failure: undefined,
      };
    case "completion-failed": {
      const taskId = state.completion?.taskId;
      if (!taskId) return state;
      return {
        ...state,
        completion: undefined,
        failure: { taskId },
        focus: focusRequest(
          state.focus,
          actionableTaskIds(state.attention.value).includes(taskId)
            ? { taskId }
            : "attention",
        ),
      };
    }
    case "completion-confirmed":
      if (!state.completion) return state;
      return {
        ...state,
        completion: { ...state.completion, phase: "confirmed" },
      };
  }
}

/** Where an item's title leads: the person section that owns it. */
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

/** The line under a queued item's title. */
export function attentionMeta(
  item: TodayAttentionItem,
  preferences: TimePreferences | undefined,
): string {
  const due = `${item.kind === "cadence" ? "Reconnect by" : "Due"} ${
    formatInstant(item.dueAt, preferences)
  }`;
  const who = item.person ? ` · ${item.person.name}` : "";
  if (item.kind !== "cadence") return `${due}${who}`;
  const contact = item.lastContactedAt
    ? `Last contact ${formatInstant(item.lastContactedAt, preferences)}`
    : "No contact recorded";
  return `${due}${who} · ${contact}${
    item.person.archived ? " · archived" : ""
  }`;
}

/** The line under an upcoming item's title. */
export function upcomingMeta(
  item: TodayAttentionItem,
  preferences: TimePreferences | undefined,
): string {
  return `${formatInstant(item.dueAt, preferences)}${
    item.person ? ` · ${item.person.name}` : ""
  }`;
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
  readonly completeDisabled: boolean;
  /** The row a pending completion hides. */
  readonly hiddenTaskId: string | undefined;
  readonly date: {
    readonly dateTime: string | undefined;
    readonly text: string;
  };
}

export function attentionView(state: AttentionState): AttentionView {
  const { attention, completion, failure, upcoming } = state;
  const pending = completion?.phase === "pending";
  const attentionLoading = attention.status === "loading";
  const exact = failure !== undefined &&
    actionableTaskIds(attention.value).includes(failure.taskId);
  const attentionStatus = pending
    ? "Completing task…"
    : attentionLoading
    ? "Loading relationship priorities…"
    : completion
    ? `${
      attentionSummary(attention)
    } Task completion is confirmed; the projection has not caught up.`
    : failure
    ? `${attentionSummary(attention)} Task could not be completed. ${
      exact ? "Retry Complete." : "Retry the attention projection."
    }`
    : attentionSummary(attention);
  const count = Object.values(attention.value ?? {}).flat().length +
    (upcoming.value?.length ?? 0);
  return {
    attentionRetry: !pending && !attentionLoading &&
      (completion !== undefined || (failure ? !exact : false) ||
        attention.status === "failed"),
    attentionStatus,
    completeDisabled: completion !== undefined,
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
    hiddenTaskId: pending ? completion.taskId : undefined,
    onboarding: attention.value !== undefined &&
      upcoming.value !== undefined && count === 0,
    upcomingRetry: !pending && upcoming.status === "failed",
    upcomingStatus: upcoming.status === "loading"
      ? "Loading upcoming work…"
      : upcomingSummary(upcoming),
  };
}
