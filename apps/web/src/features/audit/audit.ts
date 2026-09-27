/**
 * Audit history's pure half (GAP-033): how an audit event reads, which
 * filters a search sends, and the one reducer the full history pages move
 * through. Nothing here touches the DOM, so it is tested without one.
 *
 * The full pages — a person's (`/app/people/:personId/audit`) and the
 * workspace's (`/app/settings/audit`) — and the person workspace's audit
 * summary card render these same events (`audit-event.tsx`).
 */

import type {
  AuditDateDetail,
  AuditDetail,
  AuditEvent,
  AuditHistory,
  AuditHistoryInput,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import type { TimePreferences } from "../../lib/time-presentation.ts";

/** `people.person-updated` reads "People person updated". */
export function formatAction(action: string): string {
  return action.replaceAll(/[._-]+/g, " ").replace(
    /^./,
    (value) => value.toUpperCase(),
  );
}

const DATE_PRECISION_LABELS: Readonly<
  Record<AuditDateDetail["precision"], string>
> = {
  day: "day only",
  full: "full date",
  month: "month only",
  month_day: "month and day",
  unknown: "unknown date",
  year: "year only",
  year_month: "year and month",
};

function isAuditDateDetail(value: AuditDetail): value is AuditDateDetail {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Partial<AuditDateDetail>;
  return Object.keys(value).every((key) =>
    key === "isYearApproximate" || key === "precision"
  ) && typeof candidate.isYearApproximate === "boolean" &&
    typeof candidate.precision === "string" &&
    candidate.precision in DATE_PRECISION_LABELS;
}

/** One stored detail as accessible text; anything unrecognised stays hidden. */
export function formatDetail(key: string, value: AuditDetail): string {
  if (isAuditDateDetail(value)) {
    return `${value.isYearApproximate ? "Approximate " : ""}${
      DATE_PRECISION_LABELS[value.precision]
    }`;
  }
  if (value === null) return "Not set";
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") {
    return key === "from" || key === "status" || key === "to"
      ? formatAction(value)
      : value;
  }
  return "Protected detail";
}

/** Who acted, on whom, and on what kind of record. */
export function eventContext(event: AuditEvent): string {
  return [event.actor.name, event.person?.name, event.subject.type]
    .filter(Boolean).join(" · ");
}

/** The event's non-sensitive details, or a line saying there are none. */
export function eventDetails(event: AuditEvent): string {
  const values = Object.entries(event.details).map(([key, value]) =>
    `${formatAction(key)}: ${formatDetail(key, value)}`
  );
  return values.length > 0
    ? values.join(" · ")
    : "No non-sensitive details stored.";
}

/** The filter fields a history page's form carries. */
export type AuditFilterValues = Readonly<Record<string, string>>;

function isoValue(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

/** The search a filter form asks for: one page of 20, dates as instants. */
export function filterInput(
  values: AuditFilterValues,
  cursor?: string,
): AuditHistoryInput {
  const text = (name: string) => values[name]?.trim() ?? "";
  const from = isoValue(text("from"));
  const to = isoValue(text("to"));
  return {
    ...(text("action") ? { action: text("action") } : {}),
    ...(text("actorMemberId") ? { actorMemberId: text("actorMemberId") } : {}),
    ...(cursor ? { cursor } : {}),
    ...(from ? { from } : {}),
    limit: 20,
    ...(text("personId") ? { personId: text("personId") } : {}),
    ...(to ? { to } : {}),
  };
}

/** Why a page of history did not arrive. */
export type AuditFailure =
  | "session-lost"
  | "forbidden"
  | "not-found"
  | "stale"
  | "unavailable";

/** The failure a refused read's status names. */
export function auditFailure(status: number | undefined): AuditFailure {
  if (status === 403) return "forbidden";
  if (status === 404) return "not-found";
  if (status === 409) return "stale";
  return "unavailable";
}

export interface AuditHistoryState {
  readonly events: readonly AuditEvent[];
  /** The cursor Load older events continues from; none hides it. */
  readonly nextCursor: string | undefined;
  /** Where Retry resumes: a continuation's cursor, or the first page. */
  readonly retryCursor: string | undefined;
  /** Whether Retry is offered at all. */
  readonly retryable: boolean;
  /** A page is in flight: Load older events is unavailable until it lands. */
  readonly loading: boolean;
  readonly message: string;
  /** The person a person history names, once a page has said so. */
  readonly personName: string | undefined;
  /** A person history's read failed before the person was ever named. */
  readonly personUnknown: boolean;
  /** The member's time presentation, as the latest page read it. */
  readonly preferences: TimePreferences | undefined;
}

export type AuditHistoryAction =
  | { readonly type: "loading"; readonly cursor?: string | undefined }
  | {
    readonly type: "loaded";
    readonly cursor?: string | undefined;
    readonly page: AuditHistory;
    readonly preferences?: TimePreferences | undefined;
  }
  | {
    readonly type: "failed";
    readonly cursor?: string | undefined;
    readonly failure: AuditFailure;
  };

export const initialAuditHistory: AuditHistoryState = {
  events: [],
  loading: true,
  message: "Loading audit history…",
  nextCursor: undefined,
  personName: undefined,
  personUnknown: false,
  preferences: undefined,
  retryable: false,
  retryCursor: undefined,
};

const KEPT = " Existing results are unchanged.";

function failureMessage(failure: AuditFailure, continued: boolean): string {
  switch (failure) {
    case "session-lost":
      return `Sign in again to review audit history.${continued ? KEPT : ""}`;
    case "forbidden":
      return continued
        ? `You no longer have permission to continue this audit history.${KEPT}`
        : "You do not have permission to review audit history. Owner or administrator access is required.";
    case "not-found":
      return continued
        ? `This audit scope is no longer available.${KEPT} Adjust filters to start a new search.`
        : "This audit scope was not found in the active workspace.";
    case "stale":
      return `This audit page is stale. Restart the filtered history.${
        continued ? KEPT : ""
      }`;
    case "unavailable":
      return continued
        ? `Older audit events could not be loaded.${KEPT} Try again.`
        : "Audit history could not be loaded. Try again.";
  }
}

function countMessage(count: number, archived: boolean): string {
  if (count === 0) return "No audit events match this scope.";
  return `${count} audit event${
    count === 1 ? "" : "s"
  } in immutable newest-first order.${
    archived ? " Archived person history remains readable." : ""
  }`;
}

export function auditHistoryReducer(
  state: AuditHistoryState,
  action: AuditHistoryAction,
): AuditHistoryState {
  const continued = action.cursor !== undefined;
  switch (action.type) {
    case "loading":
      return {
        ...state,
        loading: true,
        message: continued
          ? "Loading older audit events…"
          : "Loading audit history…",
        retryable: false,
        // A new search starts empty, so no earlier scope's rows linger.
        ...(continued
          ? {}
          : { events: [], nextCursor: undefined, retryCursor: undefined }),
      };
    case "loaded": {
      const events = continued
        ? [...state.events, ...action.page.items]
        : action.page.items;
      return {
        ...state,
        events,
        loading: false,
        message: countMessage(events.length, action.page.status === "archived"),
        nextCursor: action.page.nextCursor,
        personName: action.page.person?.name ?? state.personName,
        preferences: action.preferences,
        retryCursor: undefined,
        retryable: false,
      };
    }
    case "failed": {
      const { failure } = action;
      // A continuation the server refuses for good cannot be retried or
      // continued; a stale one can only restart.
      const terminal = continued &&
        (failure === "forbidden" || failure === "not-found");
      const resumable = failure === "session-lost" ||
        failure === "unavailable";
      return {
        ...state,
        loading: false,
        message: failureMessage(failure, continued),
        nextCursor: terminal || failure === "stale"
          ? undefined
          : state.nextCursor,
        personUnknown: state.personName === undefined,
        retryCursor: resumable ? action.cursor : undefined,
        retryable: !terminal,
      };
    }
  }
}
