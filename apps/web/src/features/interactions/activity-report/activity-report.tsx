/**
 * A person's activity report (INTERACTION-001, GAP-033): every activity and
 * note about one person, newest first, twenty at a time, optionally for one
 * year (`?year=`), as one island.
 *
 * `pages/internal/activity-report-shell.astro` draws the page in its loading
 * state; `mountActivityReport` renders the list over the region the page
 * reserved and portals the person's name into the heading and the
 * breadcrumb. Every read — the first page, the next page, and the refresh
 * after Quick capture records an interaction (`INTERACTION_CREATED_EVENT`) —
 * goes through one latest-request slot, and Load more hides while a refresh
 * owns the list. A person the workspace cannot see reads as not found, and
 * the breadcrumb never names them.
 */

import { useEffect, useEffectEvent, useReducer, useRef } from "react";
import { createPortal } from "react-dom";
import {
  type ActivityOrNoteInteraction,
  type ActivityReport as Report,
  getActivityReport,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { skeletonVariants } from "@/components/ui/variants.ts";
import {
  LoadMore,
  mountIsland,
  type Settled,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import { type TimePreferences } from "../../../lib/time-presentation.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import { InteractionEntry } from "../interaction-entry.tsx";
import { INTERACTION_CREATED_EVENT, profilePersonId } from "../shared.ts";

export const ACTIVITY_REPORT_ISLAND = "activity-report";

const PAGE_SIZE = 20;
const LIST_ID = "activity-report-list";

type Status =
  | "loading"
  | "ready"
  | "no-session"
  | "not-found"
  | "failed";

export interface ReportState {
  readonly status: Status;
  readonly items: readonly ActivityOrNoteInteraction[];
  readonly nextCursor?: string | undefined;
  readonly name?: string | undefined;
  readonly preferences?: TimePreferences | undefined;
  /** A refresh from the first page owns the list until it lands. */
  readonly refreshing: boolean;
}

interface Page {
  readonly report: Report;
  readonly preferences: TimePreferences | undefined;
}

export type ReportAction =
  | { readonly type: "refresh" }
  | {
    readonly type: "answered";
    readonly answer: Settled<Page | undefined>;
    /** The cursor the answered page continued after, if any. */
    readonly cursor: string | undefined;
  };

/** A first page replaces the list, a continuation extends it. */
export function reportReducer(
  state: ReportState,
  action: ReportAction,
): ReportState {
  if (action.type === "refresh") return { ...state, refreshing: true };
  const { answer, cursor } = action;
  if (answer.status !== "ready") {
    return {
      ...state,
      refreshing: false,
      status: answer.problem?.status === 404 ? "not-found" : "failed",
    };
  }
  if (!answer.data) {
    return { ...state, refreshing: false, status: "no-session" };
  }
  const { preferences, report } = answer.data;
  const known = new Set(state.items.map((item) => item.id));
  return {
    items: cursor
      ? [...state.items, ...report.items.filter((item) => !known.has(item.id))]
      : report.items,
    name: report.person.name,
    nextCursor: report.nextCursor,
    preferences,
    refreshing: false,
    status: "ready",
  };
}

function statusLine(state: ReportState): string {
  switch (state.status) {
    case "loading":
      return "Loading activities and notes…";
    case "no-session":
      return "Activity report unavailable.";
    case "not-found":
      return "Person not found in this workspace.";
    case "failed":
      return "Activity report could not be loaded. Saved interactions are unchanged.";
    case "ready": {
      const count = state.items.length;
      return count === 0
        ? "No activities or notes for this period."
        : `${count} recorded item${count === 1 ? "" : "s"}.`;
    }
  }
}

export interface ActivityReportProps {
  readonly personId: string;
  readonly year?: number | undefined;
  /** The page heading the person's name renders into. */
  readonly heading: HTMLElement;
  /** The breadcrumb link the person's name renders into, when the page has one. */
  readonly crumb?: HTMLElement | undefined;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
}

export function ActivityReport(props: ActivityReportProps) {
  const { personId, year } = props;
  const [state, dispatch] = useReducer(reportReducer, {
    items: [],
    refreshing: false,
    status: "loading",
  });
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);

  const read = async (cursor?: string): Promise<void> => {
    if (!cursor) dispatch({ type: "refresh" });
    const answer = await request<Page | undefined>(async () => {
      const session = await resolveWorkspaceSession();
      if (session.status !== "ready") return { ok: true, value: undefined };
      const workspaceId = session.session.workspace.id;
      const report = await getActivityReport(personId, {
        ...(cursor ? { cursor } : {}),
        limit: PAGE_SIZE,
        ...(year === undefined ? {} : { year }),
      }, workspaceId);
      const preferences = session.session.preferences;
      return report.ok
        ? { ok: true, value: { preferences, report: report.value } }
        : report;
    });
    if (!answer) return;
    dispatch({ answer, cursor, type: "answered" });
    settled.current?.();
    settled.current = undefined;
  };

  const first = useEffectEvent(() => void read());
  useEffect(() => first(), []);

  const created = useEffectEvent(() => void read());
  useEffect(() => {
    const listener = () => created();
    globalThis.addEventListener(INTERACTION_CREATED_EVENT, listener);
    return () =>
      globalThis.removeEventListener(INTERACTION_CREATED_EVENT, listener);
  }, []);

  const { name } = state;
  return (
    <>
      <p
        aria-live="polite"
        className="section-state"
        id="activity-report-state"
        role="status"
      >
        {statusLine(state)}
      </p>
      <ol
        aria-label="Activities and notes in reverse chronological order"
        className="interaction-list"
        id={LIST_ID}
      >
        {state.items.map((entry) => (
          <InteractionEntry
            entry={entry}
            key={`${entry.kind}:${entry.id}`}
            preferences={state.preferences}
          />
        ))}
      </ol>
      <LoadMore
        controls={LIST_ID}
        cursor={state.refreshing ? undefined : state.nextCursor}
        label="Load more"
        list="activity-report"
        onLoad={(cursor) => read(cursor)}
      />
      {createPortal(
        name
          ? `${name} activity`
          : state.status === "loading"
          ? "Loading activity report…"
          : "Activity report",
        props.heading,
      )}
      {props.crumb
        ? createPortal(
          name ?? (state.status === "loading"
            ? (
              <>
                <span
                  aria-hidden="true"
                  className={skeletonVariants({ shape: "chip" })}
                  data-slot="skeleton"
                />
                <span className="sr-only">Loading person…</span>
              </>
            )
            : "Person"),
          props.crumb,
        )
        : null}
    </>
  );
}

/** The year the page's filter asks for, when it names a whole year. */
export function reportYear(search: string): number | undefined {
  const value = new URLSearchParams(search).get("year");
  const year = value ? Number(value) : undefined;
  return year !== undefined && Number.isSafeInteger(year) ? year : undefined;
}

/**
 * Mounts the report over the region the page drew and resolves, once its
 * first read has settled, with the function that unmounts it. Without the
 * region, the heading, or a person there is nothing to own.
 */
export function mountActivityReport(
  root: ParentNode = document,
  personId: string | undefined = profilePersonId(),
): Promise<() => void> {
  const region = root.querySelector<HTMLElement>("[data-activity-report]");
  const heading = root.querySelector<HTMLElement>("#activity-report-heading");
  if (!region || !heading || !personId) {
    return Promise.resolve(() => undefined);
  }
  const crumb = root.querySelector<HTMLElement>("[data-breadcrumb-person]") ??
    undefined;
  // The portals replace the page's loading copy in the same task.
  heading.replaceChildren();
  crumb?.replaceChildren();
  return new Promise((resolve) => {
    const unmount = mountIsland(
      region,
      ACTIVITY_REPORT_ISLAND,
      <ActivityReport
        crumb={crumb}
        heading={heading}
        onSettled={() => resolve(unmount)}
        personId={personId}
        year={reportYear(globalThis.location.search)}
      />,
    );
  });
}
