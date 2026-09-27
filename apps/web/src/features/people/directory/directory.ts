/**
 * The people directory's pure half (GAP-033): its wording, the search it
 * sends, the location it keeps, and the one reducer the directory island
 * moves through. Nothing here touches the DOM.
 *
 * The directory lists one lifecycle — active or archived people — twenty at
 * a time, filtered by a name search and one tag, in the member's sort. The
 * tag picker pages its own options, so a workspace with many tags stays
 * bounded while every tag remains reachable by continuation or refinement.
 */

import type {
  PeopleDirectoryInput,
  PeopleDirectoryLifecycle,
  PeopleDirectoryPerson,
  PeopleDirectorySort,
  PeopleDirectoryTag,
  PeopleTagOptionsPage,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  displayPersonName,
  type PersonNameOrder,
} from "../../../lib/person-name.ts";

export const PAGE_SIZE = 20;

export function isSort(value: string | null): value is PeopleDirectorySort {
  return value === "given-name" || value === "family-name" ||
    value === "recently-added";
}

/** What the reader asked the directory for. */
export interface DirectoryQuery {
  readonly search: string;
  readonly sort: PeopleDirectorySort;
  readonly tagId: string;
}

/** The page request a query makes, continuing after `cursor` when given. */
export function directoryInput(
  lifecycle: PeopleDirectoryLifecycle,
  query: DirectoryQuery,
  cursor?: string,
): PeopleDirectoryInput {
  const search = query.search.trim();
  return {
    ...(cursor ? { cursor } : {}),
    lifecycle,
    limit: PAGE_SIZE,
    ...(search ? { search } : {}),
    sort: query.sort,
    ...(query.tagId ? { tagId: query.tagId } : {}),
  };
}

/**
 * The directory's address for `query`: the search, the tag, and the sort
 * when it differs from the member's default or the address already named
 * one, so an explicit choice survives a reload.
 */
export function directoryLocation(
  pathname: string,
  current: string,
  query: DirectoryQuery,
  defaultSort: PeopleDirectorySort,
): string {
  const next = new URLSearchParams();
  const search = query.search.trim();
  if (search) next.set("search", search);
  if (query.tagId) next.set("tag", query.tagId);
  if (
    query.sort !== defaultSort ||
    isSort(new URLSearchParams(current).get("sort"))
  ) next.set("sort", query.sort);
  return next.size > 0 ? `${pathname}?${next.toString()}` : pathname;
}

/** The line under a person's name. */
export function personDetails(person: PeopleDirectoryPerson): string {
  return [
    person.isStarred ? "Favorite" : "",
    person.isPartial ? "Partial identity" : "",
    person.lifecycle === "archived" ? "Archived · read-only" : "",
  ].filter(Boolean).join(" · ") || "Open person workspace";
}

export function personName(
  person: PeopleDirectoryPerson,
  order: PersonNameOrder,
): string {
  return displayPersonName(person, order);
}

/** What an empty result says, for a search, an archive, or a new workspace. */
export function emptyCopy(
  filtered: boolean,
  lifecycle: PeopleDirectoryLifecycle,
): { readonly heading: string; readonly detail: string } {
  if (filtered) {
    return {
      detail: "Try a different name or tag.",
      heading: "No people match these filters",
    };
  }
  return lifecycle === "archived"
    ? {
      detail: "People you archive will appear here.",
      heading: "No archived people",
    }
    : {
      detail: "Add your first person when you are ready.",
      heading: "No people yet",
    };
}

/** What a failed read says, for lost access or an unreachable directory. */
export function errorCopy(
  forbidden: boolean,
): { readonly heading: string; readonly detail: string } {
  return forbidden
    ? {
      detail:
        "Your current session or active workspace no longer permits this view.",
      heading: "People unavailable",
    }
    : {
      detail:
        "Your saved people have not changed. Check your connection and try again.",
      heading: "People temporarily unavailable",
    };
}

export type DirectoryStatus = "context" | "loading" | "ready" | "error";

export interface DirectoryState {
  /** `context` while the workspace and preferences resolve. */
  readonly status: DirectoryStatus;
  /** A list read owns the list: every control waits for it. */
  readonly loading: boolean;
  /** The read in flight continues the list rather than replacing it. */
  readonly appending: boolean;
  readonly people: readonly PeopleDirectoryPerson[];
  readonly nextCursor: string | undefined;
  /** Whether the failure was lost access rather than an unreachable server. */
  readonly forbidden: boolean;
  /** Whether the list shown answers a search or a tag. */
  readonly filtered: boolean;
  readonly announcement: string;
  readonly nameOrder: PersonNameOrder;
  readonly sort: PeopleDirectorySort;
  readonly defaultSort: PeopleDirectorySort;
  readonly tag: TagPickerState;
}

export interface TagPickerState {
  /** The chosen tag id, or "" for every tag. */
  readonly selected: string;
  /** The options after "All tags", in the order they arrived. */
  readonly options: readonly PeopleDirectoryTag[];
  readonly cursor: string | undefined;
  readonly loading: boolean;
  readonly status: string;
}

export type DirectoryAction =
  | {
    readonly type: "context";
    readonly nameOrder: PersonNameOrder;
    readonly defaultSort: PeopleDirectorySort;
    readonly sort: PeopleDirectorySort;
  }
  | { readonly type: "loading"; readonly append: boolean }
  | {
    readonly type: "loaded";
    readonly append: boolean;
    readonly people: readonly PeopleDirectoryPerson[];
    readonly nextCursor: string | undefined;
    readonly filtered: boolean;
    readonly lifecycle: PeopleDirectoryLifecycle;
  }
  | { readonly type: "failed"; readonly forbidden: boolean }
  | { readonly type: "announce"; readonly announcement: string }
  | { readonly type: "sort"; readonly sort: PeopleDirectorySort }
  | { readonly type: "tag"; readonly selected: string }
  | { readonly type: "tags-loading"; readonly append: boolean }
  | {
    readonly type: "tags-loaded";
    readonly append: boolean;
    readonly page: PeopleTagOptionsPage;
  }
  | { readonly type: "tags-failed" };

export function initialDirectory(selectedTag: string): DirectoryState {
  return {
    announcement: "",
    appending: false,
    defaultSort: "given-name",
    filtered: false,
    forbidden: false,
    loading: false,
    nameOrder: "given_family_nickname",
    nextCursor: undefined,
    people: [],
    sort: "given-name",
    status: "context",
    tag: {
      cursor: undefined,
      loading: false,
      options: [],
      selected: selectedTag,
      status: "",
    },
  };
}

function countAnnouncement(
  count: number,
  lifecycle: PeopleDirectoryLifecycle,
): string {
  return count === 0
    ? "No people found."
    : `${count} ${lifecycle} ${count === 1 ? "person" : "people"} shown.`;
}

/**
 * The options a tag page leaves: a first page starts over, keeping the
 * chosen tag even when the page does not reach it; a continuation appends
 * what is new.
 */
function tagOptions(
  tag: TagPickerState,
  page: PeopleTagOptionsPage,
  append: boolean,
): readonly PeopleDirectoryTag[] {
  const kept: PeopleDirectoryTag[] = append
    ? [...tag.options]
    : tag.selected
    ? [page.selected ?? { id: tag.selected, name: "Selected tag" }]
    : [];
  const seen = new Set(kept.map((option) => option.id));
  for (const option of page.options) {
    if (seen.has(option.id)) continue;
    kept.push(option);
    seen.add(option.id);
  }
  return kept;
}

export function directoryReducer(
  state: DirectoryState,
  action: DirectoryAction,
): DirectoryState {
  switch (action.type) {
    case "context":
      return {
        ...state,
        defaultSort: action.defaultSort,
        nameOrder: action.nameOrder,
        sort: action.sort,
      };
    case "loading":
      return {
        ...state,
        appending: action.append,
        loading: true,
        status: action.append ? state.status : "loading",
      };
    case "loaded": {
      const people = action.append
        ? [...state.people, ...action.people]
        : action.people;
      return {
        ...state,
        announcement: countAnnouncement(people.length, action.lifecycle),
        appending: false,
        filtered: action.filtered,
        loading: false,
        nextCursor: action.nextCursor,
        people,
        status: "ready",
      };
    }
    case "failed":
      return {
        ...state,
        appending: false,
        forbidden: action.forbidden,
        loading: false,
        nextCursor: undefined,
        status: "error",
      };
    case "announce":
      return { ...state, announcement: action.announcement };
    case "sort":
      return { ...state, sort: action.sort };
    case "tag":
      return { ...state, tag: { ...state.tag, selected: action.selected } };
    case "tags-loading":
      return {
        ...state,
        tag: {
          ...state.tag,
          loading: true,
          status: action.append
            ? "Loading more tag options…"
            : "Loading tag options…",
        },
      };
    case "tags-loaded": {
      const options = tagOptions(state.tag, action.page, action.append);
      return {
        ...state,
        tag: {
          ...state.tag,
          cursor: action.page.nextCursor,
          loading: false,
          options,
          status: `${options.length} tag ${
            options.length === 1 ? "option" : "options"
          } shown.`,
        },
      };
    }
    case "tags-failed":
      return {
        ...state,
        tag: {
          ...state.tag,
          cursor: undefined,
          loading: false,
          status: "Tag options are temporarily unavailable.",
        },
      };
  }
}
