/**
 * The relationships rail block's pure half (GAP-031): how relationships
 * group and read, which relationship types a picker offers, what the block
 * shows in each state, and the one reducer its state moves through.
 *
 * The block has three kinds of state that answer independently — the page
 * of relationships, the page of relationship types, and a people search for
 * the editor — and a write may only start while all of them say it can. The
 * reducer holds them together, and `relationshipsView` is the one place that
 * says what they add up to, in the order the vanilla block decided it: a
 * hidden module conceals everything, a failed list read or an archived
 * person comes next, then a relationship-type outage, then loading, then the
 * people search, and only then the ready summary.
 */

import type {
  RelationshipListPage,
  RelationshipType,
  RelationshipWithDisplay,
} from "../../../../../../packages/contracts/generated/auth-client.ts";

export type Row = RelationshipWithDisplay;

// --- How relationships read -------------------------------------------------

/** How many rows the collapsed block keeps in view. */
export const SUMMARY_ROWS = 5;

export interface RelationshipGroup {
  readonly key: string;
  readonly label: string;
  readonly relationshipTypeId: string;
  readonly rows: readonly Row[];
}

/**
 * The relationships grouped by type and direction, in first-seen order: one
 * type read in opposite directions ("parent", "child") is two groups.
 */
export function groupRelationships(
  rows: readonly Row[],
): readonly RelationshipGroup[] {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.relationshipTypeId, row.display.label]);
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }
  return [...groups].map(([key, grouped]) => ({
    key,
    label: grouped[0]!.display.label,
    relationshipTypeId: grouped[0]!.relationshipTypeId,
    rows: grouped,
  }));
}

/** The rows the collapsed block keeps in view. */
export function summaryRowIds(rows: readonly Row[]): ReadonlySet<string> {
  return new Set(rows.slice(0, SUMMARY_ROWS).map((row) => row.id));
}

/** The related person's name, or what a row says without one. */
export function relatedName(row: Row): string {
  return row.display.name ?? "Related person";
}

/** A directory person's name as a choice reads it. */
export function personName(
  person: {
    readonly familyName?: string;
    readonly givenName: string;
    readonly nickname?: string;
  },
): string {
  return [person.givenName, person.familyName].filter(Boolean).join(" ") ||
    person.nickname || "Unnamed person";
}

export interface TypeChoice {
  readonly id: string;
  readonly label: string;
  readonly archived: boolean;
}

/**
 * The relationship types a picker offers: the page on screen, the types the
 * last read hydrated for what is selected, and the row's own current type,
 * each once. An archived type is offered, disabled, so a row keeps naming it.
 */
export function typeChoices(
  options: readonly RelationshipType[],
  selected: readonly RelationshipType[],
  current?: RelationshipType,
): readonly TypeChoice[] {
  const byId = new Map<string, RelationshipType>();
  for (const type of [...options, ...selected, ...(current ? [current] : [])]) {
    byId.set(type.id, type);
  }
  return [...byId.values()].map((type) => ({
    archived: type.archived,
    id: type.id,
    label: `${type.forwardLabel} / ${type.reverseLabel}${
      type.archived ? " (archived)" : ""
    }`,
  }));
}

/** A row's current type, as its picker names it. */
export function rowType(row: Row): RelationshipType {
  return {
    archived: row.relationshipTypeArchived,
    forwardLabel: row.forwardLabel,
    id: row.relationshipTypeId,
    reverseLabel: row.reverseLabel,
  };
}

/** The types a type read hydrates: the chosen one and those rows use. */
export function selectedTypeIds(
  chosen: string,
  rows: readonly Row[],
): readonly string[] {
  return [
    ...new Set([chosen, ...rows.map((row) => row.relationshipTypeId)]),
  ].filter(Boolean).slice(0, 20);
}

/**
 * A person revision in the one form the API writes, so revisions compare as
 * text; anything else is not a revision.
 */
export function normalizeRevision(value: unknown): string | undefined {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) return;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z$/,
  );
  if (!match) return;
  return `${match[1]}.${(match[2] ?? "").padEnd(6, "0")}Z`;
}

/**
 * The lifecycle change a `person-lifecycle-changed` event announces for
 * `personId`, when it is well formed and newer than `revision`.
 */
export function lifecycleChange(
  detail: unknown,
  personId: string,
  revision: string,
): { readonly archived: boolean; readonly revision: string } | undefined {
  const event = detail as
    | {
      readonly archived?: unknown;
      readonly personId?: unknown;
      readonly personUpdatedAt?: unknown;
      readonly state?: unknown;
    }
    | null
    | undefined;
  const next = normalizeRevision(event?.personUpdatedAt);
  if (
    event?.personId !== personId ||
    (event.state !== "active" && event.state !== "archived") ||
    event.archived !== (event.state === "archived") ||
    !next || (revision !== "" && next <= revision)
  ) return undefined;
  return { archived: event.state === "archived", revision: next };
}

// --- The block's state ------------------------------------------------------

export type ListStatus = "loading" | "ready" | "error" | "forbidden";
/** `idle` until an editor first needs the types (FEQ-04). */
export type TypeStatus = "idle" | "loading" | "ready" | "error" | "hidden";
export type PeopleStatus = "idle" | "loading" | "error";

export interface PersonChoice {
  readonly id: string;
  readonly name: string;
}

/** A related person the editor would create, kept for a duplicate choice. */
export interface RelatedDraft {
  readonly familyName: string;
  readonly givenName: string;
  readonly relationshipTypeId: string;
}

export type RelationshipFocus =
  | "state"
  | "add"
  | "field"
  | "target"
  | "type"
  | "list"
  | "select-existing";

export interface RelationshipsState {
  /** What the relationship read said about the person. */
  readonly personStatus: "ready" | "archived" | "hidden";
  readonly list: ListStatus;
  readonly listProblem: string;
  readonly types: TypeStatus;
  readonly typeProblem: string;
  readonly people: PeopleStatus;
  readonly rows: readonly Row[];
  readonly cursor?: string | undefined;
  readonly nextCursor?: string | undefined;
  /** The cursors of the pages before the one on screen. */
  readonly previous: readonly (string | undefined)[];
  readonly typeOptions: readonly RelationshipType[];
  readonly selectedTypes: readonly RelationshipType[];
  readonly typeCursor?: string | undefined;
  readonly typeNextCursor?: string | undefined;
  readonly typePrevious: readonly (string | undefined)[];
  readonly typeSearch: string;
  /** The existing people the editor offers, from its last search. */
  readonly candidates: readonly PersonChoice[];
  readonly peopleQuery: string;
  /** Whether the reader has the editor open. */
  readonly editorOpen: boolean;
  /**
   * Whether a type read holds the open editor: hidden and inert until the
   * read answers, then shown again when it answers ready.
   */
  readonly reserved: boolean;
  readonly targetId: string;
  readonly typeId: string;
  readonly duplicate?: RelatedDraft | undefined;
  /** What the status line says instead of the state's own text. */
  readonly notice?: string | undefined;
  readonly expanded: boolean;
  readonly focus?: {
    readonly target: RelationshipFocus;
    readonly tick: number;
  };
}

export type RelationshipsAction =
  | {
    readonly type: "list-loading";
    readonly previous?: readonly (string | undefined)[];
  }
  | {
    readonly type: "list-loaded";
    readonly cursor: string | undefined;
    readonly page: RelationshipListPage;
    /**
     * What a write that asked for the read says, focused, once the block
     * shows writable again.
     */
    readonly notice?: string;
  }
  | { readonly type: "list-failed"; readonly status: number | undefined }
  | {
    readonly type: "types-loading";
    readonly previous?: readonly (string | undefined)[];
    readonly search?: string;
  }
  | {
    readonly type: "types-loaded";
    readonly cursor: string | undefined;
    readonly nextCursor?: string | undefined;
    readonly status: "ready" | "hidden";
    readonly options: readonly RelationshipType[];
    readonly selected: readonly RelationshipType[];
    readonly focus?: RelationshipFocus;
  }
  | { readonly type: "types-failed"; readonly detail: string | undefined }
  | { readonly type: "people-loading" }
  | { readonly type: "people-query"; readonly query: string }
  | { readonly type: "people-found"; readonly people: readonly PersonChoice[] }
  | { readonly type: "people-failed" }
  | { readonly type: "open" }
  | { readonly type: "close"; readonly focus?: boolean }
  | {
    readonly type: "choose";
    readonly targetId?: string;
    readonly typeId?: string;
  }
  | {
    readonly type: "notice";
    readonly notice: string;
    readonly focus?: RelationshipFocus;
  }
  | { readonly type: "duplicate"; readonly draft: RelatedDraft }
  | { readonly type: "dismiss-duplicate" }
  | { readonly type: "lifecycle"; readonly archived: boolean }
  | { readonly type: "focus"; readonly target: RelationshipFocus }
  | { readonly type: "expand" };

export const LIST_UNAVAILABLE =
  "This relationship section is temporarily unavailable. Try again.";
export const FORBIDDEN = "Your active workspace no longer permits this action.";
export const TYPES_UNAVAILABLE =
  "Relationship types are temporarily unavailable.";
export const PEOPLE_UNAVAILABLE =
  "People search is temporarily unavailable. Try again.";
export const READ_ONLY =
  "Relationships are read-only because this person is archived.";
export const DUPLICATE_NOTICE =
  "A person with this name may already exist. Select the existing person or explicitly create another.";

/**
 * The block as it mounts: loading, or — when the profile summary counted no
 * relationship (`empty`) — already showing its empty list, with the types
 * left until the editor opens (FEQ-04).
 */
export function initialRelationshipsState(
  archived: boolean,
  empty = false,
): RelationshipsState {
  return {
    candidates: [],
    editorOpen: false,
    expanded: false,
    list: empty ? "ready" : "loading",
    listProblem: "",
    people: "idle",
    peopleQuery: "",
    personStatus: archived ? "archived" : "ready",
    previous: [],
    reserved: false,
    rows: [],
    selectedTypes: [],
    targetId: "",
    typeId: "",
    typeOptions: [],
    typePrevious: [],
    typeProblem: "",
    typeSearch: "",
    types: empty ? "idle" : "loading",
  };
}

/**
 * Whether the block may write: its list and person are ready, and its types
 * are ready or not yet asked for, which opening the editor does.
 */
export function writesReady(state: RelationshipsState): boolean {
  return state.list === "ready" && state.personStatus === "ready" &&
    (state.types === "ready" || state.types === "idle");
}

/** Whether the module is off, which conceals the block entirely. */
export function concealed(state: RelationshipsState): boolean {
  return state.personStatus === "hidden" || state.types === "hidden";
}

/** Whether the editor shows: open, writable, and holding its types. */
export function editorVisible(state: RelationshipsState): boolean {
  return state.editorOpen && writesReady(state) && state.types === "ready";
}

function focus(
  state: RelationshipsState,
  target: RelationshipFocus,
): { readonly target: RelationshipFocus; readonly tick: number } {
  return { target, tick: (state.focus?.tick ?? 0) + 1 };
}

/** The editor's draft goes: its choices, its people, and its types. */
function withoutDraft(state: RelationshipsState): RelationshipsState {
  return {
    ...state,
    candidates: [],
    duplicate: undefined,
    editorOpen: false,
    people: "idle",
    peopleQuery: "",
    reserved: false,
    selectedTypes: [],
    targetId: "",
    typeCursor: undefined,
    typeId: "",
    typeNextCursor: undefined,
    typeOptions: [],
    typePrevious: [],
    typeSearch: "",
  };
}

/** A hidden module leaves nothing of the person's relationships behind. */
function conceal(state: RelationshipsState): RelationshipsState {
  return {
    ...withoutDraft(state),
    cursor: undefined,
    nextCursor: undefined,
    notice: undefined,
    previous: [],
    rows: [],
  };
}

/** The state line is the state's own again; the rows collapse. */
function redrawn(state: RelationshipsState): RelationshipsState {
  return { ...state, expanded: false, notice: undefined };
}

export function relationshipsReducer(
  state: RelationshipsState,
  action: RelationshipsAction,
): RelationshipsState {
  switch (action.type) {
    case "list-loading":
      return {
        ...redrawn(state),
        duplicate: undefined,
        editorOpen: false,
        list: "loading",
        ...(action.previous ? { previous: action.previous } : {}),
      };
    case "list-loaded": {
      const { page } = action;
      if (page.status === "hidden") {
        return conceal({ ...state, list: "ready", personStatus: "hidden" });
      }
      const next: RelationshipsState = {
        ...redrawn(state),
        cursor: action.cursor,
        list: "ready",
        nextCursor: page.nextCursor,
        personStatus: page.status,
        rows: page.relationships,
        ...(page.status === "archived" ? { people: "idle" as const } : {}),
      };
      if (!writesReady(next) || action.notice === undefined) return next;
      return { ...next, focus: focus(state, "state"), notice: action.notice };
    }
    case "list-failed":
      return {
        ...redrawn(state),
        list: action.status === 401 || action.status === 403
          ? "forbidden"
          : "error",
        listProblem: action.status === 401 || action.status === 403
          ? FORBIDDEN
          : LIST_UNAVAILABLE,
        people: "idle",
      };
    case "types-loading": {
      const reserved = state.reserved || editorVisible(state);
      return {
        ...redrawn(state),
        duplicate: undefined,
        editorOpen: reserved,
        reserved,
        types: "loading",
        ...(action.previous ? { typePrevious: action.previous } : {}),
        ...(action.search !== undefined ? { typeSearch: action.search } : {}),
      };
    }
    case "types-loaded": {
      if (action.status === "hidden") {
        return conceal({ ...state, types: "hidden" });
      }
      const next: RelationshipsState = {
        ...redrawn(state),
        reserved: false,
        selectedTypes: action.selected,
        typeCursor: action.cursor,
        typeNextCursor: action.nextCursor,
        typeOptions: action.options,
        typeProblem: "",
        types: "ready",
      };
      return action.focus && writesReady(next)
        ? { ...next, focus: focus(state, action.focus) }
        : next;
    }
    case "types-failed":
      return {
        ...redrawn(state),
        editorOpen: false,
        people: "idle",
        reserved: false,
        selectedTypes: [],
        typeOptions: [],
        typeProblem: action.detail ?? TYPES_UNAVAILABLE,
        types: "error",
      };
    case "people-query":
      return {
        ...redrawn(state),
        candidates: [],
        people: action.query.trim() ? "loading" : "idle",
        peopleQuery: action.query,
        targetId: "",
      };
    case "people-loading":
      return { ...redrawn(state), candidates: [], people: "loading" };
    case "people-found":
    case "people-failed": {
      if (state.people !== "loading") return state;
      if (!editorVisible(state)) return { ...state, people: "idle" };
      if (action.type === "people-failed") {
        return {
          ...redrawn(state),
          candidates: [],
          people: "error",
          targetId: "",
        };
      }
      return {
        ...redrawn(state),
        candidates: action.people,
        people: "idle",
      };
    }
    case "open":
      return { ...state, editorOpen: true, focus: focus(state, "field") };
    case "close": {
      const next = {
        ...state,
        duplicate: undefined,
        editorOpen: false,
        candidates: [],
        people: "idle" as const,
        peopleQuery: "",
        reserved: false,
        targetId: "",
        typeId: "",
      };
      return action.focus ? { ...next, focus: focus(state, "add") } : next;
    }
    case "choose":
      return {
        ...state,
        ...(action.targetId !== undefined
          ? {
            targetId: action.targetId,
            peopleQuery:
              state.candidates.find((person) => person.id === action.targetId)
                ?.name ?? "",
          }
          : {}),
        ...(action.typeId !== undefined ? { typeId: action.typeId } : {}),
      };
    case "notice":
      return {
        ...state,
        notice: action.notice,
        ...(action.focus ? { focus: focus(state, action.focus) } : {}),
      };
    case "duplicate":
      return {
        ...state,
        duplicate: action.draft,
        focus: focus(state, "select-existing"),
        notice: DUPLICATE_NOTICE,
      };
    case "dismiss-duplicate":
      return { ...state, duplicate: undefined };
    case "lifecycle": {
      const cleared = {
        ...redrawn(withoutDraft(state)),
        cursor: undefined,
        nextCursor: undefined,
        previous: [],
        types: "loading" as const,
      };
      return action.archived
        ? { ...cleared, list: "ready", personStatus: "archived" }
        : { ...cleared, list: "loading", personStatus: "ready" };
    }
    case "focus":
      return { ...state, focus: focus(state, action.target) };
    case "expand":
      return { ...state, expanded: !state.expanded };
  }
}

// --- What the block shows ---------------------------------------------------

export type ViewKind =
  | "hidden"
  | "error"
  | "forbidden"
  | "read-only"
  | "types-error"
  | "loading"
  | "searching"
  | "search-error"
  | "ready";

export interface RelationshipsView {
  readonly kind: ViewKind;
  /** The section's `data-section-state`. */
  readonly sectionState: string;
  /** The status line's own text, unless a notice replaces it. */
  readonly text: string;
  /** Whether the text is the plain summary the rail may collapse. */
  readonly summary: boolean;
  readonly writesReady: boolean;
  /** Whether the people search holds the editor's person choices. */
  readonly peopleLocked: boolean;
  /** Where the block announces a state the reader must hear. */
  readonly announce?: "state" | "main";
}

export function relationshipsView(
  state: RelationshipsState,
): RelationshipsView {
  const base = {
    peopleLocked: false,
    summary: false,
    writesReady: writesReady(state),
  };
  if (concealed(state)) {
    return {
      ...base,
      announce: "main",
      kind: "hidden",
      sectionState: "hidden",
      text: "",
      writesReady: false,
    };
  }
  if (state.list === "error" || state.list === "forbidden") {
    return {
      ...base,
      announce: "state",
      kind: state.list,
      sectionState: state.list,
      text: state.listProblem,
    };
  }
  if (state.list === "ready" && state.personStatus === "archived") {
    return {
      ...base,
      announce: "state",
      kind: "read-only",
      sectionState: "read-only",
      text: READ_ONLY,
    };
  }
  if (state.types === "error") {
    return {
      ...base,
      announce: "state",
      kind: "types-error",
      sectionState: "error",
      text: state.typeProblem,
    };
  }
  if (state.list === "loading" || state.types === "loading") {
    return {
      ...base,
      kind: "loading",
      sectionState: "loading",
      text: "Loading relationships…",
    };
  }
  if (state.people === "loading") {
    return {
      ...base,
      kind: "searching",
      peopleLocked: true,
      sectionState: "loading",
      text: "Searching people…",
    };
  }
  if (state.people === "error") {
    return {
      ...base,
      kind: "search-error",
      peopleLocked: true,
      sectionState: "error",
      text: PEOPLE_UNAVAILABLE,
    };
  }
  const count = state.rows.length;
  return {
    ...base,
    kind: "ready",
    sectionState: "ready",
    summary: true,
    text: count ? `${count} relationship${count === 1 ? "" : "s"}.` : "",
  };
}
