/**
 * The import pages' pure parts (GAP-033): recognizing a Monica JSON export,
 * the new-import flow's state, and the words the history and report pages
 * show. `import-new.tsx`, `import-history.tsx`, and `import-report.tsx`
 * render them.
 *
 * A new import moves from a chosen file to a recognized source, a dry run
 * whose report the reader reviews, an explicit confirmation, and a commit.
 * Choosing another file, or validating again, withdraws any dry run a
 * commit could otherwise act on.
 */

import type {
  ImportReport,
  ImportSummary,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { IMPORT_SOURCE_MAX_BYTES } from "../../../../../../packages/contracts/imports.ts";
import type { TimePreferences } from "../../../lib/time-presentation.ts";

export const CHOOSE_EXPORT = "Choose an export to detect its format.";
export const TOO_LARGE = "This file exceeds the 1.5 MB staging limit.";
export const DETECTED = "Monica JSON version 1 detected.";

/** Whether a file is small enough to stage, before it is read. */
export function withinStagingLimit(size: number): boolean {
  return size <= IMPORT_SOURCE_MAX_BYTES;
}

/** What a chosen file's text is: a Monica JSON v1 source, or why not. */
export function recognizeSource(
  text: string,
): { readonly source?: unknown; readonly message: string } {
  try {
    const parsed = JSON.parse(text) as {
      readonly format?: unknown;
      readonly version?: unknown;
    };
    if (parsed?.format !== "monica-json" || parsed.version !== 1) {
      return { message: "Unsupported export. Choose Monica JSON version 1." };
    }
    return { message: DETECTED, source: parsed };
  } catch {
    return { message: "This file is not valid JSON." };
  }
}

export interface NewImportState {
  readonly phase: "loading" | "ready" | "no-session" | "member";
  readonly detection: string;
  readonly status: string;
  readonly validating: boolean;
  /** The dry run a confirmed commit acts on. */
  readonly importId: string | undefined;
  readonly report: ImportReport | undefined;
  readonly confirmed: boolean;
  readonly committing: boolean;
  /** The committed import, whose report the page links to. */
  readonly committed: string | undefined;
}

export type NewImportAction =
  | { readonly type: "ready" }
  | { readonly type: "no-session" }
  | { readonly type: "member" }
  | { readonly type: "detecting" }
  | { readonly type: "detected"; readonly message: string }
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "validating" }
  | { readonly type: "validated"; readonly message?: string }
  | {
    readonly type: "dry-run";
    readonly importId: string;
    readonly report: ImportReport;
  }
  | { readonly type: "confirm"; readonly confirmed: boolean }
  | { readonly type: "committing" }
  | { readonly type: "commit-refused"; readonly message: string }
  | {
    readonly type: "committed";
    readonly importId: string;
    readonly created: number;
    readonly reused: number;
  };

export const initialNewImport: NewImportState = {
  committed: undefined,
  committing: false,
  confirmed: false,
  detection: CHOOSE_EXPORT,
  importId: undefined,
  phase: "loading",
  report: undefined,
  status: "",
  validating: false,
};

/** Withdraws the dry run: nothing is committable until one lands again. */
function withdrawn(state: NewImportState): NewImportState {
  return { ...state, confirmed: false, importId: undefined, report: undefined };
}

export function newImportReducer(
  state: NewImportState,
  action: NewImportAction,
): NewImportState {
  switch (action.type) {
    case "ready":
      return { ...state, phase: "ready" };
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
        status: "Workspace import requires owner or administrator access.",
      };
    case "detecting":
      return withdrawn(state);
    case "detected":
      return { ...state, detection: action.message };
    case "status":
      return { ...state, status: action.message };
    case "validating":
      return {
        ...withdrawn(state),
        status: "Validating bounded staging…",
        validating: true,
      };
    case "validated":
      return {
        ...state,
        ...(action.message === undefined ? {} : { status: action.message }),
        validating: false,
      };
    case "dry-run":
      return {
        ...state,
        importId: action.importId,
        report: action.report,
        status: "Dry run complete. Review the report before committing.",
      };
    case "confirm":
      return { ...state, confirmed: action.confirmed };
    case "committing":
      return {
        ...state,
        committing: true,
        status: "Committing validated import…",
      };
    case "commit-refused":
      return { ...state, committing: false, status: action.message };
    case "committed":
      return {
        ...state,
        committed: action.importId,
        committing: false,
        status:
          `Import completed: ${action.created} created, ${action.reused} reused.`,
      };
  }
}

/** An import in the history: how many contacts it carries. */
export function importHeading(run: ImportSummary): string {
  const count = run.report.counts.contacts;
  return `${count} contact${count === 1 ? "" : "s"}`;
}

/** An import's state as the history names it. */
export function importStatus(status: ImportSummary["status"]): string {
  return status === "dry_run"
    ? "Dry run"
    : status === "completed"
    ? "Completed"
    : "Failed";
}

/** An import's state as its report names it. */
export function reportStatus(status: ImportSummary["status"]): string {
  return status === "completed"
    ? "Completed"
    : status === "dry_run"
    ? "Awaiting confirmation"
    : "Failed";
}

/** The history's summary line. */
export function historyLine(count: number): string {
  return count === 0
    ? "No imports yet."
    : `${count} import${count === 1 ? "" : "s"}.`;
}

export interface HistoryState {
  readonly status: string;
  readonly retry: boolean;
  readonly imports: readonly ImportSummary[] | undefined;
  readonly timePreferences: TimePreferences | undefined;
  readonly member: boolean;
}

export type HistoryAction =
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "member" }
  | {
    readonly type: "context";
    readonly timePreferences: TimePreferences | undefined;
  }
  | { readonly type: "failed" }
  | { readonly type: "loaded"; readonly imports: readonly ImportSummary[] };

export function historyReducer(
  state: HistoryState,
  action: HistoryAction,
): HistoryState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.message };
    case "member":
      return {
        ...state,
        member: true,
        status: "Workspace import requires owner or administrator access.",
      };
    case "context":
      return { ...state, timePreferences: action.timePreferences };
    case "failed":
      return {
        ...state,
        retry: true,
        status: "Import history could not be loaded.",
      };
    case "loaded":
      return {
        ...state,
        imports: action.imports,
        retry: false,
        status: historyLine(action.imports.length),
      };
  }
}

export interface ReportState {
  readonly status: string;
  readonly retry: boolean;
  readonly report: ImportReport | undefined;
  readonly outcome: string;
}

export type ReportAction =
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "failed"; readonly message: string }
  | {
    readonly type: "loaded";
    readonly report: ImportReport;
    readonly outcome: string;
  };

/** The report page's state: its status line, Retry, and the report. */
export function reportReducer(
  state: ReportState,
  action: ReportAction,
): ReportState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.message };
    case "failed":
      return { ...state, retry: true, status: action.message };
    case "loaded":
      return {
        outcome: action.outcome,
        report: action.report,
        retry: false,
        status: "Import report is current.",
      };
  }
}

/** The import id a report page's path names, or `undefined`. */
export function reportImportId(pathname: string): string | undefined {
  return pathname.match(/\/app\/settings\/import\/([0-9a-f-]{36})\/?$/i)?.[1];
}
