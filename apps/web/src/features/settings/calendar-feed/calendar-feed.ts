/**
 * The calendar feed section's state (GAP-052, `INTEGRATION-002`): whether the
 * member has a live feed, the subscription link while it is shown once, the
 * section's one status line, and the one feed change that may run at a time.
 * A pure reducer with the words the section shows; `calendar-feed.tsx`
 * renders it.
 *
 * The link lives only here, in memory, from the answer that minted it until
 * it is dismissed, replaced, revoked, or the page is left; the server never
 * shows it again. `focus` names the control the section moves focus to once
 * the change it just made has rendered. A change another window already made
 * (a 409 creating, a 404 rotating or revoking) is read again once, so the
 * section shows the feed as it now is rather than a stale one.
 */

import type { CalendarFeed } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  formatInstant,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";

export interface CalendarFeedState {
  readonly phase: "loading" | "ready" | "unavailable";
  readonly feed: CalendarFeed | undefined;
  readonly url: string | undefined;
  readonly status: string;
  readonly busy: boolean;
  readonly focus: "create" | "rotate" | "url" | undefined;
  readonly timePreferences: TimePreferences | undefined;
}

export type CalendarFeedAction =
  | {
    readonly type: "loaded";
    readonly feed: CalendarFeed | undefined;
    readonly timePreferences?: TimePreferences | undefined;
  }
  | {
    readonly type: "issued";
    readonly feed: CalendarFeed;
    readonly status: "created" | "rotated";
    readonly url: string;
  }
  | { readonly type: "revoked" }
  /** A change was refused because another window already made one. */
  | {
    readonly type: "changed-elsewhere";
    readonly feed: CalendarFeed | undefined;
  }
  | { readonly type: "busy"; readonly busy: boolean; readonly message?: string }
  | { readonly type: "failed"; readonly message: string }
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "dismissed" }
  | { readonly type: "focused" };

export const initialCalendarFeed: CalendarFeedState = {
  busy: false,
  feed: undefined,
  focus: undefined,
  phase: "loading",
  status: "",
  timePreferences: undefined,
  url: undefined,
};

const ISSUED = {
  created: "Calendar feed created. Copy the link now; it is shown only once.",
  rotated:
    "Calendar feed link rotated. The old link no longer works; copy the new one now.",
} as const;

export function calendarFeedReducer(
  state: CalendarFeedState,
  action: CalendarFeedAction,
): CalendarFeedState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        feed: action.feed,
        phase: "ready",
        status: action.feed
          ? "Your calendar feed is active."
          : "No calendar feed yet.",
        timePreferences: action.timePreferences,
      };
    case "issued":
      return {
        ...state,
        busy: false,
        feed: action.feed,
        focus: "url",
        status: ISSUED[action.status],
        url: action.url,
      };
    case "revoked":
      return {
        ...state,
        busy: false,
        feed: undefined,
        focus: "create",
        status: "Calendar feed revoked. Its link no longer works.",
        url: undefined,
      };
    case "busy":
      return {
        ...state,
        busy: action.busy,
        ...(action.message === undefined ? {} : { status: action.message }),
      };
    case "failed":
      return {
        ...state,
        busy: false,
        phase: state.phase === "loading" ? "unavailable" : state.phase,
        status: action.message,
      };
    case "status":
      return { ...state, status: action.message };
    case "changed-elsewhere":
      return {
        ...state,
        busy: false,
        feed: action.feed,
        focus: action.feed ? "rotate" : "create",
        phase: "ready",
        status: "Your calendar feed changed in another window.",
        url: undefined,
      };
    case "dismissed":
      return {
        ...state,
        focus: "rotate",
        status: "The link is hidden. Rotate the feed if you need a new one.",
        url: undefined,
      };
    case "focused":
      return { ...state, focus: undefined };
  }
}

/** When the feed was created and last read by a calendar. */
export function feedSummary(
  feed: CalendarFeed,
  timePreferences: TimePreferences | undefined,
): string {
  const created = `Created ${formatInstant(feed.createdAt, timePreferences)}`;
  return feed.lastUsedAt
    ? `${created} · Last used ${
      formatInstant(feed.lastUsedAt, timePreferences)
    }`
    : `${created} · Never used`;
}
