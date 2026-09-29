/**
 * The duplicate review's pure half (GAP-049, PEOPLE-008): its one reducer and
 * its wording. Nothing here touches the DOM.
 *
 * The review sits on the people directory, folded away until the member asks
 * for it, and says nothing at all when there is nothing to review or it could
 * not be read: it is a suggestion beside the directory, never a second
 * directory with its own error states.
 *
 * A pair can be merged or, when the two really are different people, marked
 * as not duplicates (REL-064). One of those runs at a time; a dismissed pair
 * leaves the list at once, and the review's one status line says so.
 *
 * A review cut off at its pair limit hides pairs the list never showed. Once
 * its last shown pair is dismissed, the review reads the list once more
 * (REL-090) instead of saying nothing is left; if that read fails, it says to
 * reload the page. Either way the status line adds the outcome to the
 * dismissal's announcement, so it is heard as well as shown.
 */

import type { PeopleDuplicatePair } from "../../../../../../packages/contracts/generated/auth-client.ts";
import type { PersonNameOrder } from "../../../lib/person-name.ts";

export interface DuplicatesState {
  readonly status: "loading" | "ready" | "unavailable";
  readonly pairs: readonly PeopleDuplicatePair[];
  readonly truncated: boolean;
  /** The member opened the list. */
  readonly expanded: boolean;
  /** The pair whose merge dialog is open. */
  readonly merging?: number;
  /** The pair, by `pairKey`, being marked as not duplicates. */
  readonly dismissing?: string;
  /**
   * The last shown pair of a cut-off review left, and the list is being read
   * again.
   */
  readonly refreshing?: true;
  /** What the review's status line says about the last dismissal. */
  readonly announcement?: string;
  /** The workspace the pairs were read in, and how the member reads names. */
  readonly context?: {
    readonly nameOrder: PersonNameOrder;
    readonly workspaceId: string;
  };
}

export type DuplicatesAction =
  | {
    readonly type: "loaded";
    readonly context: NonNullable<DuplicatesState["context"]>;
    readonly pairs: readonly PeopleDuplicatePair[];
    readonly truncated: boolean;
  }
  | { readonly type: "failed" }
  | { readonly type: "toggled" }
  | { readonly type: "merge-opened"; readonly index: number }
  | { readonly type: "merge-closed" }
  | {
    readonly type: "dismiss-started";
    readonly key: string;
    readonly names: string;
  }
  | { readonly type: "dismissed"; readonly key: string; readonly names: string }
  | { readonly type: "dismiss-failed"; readonly detail: string };

/** A pair's identity in the list: its two ids, in the review's order. */
export function pairKey(pair: PeopleDuplicatePair): string {
  return pair.people.map((person) => person.id).join(":");
}

export function initialDuplicates(): DuplicatesState {
  return { expanded: false, pairs: [], status: "loading", truncated: false };
}

export function duplicatesReducer(
  state: DuplicatesState,
  action: DuplicatesAction,
): DuplicatesState {
  switch (action.type) {
    case "loaded": {
      const { refreshing, ...rest } = state;
      return {
        ...rest,
        ...(refreshing
          ? { announcement: afterRefresh(state, action.pairs.length) }
          : {}),
        context: action.context,
        pairs: action.pairs,
        status: "ready",
        truncated: action.truncated,
      };
    }
    case "failed": {
      // A failed second read keeps the review, which says to reload.
      const { refreshing, ...rest } = state;
      return refreshing
        ? { ...rest, announcement: afterRefresh(state) }
        : { ...state, status: "unavailable" };
    }
    case "toggled":
      return { ...state, expanded: !state.expanded };
    case "merge-opened":
      return state.merging === undefined && state.dismissing === undefined &&
          action.index < state.pairs.length
        ? { ...state, merging: action.index }
        : state;
    case "merge-closed": {
      const { merging: _merging, ...rest } = state;
      return rest;
    }
    case "dismiss-started":
      return state.merging === undefined && state.dismissing === undefined &&
          !state.refreshing
        ? {
          ...state,
          announcement: `Marking ${action.names} as not duplicates…`,
          dismissing: action.key,
        }
        : state;
    case "dismissed": {
      const { dismissing: _dismissing, ...rest } = state;
      const pairs = state.pairs.filter((pair) => pairKey(pair) !== action.key);
      return {
        ...rest,
        announcement: dismissedAnnouncement(action.names),
        pairs,
        ...(pairs.length === 0 && state.truncated
          ? { refreshing: true as const }
          : {}),
      };
    }
    case "dismiss-failed": {
      const { dismissing: _dismissing, ...rest } = state;
      return { ...rest, announcement: action.detail };
    }
  }
}

const REASONS = {
  email: "same email address",
  name: "same name",
  phone: "same phone number",
} as const;

/** Why a pair was offered, in a fixed order: name, email, phone. */
export function reasonsText(
  reasons: readonly PeopleDuplicatePair["reasons"][number][],
): string {
  const text = (["name", "email", "phone"] as const)
    .filter((reason) => reasons.includes(reason))
    .map((reason) => REASONS[reason])
    .join(" · ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const NOTHING_LEFT = "No possible duplicates are left to review.";
const RELOAD =
  "More possible duplicates may be waiting. Reload the page to review them.";

/**
 * What the status line adds once the list was read again (REL-090): how many
 * pairs the read found, or, without `count`, that it failed.
 */
export function refreshedAnnouncement(count?: number): string {
  if (count === undefined) return RELOAD;
  if (count === 0) return NOTHING_LEFT;
  return `${count} more ${
    count === 1 ? "pair" : "pairs"
  } of possible duplicates to review.`;
}

/** The dismissal's announcement, followed by what the second read found. */
function afterRefresh(state: DuplicatesState, count?: number): string {
  return [state.announcement, refreshedAnnouncement(count)]
    .filter(Boolean)
    .join(" ");
}

/**
 * What the review says about its pairs. `truncated` means the server held
 * more than it sent; `refreshing` that the list is being read again after
 * its last shown pair left.
 */
export function duplicatesSummary(
  count: number,
  truncated: boolean,
  refreshing = false,
): string {
  if (refreshing) return "Looking for more possible duplicates…";
  if (count === 0) return truncated ? RELOAD : NOTHING_LEFT;
  const pairs = `${count} ${count === 1 ? "pair" : "pairs"}`;
  return `${pairs} of people may be the same person.${
    truncated
      ? " More are waiting: merge pairs or mark them as not duplicates to see the rest."
      : ""
  }`;
}

export function dismissedAnnouncement(names: string): string {
  return `${names} are marked as not duplicates. They will not be suggested again.`;
}
