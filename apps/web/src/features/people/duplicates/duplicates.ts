/**
 * The duplicate review's pure half (GAP-049, PEOPLE-008): its one reducer and
 * its wording. Nothing here touches the DOM.
 *
 * The review sits on the people directory, folded away until the member asks
 * for it, and says nothing at all when there is nothing to review or it could
 * not be read: it is a suggestion beside the directory, never a second
 * directory with its own error states.
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
  | { readonly type: "merge-closed" };

export function initialDuplicates(): DuplicatesState {
  return { expanded: false, pairs: [], status: "loading", truncated: false };
}

export function duplicatesReducer(
  state: DuplicatesState,
  action: DuplicatesAction,
): DuplicatesState {
  switch (action.type) {
    case "loaded":
      return {
        ...state,
        context: action.context,
        pairs: action.pairs,
        status: "ready",
        truncated: action.truncated,
      };
    case "failed":
      return { ...state, status: "unavailable" };
    case "toggled":
      return { ...state, expanded: !state.expanded };
    case "merge-opened":
      return state.merging === undefined && action.index < state.pairs.length
        ? { ...state, merging: action.index }
        : state;
    case "merge-closed": {
      const { merging: _merging, ...rest } = state;
      return rest;
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

export function duplicatesSummary(count: number, truncated: boolean): string {
  const pairs = `${count} ${count === 1 ? "pair" : "pairs"}`;
  return `${pairs} of people may be the same person.${
    truncated ? ` Showing the first ${count}; merge some to see more.` : ""
  }`;
}
