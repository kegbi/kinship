/**
 * The bulk bar's tag picker (REL-066), pure: the options it lists, the tag
 * chosen among them, and the search and continuation that reach the rest.
 *
 * The picker reads tag options on its own, apart from the directory's tag
 * filter, so the filter's search never narrows what a bulk action can pick,
 * and a workspace with more tags than one page still offers every one by
 * More tags or by the picker's own search.
 */

import type {
  PeopleDirectoryTag,
  PeopleTagOptionsInput,
  PeopleTagOptionsPage,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { tagOptionsStatus } from "./directory.ts";

export interface BulkTagPickerState {
  /** The options, in the order they arrived. */
  readonly options: readonly PeopleDirectoryTag[];
  /** The chosen option's id, or "" when there is none to choose. */
  readonly chosen: string;
  /** The search the options answer, which More tags continues. */
  readonly query: string;
  readonly cursor: string | undefined;
  readonly loading: boolean;
  readonly status: string;
}

export type BulkTagPickerAction =
  | {
    readonly type: "loading";
    readonly append: boolean;
    readonly query: string;
  }
  | {
    readonly type: "loaded";
    readonly append: boolean;
    readonly page: PeopleTagOptionsPage;
  }
  | { readonly type: "failed"; readonly append: boolean }
  | { readonly type: "choose"; readonly id: string };

export const initialBulkTagPicker: BulkTagPickerState = {
  chosen: "",
  cursor: undefined,
  loading: false,
  options: [],
  query: "",
  status: "",
};

/** The page request for `search`, continuing after `cursor` when given. */
export function tagOptionsInput(
  search: string,
  cursor: string | undefined,
): PeopleTagOptionsInput {
  const text = search.trim();
  return { ...(cursor ? { cursor } : {}), ...(text ? { search: text } : {}) };
}

function appended(
  options: readonly PeopleDirectoryTag[],
  page: readonly PeopleDirectoryTag[],
): readonly PeopleDirectoryTag[] {
  const seen = new Set(options.map((option) => option.id));
  return [...options, ...page.filter((option) => !seen.has(option.id))];
}

export function bulkTagPickerReducer(
  state: BulkTagPickerState,
  action: BulkTagPickerAction,
): BulkTagPickerState {
  switch (action.type) {
    case "loading":
      // A new search forgets the continuation of the one it replaces.
      return action.append
        ? { ...state, loading: true, status: "Loading more tag options…" }
        : {
          ...state,
          cursor: undefined,
          loading: true,
          query: action.query,
          status: "Loading tag options…",
        };
    case "loaded": {
      const options = action.append
        ? appended(state.options, action.page.options)
        : action.page.options;
      const kept = options.some((option) => option.id === state.chosen);
      return {
        ...state,
        chosen: kept ? state.chosen : options[0]?.id ?? "",
        cursor: action.page.nextCursor,
        loading: false,
        options,
        status: tagOptionsStatus(options.length),
      };
    }
    case "failed":
      // A failed continuation keeps its cursor, so More tags tries again.
      return {
        ...state,
        cursor: action.append ? state.cursor : undefined,
        loading: false,
        status: "Tag options are temporarily unavailable.",
      };
    case "choose":
      return { ...state, chosen: action.id };
  }
}
