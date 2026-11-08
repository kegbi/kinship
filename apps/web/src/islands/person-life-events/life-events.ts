/**
 * The life-events card's pure half (JOURNAL-002): how an event reads, the
 * order the card lists events in, what the editor's fields send, how a
 * refusal is worded, and the one reducer the card's state moves through.
 * Nothing here touches the DOM, so it is tested without rendering.
 *
 * An event is kept with only the components its precision declares; the
 * editor never sends a hidden component and never invents a missing one.
 */

import { z } from "zod";
import type {
  PersonLifeEvent,
  PersonLifeEventType,
  ProblemDetails,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { personLifeEventInput } from "../../../../../packages/contracts/schemas/people.ts";
import { formatPartialDate } from "../../lib/time-presentation.ts";

export type LifeEventPrecision = PersonLifeEvent["date"]["precision"];
export type DateComponent = "year" | "month" | "day";

// --- How an event reads ------------------------------------------------------

/** What the event is called: its name, else its type, else a plain noun. */
export function eventTitle(event: PersonLifeEvent): string {
  return event.name ?? event.typeName ?? "Life event";
}

/** The event's date with only the components its precision has. */
export function eventDate(event: PersonLifeEvent): string {
  const { date } = event;
  const known = date.year !== undefined || date.month !== undefined ||
    date.day !== undefined;
  if (!known && date.happenedAt) {
    const instant = new Date(date.happenedAt);
    return formatPartialDate(
      {
        day: instant.getUTCDate(),
        month: instant.getUTCMonth() + 1,
        year: instant.getUTCFullYear(),
      },
      date.precision,
      "en",
    );
  }
  return formatPartialDate(date, date.precision, "en");
}

function descending(left: number | undefined, right: number | undefined) {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return right - left;
}

function descendingText(left: string | undefined, right: string | undefined) {
  if (left === right) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return left < right ? 1 : -1;
}

/**
 * The events in the order the person's page lists them: the latest year,
 * month, and day first, unknown components last, then the latest recorded
 * instant and the latest revision.
 */
export function sortLifeEvents(
  events: readonly PersonLifeEvent[],
): readonly PersonLifeEvent[] {
  return [...events].sort((left, right) =>
    descending(left.date.year, right.date.year) ||
    descending(left.date.month, right.date.month) ||
    descending(left.date.day, right.date.day) ||
    descendingText(left.date.happenedAt, right.date.happenedAt) ||
    descendingText(left.updatedAt, right.updatedAt) ||
    descendingText(left.id, right.id)
  );
}

// --- Refusals ----------------------------------------------------------------

export const UNAVAILABLE =
  "Life events are temporarily unavailable. Other person sections remain available.";
export const TYPES_UNAVAILABLE =
  "Life event types could not be loaded. You can save without a type.";
export const CONFIRM_REMOVE =
  "Press the remove button again to confirm. Reminders attached to this life event are deleted too.";
export const DISCARD_EDIT =
  "Discard the unsaved life event and edit another one?";

/** What a refused save or removal says. */
export function problemMessage(problem: ProblemDetails | undefined): string {
  if (!problem) return UNAVAILABLE;
  if (problem.status === 404) {
    return "This person or life event is no longer available.";
  }
  if (problem.status === 401 || problem.status === 403) {
    return "Your active workspace no longer permits this change.";
  }
  if (problem.status === 400 || problem.status === 409) return problem.detail;
  return UNAVAILABLE;
}

// --- The editor --------------------------------------------------------------

/** The components a precision declares, which the editor asks for. */
export function precisionComponents(
  precision: LifeEventPrecision,
): ReadonlySet<DateComponent> {
  switch (precision) {
    case "full":
      return new Set(["year", "month", "day"]);
    case "year_month":
      return new Set(["year", "month"]);
    case "month_day":
      return new Set(["month", "day"]);
    case "unknown":
      return new Set();
    default:
      return new Set([precision]);
  }
}

/** The editor's fields, as they hold them. */
export interface LifeEventFormValues {
  day: string;
  month: string;
  name: string;
  note: string;
  precision: LifeEventPrecision;
  typeId: string;
  year: string;
}

/** The fields an editor opens with: the event's own, or a blank full date. */
export function formValues(
  event: PersonLifeEvent | undefined,
): LifeEventFormValues {
  const component = (value: number | undefined) =>
    value === undefined ? "" : `${value}`;
  return {
    day: component(event?.date.day),
    month: component(event?.date.month),
    name: event?.name ?? "",
    note: event?.note ?? "",
    precision: event?.date.precision ?? "full",
    typeId: event?.typeId ?? "",
    year: component(event?.date.year),
  };
}

/**
 * The fields as the request carries them: blank text left out, only the
 * components the precision declares, and those as numbers. Anything else
 * reaches the contract schema unchanged, so the schema alone decides what is
 * valid.
 */
export function submittedLifeEvent(values: unknown): unknown {
  if (typeof values !== "object" || values === null) return values;
  const fields = values as Readonly<Record<string, unknown>>;
  const precision = fields.precision;
  const components = typeof precision === "string"
    ? precisionComponents(precision as LifeEventPrecision)
    : new Set<DateComponent>();
  const submitted: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fields)) {
    const text = typeof value === "string" ? value.trim() : value;
    if (text === "" || text === undefined) continue;
    if (name === "year" || name === "month" || name === "day") {
      if (components.has(name)) submitted[name] = Number(text);
      continue;
    }
    submitted[name] = text;
  }
  return submitted;
}

/** The editor validated by the create route's own contract schema. */
export const lifeEventForm = z.preprocess(
  submittedLifeEvent,
  personLifeEventInput,
) as unknown as z.ZodType<
  z.output<typeof personLifeEventInput>,
  LifeEventFormValues
>;

// --- The card's state --------------------------------------------------------

export type FocusTarget = "state" | "form-state" | "field" | "add";

export interface LifeEventEditor {
  /**
   * Bumped on every open and never reused, even after the editor closes, so
   * the fields start from the opened event and a save's answer names the
   * editor that sent it (REL-076).
   */
  readonly generation: number;
  /** The event being edited; absent for a new one. */
  readonly event?: PersonLifeEvent;
  /** True while a save is in flight. */
  readonly busy: boolean;
}

export interface LifeEventsState {
  readonly status:
    | "loading"
    | "ready"
    | "hidden"
    | "error"
    | "forbidden"
    | "not-found";
  /** Whether the loading line draws the first-load skeleton. */
  readonly initial: boolean;
  readonly archived: boolean;
  readonly events: readonly PersonLifeEvent[];
  readonly types: readonly PersonLifeEventType[];
  /** What a failed read says. */
  readonly detail?: string;
  /** What the status line says instead of the count, until the next change. */
  readonly feedback?: string;
  /** The event whose remove control asks for confirmation. */
  readonly confirming?: string;
  /** The event being removed. */
  readonly removing?: string;
  readonly editor?: LifeEventEditor;
  /** The generation of the last editor opened, open or not. */
  readonly opened: number;
  readonly focus?: { readonly target: FocusTarget; readonly tick: number };
}

export type LifeEventsAction =
  | {
    readonly type: "loaded";
    readonly events: readonly PersonLifeEvent[];
    readonly types: readonly PersonLifeEventType[];
  }
  | { readonly type: "hidden" }
  | {
    readonly type: "failed";
    readonly status: "error" | "forbidden" | "not-found";
    readonly detail: string;
  }
  /**
   * The types an editor opened on a card counted empty did not load: the
   * editor and its draft stay, and say so (FEQ-04).
   */
  | { readonly type: "types-failed" }
  | { readonly type: "retry" }
  | { readonly type: "lifecycle"; readonly archived: boolean }
  | { readonly type: "open"; readonly event?: PersonLifeEvent }
  | { readonly type: "close"; readonly focus?: boolean }
  | { readonly type: "saving" }
  | { readonly type: "save-failed"; readonly generation: number }
  | {
    readonly type: "saved";
    readonly event: PersonLifeEvent;
    readonly generation: number;
  }
  | { readonly type: "confirm"; readonly id: string }
  | { readonly type: "remove"; readonly id: string }
  | { readonly type: "remove-failed"; readonly message: string }
  | { readonly type: "removed"; readonly id: string };

/**
 * The card as it mounts: hidden, loading, or — when the profile summary
 * counted no event (`empty`) — already empty, its read left until the editor
 * first opens and needs the types (FEQ-04).
 */
export function initialLifeEventsState(
  hidden: boolean,
  archived: boolean,
  empty = false,
): LifeEventsState {
  return {
    archived,
    events: [],
    initial: !empty,
    opened: 0,
    status: hidden ? "hidden" : empty ? "ready" : "loading",
    types: [],
  };
}

/** The section state the card carries, which page settles wait on. */
export function sectionState(
  state: LifeEventsState,
): LifeEventsState["status"] | "empty" {
  return state.status === "ready" && state.events.length === 0
    ? "empty"
    : state.status;
}

/** The card's status line. */
export function statusLine(state: LifeEventsState): string {
  switch (state.status) {
    case "loading":
      return "Loading life events…";
    case "hidden":
      return "";
    case "ready": {
      if (state.feedback !== undefined) return state.feedback;
      const count = state.events.length;
      const counted = count === 0
        ? "No life events saved."
        : `${count} life event${count === 1 ? "" : "s"}.`;
      return state.archived
        ? `${counted} This archived person is read-only.`
        : counted;
    }
    default:
      return state.detail ?? UNAVAILABLE;
  }
}

function focus(
  state: LifeEventsState,
  target: FocusTarget,
): { readonly target: FocusTarget; readonly tick: number } {
  return { target, tick: (state.focus?.tick ?? 0) + 1 };
}

/**
 * The card drawn again: confirmations and feedback go. A removal in flight
 * stays until its own answer arrives, so its control stays disabled and a
 * second removal of the same event cannot start.
 */
function redrawn(
  state: LifeEventsState,
  changes: Partial<LifeEventsState>,
): LifeEventsState {
  const { confirming: _confirming, feedback: _feedback, ...rest } = state;
  return { ...rest, ...changes };
}

/**
 * Whether the controls that open an editor (Add and every row's Edit) are
 * disabled: while the editor saves, so its answer only ever meets the editor
 * that asked (REL-055).
 */
export function editorOpeningDisabled(state: LifeEventsState): boolean {
  return state.editor?.busy === true;
}

/**
 * Whether one row's edit and remove controls are disabled: every row's while
 * the editor saves, and both controls of an event being removed, so a save
 * never revives or silently loses an event its removal deletes.
 */
export function rowControlsDisabled(
  state: LifeEventsState,
  id: string,
): { readonly edit: boolean; readonly remove: boolean } {
  const locked = editorOpeningDisabled(state) || state.removing === id;
  return { edit: locked, remove: locked };
}

function withoutEditor(state: LifeEventsState): LifeEventsState {
  const { editor: _editor, ...rest } = state;
  return rest;
}

/** Whether the open editor is the one whose save `generation` answers. */
function sending(
  state: LifeEventsState,
  generation: number,
): state is LifeEventsState & { readonly editor: LifeEventEditor } {
  return state.editor?.busy === true && state.editor.generation === generation;
}

export function lifeEventsReducer(
  state: LifeEventsState,
  action: LifeEventsAction,
): LifeEventsState {
  switch (action.type) {
    case "loaded":
      return redrawn(state, {
        events: sortLifeEvents(action.events),
        initial: false,
        status: "ready",
        types: action.types,
      });
    case "hidden":
      return withoutEditor(redrawn(state, { events: [], status: "hidden" }));
    case "failed":
      return withoutEditor(
        redrawn(state, {
          detail: action.detail,
          initial: false,
          status: action.status,
        }),
      );
    case "types-failed":
      return { ...state, feedback: TYPES_UNAVAILABLE };
    case "retry":
      return redrawn(state, { initial: false, status: "loading" });
    case "lifecycle": {
      const next = redrawn(state, { archived: action.archived });
      return action.archived ? withoutEditor(next) : next;
    }
    case "open":
      return redrawn(state, {
        editor: {
          busy: false,
          ...(action.event ? { event: action.event } : {}),
          generation: state.opened + 1,
        },
        focus: focus(state, "field"),
        opened: state.opened + 1,
      });
    case "close": {
      const next = withoutEditor(state);
      return action.focus ? { ...next, focus: focus(state, "add") } : next;
    }
    case "saving":
      return state.editor
        ? { ...state, editor: { ...state.editor, busy: true } }
        : state;
    // A save answers only the busy editor that sent it; an editor opened
    // after that one closed (a failed read, an archive) is left alone, even
    // while it saves too (REL-076).
    case "save-failed":
      return sending(state, action.generation)
        ? {
          ...state,
          editor: { ...state.editor, busy: false },
          focus: focus(state, "form-state"),
        }
        : state;
    case "saved": {
      const { event } = action;
      const others = state.events.filter((item) => item.id !== event.id);
      const events = sortLifeEvents([...others, event]);
      return state.editor && !sending(state, action.generation)
        ? redrawn(state, { events })
        : redrawn(withoutEditor(state), {
          events,
          focus: focus(state, "state"),
        });
    }
    case "confirm":
      return { ...state, confirming: action.id, feedback: CONFIRM_REMOVE };
    case "remove":
      return { ...state, removing: action.id };
    case "remove-failed": {
      const { confirming: _confirming, removing: _removing, ...rest } = state;
      return { ...rest, feedback: action.message };
    }
    case "removed": {
      const { removing: _removing, ...rest } = state;
      // The editor closes when the event it edits is gone.
      const next = rest.editor?.event?.id === action.id
        ? withoutEditor(rest)
        : rest;
      return redrawn(next, {
        events: state.events.filter((item) => item.id !== action.id),
        focus: focus(state, "state"),
      });
    }
  }
}
