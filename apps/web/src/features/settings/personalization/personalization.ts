/**
 * Workspace personalization's pure parts (GAP-033): the section catalog and
 * its `?section=` deep links, the history entries section navigation
 * writes, the page's state as one reducer, and the words the page shows.
 * `personalization.tsx` renders it.
 *
 * The page shows one section at a time. Its rows and its create form are
 * editable drafts, compared against the baseline the last authoritative read
 * established. While any draft differs, only the one draft being edited may
 * be saved, every row action that would replace it is blocked, and leaving
 * the section asks first. A read in flight makes every mutation control
 * inert until it lands.
 */

import type {
  ContactMethodKind,
  PersonalizationEntry,
  PersonalizationSection,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
export { CONTACT_METHOD_KINDS } from "../../../../../../packages/contracts/schemas/settings.ts";

/**
 * A contact-method type's kind as the page names it (GAP-050). The importer
 * files email addresses, phone numbers, and websites under the types whose
 * kind is Email, Phone, and Website.
 */
export const CONTACT_KIND_LABELS: Readonly<Record<ContactMethodKind, string>> =
  {
    email: "Email",
    phone: "Phone",
    url: "Website",
    social: "Social profile",
    im: "Instant messaging",
    username: "Username",
    custom: "Custom",
  };

export const PERSONALIZATION_SECTIONS: readonly {
  readonly id: PersonalizationSection;
  readonly label: string;
}[] = [
  { id: "profile-modules", label: "Profile modules" },
  { id: "gender-options", label: "Gender options" },
  { id: "contact-method-types", label: "Contact method types" },
  { id: "contact-labels", label: "Contact labels" },
  { id: "activity-types", label: "Activity types" },
  { id: "emotion-options", label: "Emotion options" },
  { id: "life-event-types", label: "Life event types" },
  { id: "relationship-types", label: "Relationship types" },
  { id: "pet-categories", label: "Pet categories" },
  { id: "reminder-rules", label: "Reminder rules" },
  { id: "tags", label: "Tags" },
];

export function acceptedSection(
  value: unknown,
): value is PersonalizationSection {
  return typeof value === "string" &&
    PERSONALIZATION_SECTIONS.some(({ id }) => id === value);
}

/** The section a `?section=` query names, or the first one. */
export function resolvePersonalizationSection(
  search: string,
): PersonalizationSection {
  const requested = new URLSearchParams(search).get("section");
  return acceptedSection(requested) ? requested : "profile-modules";
}

export function sectionLabel(section: PersonalizationSection): string {
  return PERSONALIZATION_SECTIONS.find(({ id }) => id === section)!.label;
}

/** The history entry section navigation writes: where it is, and which. */
export interface PersonalizationHistoryState {
  readonly index: number;
  readonly section: PersonalizationSection;
}

export const MAX_PERSONALIZATION_HISTORY_INDEX = 10_000;

/** The personalization entry a history state carries, if it is a valid one. */
export function personalizationHistoryState(
  value: unknown,
): PersonalizationHistoryState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as { readonly personalization?: unknown })
    .personalization;
  if (!candidate || typeof candidate !== "object") return undefined;
  const { index, section } = candidate as {
    readonly index?: unknown;
    readonly section?: unknown;
  };
  return Number.isSafeInteger(index) && Number(index) >= 0 &&
      Number(index) <= MAX_PERSONALIZATION_HISTORY_INDEX &&
      acceptedSection(section)
    ? { index: Number(index), section }
    : undefined;
}

/** `existing` history state with the personalization entry set. */
export function historyValue(
  existing: unknown,
  index: number,
  section: PersonalizationSection,
): Record<string, unknown> {
  return {
    ...(existing && typeof existing === "object" ? existing : {}),
    personalization: { index, section },
  };
}

/** The section the page shows, as its last successful read answered it. */
export interface RenderedSection {
  readonly section: PersonalizationSection;
  readonly entries: readonly PersonalizationEntry[];
  readonly canCreate: boolean;
}

/** What the status line offers to retry, and how. */
export type StatusRetry =
  | { readonly kind: "refresh" }
  | {
    readonly kind: "section";
    readonly section: PersonalizationSection;
    readonly focus: boolean;
    readonly cleanMessage: string | undefined;
  };

export interface PersonalizationState {
  readonly phase: "session" | "no-session" | "ready";
  readonly rendered: RenderedSection | undefined;
  /** Moves on with each successful read, so the rows restart from it. */
  readonly generation: number;
  /** Moves on whenever the create form restarts empty. */
  readonly createKey: number;
  readonly loading: boolean;
  /** Whether a change the reader asked for is in flight. */
  readonly mutating: boolean;
  readonly status: string;
  readonly retry: StatusRetry | undefined;
  readonly retrying: boolean;
  /** Bumped when focus should move to the status line or the heading. */
  readonly statusFocus: number;
  readonly headingFocus: number;
  /** Whether an authoritative read has set the baseline drafts differ from. */
  readonly baselined: boolean;
  /** The drafts that differ from it, by form: `create` or an entry's id. */
  readonly dirtyForms: readonly string[];
  /** The draft being edited: the only one that may be saved. */
  readonly active: string | undefined;
  /** Words that replace the dirty line until the next change of state. */
  readonly dirtyNote: string | undefined;
}

export type PersonalizationAction =
  | { readonly type: "no-session" }
  | { readonly type: "ready" }
  | { readonly type: "loading"; readonly section: PersonalizationSection }
  | {
    readonly type: "loaded";
    readonly rendered: RenderedSection;
    readonly focus: boolean;
    readonly cleanMessage: string | undefined;
  }
  | {
    readonly type: "load-failed";
    readonly message: string;
    /** Where the failed read leaves the status line. */
    readonly retry: StatusRetry | undefined;
    readonly focus: boolean;
  }
  | { readonly type: "edited"; readonly dirtyForms: readonly string[] }
  | { readonly type: "note"; readonly message: string }
  | { readonly type: "baseline"; readonly message?: string }
  | {
    readonly type: "status";
    readonly message: string;
    readonly focus?: boolean;
  }
  | { readonly type: "mutating"; readonly mutating: boolean }
  | { readonly type: "refresh-failed" }
  | { readonly type: "retrying" }
  | { readonly type: "reset-create" };

export const LOADING_PERSONALIZATION = "Loading workspace personalization…";
export const FINISH_DRAFT = "Finish or revert the active draft first.";
export const REFRESH_FAILED =
  "Change saved, but this section could not be refreshed. ";

export const initialPersonalization: PersonalizationState = {
  active: undefined,
  baselined: false,
  createKey: 0,
  dirtyForms: [],
  dirtyNote: undefined,
  generation: 0,
  headingFocus: 0,
  loading: false,
  mutating: false,
  phase: "session",
  rendered: undefined,
  retry: undefined,
  retrying: false,
  status: LOADING_PERSONALIZATION,
  statusFocus: 0,
};

function clean(state: PersonalizationState, note: string | undefined) {
  return {
    ...state,
    active: undefined,
    baselined: true,
    dirtyForms: [],
    dirtyNote: note,
  };
}

export function personalizationReducer(
  state: PersonalizationState,
  action: PersonalizationAction,
): PersonalizationState {
  switch (action.type) {
    case "no-session":
      return {
        ...state,
        phase: "no-session",
        status: "Your session could not be confirmed.",
      };
    case "ready":
      return { ...state, phase: "ready" };
    case "loading":
      return {
        ...state,
        loading: true,
        retry: undefined,
        status: `Loading ${sectionLabel(action.section).toLowerCase()}…`,
      };
    case "loaded": {
      const { rendered } = action;
      const empty = rendered.canCreate
        ? "No options yet. Create the first option for this workspace."
        : "No shared options are available.";
      return {
        ...clean(state, action.cleanMessage),
        createKey: state.rendered?.section === rendered.section
          ? state.createKey
          : state.createKey + 1,
        generation: state.generation + 1,
        headingFocus: state.headingFocus + (action.focus ? 1 : 0),
        loading: false,
        rendered,
        retry: undefined,
        retrying: false,
        status: rendered.entries.length ? "" : empty,
      };
    }
    case "load-failed":
      return {
        ...state,
        ...(state.baselined
          ? {}
          : { active: undefined, dirtyForms: [], dirtyNote: undefined }),
        loading: false,
        retry: action.retry,
        retrying: false,
        status: action.retry ? `${action.message} ` : action.message,
        statusFocus: state.statusFocus + (action.focus ? 1 : 0),
      };
    case "edited": {
      if (!state.baselined) return state;
      const wasDirty = state.dirtyForms.length > 0;
      const dirty = action.dirtyForms.length > 0;
      const active = state.active && action.dirtyForms.includes(state.active)
        ? state.active
        : action.dirtyForms[0];
      return {
        ...state,
        active,
        dirtyForms: action.dirtyForms,
        dirtyNote: dirty || wasDirty ? undefined : state.dirtyNote,
      };
    }
    case "note":
      return { ...state, dirtyNote: action.message };
    case "baseline":
      return clean(state, action.message);
    case "status":
      return {
        ...state,
        retry: undefined,
        status: action.message,
        statusFocus: state.statusFocus + (action.focus ? 1 : 0),
      };
    case "mutating":
      return { ...state, mutating: action.mutating };
    case "refresh-failed":
      return {
        ...state,
        retry: { kind: "refresh" },
        retrying: false,
        status: REFRESH_FAILED,
        statusFocus: state.statusFocus + 1,
      };
    case "retrying":
      return { ...state, retrying: true };
    case "reset-create":
      return { ...state, createKey: state.createKey + 1 };
  }
}

/** Whether any draft differs from the baseline. */
export function isDirty(state: PersonalizationState): boolean {
  return state.dirtyForms.length > 0;
}

/** The dirty line, and its `data-state`. */
export function dirtyLine(
  state: PersonalizationState,
): { readonly text: string; readonly state: "dirty" | "saved" } {
  const dirty = isDirty(state);
  return {
    state: dirty ? "dirty" : "saved",
    text: state.dirtyNote ??
      (dirty ? "Unsaved changes." : "All changes saved."),
  };
}

/**
 * How the draft rules hold a form's controls: its Save only while it is the
 * one draft being edited, its other actions while no draft differs, and its
 * Revert shows only on the draft being edited.
 */
export function draftRules(
  state: PersonalizationState,
  form: string,
): {
  readonly saveBlocked: boolean;
  readonly actionsBlocked: boolean;
  readonly revertShown: boolean;
} {
  const dirty = isDirty(state);
  const active = state.active === form;
  return {
    actionsBlocked: dirty,
    revertShown: dirty && active,
    saveBlocked: dirty && (!active || state.dirtyForms.length > 1),
  };
}

type Capabilities = NonNullable<PersonalizationEntry["capabilities"]>;

/**
 * What a row may do. An entry without declared capabilities is a workspace
 * vocabulary option: renamable, reorderable, and deletable when unused.
 */
export function entryCapabilities(
  entry: PersonalizationEntry,
  section: PersonalizationSection,
): Capabilities {
  return entry.capabilities ?? {
    delete: entry.canDelete,
    disable: true,
    editValue: false,
    rename: true,
    reorder: true,
    replace: entry.canDelete,
    setDefault: section === "gender-options",
  };
}

/** Whether a row is shared and read-only rather than the workspace's own. */
export function entryReadOnly(entry: PersonalizationEntry): boolean {
  return entry.readOnly ?? !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(entry.id);
}

/** The line under a row: how often it is used and its state. */
export function entryDetail(entry: PersonalizationEntry): string {
  return `${entry.referenceCount} reference${
    entry.referenceCount === 1 ? "" : "s"
  } · ${entry.isActive ? "Enabled" : "Disabled"}${
    entry.isDefault ? " · Default" : ""
  }`;
}
