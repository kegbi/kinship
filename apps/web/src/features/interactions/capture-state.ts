/**
 * Quick capture's state and every transition it takes (GAP-031).
 *
 * Quick capture is one dialog every protected page shares. Its draft, the
 * options it loads, a Today reconnect check, and the one save it may have in
 * flight all move through `captureReducer`, a pure function the island
 * (`quick-capture.tsx`) consumes with `useReducer`; the island only runs the
 * requests and hands their answers back as actions. What the island shows
 * disabled follows from the state through `captureControls`, and what a submit
 * does through `captureSubmission`, so each is tested without a DOM.
 *
 * A save is an intent: its request body is frozen when it is sent, together
 * with its request key. A refused save releases the draft for editing with a
 * new key; a save whose outcome is uncertain keeps the intent, and the next
 * submit replays exactly that body under the same key, so the server can
 * answer it idempotently.
 */

import type { InteractionInput } from "../../../../../packages/contracts/generated/auth-client.ts";
import type { PersonNameOrder } from "../../lib/person-name.ts";

export type CaptureKind = "activity" | "note";

/** One option a selector offers: a person, an activity type, an emotion. */
export interface Choice {
  /** How a chosen person is drawn (GAP-045); initials when absent. */
  readonly avatar?: { readonly color: string; readonly imageUrl?: string };
  readonly id: string;
  readonly name: string;
}

/** One page of a selector's options and the cursor that continues it. */
export interface OptionPage {
  readonly records: readonly Choice[];
  readonly cursor?: string | undefined;
}

/** What opening Quick capture loads once and every later open reuses. */
export interface CaptureOptions {
  readonly availability: Readonly<Record<CaptureKind, boolean>>;
  readonly people: OptionPage;
  readonly activityTypes: OptionPage;
  readonly emotions: OptionPage;
}

export type CaptureInput = Extract<
  InteractionInput,
  { readonly kind: CaptureKind }
>;

export interface CaptureIntent {
  readonly input: CaptureInput;
  /** The Today reconnect person the save answers, when it answers one. */
  readonly reconnectPersonId?: string | undefined;
  readonly phase: "pending" | "ambiguous";
}

export interface CaptureDraft {
  readonly kind: CaptureKind;
  readonly participants: readonly Choice[];
  readonly activityType?: Choice | undefined;
  readonly emotions: readonly Choice[];
  /** The `datetime-local` value of the activity's occurrence. */
  readonly happenedAt: string;
  readonly summary: string;
  readonly description: string;
  readonly body: string;
  readonly isFavorited: boolean;
}

/** The fields an edit may change; the kind changes through its own action. */
export type DraftPatch = Partial<Omit<CaptureDraft, "kind">>;

export type CaptureSession =
  | { readonly status: "resolving" | "access-lost" | "unavailable" }
  | {
    readonly status: "ready";
    readonly workspaceId: string;
    readonly nameOrder: PersonNameOrder;
  };

export type OptionsState =
  | { readonly status: "idle" | "loading" | "failed" }
  | { readonly status: "ready"; readonly value: CaptureOptions };

export type FocusTarget =
  | "status"
  | "kind"
  | "summary"
  | "submit"
  | "participants"
  | "happenedAt";

export interface CaptureState {
  readonly session: CaptureSession;
  readonly open: boolean;
  readonly options: OptionsState;
  /** The person the page is about, chosen whenever the draft starts over. */
  readonly preferredId?: string | undefined;
  readonly draft: CaptureDraft;
  /** Bumped whenever the draft starts over, so the selectors do too. */
  readonly generation: number;
  readonly dirty: boolean;
  readonly reconnect: "none" | "checking" | "ready" | "degraded";
  readonly reconnectPersonId?: string | undefined;
  /** The opened kind is turned off in workspace personalization. */
  readonly blocked: boolean;
  readonly intent?: CaptureIntent | undefined;
  readonly requestId: string;
  readonly status: string;
  readonly occurrenceError: string;
  /** The element to focus next; the tick makes a repeated request count. */
  readonly focus?: {
    readonly target: FocusTarget;
    readonly tick: number;
  } | undefined;
}

export type CaptureAction =
  | {
    readonly type: "session";
    readonly session: Exclude<CaptureSession, { status: "resolving" }>;
  }
  | { readonly type: "open" }
  | {
    readonly type: "options";
    /** Absent when the options could not be loaded. */
    readonly options?: CaptureOptions | undefined;
    readonly happenedAt: string;
  }
  | { readonly type: "opened"; readonly intended?: CaptureKind | undefined }
  | { readonly type: "reconnect-checking" }
  | {
    readonly type: "reconnect-settled";
    /** Absent when the person cannot be recorded against. */
    readonly person?: Choice | undefined;
  }
  | {
    readonly type: "dismiss";
    readonly requestId: string;
    readonly happenedAt: string;
  }
  | { readonly type: "kind"; readonly kind: CaptureKind }
  | { readonly type: "edit"; readonly patch: DraftPatch }
  | { readonly type: "invalid"; readonly reason: InvalidReason }
  | { readonly type: "focus"; readonly target: FocusTarget }
  | { readonly type: "save"; readonly intent: CaptureIntent }
  | {
    readonly type: "saved";
    readonly kind: CaptureKind | string;
    readonly requestId: string;
    readonly happenedAt: string;
  }
  | {
    readonly type: "refused";
    readonly detail: string;
    readonly requestId: string;
  }
  | { readonly type: "uncertain" };

export type InvalidReason = "kind" | "participants" | "occurrence";

export const CAPTURE_MESSAGES = {
  accessLost: "Sign in again before recording an interaction.",
  checking: "Checking reconnect person…",
  hidden: "This interaction kind is hidden in workspace personalization.",
  loading: "Loading quick capture options…",
  noParticipants: "Choose at least one participant.",
  occurrence: "Enter a valid occurrence date and time.",
  optionsFailed:
    "Quick capture options could not be loaded. Close and open Quick capture to try again.",
  reconnectUnavailable:
    "Quick capture for this person is unavailable. The reconnect list is unchanged.",
  saving: "Saving interaction…",
  uncertain: "The save outcome is uncertain. Retry this exact interaction.",
  unavailable: "Quick capture is temporarily unavailable.",
} as const;

const NO_AVAILABILITY: Readonly<Record<CaptureKind, boolean>> = {
  activity: false,
  note: false,
};

/**
 * Whether opening for `intended` finds it turned off in workspace
 * personalization; without an intended kind, whether both are off.
 */
export function kindBlocked(
  availability: Readonly<Record<CaptureKind, boolean>>,
  intended: CaptureKind | undefined,
): boolean {
  return intended
    ? !availability[intended]
    : !availability.activity && !availability.note;
}

/** The draft a fresh capture starts from. */
export function freshDraft(
  options: OptionsState,
  preferredId: string | undefined,
  happenedAt: string,
): CaptureDraft {
  const ready = options.status === "ready" ? options.value : undefined;
  const preferred = preferredId
    ? ready?.people.records.find((person) => person.id === preferredId)
    : undefined;
  return {
    body: "",
    description: "",
    emotions: [],
    happenedAt,
    isFavorited: false,
    kind: ready && !ready.availability.activity ? "note" : "activity",
    participants: preferred ? [preferred] : [],
    summary: "",
  };
}

export function initialCaptureState(
  init: {
    readonly preferredId?: string | undefined;
    readonly requestId: string;
    readonly happenedAt: string;
  },
): CaptureState {
  const options: OptionsState = { status: "idle" };
  return {
    blocked: false,
    dirty: false,
    draft: freshDraft(options, init.preferredId, init.happenedAt),
    generation: 0,
    occurrenceError: "",
    open: false,
    options,
    preferredId: init.preferredId,
    reconnect: "none",
    requestId: init.requestId,
    session: { status: "resolving" },
    status: "",
  };
}

function focus(state: CaptureState, target: FocusTarget): CaptureState {
  return {
    ...state,
    focus: { target, tick: (state.focus?.tick ?? 0) + 1 },
  };
}

/** A note belongs to one person, so it keeps only the first participant. */
function withKind(draft: CaptureDraft, kind: CaptureKind): CaptureDraft {
  return {
    ...draft,
    kind,
    participants: kind === "note"
      ? draft.participants.slice(0, 1)
      : draft.participants,
  };
}

/** The draft starts over: a closed dialog, or a reconnect that was saved. */
function startOver(
  state: CaptureState,
  requestId: string,
  happenedAt: string,
): CaptureState {
  return {
    ...state,
    blocked: false,
    dirty: false,
    draft: freshDraft(state.options, state.preferredId, happenedAt),
    generation: state.generation + 1,
    occurrenceError: "",
    reconnect: "none",
    reconnectPersonId: undefined,
    requestId,
    status: "",
  };
}

export function captureReducer(
  state: CaptureState,
  action: CaptureAction,
): CaptureState {
  switch (action.type) {
    case "session":
      return {
        ...state,
        session: action.session,
        status: action.session.status === "ready"
          ? state.status
          : action.session.status === "access-lost"
          ? CAPTURE_MESSAGES.accessLost
          : CAPTURE_MESSAGES.unavailable,
      };
    case "open": {
      if (state.intent) return state;
      const opened: CaptureState = {
        ...state,
        blocked: false,
        open: true,
        reconnect: "none",
        reconnectPersonId: undefined,
      };
      return state.options.status === "ready" ? opened : focus({
        ...opened,
        options: { status: "loading" },
        status: CAPTURE_MESSAGES.loading,
      }, "status");
    }
    case "options": {
      if (!action.options) {
        return focus({
          ...state,
          options: { status: "failed" },
          status: CAPTURE_MESSAGES.optionsFailed,
        }, "status");
      }
      const options: OptionsState = { status: "ready", value: action.options };
      return {
        ...state,
        draft: freshDraft(options, state.preferredId, action.happenedAt),
        generation: state.generation + 1,
        options,
        status: "",
      };
    }
    case "opened": {
      if (state.options.status !== "ready") return state;
      const { availability } = state.options.value;
      const intended = action.intended;
      const draft = intended ? withKind(state.draft, intended) : state.draft;
      if (kindBlocked(availability, intended)) {
        return focus({
          ...state,
          blocked: true,
          draft,
          status: CAPTURE_MESSAGES.hidden,
        }, "status");
      }
      return focus({ ...state, draft, status: "" }, "kind");
    }
    case "reconnect-checking":
      return focus({
        ...state,
        draft: withKind(state.draft, "activity"),
        reconnect: "checking",
        status: CAPTURE_MESSAGES.checking,
      }, "status");
    case "reconnect-settled":
      return action.person
        ? focus({
          ...state,
          draft: {
            ...withKind(state.draft, "activity"),
            participants: [action.person],
          },
          reconnect: "ready",
          reconnectPersonId: action.person.id,
          status: "",
        }, "summary")
        : focus({
          ...state,
          draft: withKind(state.draft, "activity"),
          reconnect: "degraded",
          reconnectPersonId: undefined,
          status: CAPTURE_MESSAGES.reconnectUnavailable,
        }, "status");
    case "dismiss":
      if (state.intent) return state;
      return {
        ...startOver(state, action.requestId, action.happenedAt),
        open: false,
      };
    case "kind":
      return {
        ...state,
        dirty: true,
        draft: withKind(state.draft, action.kind),
        occurrenceError: action.kind === "note" ? "" : state.occurrenceError,
      };
    case "edit":
      return {
        ...state,
        dirty: true,
        draft: { ...state.draft, ...action.patch },
      };
    case "invalid":
      return action.reason === "kind"
        ? focus({ ...state, status: CAPTURE_MESSAGES.hidden }, "kind")
        : action.reason === "participants"
        ? focus(
          { ...state, status: CAPTURE_MESSAGES.noParticipants },
          "participants",
        )
        : focus({
          ...state,
          occurrenceError: CAPTURE_MESSAGES.occurrence,
          status: CAPTURE_MESSAGES.occurrence,
        }, "happenedAt");
    case "focus":
      return focus(state, action.target);
    case "save":
      return {
        ...state,
        intent: { ...action.intent, phase: "pending" },
        occurrenceError: "",
        status: CAPTURE_MESSAGES.saving,
      };
    case "saved": {
      const reconnected = state.intent?.reconnectPersonId !== undefined;
      const saved: CaptureState = {
        ...state,
        dirty: false,
        intent: undefined,
        requestId: action.requestId,
        status: action.kind === "note" ? "Note saved." : "Activity saved.",
      };
      return reconnected
        ? {
          ...startOver(saved, action.requestId, action.happenedAt),
          open: false,
        }
        : focus(saved, "submit");
    }
    case "refused": {
      const reconnected = state.intent?.reconnectPersonId !== undefined;
      const refused: CaptureState = {
        ...state,
        intent: undefined,
        requestId: action.requestId,
        status: action.detail,
      };
      return reconnected
        ? focus({ ...refused, reconnect: "degraded" }, "status")
        : focus(refused, "submit");
    }
    case "uncertain":
      return state.intent
        ? focus({
          ...state,
          intent: { ...state.intent, phase: "ambiguous" },
          status: CAPTURE_MESSAGES.uncertain,
        }, "submit")
        : state;
  }
}

/** What the dialog shows disabled, busy, or offered, given `state`. */
export interface CaptureControls {
  readonly availability: Readonly<Record<CaptureKind, boolean>>;
  readonly busy: boolean;
  /** Every field and selector control. */
  readonly fields: boolean;
  readonly kind: boolean;
  readonly happenedAt: boolean;
  readonly submit: boolean;
  readonly cancel: boolean;
  /** Every Quick capture opener on the page. */
  readonly openers: boolean;
}

export function captureControls(state: CaptureState): CaptureControls {
  const ready = state.options.status === "ready";
  const availability = state.options.status === "ready"
    ? state.options.value.availability
    : NO_AVAILABILITY;
  const locked = state.intent !== undefined;
  const fields = locked || !ready || state.blocked;
  return {
    availability,
    busy: state.options.status === "loading" || state.reconnect === "checking",
    cancel: locked,
    fields,
    happenedAt: fields || state.draft.kind === "note",
    kind: fields || state.reconnect !== "none",
    openers: locked || state.session.status !== "ready",
    submit: state.intent
      ? state.intent.phase !== "ambiguous"
      : fields || state.reconnect === "checking" ||
        state.reconnect === "degraded" ||
        (!availability.activity && !availability.note),
  };
}

/** What submitting the dialog in `state` should do. */
export type CaptureSubmission =
  | { readonly type: "ignore" }
  | { readonly type: "focus"; readonly target: FocusTarget }
  | { readonly type: "invalid"; readonly reason: InvalidReason }
  | { readonly type: "send"; readonly intent: CaptureIntent };

export function captureSubmission(state: CaptureState): CaptureSubmission {
  const { intent } = state;
  if (intent) {
    return intent.phase === "ambiguous"
      ? { intent, type: "send" }
      : { type: "ignore" };
  }
  if (state.reconnect === "degraded") {
    return { target: "status", type: "focus" };
  }
  if (state.options.status !== "ready" || state.blocked) {
    return { type: "ignore" };
  }
  const { draft, requestId } = state;
  if (!state.options.value.availability[draft.kind]) {
    return { reason: "kind", type: "invalid" };
  }
  if (draft.participants.length === 0) {
    return { reason: "participants", type: "invalid" };
  }
  const reconnect = state.reconnectPersonId
    ? { reconnectPersonId: state.reconnectPersonId }
    : {};
  if (draft.kind === "note") {
    return {
      intent: Object.freeze({
        input: Object.freeze({
          body: draft.body,
          isFavorited: draft.isFavorited,
          kind: "note" as const,
          personId: draft.participants[0]!.id,
          requestId,
        }),
        phase: "pending" as const,
        ...reconnect,
      }),
      type: "send",
    };
  }
  const occurrence = new Date(draft.happenedAt);
  if (!draft.happenedAt || Number.isNaN(occurrence.getTime())) {
    return { reason: "occurrence", type: "invalid" };
  }
  return {
    intent: Object.freeze({
      input: Object.freeze({
        ...(draft.activityType
          ? { activityTypeId: draft.activityType.id }
          : {}),
        ...(draft.description ? { description: draft.description } : {}),
        emotionIds: Object.freeze(draft.emotions.map((emotion) => emotion.id)),
        happenedAt: occurrence.toISOString(),
        kind: "activity" as const,
        participantIds: Object.freeze(
          draft.participants.map((person) => person.id),
        ),
        requestId,
        summary: draft.summary,
      }),
      phase: "pending" as const,
      ...reconnect,
    }),
    type: "send",
  };
}

/**
 * The options a selector shows: its page, then any chosen option the page
 * lacks, so a choice survives a search that does not find it. At most 70.
 */
export function selectorOptions(
  page: readonly Choice[],
  chosen: readonly Choice[],
): readonly Choice[] {
  const merged = new Map(page.map((entry) => [entry.id, entry]));
  for (const entry of chosen) {
    // A chosen entry keeps its avatar when the page it came from had one.
    merged.set(entry.id, { ...merged.get(entry.id), ...entry });
  }
  return [...merged.values()].slice(0, 70).map((entry) => ({
    ...(entry.avatar ? { avatar: entry.avatar } : {}),
    id: entry.id,
    name: entry.name,
  }));
}
