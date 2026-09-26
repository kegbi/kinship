/**
 * The unified person timeline (GAP-028): notes, calls, conversations,
 * activities, and life events merged newest first, filtered by kind, and
 * paged by cursor.
 *
 * It renders into the `#person-timeline` card the static shell drew and
 * keeps its heading, filter chips, status line, list, and paging controls —
 * and every `data-timeline-*` hook the end-to-end journeys read. Only the
 * latest request may land: a filter chosen while the first page loads, or a
 * refresh another surface asks for, supersedes what came before.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  listPersonTimeline,
  type PersonTimelineItem,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { segmentVariants } from "@/components/ui/variants.ts";
import type { TimePreferences } from "../../lib/time-presentation.ts";
import { SectionGlyph } from "../../features/person/section-glyph.tsx";
import { SectionLoading } from "../../features/person/section-loading.tsx";
import { useDocumentEvent, useLatestRequest } from "../core/index.ts";
import {
  countText,
  dateTimeValue,
  detailLines,
  displayDate,
  KIND_LABELS,
  TIMELINE_FILTERS,
  type TimelineFilter,
} from "./timeline.ts";

export interface PersonTimelineProps {
  readonly personId: string;
  readonly workspaceId: string;
  readonly preferences?: TimePreferences | undefined;
  /** The card the island renders into; it carries `data-timeline-state`. */
  readonly section: HTMLElement;
  /** Called once, when the first page has settled either way. */
  readonly onSettled?: () => void;
}

type TimelineStatus =
  | "loading"
  | "ready"
  | "empty"
  | "error"
  | "forbidden"
  | "not-found";

interface TimelineState {
  readonly status: TimelineStatus;
  readonly items: readonly PersonTimelineItem[];
  readonly nextCursor?: string | undefined;
  /** Whether the load in flight appends an older page. */
  readonly appending: boolean;
  /** True until the first page has answered; the skeleton shows meanwhile. */
  readonly initial: boolean;
  readonly detail?: string | undefined;
  readonly retryable: boolean;
}

interface TimelineRequest {
  readonly cursor?: string;
  readonly filter: TimelineFilter;
}

const PAGE_SIZE = 20;
const segment = segmentVariants();

function statusText(state: TimelineState): string {
  switch (state.status) {
    case "loading":
      return state.appending
        ? "Loading older events…"
        : "Loading the timeline…";
    case "ready":
    case "empty":
      return countText(state.items.length);
    case "forbidden":
      return "You no longer have access to this person's timeline.";
    case "not-found":
      return "This person is no longer available.";
    case "error":
      return state.detail ?? "The timeline is temporarily unavailable.";
  }
}

export function PersonTimeline(props: PersonTimelineProps) {
  const { personId, preferences, section, workspaceId } = props;
  const [filter, setFilter] = useState<TimelineFilter>("all");
  const [state, setState] = useState<TimelineState>({
    appending: false,
    initial: true,
    items: [],
    retryable: false,
    status: "loading",
  });
  // Where focus goes once an older page has rendered.
  const focusAfterAppend = useRef<
    { readonly firstNewId?: string } | undefined
  >(undefined);
  const request = useLatestRequest();
  const lastRequest = useRef<TimelineRequest>({ filter: "all" });
  const more = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const settled = useRef(props.onSettled);

  /** Asks for one page and applies the answer if it is still the latest. */
  const fetchPage = useCallback(
    (next: TimelineRequest): Promise<void> => {
      lastRequest.current = next;
      const append = next.cursor !== undefined;
      return request(() =>
        listPersonTimeline(personId, {
          ...(next.cursor ? { cursor: next.cursor } : {}),
          ...(next.filter === "all" ? {} : { kind: next.filter }),
          limit: PAGE_SIZE,
        }, workspaceId)
      ).then((answer) => {
        if (!answer) return;
        if (answer.status === "ready" && answer.data) {
          const page = answer.data;
          const firstNewId = page.items[0]?.id;
          if (append) {
            focusAfterAppend.current =
              page.nextCursor || firstNewId === undefined ? {} : {
                firstNewId,
              };
          }
          setState((current) => {
            const items = append
              ? [...current.items, ...page.items]
              : page.items;
            return {
              appending: false,
              initial: false,
              items,
              nextCursor: page.nextCursor,
              retryable: false,
              status: items.length === 0 ? "empty" : "ready",
            };
          });
          return;
        }
        const status = answer.problem?.status ?? 503;
        setState((current) => ({
          appending: false,
          detail: answer.problem?.detail,
          initial: false,
          items: current.items,
          nextCursor: undefined,
          retryable: status >= 500,
          status: status === 403
            ? "forbidden"
            : status === 404
            ? "not-found"
            : "error",
        }));
      });
    },
    [personId, request, workspaceId],
  );

  /** Shows the request as loading, then asks for it. */
  const load = useCallback((next: TimelineRequest): Promise<void> => {
    const append = next.cursor !== undefined;
    setState((current) => ({
      ...current,
      appending: append,
      items: append ? current.items : [],
      nextCursor: append ? current.nextCursor : undefined,
      retryable: false,
      status: "loading",
    }));
    return fetchPage(next);
  }, [fetchPage]);

  // The first page starts in the loading state the island mounted with.
  useEffect(() => {
    void fetchPage({ filter: "all" }).finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, [fetchPage]);

  useLayoutEffect(() => {
    section.setAttribute("data-timeline-state", state.status);
  }, [section, state.status]);

  useLayoutEffect(() => {
    const target = focusAfterAppend.current;
    if (!target) return;
    focusAfterAppend.current = undefined;
    if (target.firstNewId === undefined) more.current?.focus();
    else {
      list.current?.querySelector<HTMLElement>(
        `[data-timeline-id="${target.firstNewId}"] summary`,
      )?.focus();
    }
  }, [state.items]);

  useDocumentEvent<CustomEvent<{ readonly personIds?: unknown }>>(
    "person-timeline-changed",
    (event) => {
      const personIds = event.detail?.personIds;
      if (!Array.isArray(personIds) || !personIds.includes(personId)) return;
      void load({ filter: lastRequest.current.filter });
    },
  );

  const choose = (next: TimelineFilter) => {
    setFilter(next);
    void load({ filter: next });
  };
  const failed = state.status === "error" || state.status === "forbidden" ||
    state.status === "not-found";

  return (
    <>
      <header className="profile-section-heading">
        <SectionGlyph className="profile-section-glyph" name="timeline" />
        <div className="profile-section-title">
          <h3 id="person-timeline-heading">Everything, in order</h3>
        </div>
      </header>
      <div
        aria-label="Filter timeline by type"
        className="person-timeline-filters"
        role="group"
      >
        {TIMELINE_FILTERS.map((chip) => (
          <button
            aria-pressed={filter === chip.filter}
            className={segment}
            data-timeline-filter={chip.filter}
            key={chip.filter}
            onClick={() => choose(chip.filter)}
            type="button"
          >
            {chip.label}
          </button>
        ))}
      </div>
      <p className="section-state" data-timeline-state="">
        {state.initial && state.status === "loading"
          ? <SectionLoading label="Loading the timeline…" />
          : statusText(state)}
      </p>
      <ul
        aria-label="Person timeline"
        className="person-timeline-list"
        data-timeline-list=""
        ref={list}
      >
        {state.items.map((item) => (
          <TimelineRow item={item} key={item.id} preferences={preferences} />
        ))}
      </ul>
      <Button
        data-timeline-more=""
        disabled={state.status === "loading"}
        hidden={!state.nextCursor || failed}
        onClick={() => {
          if (state.nextCursor) {
            void load({ cursor: state.nextCursor, filter });
          }
        }}
        ref={more}
        type="button"
        variant="outline"
      >
        Load older events
      </Button>
      <Button
        data-timeline-retry=""
        hidden={!state.retryable}
        onClick={() => void load(lastRequest.current)}
        type="button"
        variant="outline"
      >
        Retry the timeline
      </Button>
    </>
  );
}

function TimelineRow(
  props: {
    readonly item: PersonTimelineItem;
    readonly preferences: TimePreferences | undefined;
  },
) {
  const { item } = props;
  const dateTime = dateTimeValue(item);
  const date = displayDate(item, props.preferences);
  const lines = detailLines(item);
  return (
    <li data-timeline-id={item.id} data-timeline-kind={item.kind}>
      <details>
        <summary>
          {dateTime
            ? (
              <time
                className="person-timeline-date"
                data-timeline-date=""
                dateTime={dateTime}
              >
                {date}
              </time>
            )
            : (
              <span className="person-timeline-date" data-timeline-date="">
                {date}
              </span>
            )}
          <span className="person-timeline-type">{KIND_LABELS[item.kind]}</span>
          <span className="person-timeline-summary-excerpt">
            {item.excerpt ?? item.title ?? "No details recorded."}
          </span>
        </summary>
        <strong>{item.title ?? KIND_LABELS[item.kind]}</strong>
        <p>{item.excerpt ?? "No details recorded."}</p>
        {lines.length > 0 && (
          <ul>
            {lines.map((line, index) => <li key={index}>{line}</li>)}
          </ul>
        )}
      </details>
    </li>
  );
}
