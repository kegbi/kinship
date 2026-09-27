/**
 * The storage settings page's state (GAP-033): the workspace's file usage,
 * limits, and provider health, and the last metadata lookup. A pure reducer
 * with the words the page shows; `storage-settings.tsx` renders it.
 *
 * A member without admin access sees no inventory at all, including one an
 * earlier read had shown.
 */

import type {
  StorageFileLookupItem,
  StorageSettings,
} from "../../../../../../packages/contracts/generated/auth-client.ts";

export interface StorageState {
  /** `ready` once the first read has answered and the lookup is operable. */
  readonly phase: "loading" | "ready" | "no-session" | "forbidden";
  readonly settings: StorageSettings | undefined;
  readonly status: string;
  readonly searchStatus: string;
  /** Whether Retry is offered, and the lookup it repeats. */
  readonly retry: boolean;
  readonly query: string | undefined;
}

export type StorageAction =
  | { readonly type: "no-session" }
  | { readonly type: "forbidden" }
  | { readonly type: "loading"; readonly query: string | undefined }
  | { readonly type: "failed" }
  | { readonly type: "loaded"; readonly settings: StorageSettings }
  | { readonly type: "search-status"; readonly message: string };

export const FORBIDDEN =
  "Storage diagnostics require workspace owner or administrator access.";

export const initialStorage: StorageState = {
  phase: "loading",
  query: undefined,
  retry: false,
  searchStatus: "",
  settings: undefined,
  status: "",
};

export function storageReducer(
  state: StorageState,
  action: StorageAction,
): StorageState {
  switch (action.type) {
    case "no-session":
      return {
        ...state,
        phase: "no-session",
        retry: true,
        status: "Your session could not be confirmed.",
      };
    case "forbidden":
      return {
        ...state,
        phase: "forbidden",
        retry: false,
        settings: undefined,
        status: FORBIDDEN,
      };
    case "loading":
      return {
        ...state,
        phase: state.phase === "no-session" ? "loading" : state.phase,
        query: action.query,
        retry: false,
        status: action.query
          ? "Searching workspace file metadata…"
          : "Loading workspace storage diagnostics…",
      };
    case "failed":
      return {
        ...state,
        // Operable once the first read has answered, either way.
        phase: state.phase === "loading" ? "ready" : state.phase,
        retry: true,
        status: state.query
          ? "File metadata search could not be completed. Existing usage remains visible."
          : "Workspace storage diagnostics could not be loaded.",
      };
    case "loaded": {
      const count = action.settings.files.length;
      return {
        ...state,
        phase: "ready",
        searchStatus: state.query
          ? count === 0
            ? "No files match this workspace lookup."
            : `${count} matching file${
              count === 1 ? "" : "s"
            }. Results are limited to 20.`
          : "Search by file ID, filename, title, or person name.",
        settings: action.settings,
        status: action.settings.provider.health === "available"
          ? "Storage diagnostics are current."
          : "Metadata is current, but the configured provider is unavailable.",
      };
    }
    case "search-status":
      return { ...state, searchStatus: action.message };
  }
}

/** A byte count in the largest unit that keeps it at or above one. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0]!;
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024;
    unit = units[index]!;
  }
  return `${
    new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)
  } ${unit}`;
}

/** The provider's health as the page names it. */
export function providerHealth(
  health: StorageSettings["provider"]["health"],
): string {
  return health === "available"
    ? "Available"
    : health === "not-initialized"
    ? "Not initialized"
    : "Unavailable";
}

/** The line under a found file's name: what it is, its size, and its owner. */
export function fileDetails(file: StorageFileLookupItem): string {
  return `${file.kind} · ${formatBytes(file.byteSize)} · ${file.status}${
    file.personName ? ` · ${file.personName}` : ""
  }`;
}
