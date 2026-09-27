/**
 * The export page's state (GAP-033): the workspace's export history, the
 * one export being created, and each completed export's short-lived
 * download. A pure reducer with the words the page shows; `exports.tsx`
 * renders it.
 */

import type { ExportSummary } from "../../../../../../packages/contracts/generated/auth-client.ts";
import type { TimePreferences } from "../../../lib/time-presentation.ts";

export interface ExportsState {
  readonly phase: "loading" | "ready" | "no-session" | "member";
  readonly exports: readonly ExportSummary[] | undefined;
  readonly timePreferences: TimePreferences | undefined;
  readonly status: string;
  readonly retry: boolean;
  readonly creating: boolean;
  /** The exports whose download is being prepared. */
  readonly preparing: readonly string[];
  /** Each prepared download's link, by export; a new history drops them. */
  readonly downloads: Readonly<Record<string, string>>;
}

export type ExportsAction =
  | {
    readonly type: "context";
    readonly timePreferences: TimePreferences | undefined;
  }
  | { readonly type: "no-session" }
  | { readonly type: "member" }
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "failed" }
  | { readonly type: "loaded"; readonly exports: readonly ExportSummary[] }
  | { readonly type: "creating"; readonly creating: boolean }
  | { readonly type: "preparing"; readonly exportId: string }
  | {
    readonly type: "prepared";
    readonly exportId: string;
    readonly href?: string;
    readonly message: string;
  };

export const initialExports: ExportsState = {
  creating: false,
  downloads: {},
  exports: undefined,
  phase: "loading",
  preparing: [],
  retry: false,
  status: "Loading export history…",
  timePreferences: undefined,
};

function people(count: number): string {
  return `${count} person${count === 1 ? "" : "s"}`;
}

export function exportsReducer(
  state: ExportsState,
  action: ExportsAction,
): ExportsState {
  switch (action.type) {
    case "context":
      return {
        ...state,
        phase: "ready",
        timePreferences: action.timePreferences,
      };
    case "no-session":
      return {
        ...state,
        phase: "no-session",
        status: "Your session could not be confirmed.",
      };
    case "member":
      return {
        ...state,
        phase: "member",
        status: "Workspace export requires owner or administrator access.",
      };
    case "status":
      return { ...state, status: action.message };
    case "failed":
      return {
        ...state,
        retry: true,
        status: "Export history could not be loaded.",
      };
    case "loaded": {
      const count = action.exports.length;
      return {
        ...state,
        downloads: {},
        exports: action.exports,
        retry: false,
        status: count === 0
          ? "No exports yet."
          : `${count} export${count === 1 ? "" : "s"}.`,
      };
    }
    case "creating":
      return {
        ...state,
        creating: action.creating,
        ...(action.creating ? { status: "Creating portable export…" } : {}),
      };
    case "preparing":
      return {
        ...state,
        preparing: [...state.preparing, action.exportId],
        status: "Creating a short-lived download…",
      };
    case "prepared":
      return {
        ...state,
        downloads: action.href
          ? { ...state.downloads, [action.exportId]: action.href }
          : state.downloads,
        preparing: state.preparing.filter((id) => id !== action.exportId),
        status: action.message,
      };
  }
}

/** An export's heading: how many people it carries. */
export function exportHeading(run: ExportSummary): string {
  return people(run.manifest.rows.people.count);
}

/** What the page says once an export is created. */
export function exportCompleted(peopleCount: number): string {
  return `Export completed for ${people(peopleCount)}.`;
}

/** An export's state as its row names it: `completed` → `Completed`. */
export function exportStatus(run: ExportSummary): string {
  return `${run.status[0]?.toUpperCase()}${run.status.slice(1)}`;
}
