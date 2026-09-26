/**
 * The calls and conversations cards' state and every transition it takes
 * (GAP-031).
 *
 * One surface owns both cards: one read loads the person's communications
 * and the options their editors need, and each card has one editor — closed
 * or open, idle or saving — with its request key, its status line, and, for a
 * conversation, its channel and message rows. `communicationsReducer` is the
 * pure function the island (`communications.tsx`) consumes with
 * `useReducer`; the island runs the requests and hands their answers back.
 *
 * A save keeps its request key until it succeeds, so a retry after a refused
 * or unknown outcome asks the server about the same request; archiving the
 * person closes both editors and discards their drafts, except a draft whose
 * save is still in flight, which waits for its answer.
 */

import type {
  CommunicationList,
  CommunicationOptions,
} from "../../../../../../packages/contracts/generated/auth-client.ts";

export type CommunicationKind = "call" | "conversation";

export type CommunicationFocus = "field" | "notice" | "add";

export interface EditorState {
  readonly open: boolean;
  readonly pending: boolean;
  /** Kept from the first attempt until a save succeeds or the draft goes. */
  readonly requestId?: string | undefined;
  readonly notice: string;
  /** The retry control after a save whose refresh failed. */
  readonly refresh: "hidden" | "shown" | "busy";
  /** Bumped whenever the draft is discarded, so its fields start over. */
  readonly draft: number;
  /** A conversation's channel, which narrows its contact methods. */
  readonly channel: string;
  /** A conversation's message rows, by key. */
  readonly messages: readonly string[];
  readonly focus?: {
    readonly target: CommunicationFocus;
    readonly tick: number;
  } | undefined;
}

export interface ContactMethodChoice {
  readonly id: string;
  readonly typeId: string;
  readonly value: string;
}

export type ContactMethodsState =
  | { readonly status: "idle" | "loading" | "failed" }
  | {
    readonly status: "ready";
    readonly records: readonly ContactMethodChoice[];
  };

export type ListState =
  | { readonly status: "loading" | "error" }
  | {
    readonly status: "ready";
    readonly counts: Readonly<Record<CommunicationKind, number>>;
  };

export interface CommunicationsState {
  readonly archived: boolean;
  readonly list: ListState;
  readonly options?: CommunicationOptions | undefined;
  readonly contacts: ContactMethodsState;
  readonly editors: Readonly<Record<CommunicationKind, EditorState>>;
}

export type CommunicationsAction =
  | { readonly type: "loading" }
  | {
    readonly type: "loaded";
    readonly history: CommunicationList;
    readonly options: CommunicationOptions;
  }
  | { readonly type: "load-failed" }
  | { readonly type: "history"; readonly history: CommunicationList }
  | { readonly type: "archived"; readonly archived: boolean }
  | {
    readonly type: "open";
    readonly kind: CommunicationKind;
    readonly requestId: string;
  }
  | { readonly type: "cancel"; readonly kind: CommunicationKind }
  | { readonly type: "channel"; readonly channel: string }
  | { readonly type: "add-message"; readonly key: string }
  | { readonly type: "remove-message"; readonly key: string }
  | { readonly type: "contacts-loading" }
  | {
    readonly type: "contacts-settled";
    /** Absent when the contact methods could not be loaded. */
    readonly records?: readonly ContactMethodChoice[] | undefined;
  }
  | {
    readonly type: "notice";
    readonly kind: CommunicationKind;
    readonly notice: string;
  }
  | {
    readonly type: "saving";
    readonly kind: CommunicationKind;
    readonly requestId: string;
  }
  | {
    readonly type: "save-failed";
    readonly kind: CommunicationKind;
    readonly notice: string;
  }
  | {
    readonly type: "saved";
    readonly kind: CommunicationKind;
    /** Whether the view could be refreshed after the save. */
    readonly current: boolean;
  }
  | { readonly type: "refreshing"; readonly kind: CommunicationKind }
  | {
    readonly type: "refreshed";
    readonly kind: CommunicationKind;
    readonly current: boolean;
  };

export const COMMUNICATION_MESSAGES = {
  contactsFailed:
    "Specific contact methods could not be loaded. Close and reopen the editor to try again.",
  contactsLoading: "Loading specific contact methods…",
  invalidMessage: "Choose a valid message time.",
  invalidOccurrence: "Choose a valid occurrence time.",
  refreshFailed:
    "Saved communication still could not be refreshed. Retry or reload the page.",
  refreshed: "Communication view refreshed.",
  unavailable: "Communication could not be loaded. Saved data was not changed.",
  unknown: "Save outcome is unknown. Retry to safely check the same request.",
} as const;

const TITLES: Readonly<Record<CommunicationKind, string>> = {
  call: "Call",
  conversation: "Conversation",
};

const CLOSED: EditorState = {
  channel: "",
  draft: 0,
  messages: [],
  notice: "",
  open: false,
  pending: false,
  refresh: "hidden",
};

export function initialCommunicationsState(
  archived: boolean,
): CommunicationsState {
  return {
    archived,
    contacts: { status: "idle" },
    editors: { call: CLOSED, conversation: CLOSED },
    list: { status: "loading" },
  };
}

/** How many of each kind `history` holds. */
export function communicationCounts(
  history: CommunicationList,
): Readonly<Record<CommunicationKind, number>> {
  return {
    call: history.items.filter((item) => item.kind === "call").length,
    conversation: history.items.filter((item) => item.kind === "conversation")
      .length,
  };
}

function focus(
  editor: EditorState,
  target: CommunicationFocus,
): EditorState {
  return { ...editor, focus: { target, tick: (editor.focus?.tick ?? 0) + 1 } };
}

/** The draft goes: its fields, its rows, its channel, and its key. */
function discard(editor: EditorState): EditorState {
  return {
    ...editor,
    channel: "",
    draft: editor.draft + 1,
    messages: [],
    requestId: undefined,
  };
}

function withEditor(
  state: CommunicationsState,
  kind: CommunicationKind,
  change: (editor: EditorState) => EditorState,
): CommunicationsState {
  return {
    ...state,
    editors: { ...state.editors, [kind]: change(state.editors[kind]) },
  };
}

export function communicationsReducer(
  state: CommunicationsState,
  action: CommunicationsAction,
): CommunicationsState {
  switch (action.type) {
    case "loading":
      return { ...state, list: { status: "loading" } };
    case "loaded":
      return {
        ...state,
        list: { counts: communicationCounts(action.history), status: "ready" },
        options: action.options,
      };
    case "load-failed":
      return { ...state, list: { status: "error" } };
    case "history":
      return {
        ...state,
        list: { counts: communicationCounts(action.history), status: "ready" },
      };
    case "archived": {
      if (!action.archived) return { ...state, archived: false };
      const close = (editor: EditorState): EditorState => ({
        ...(editor.pending ? editor : discard(editor)),
        open: false,
      });
      return {
        ...state,
        archived: true,
        editors: {
          call: close(state.editors.call),
          conversation: close(state.editors.conversation),
        },
      };
    }
    case "open":
      if (!writable(state, action.kind)) return state;
      if (state.editors[action.kind].pending) return state;
      return withEditor(state, action.kind, (editor) =>
        focus({
          ...editor,
          open: true,
          requestId: editor.requestId ?? action.requestId,
        }, "field"));
    case "cancel":
      return withEditor(
        state,
        action.kind,
        (editor) => focus({ ...discard(editor), open: false }, "add"),
      );
    case "channel":
      return withEditor(
        state,
        "conversation",
        (editor) => ({ ...editor, channel: action.channel }),
      );
    case "add-message":
      return withEditor(state, "conversation", (editor) => ({
        ...editor,
        messages: [...editor.messages, action.key],
      }));
    case "remove-message":
      return withEditor(state, "conversation", (editor) => ({
        ...editor,
        messages: editor.messages.filter((key) => key !== action.key),
      }));
    case "contacts-loading":
      return withEditor(
        {
          ...state,
          contacts: state.contacts.status === "ready"
            ? state.contacts
            : { status: "loading" },
        },
        "conversation",
        (editor) => ({
          ...editor,
          notice: state.contacts.status === "ready"
            ? ""
            : COMMUNICATION_MESSAGES.contactsLoading,
        }),
      );
    case "contacts-settled":
      return withEditor(
        {
          ...state,
          contacts: action.records
            ? { records: action.records, status: "ready" }
            : { status: "failed" },
        },
        "conversation",
        (editor) => ({
          ...editor,
          notice: action.records ? "" : COMMUNICATION_MESSAGES.contactsFailed,
        }),
      );
    case "notice":
      return withEditor(
        state,
        action.kind,
        (editor) => focus({ ...editor, notice: action.notice }, "notice"),
      );
    case "saving":
      return withEditor(state, action.kind, (editor) => ({
        ...editor,
        pending: true,
        requestId: action.requestId,
      }));
    case "save-failed":
      return withEditor(
        state,
        action.kind,
        (editor) =>
          focus({ ...editor, notice: action.notice, pending: false }, "notice"),
      );
    case "saved":
      return withEditor(state, action.kind, (editor) => {
        const saved: EditorState = {
          ...editor,
          notice: action.current
            ? `${TITLES[action.kind]} saved.`
            : `${
              TITLES[action.kind]
            } saved, but the current view could not be refreshed. Retry refresh or reload the page.`,
          pending: false,
          refresh: action.current ? "hidden" : "shown",
          requestId: undefined,
        };
        return action.current ? saved : focus(saved, "notice");
      });
    case "refreshing":
      return withEditor(
        state,
        action.kind,
        (editor) => ({ ...editor, refresh: "busy" }),
      );
    case "refreshed":
      return withEditor(state, action.kind, (editor) =>
        focus({
          ...editor,
          notice: action.current
            ? COMMUNICATION_MESSAGES.refreshed
            : COMMUNICATION_MESSAGES.refreshFailed,
          refresh: action.current ? "hidden" : "shown",
        }, "notice"));
  }
}

/** Whether `kind` can be recorded for this person now. */
export function writable(
  state: CommunicationsState,
  kind: CommunicationKind,
): boolean {
  return !state.archived && state.options?.availability[kind] === true;
}
