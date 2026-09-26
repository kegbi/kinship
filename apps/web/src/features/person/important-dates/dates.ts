/**
 * The important-dates rail block's pure half (GAP-031): how a date reads,
 * which dates the collapsed block keeps in view, what a form's values send,
 * how a refusal is worded, and the one reducer the island's state moves
 * through. Nothing here touches the DOM, so it is tested without rendering.
 *
 * A date is stored with only the components its precision declares; nothing
 * here ever invents a missing year, month, or day.
 */

import type {
  ImportantDate,
  ImportantDateInput,
  ProblemDetails,
} from "../../../../../../packages/contracts/generated/auth-client.ts";

// --- How a date reads -------------------------------------------------------

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthName(month: number | undefined): string {
  return month === undefined ? "Unknown month" : MONTH_NAMES[month - 1] ?? "";
}

/** The date as its precision allows it to be said. */
export function formatImportantDate(date: ImportantDate): string {
  const year = date.isYearApproximate ? `about ${date.year}` : `${date.year}`;
  switch (date.precision) {
    case "full":
      return `${monthName(date.month)} ${date.day}, ${year}`;
    case "year_month":
      return `${monthName(date.month)} ${year}`;
    case "month_day":
      return `${monthName(date.month)} ${date.day} (year unknown)`;
    case "year":
      return year;
    case "month":
      return `${monthName(date.month)} (year unknown)`;
    case "day":
      return `Day ${date.day} (month and year unknown)`;
    default:
      return "Date unknown";
  }
}

/** The birthday vital: the age first, when it is asked for and known. */
export function formatBirthday(date: ImportantDate, now: Date): string {
  const formatted = formatImportantDate(date);
  if (!date.isAgeBased || date.year === undefined || date.isYearApproximate) {
    return formatted;
  }
  let age = now.getFullYear() - date.year;
  if (
    date.month !== undefined &&
    (now.getMonth() + 1 < date.month ||
      (now.getMonth() + 1 === date.month && date.day !== undefined &&
        now.getDate() < date.day))
  ) age -= 1;
  return age < 0 ? formatted : `Age ${age} · ${formatted}`;
}

/** What a date is called in its row and its controls' names. */
export function dateTitle(date: ImportantDate): string {
  if (date.kind === "birthday") return "Birthday";
  if (date.kind === "deceased") return "Date of death";
  if (date.kind === "first_met") return "First meeting";
  return date.label ?? "Custom date";
}

/** The scheduling line under a date. */
export function schedulingText(date: ImportantDate): string {
  return date.scheduling === "annual-reminder"
    ? "Annual reminder scheduled because month and day are known."
    : "No reminder scheduled; month and day are not both known.";
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function nextAnnualOccurrence(
  date: ImportantDate,
  now: Date,
): number | undefined {
  const { day, month } = date;
  if (month === undefined || day === undefined) return undefined;
  const currentYear = now.getUTCFullYear();
  const today = Date.UTC(currentYear, now.getUTCMonth(), now.getUTCDate());
  const occurrence = (year: number): number => {
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    return Date.UTC(year, month - 1, Math.min(day, lastDay));
  };
  const thisYear = occurrence(currentYear);
  return thisYear >= today ? thisYear : occurrence(currentYear + 1);
}

/**
 * The dates a collapsed block keeps in view: the birthday and the soonest
 * upcoming date, each once.
 */
export function selectImportantDateSummaryIds(
  dates: readonly ImportantDate[],
  now: Date,
): readonly string[] {
  const birthday = dates.find((date) => date.kind === "birthday");
  const upcoming = dates.map((date) => ({
    date,
    occurrence: nextAnnualOccurrence(date, now),
  })).filter(
    (candidate): candidate is { date: ImportantDate; occurrence: number } =>
      candidate.occurrence !== undefined,
  ).sort((left, right) =>
    left.occurrence - right.occurrence ||
    compareText(dateTitle(left.date), dateTitle(right.date)) ||
    compareText(left.date.id, right.date.id)
  )[0]?.date;
  return [birthday, upcoming]
    .filter((date): date is ImportantDate => date !== undefined)
    .filter((date, index, selected) =>
      selected.findIndex((candidate) => candidate.id === date.id) === index
    )
    .map((date) => date.id);
}

/**
 * The dates a block of more than two keeps out of view until expanded; a
 * block of one or two shows them all.
 */
export function collapsedDateIds(
  dates: readonly ImportantDate[],
  now: Date,
): ReadonlySet<string> {
  if (dates.length <= 2) return new Set();
  const shown = new Set(selectImportantDateSummaryIds(dates, now));
  return new Set(
    dates.filter((date) => !shown.has(date.id)).map((date) => date.id),
  );
}

/** The dates in the order the API lists them, after a local save. */
export function sortDates(
  dates: readonly ImportantDate[],
): readonly ImportantDate[] {
  return [...dates].sort((left, right) =>
    (left.year ?? 10_000) - (right.year ?? 10_000) ||
    (left.month ?? 13) - (right.month ?? 13) ||
    (left.day ?? 32) - (right.day ?? 32) ||
    left.kind.localeCompare(right.kind) ||
    (left.label ?? "").localeCompare(right.label ?? "") ||
    left.id.localeCompare(right.id)
  );
}

/** The block's status line once its dates are shown. */
export function summaryText(
  dates: readonly ImportantDate[],
  archived: boolean,
): string {
  if (archived) {
    return dates.length === 0
      ? "No important dates recorded. This archived person is read-only."
      : "Important dates loaded. This archived person is read-only.";
  }
  return dates.length === 0
    ? "No important dates recorded."
    : `${dates.length} important ${
      dates.length === 1 ? "date" : "dates"
    } loaded.`;
}

// --- Refusals ---------------------------------------------------------------

export const LIST_UNAVAILABLE =
  "Important dates are temporarily unavailable. Try again.";
export const DELETE_UNAVAILABLE =
  "Important date deletion is temporarily unavailable.";
export const SAVE_UNAVAILABLE =
  "Important date saving is temporarily unavailable.";
export const CONFIRM_DELETE = "Press the delete button again to confirm.";

/** What a refused read or delete says; a problem's detail only for a conflict. */
export function problemMessage(problem: ProblemDetails | undefined): string {
  if (!problem) return LIST_UNAVAILABLE;
  if (problem.status === 404) return "This person is no longer available.";
  if (problem.status === 401 || problem.status === 403) {
    return "Your active workspace no longer permits this action.";
  }
  if (problem.status === 409) return problem.detail;
  return LIST_UNAVAILABLE;
}

/** The field a refused save names, among those the form shows. */
export type DateField = "day" | "label" | "month" | "year";

export interface FormProblem {
  readonly field?: DateField;
  readonly message: string;
}

const FIELDS: ReadonlySet<string> = new Set(["day", "label", "month", "year"]);

/** What a refused save says, and the field it marks invalid. */
export function formProblem(problem: ProblemDetails | undefined): FormProblem {
  if (!problem) return { message: SAVE_UNAVAILABLE };
  const named = Object.keys(problem.errors ?? {})[0];
  const field = named && FIELDS.has(named) ? named as DateField : undefined;
  const message = problem.status === 400
    ? Object.values(problem.errors ?? {})[0] ?? problem.detail
    : problemMessage(problem);
  return field ? { field, message } : { message };
}

// --- The form ---------------------------------------------------------------

export type DateKind = ImportantDate["kind"];
export type DatePrecision = ImportantDate["precision"];
export type DateComponent = "year" | "month" | "day";

/** The components a precision declares, which the form asks for. */
export function precisionComponents(
  precision: DatePrecision,
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

/** The form's raw values, as the reader left them. */
export interface DateFormValues {
  readonly kind: DateKind;
  readonly precision: DatePrecision;
  readonly label: string;
  readonly year: string;
  readonly month: string;
  readonly day: string;
  readonly isYearApproximate: boolean;
  readonly isAgeBased: boolean;
  readonly notes: string;
}

/**
 * The request the values make: only the components the precision declares,
 * a label only for a custom date, and trimmed text only when some is left.
 */
export function dateInput(values: DateFormValues): ImportantDateInput {
  const components = precisionComponents(values.precision);
  const hasYear = components.has("year");
  const label = values.kind === "custom" ? values.label.trim() : "";
  const notes = values.notes.trim();
  return {
    ...(components.has("day") ? { day: Number(values.day) } : {}),
    isAgeBased: hasYear && values.isAgeBased,
    isYearApproximate: hasYear && values.isYearApproximate,
    kind: values.kind,
    ...(label ? { label } : {}),
    ...(components.has("month") ? { month: Number(values.month) } : {}),
    ...(notes ? { notes } : {}),
    precision: values.precision,
    ...(hasYear ? { year: Number(values.year) } : {}),
  };
}

// --- The block's state ------------------------------------------------------

export type DatesStatus = "loading" | "ready" | "error" | "forbidden";

export type FocusTarget = "state" | "form-state" | "field" | "add";

export interface DateEditor {
  /** Bumped on every open, so the fields start from the opened date. */
  readonly generation: number;
  /** The date being edited; absent for a new one. */
  readonly date?: ImportantDate;
  readonly kind: DateKind;
  readonly precision: DatePrecision;
  readonly problem?: FormProblem;
}

export interface DatesState {
  readonly status: DatesStatus;
  readonly dates: readonly ImportantDate[];
  readonly archived: boolean;
  /** What the status line says instead of the summary, until the next render. */
  readonly feedback?: string;
  /** The date whose delete control asks for confirmation. */
  readonly confirming?: string;
  /** The date being deleted. */
  readonly deleting?: string;
  readonly editor?: DateEditor;
  readonly expanded: boolean;
  readonly focus?: { readonly target: FocusTarget; readonly tick: number };
}

export type DatesAction =
  | { readonly type: "loaded"; readonly dates: readonly ImportantDate[] }
  | {
    readonly type: "failed";
    readonly status: "error" | "forbidden";
    readonly message: string;
  }
  | { readonly type: "lifecycle"; readonly archived: boolean }
  | { readonly type: "open"; readonly date?: ImportantDate }
  | { readonly type: "close"; readonly focus?: boolean }
  | { readonly type: "kind"; readonly kind: DateKind }
  | { readonly type: "precision"; readonly precision: DatePrecision }
  | { readonly type: "save-failed"; readonly problem: FormProblem }
  | { readonly type: "saved"; readonly date: ImportantDate }
  | { readonly type: "confirm"; readonly id: string }
  | { readonly type: "delete"; readonly id: string }
  | { readonly type: "delete-failed"; readonly message: string }
  | { readonly type: "deleted"; readonly id: string }
  | { readonly type: "expand" };

export function initialDatesState(archived: boolean): DatesState {
  return { archived, dates: [], expanded: false, status: "loading" };
}

function focus(
  state: DatesState,
  target: FocusTarget,
): { readonly target: FocusTarget; readonly tick: number } {
  return { target, tick: (state.focus?.tick ?? 0) + 1 };
}

/** The block drawn again: confirmations and feedback go, the list collapses. */
function redrawn(
  state: DatesState,
  changes: Partial<DatesState>,
): DatesState {
  const {
    confirming: _confirming,
    deleting: _deleting,
    feedback: _feedback,
    ...rest
  } = state;
  return { ...rest, expanded: false, ...changes };
}

function withoutEditor(state: DatesState): DatesState {
  const { editor: _editor, ...rest } = state;
  return rest;
}

export function datesReducer(
  state: DatesState,
  action: DatesAction,
): DatesState {
  switch (action.type) {
    case "loaded":
      return redrawn(state, { dates: action.dates, status: "ready" });
    case "failed":
      return { ...state, feedback: action.message, status: action.status };
    case "lifecycle": {
      const next = redrawn(state, { archived: action.archived });
      return action.archived ? withoutEditor(next) : next;
    }
    case "open":
      return {
        ...state,
        editor: {
          ...(action.date ? { date: action.date } : {}),
          generation: (state.editor?.generation ?? 0) + 1,
          kind: action.date?.kind ?? "birthday",
          precision: action.date?.precision ?? "full",
        },
        focus: focus(state, "field"),
      };
    case "close": {
      const next = withoutEditor(state);
      return action.focus ? { ...next, focus: focus(state, "add") } : next;
    }
    case "kind":
      return state.editor
        ? { ...state, editor: { ...state.editor, kind: action.kind } }
        : state;
    case "precision":
      return state.editor
        ? { ...state, editor: { ...state.editor, precision: action.precision } }
        : state;
    case "save-failed":
      return state.editor
        ? {
          ...state,
          editor: { ...state.editor, problem: action.problem },
          focus: focus(state, "form-state"),
        }
        : state;
    case "saved": {
      const { date } = action;
      const known = state.dates.some((candidate) => candidate.id === date.id);
      const dates = known
        ? state.dates.map((candidate) =>
          candidate.id === date.id ? date : candidate
        )
        : [...state.dates, date];
      return redrawn(withoutEditor(state), {
        dates: sortDates(dates),
        focus: focus(state, "state"),
      });
    }
    case "confirm":
      return { ...state, confirming: action.id, feedback: CONFIRM_DELETE };
    case "delete":
      return { ...state, deleting: action.id };
    case "delete-failed": {
      const {
        confirming: _confirming,
        deleting: _deleting,
        ...rest
      } = state;
      return { ...rest, feedback: action.message };
    }
    case "deleted":
      return redrawn(state, {
        dates: state.dates.filter((date) => date.id !== action.id),
      });
    case "expand":
      return { ...state, expanded: !state.expanded };
  }
}
