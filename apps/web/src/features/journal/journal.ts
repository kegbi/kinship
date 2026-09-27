/**
 * The journal as one pure state (JOURNAL-001, GAP-033): the timeline of
 * posts, day ratings, and linked activities, its paging, and the one editor
 * that adds an item or changes a post. `Journal` (`journal.tsx`) owns the
 * reads and writes; this reducer is everything it does with their answers.
 *
 * Saves are never optimistic: a save or a removal refreshes the timeline and
 * only then shows it, and while one is in flight (`saving`, `removing`) the
 * controls it guards are disabled and Load more hides.
 */

import type {
  JournalItemType,
  JournalLinkableActivity,
  JournalTimelineItem,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatCalendarDate,
  formatInstant,
  type TimePreferences,
} from "../../lib/time-presentation.ts";

type PostItem = Extract<JournalTimelineItem, { type: "post" }>;

/** The editor, fresh (`generation`) each time it opens. */
export interface JournalEditor {
  readonly generation: number;
  readonly type: JournalItemType;
  /** The post being changed; a new item has none. */
  readonly post?: PostItem | undefined;
}

export type JournalFocus = "type" | "body" | "add";

/** A request to move focus, fresh (`sequence`) each time it is made. */
export interface JournalFocusRequest {
  readonly target: JournalFocus;
  readonly sequence: number;
}

function focusRequest(
  previous: JournalFocusRequest | undefined,
  target: JournalFocus,
): JournalFocusRequest {
  return { sequence: (previous?.sequence ?? 0) + 1, target };
}

export interface JournalState {
  readonly status: "loading" | "ready" | "failed" | "no-session";
  /** Why the last read failed, in the server's words. */
  readonly problem?: string | undefined;
  /** Why the last removal was refused, until the next read. */
  readonly notice?: string | undefined;
  readonly items: readonly JournalTimelineItem[];
  readonly nextCursor?: string | undefined;
  /** The activities a new item may link, once a timeline read named them. */
  readonly activities?: readonly JournalLinkableActivity[] | undefined;
  readonly workspaceId?: string | undefined;
  readonly preferences?: TimePreferences | undefined;
  readonly editor?: JournalEditor | undefined;
  readonly generation: number;
  readonly formNotice: string;
  readonly saving: boolean;
  /** The item a removal is in flight for. */
  readonly removing?: string | undefined;
  readonly focus?: JournalFocusRequest | undefined;
}

export type JournalAction =
  | { readonly type: "loading" }
  | {
    readonly type: "loaded";
    readonly items: readonly JournalTimelineItem[];
    readonly append: boolean;
    readonly nextCursor?: string | undefined;
    readonly activities?: readonly JournalLinkableActivity[] | undefined;
    readonly workspaceId: string;
    readonly preferences: TimePreferences | undefined;
  }
  | { readonly type: "failed"; readonly problem: string }
  | { readonly type: "no-session" }
  | { readonly type: "open"; readonly post?: PostItem }
  | { readonly type: "close" }
  | { readonly type: "item-type"; readonly itemType: JournalItemType }
  | { readonly type: "form-notice"; readonly text: string }
  | { readonly type: "saving"; readonly saving: boolean }
  | { readonly type: "saved" }
  | { readonly type: "removing"; readonly itemId: string | undefined }
  | { readonly type: "remove-refused"; readonly notice: string };

export const initialJournalState: JournalState = {
  formNotice: "",
  generation: 0,
  items: [],
  saving: false,
  status: "loading",
};

export function journalReducer(
  state: JournalState,
  action: JournalAction,
): JournalState {
  switch (action.type) {
    case "loading":
      return { ...state, notice: undefined, status: "loading" };
    case "loaded":
      return {
        ...state,
        activities: action.activities ?? state.activities,
        items: action.append ? [...state.items, ...action.items] : action.items,
        nextCursor: action.nextCursor,
        notice: undefined,
        preferences: action.preferences,
        problem: undefined,
        status: "ready",
        workspaceId: action.workspaceId,
      };
    case "failed":
      return {
        ...state,
        items: [],
        nextCursor: undefined,
        problem: action.problem,
        status: "failed",
      };
    case "no-session":
      return {
        ...state,
        items: [],
        nextCursor: undefined,
        status: "no-session",
        workspaceId: undefined,
      };
    case "open": {
      const generation = state.generation + 1;
      return {
        ...state,
        editor: {
          generation,
          post: action.post,
          type: "post",
        },
        focus: focusRequest(state.focus, action.post ? "body" : "type"),
        formNotice: "",
        generation,
      };
    }
    case "close":
      return {
        ...state,
        editor: undefined,
        focus: focusRequest(state.focus, "add"),
        formNotice: "",
      };
    case "item-type":
      return state.editor && !state.editor.post
        ? { ...state, editor: { ...state.editor, type: action.itemType } }
        : state;
    case "form-notice":
      return { ...state, formNotice: action.text };
    case "saving":
      return { ...state, saving: action.saving };
    case "saved":
      return { ...state, editor: undefined, formNotice: "" };
    case "removing":
      return { ...state, removing: action.itemId };
    case "remove-refused":
      return { ...state, notice: action.notice, removing: undefined };
  }
}

/** What the timeline's status says. */
export function journalStatus(
  state: JournalState,
  loading = "Loading journal…",
): string {
  if (state.status === "loading") return loading;
  if (state.status === "no-session") {
    return "Your journal session could not be confirmed.";
  }
  if (state.status === "failed") return state.problem ?? "";
  if (state.notice) return state.notice;
  const count = state.items.length;
  return count === 0
    ? "No journal items yet."
    : `${count} journal item${count === 1 ? "" : "s"}.`;
}

/** Whether a write owns the timeline, so no page may extend it. */
export function journalBusy(state: JournalState): boolean {
  return state.saving || state.removing !== undefined ||
    state.status === "loading";
}

/** An item's title. */
export function journalHeading(item: JournalTimelineItem): string {
  if (item.type === "post") return item.post.title ?? "Journal post";
  if (item.type === "day-rating") {
    return `Day rating: ${item.dayRating.rating}/5`;
  }
  return item.activity.summary;
}

/** When an item happened: a rating's calendar day, anything else's instant. */
export function journalWhen(
  item: JournalTimelineItem,
  preferences: TimePreferences | undefined,
): { readonly dateTime: string; readonly text: string } {
  return item.type === "day-rating"
    ? {
      dateTime: item.dayRating.ratedOn,
      text: formatCalendarDate(
        item.dayRating.ratedOn,
        preferences?.locale ?? "en",
      ),
    }
    : {
      dateTime: item.occurredAt,
      text: formatInstant(item.occurredAt, preferences),
    };
}

/** The text under an item's title. */
export function journalBody(item: JournalTimelineItem): string {
  return item.type === "post"
    ? item.post.body
    : item.type === "day-rating"
    ? item.dayRating.comment ?? ""
    : "Activity linked to this timeline.";
}

/** An activity as the link choice names it. */
export function activityChoice(
  activity: JournalLinkableActivity,
  preferences: TimePreferences | undefined,
): string {
  return `${activity.summary} · ${
    formatInstant(activity.happenedAt, preferences)
  }`;
}

/** The value a `datetime-local` field shows for `value`, in local time. */
export function localDateTimeValue(value: Date): string {
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${
    pad(value.getDate())
  }T${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/**
 * The instant a `datetime-local` value names in local time, or `undefined`
 * when it names no real minute (an empty field, 24:00, 31 February, or a
 * minute a daylight-saving jump skips).
 */
export function parseLocalDateTime(value: string): string | undefined {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return undefined;
  const [, year, month, day, hour, minute] = match.map(Number);
  const parsed = new Date(year!, month! - 1, day, hour, minute);
  if (
    parsed.getFullYear() !== year || parsed.getMonth() !== month! - 1 ||
    parsed.getDate() !== day || parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute
  ) return undefined;
  return parsed.toISOString();
}
