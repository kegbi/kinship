/**
 * The documents and photos cards' pure half (GAP-033): their wording and
 * the one reducer both cards move through. One list read answers both
 * cards, each showing the files of its kind; nothing here touches the DOM.
 */

import type { PersonFile } from "../../../../../../packages/contracts/generated/auth-client.ts";

/** The two kinds of person file, one card each. */
export type FileKind = "document" | "photo";

export const FILE_KINDS = [
  "document",
  "photo",
] as const satisfies readonly FileKind[];

/** Each card's section id and the words it uses. */
export const FILE_CARDS = {
  document: {
    id: "documents",
    noun: "document",
    plural: "documents",
    title: "Documents",
  },
  photo: { id: "photos", noun: "photo", plural: "photos", title: "Photos" },
} as const satisfies Record<
  FileKind,
  {
    readonly id: string;
    readonly noun: string;
    readonly plural: string;
    readonly title: string;
  }
>;

export const FILES_UNAVAILABLE = "Files are temporarily unavailable.";

export function readableSize(bytes: number): string {
  return bytes < 1024
    ? `${bytes} B`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function fileStatusLabel(status: PersonFile["status"]): string {
  switch (status) {
    case "available":
      return "Available";
    case "missing":
      return "Bytes missing";
    case "quarantined":
      return "Quarantined";
    default:
      return "Processing";
  }
}

/** A card's count line once the list has answered. */
export function countText(kind: FileKind, count: number): string {
  const { noun, plural } = FILE_CARDS[kind];
  return count === 0
    ? `No ${plural} saved.`
    : `${count} ${noun}${count === 1 ? "" : "s"} saved.`;
}

export type FilesList =
  | { readonly status: "loading" }
  | { readonly status: "ready" }
  | { readonly status: "error"; readonly detail: string };

export interface FilesState {
  readonly archived: boolean;
  readonly files: readonly PersonFile[];
  readonly nextCursor: string | undefined;
  readonly list: FilesList;
  /** A list has answered once, so the cards may offer Attach. */
  readonly listed: boolean;
  /** Which card's upload form is open. */
  readonly editors: Readonly<Record<FileKind, boolean>>;
  /** A card's own line, which replaces its count until the next answer. */
  readonly notices: Readonly<Partial<Record<FileKind, string>>>;
  /** An upload or removal owns the list until its refresh has answered. */
  readonly busy: boolean;
  /** The file a removal is working on. */
  readonly removing: string | undefined;
}

export type FilesAction =
  | {
    readonly type: "loaded";
    readonly files: readonly PersonFile[];
    readonly nextCursor: string | undefined;
    readonly continued: boolean;
  }
  | { readonly type: "failed"; readonly detail: string }
  | { readonly type: "lifecycle"; readonly archived: boolean }
  | { readonly type: "open"; readonly kind: FileKind }
  | {
    readonly type: "close";
    readonly kind: FileKind;
    readonly notice?: string | undefined;
  }
  | {
    readonly type: "notice";
    readonly kind: FileKind;
    readonly notice: string;
  }
  | {
    readonly type: "busy";
    readonly busy: boolean;
    readonly removing?: string | undefined;
  };

const CLOSED: Readonly<Record<FileKind, boolean>> = {
  document: false,
  photo: false,
};

export function initialFiles(archived: boolean): FilesState {
  return {
    archived,
    busy: false,
    editors: CLOSED,
    files: [],
    list: { status: "loading" },
    listed: false,
    nextCursor: undefined,
    notices: {},
    removing: undefined,
  };
}

export function filesReducer(
  state: FilesState,
  action: FilesAction,
): FilesState {
  switch (action.type) {
    case "loaded":
      // Every answer repaints both cards' counts over their notices.
      return {
        ...state,
        files: action.continued
          ? [...state.files, ...action.files]
          : action.files,
        list: { status: "ready" },
        listed: true,
        nextCursor: action.nextCursor,
        notices: {},
      };
    case "failed":
      // The rows already shown stay; no page is offered after a failure.
      return {
        ...state,
        list: { detail: action.detail, status: "error" },
        nextCursor: undefined,
        notices: {},
      };
    case "lifecycle":
      return {
        ...state,
        archived: action.archived,
        editors: action.archived ? CLOSED : state.editors,
        notices: {},
      };
    case "open":
      return state.archived
        ? state
        : { ...state, editors: { ...state.editors, [action.kind]: true } };
    case "close":
      return {
        ...state,
        editors: { ...state.editors, [action.kind]: false },
        notices: action.notice === undefined
          ? state.notices
          : { ...state.notices, [action.kind]: action.notice },
      };
    case "notice":
      return {
        ...state,
        notices: { ...state.notices, [action.kind]: action.notice },
      };
    case "busy":
      return {
        ...state,
        busy: action.busy,
        removing: action.busy ? action.removing : undefined,
      };
  }
}

/** The files a card shows: those of its kind, in the order listed. */
export function filesOf(
  state: FilesState,
  kind: FileKind,
): readonly PersonFile[] {
  return state.files.filter((file) => file.kind === kind);
}
