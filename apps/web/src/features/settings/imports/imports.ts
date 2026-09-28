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
  CsvColumnTarget,
  CsvPreview,
  ImportReport,
  ImportSummary,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { IMPORT_SOURCE_MAX_BYTES } from "../../../../../../packages/contracts/imports.ts";
import type { TimePreferences } from "../../../lib/time-presentation.ts";

export const CHOOSE_EXPORT = "Choose an export to detect its format.";
export const CHOOSE_CONTACTS = "Choose a file to detect its format.";
export const NOT_UTF8 =
  "This file is not UTF-8 encoded. Save it as UTF-8 and try again.";
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

/** Where a new import's contacts come from (GAP-050). */
export type ImportSource = "csv" | "monica" | "vcard";

/** Each source as the page offers it, and the file field it asks for. */
export const IMPORT_SOURCES: readonly {
  readonly accept: string;
  readonly field: string;
  readonly id: ImportSource;
  readonly label: string;
}[] = [
  {
    accept: "application/json,.json",
    field: "Monica JSON export",
    id: "monica",
    label: "Monica backup",
  },
  {
    accept: "text/vcard,text/x-vcard,.vcf,.vcard",
    field: "vCard file",
    id: "vcard",
    label: "vCard",
  },
  { accept: "text/csv,.csv", field: "CSV file", id: "csv", label: "CSV" },
];

/** Every field a CSV column can be mapped to, as the mapping step names it. */
export const CSV_TARGET_LABELS: Readonly<Record<CsvColumnTarget, string>> = {
  ignore: "Ignore",
  givenName: "Given name",
  familyName: "Family name",
  middleName: "Middle name",
  nickname: "Nickname",
  email: "Email",
  phone: "Phone",
  street: "Street",
  city: "City",
  region: "Region",
  postalCode: "Postal code",
  country: "Country",
  birthday: "Birthday",
  note: "Note",
  company: "Company",
  jobTitle: "Job title",
};

/**
 * What a chosen vCard or CSV file's bytes are: the source the dry run is
 * sent, or why not. The bytes must be UTF-8, which is the one encoding the
 * importer reads, so a spreadsheet saved in a legacy code page is refused
 * here, before it is uploaded, with the same words the server would use.
 */
export function recognizeContactFile(
  source: "csv" | "vcard",
  bytes: Uint8Array,
): { readonly source?: unknown; readonly message: string } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { message: NOT_UTF8 };
  }
  if (source === "vcard") {
    return /BEGIN:VCARD/i.test(text)
      ? { message: "vCard file detected.", source: { format: "vcard", text } }
      : { message: "This file does not look like a vCard." };
  }
  return text.replace(/^\uFEFF/, "").trim() === ""
    ? { message: "This CSV file has no header row." }
    : { message: "CSV file detected.", source: { format: "csv", text } };
}

/** A CSV run awaiting its column mapping. */
export interface PendingMapping {
  readonly importId: string;
  readonly preview: CsvPreview;
}

export interface NewImportState {
  readonly phase: "loading" | "ready" | "no-session" | "member";
  readonly source: ImportSource;
  /** The CSV run whose columns the reader is mapping, if there is one. */
  readonly mapping: PendingMapping | undefined;
  /** Whether a mapping is being applied. */
  readonly applying: boolean;
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
  | { readonly type: "source"; readonly source: ImportSource }
  | {
    readonly type: "mapping";
    readonly importId: string;
    readonly preview: CsvPreview;
  }
  | { readonly type: "applying" }
  | { readonly type: "apply-refused"; readonly message: string }
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
  applying: false,
  committed: undefined,
  committing: false,
  confirmed: false,
  detection: CHOOSE_EXPORT,
  importId: undefined,
  mapping: undefined,
  phase: "loading",
  report: undefined,
  source: "monica",
  status: "",
  validating: false,
};

/**
 * Withdraws the dry run and any mapping step: nothing is committable, or
 * mappable, until one lands again.
 */
function withdrawn(state: NewImportState): NewImportState {
  return {
    ...state,
    confirmed: false,
    importId: undefined,
    mapping: undefined,
    report: undefined,
  };
}

export function newImportReducer(
  state: NewImportState,
  action: NewImportAction,
): NewImportState {
  switch (action.type) {
    case "ready":
      return { ...state, phase: "ready" };
    case "source":
      return {
        ...withdrawn(state),
        detection: action.source === "monica" ? CHOOSE_EXPORT : CHOOSE_CONTACTS,
        source: action.source,
      };
    case "mapping":
      return {
        ...withdrawn(state),
        mapping: { importId: action.importId, preview: action.preview },
        source: "csv",
        status:
          "Map each column to a field, or choose Ignore, then apply the mapping.",
      };
    case "applying":
      return { ...state, applying: true, status: "Applying the mapping…" };
    case "apply-refused":
      return { ...state, applying: false, status: action.message };
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
        applying: false,
        importId: action.importId,
        mapping: undefined,
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

const SOURCE_NAMES: Readonly<Record<ImportSummary["sourceSystem"], string>> = {
  csv: "CSV",
  monica: "Monica",
  vcard: "vCard",
};

/**
 * An import in the history: how many contacts it carries, and, for a vCard
 * or CSV import, its source. A CSV import awaiting its mapping counts rows.
 */
export function importHeading(run: ImportSummary): string {
  const count = run.preview?.rowCount ?? run.report.counts.contacts;
  const noun = run.preview ? "row" : "contact";
  const source = run.sourceSystem && run.sourceSystem !== "monica"
    ? ` · ${SOURCE_NAMES[run.sourceSystem]}`
    : "";
  return `${count} ${noun}${count === 1 ? "" : "s"}${source}`;
}

/** Where a history entry leads: a pending CSV run resumes its mapping. */
export function importHref(run: ImportSummary): string {
  return run.status === "pending"
    ? `/app/settings/import/new?import=${encodeURIComponent(run.importId)}`
    : `/app/settings/import/${run.importId}`;
}

/** An import's state as the history names it. */
export function importStatus(status: ImportSummary["status"]): string {
  return status === "dry_run"
    ? "Dry run"
    : status === "completed"
    ? "Completed"
    : status === "pending"
    ? "Awaiting column mapping"
    : "Failed";
}

/** An import's state as its report names it. */
export function reportStatus(status: ImportSummary["status"]): string {
  return status === "completed"
    ? "Completed"
    : status === "dry_run"
    ? "Awaiting confirmation"
    : status === "pending"
    ? "Awaiting column mapping"
    : "Failed";
}

/** The pending import a new-import URL resumes, or `undefined`. */
export function resumedImportId(search: string): string | undefined {
  const id = new URLSearchParams(search).get("import") ?? "";
  return /^[0-9a-f-]{36}$/i.test(id) ? id : undefined;
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
  /** Where a CSV import awaiting its mapping resumes (GAP-050). */
  readonly resume?: string;
}

export type ReportAction =
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "failed"; readonly message: string }
  | {
    readonly type: "loaded";
    readonly report: ImportReport;
    readonly outcome: string;
    readonly resume?: string;
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
        ...(action.resume ? { resume: action.resume } : {}),
        retry: false,
        status: "Import report is current.",
      };
  }
}

/** The import id a report page's path names, or `undefined`. */
export function reportImportId(pathname: string): string | undefined {
  return pathname.match(/\/app\/settings\/import\/([0-9a-f-]{36})\/?$/i)?.[1];
}
