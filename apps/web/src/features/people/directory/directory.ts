/**
 * The people directory's pure half (GAP-033): its wording, the search it
 * sends, the location it keeps, and the one reducer the directory island
 * moves through. Nothing here touches the DOM.
 *
 * The directory lists one lifecycle — active or archived people — twenty at
 * a time, filtered by a name search and one tag, in the member's sort. The
 * tag picker pages its own options, so a workspace with many tags stays
 * bounded while every tag remains reachable by continuation or refinement.
 *
 * GAP-051 (PEOPLE-009) adds a selection to the same reducer: a checkbox per
 * row and one for the page shown, capped at 100 people, kept across appended pages and cleared when the
 * search, filter, sort, or lifecycle changes. The bulk bar that acts on it moves through
 * one choice at a time and is inert while its request runs; its report
 * outlives the refresh that follows, so a member reads what happened after
 * the list has moved on.
 *
 * GAP-053 (PEOPLE-010) adds the starred filter, starred-first, the last
 * contacted and recently updated orders, and the tag facet: the view's most
 * carried tags with their person counts, read beside the tag options.
 */

import type {
  PeopleBulkResult,
  PeopleDirectoryInput,
  PeopleDirectoryLifecycle,
  PeopleDirectoryPerson,
  PeopleDirectorySort,
  PeopleDirectoryTag,
  PeopleTagFacet,
  PeopleTagFacetEntry,
  PeopleTagOptionsPage,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  displayPersonName,
  type PersonNameOrder,
} from "../../../lib/person-name.ts";

export const PAGE_SIZE = 20;

/** How many people one bulk action may take, as the API caps it. */
export const BULK_SELECTION_LIMIT = 100;

const CAP_NOTICE = "You can select up to 100 people at a time.";

export function isSort(value: string | null): value is PeopleDirectorySort {
  return value === "given-name" || value === "family-name" ||
    value === "recently-added" || value === "last-contacted" ||
    value === "recently-updated";
}

/** The starred filter and starred-first, as the reader chose them. */
export interface StarredCriteria {
  readonly starred: boolean;
  readonly starredFirst: boolean;
}

/** The starred choices an address names (`?starred=1&starredFirst=1`). */
export function starredCriteria(search: string): StarredCriteria {
  const query = new URLSearchParams(search);
  return {
    starred: query.get("starred") === "1",
    starredFirst: query.get("starredFirst") === "1",
  };
}

/** What the reader asked the directory for. */
export interface DirectoryQuery {
  readonly search: string;
  readonly sort: PeopleDirectorySort;
  readonly starred?: boolean;
  readonly starredFirst?: boolean;
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
    ...(query.starred ? { starred: true } : {}),
    ...(query.starredFirst ? { starredFirst: true } : {}),
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
  if (query.starred) next.set("starred", "1");
  if (query.starredFirst) next.set("starredFirst", "1");
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

/** A facet chip's accessible name: the tag and how many people carry it. */
export function facetLabel(entry: PeopleTagFacetEntry): string {
  return `${entry.name}, ${entry.count} ${
    entry.count === 1 ? "person" : "people"
  }`;
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

/** What a bulk action did, as the bar reports it. */
export interface BulkReport {
  readonly title: string;
  /** The done, unchanged, and failed counts, or why nothing ran. */
  readonly counts: string;
  /** Each person who was not changed, by name, with the reason. */
  readonly failures: readonly {
    readonly name: string;
    readonly reason: string;
  }[];
  readonly tone: "attention" | "done";
}

export type BulkKind =
  | "archive"
  | "delete"
  | "export"
  | "restore"
  | "tag"
  | "untag";

/** The one choice the bar is waiting on, if any. */
export type BulkStep =
  | "confirm-archive"
  | "confirm-delete"
  | "idle"
  | "tag"
  | "untag";

export interface BulkState {
  readonly step: BulkStep;
  /** The action whose request is in flight; the bar is inert meanwhile. */
  readonly running: BulkKind | undefined;
  readonly report: BulkReport | undefined;
  /** Counts finished runs, so each new report takes focus once. */
  readonly sequence: number;
}

const people = (count: number) =>
  `${count} ${count === 1 ? "person" : "people"}`;

const REASONS: Readonly<Record<string, string>> = {
  archived_write_rejected: "Archived and read-only; restore first",
  forbidden: "Your access to this workspace changed",
  not_found: "No longer in this workspace",
  section_hidden: "Tags are turned off in this workspace",
  stale: "Changed elsewhere; try again",
  tag_unavailable: "The tag is no longer available",
};

/** What a finished bulk action reports, naming each person it could not change. */
export function bulkReport(
  kind: Exclude<BulkKind, "export">,
  answer: Pick<PeopleBulkResult, "results" | "summary">,
  names: ReadonlyMap<string, string>,
  tagName = "",
): BulkReport {
  const { done, failed, skipped, unchanged } = answer.summary;
  const title = kind === "delete"
    ? `Deleted ${people(done)}.`
    : kind === "archive"
    ? `Archived ${people(done)}.`
    : kind === "restore"
    ? `Restored ${people(done)}.`
    : kind === "tag"
    ? `Added “${tagName}” to ${people(done)}.`
    : `Removed “${tagName}” from ${people(done)}.`;
  return {
    counts: [
      `${done} done`,
      `${unchanged} unchanged`,
      `${failed} failed`,
      ...(skipped > 0 ? [`${skipped} skipped`] : []),
    ].join(" · "),
    failures: answer.results.filter((item) =>
      item.outcome === "failed" || item.outcome === "skipped"
    ).map((item) => ({
      name: names.get(item.personId) ?? "Unknown person",
      reason: item.outcome === "skipped"
        ? "Not attempted after access changed"
        : REASONS[item.code ?? ""] ?? "Could not be changed right now",
    })),
    title,
    tone: failed > 0 || skipped > 0 ? "attention" : "done",
  };
}

/** What a selection export reports: the cards written and who was left out. */
export function exportReport(exported: number, skipped: number): BulkReport {
  return {
    counts: skipped > 0
      ? `${skipped} skipped: no longer in this workspace.`
      : "",
    failures: [],
    title: `Exported ${people(exported)} to a vCard.`,
    tone: skipped > 0 ? "attention" : "done",
  };
}

/** A bulk request refused as a whole, or never answered. */
export function bulkProblemReport(
  kind: BulkKind,
  detail: string | undefined,
): BulkReport {
  return {
    counts: detail ??
      "The people service is temporarily unavailable. Try again.",
    failures: [],
    title: kind === "export"
      ? "No vCard was exported."
      : "Nothing was changed.",
    tone: "attention",
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
  /** Only starred people are listed (GAP-053). */
  readonly starred: boolean;
  /** Starred people are listed first. */
  readonly starredFirst: boolean;
  /** The view's most carried tags, with their person counts. */
  readonly facet: FacetState;
  /** The people chosen for a bulk action, in the order they were chosen. */
  readonly selection: readonly string[];
  /** Why the last choice was not added, when the cap refused it. */
  readonly selectionNotice: string;
  readonly bulk: BulkState;
}

export interface FacetState {
  readonly status: "loading" | "ready" | "unavailable";
  readonly tags: readonly PeopleTagFacetEntry[];
  /** More tags are in use than the facet shows. */
  readonly truncated: boolean;
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
  | { readonly type: "starred"; readonly starred: boolean }
  | { readonly type: "starred-first"; readonly starredFirst: boolean }
  | {
    readonly type: "tag";
    readonly selected: string;
    /** The tag's name, when it was chosen from the facet. */
    readonly name?: string;
  }
  | { readonly type: "facet-loaded"; readonly facet: PeopleTagFacet }
  | { readonly type: "facet-failed" }
  | { readonly type: "tags-loading"; readonly append: boolean }
  | {
    readonly type: "tags-loaded";
    readonly append: boolean;
    readonly page: PeopleTagOptionsPage;
  }
  | { readonly type: "tags-failed" }
  | {
    readonly type: "select";
    readonly personId: string;
    readonly selected: boolean;
  }
  | { readonly type: "select-page"; readonly selected: boolean }
  | { readonly type: "clear-selection" }
  | { readonly type: "bulk-step"; readonly step: BulkStep }
  | { readonly type: "bulk-start"; readonly kind: BulkKind }
  | {
    readonly type: "bulk-finished";
    readonly report: BulkReport;
    readonly clearSelection: boolean;
  }
  | { readonly type: "bulk-dismiss" };

export function initialDirectory(
  selectedTag: string,
  criteria: StarredCriteria = { starred: false, starredFirst: false },
): DirectoryState {
  return {
    announcement: "",
    appending: false,
    bulk: { report: undefined, running: undefined, sequence: 0, step: "idle" },
    defaultSort: "given-name",
    facet: { status: "loading", tags: [], truncated: false },
    filtered: false,
    forbidden: false,
    loading: false,
    nameOrder: "given_family_nickname",
    nextCursor: undefined,
    people: [],
    selection: [],
    selectionNotice: "",
    sort: "given-name",
    starred: criteria.starred,
    starredFirst: criteria.starredFirst,
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

/** What a tag picker announces once its options have arrived. */
export function tagOptionsStatus(count: number): string {
  return `${count} tag ${count === 1 ? "option" : "options"} shown.`;
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

/** A list that changes under a selection takes the selection with it. */
function unselected(state: DirectoryState): DirectoryState {
  return {
    ...state,
    bulk: { ...state.bulk, step: "idle" },
    selection: [],
    selectionNotice: "",
  };
}

function select(
  state: DirectoryState,
  personId: string,
  selected: boolean,
): DirectoryState {
  if (!selected) {
    return {
      ...state,
      selection: state.selection.filter((id) => id !== personId),
      selectionNotice: "",
    };
  }
  if (state.selection.includes(personId)) return state;
  if (state.selection.length >= BULK_SELECTION_LIMIT) {
    return { ...state, selectionNotice: CAP_NOTICE };
  }
  return {
    ...state,
    selection: [...state.selection, personId],
    selectionNotice: "",
  };
}

function selectPage(state: DirectoryState, selected: boolean): DirectoryState {
  const shown = new Set(state.people.map((person) => person.id));
  if (!selected) {
    return {
      ...state,
      selection: state.selection.filter((id) => !shown.has(id)),
      selectionNotice: "",
    };
  }
  const selection = [...state.selection];
  let refused = false;
  for (const person of state.people) {
    if (selection.includes(person.id)) continue;
    if (selection.length >= BULK_SELECTION_LIMIT) {
      refused = true;
      break;
    }
    selection.push(person.id);
  }
  return {
    ...state,
    selection,
    selectionNotice: refused
      ? `${CAP_NOTICE} The first ${BULK_SELECTION_LIMIT} are selected.`
      : "",
  };
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
        ...(action.append ? state : unselected(state)),
        appending: action.append,
        loading: true,
        status: action.append ? state.status : "loading",
      };
    case "loaded": {
      const people = action.append
        ? [
          ...new Map(
            [...state.people, ...action.people].map((
              person,
            ) => [person.id, person]),
          ).values(),
        ]
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
      return { ...unselected(state), sort: action.sort };
    case "starred":
      return { ...unselected(state), starred: action.starred };
    case "starred-first":
      return { ...unselected(state), starredFirst: action.starredFirst };
    case "tag": {
      // A facet chip can name a tag the picker has not paged to yet; it is
      // added so the picker shows the tag the list is filtered by.
      const missing = action.name !== undefined && action.selected !== "" &&
        !state.tag.options.some((option) => option.id === action.selected);
      return {
        ...unselected(state),
        tag: {
          ...state.tag,
          options: missing
            ? [...state.tag.options, {
              id: action.selected,
              name: action.name!,
            }]
            : state.tag.options,
          selected: action.selected,
        },
      };
    }
    case "facet-loaded":
      return {
        ...state,
        facet: {
          status: "ready",
          tags: action.facet.tags,
          truncated: action.facet.truncated,
        },
      };
    case "facet-failed":
      return {
        ...state,
        facet: { status: "unavailable", tags: [], truncated: false },
      };
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
          status: tagOptionsStatus(options.length),
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
    case "select":
      return select(state, action.personId, action.selected);
    case "select-page":
      return selectPage(state, action.selected);
    case "clear-selection":
      return unselected(state);
    case "bulk-step":
      return { ...state, bulk: { ...state.bulk, step: action.step } };
    case "bulk-start":
      return {
        ...state,
        bulk: {
          ...state.bulk,
          report: undefined,
          running: action.kind,
          step: "idle",
        },
      };
    case "bulk-finished": {
      const bulk = {
        ...state.bulk,
        report: action.report,
        running: undefined,
        sequence: state.bulk.sequence + 1,
      };
      return action.clearSelection
        ? { ...unselected(state), bulk: { ...bulk, step: "idle" } }
        : { ...state, bulk };
    }
    case "bulk-dismiss":
      return { ...state, bulk: { ...state.bulk, report: undefined } };
  }
}
