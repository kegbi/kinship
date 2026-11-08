/**
 * A person's notes and activities cards (GAP-031).
 *
 * Both are listed in the unified timeline above, so each card reports how
 * many recent records it has, keeps a failure local with its own retry, and
 * offers Quick capture for its kind. Each card reads its own kind, through
 * its own latest-request slot, so a page of newer notes can never hide an
 * activity and a late answer never replaces a newer one. A card the profile
 * summary counted empty reads nothing (FEQ-04), and a recorded interaction
 * is counted on its own card from the record Quick capture announces, which
 * `recentCardReducer` folds in (FEQ-10). A card whose profile module is
 * turned off shows nothing and asks nothing.
 *
 * One component owns both cards — the activities card is the island's root,
 * the notes card a portal — and the person's Quick capture shortcuts: the
 * hero's two buttons and each card's. It decides whether a shortcut shows
 * (hidden while the person is archived or its kind is turned off); Quick
 * capture (`features/interactions/quick-capture.tsx`) is the one writer of
 * whether one works (`disabled`), so the shortcuts are plain buttons this
 * island never re-renders.
 */

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { getActivityReport } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import { buttonVariants } from "@/components/ui/variants.ts";
import {
  useDocumentEvent,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import { INTERACTION_CREATED_EVENT } from "../../interactions/shared.ts";
import {
  initialRecentCard,
  recentCardReducer,
} from "../recorded-interactions.ts";
import { SectionGlyph } from "../section-glyph.tsx";
import { SectionLoading } from "../section-loading.tsx";
import type { StatusRegionProps } from "../status-region.ts";

export type InteractionKind = "activity" | "note";

export interface PersonInteractionsProps {
  readonly personId: string;
  readonly workspaceId: string;
  readonly archived: boolean;
  /** Which cards the workspace turned off when the page loaded. */
  readonly hidden: { readonly activities: boolean; readonly notes: boolean };
  /** How many of each the profile summary counted, when it did. */
  readonly totals?: {
    readonly activities?: number | undefined;
    readonly notes?: number | undefined;
  };
  /** The two server-rendered cards; the activities card is the root. */
  readonly sections: {
    readonly activities: HTMLElement;
    readonly notes: HTMLElement;
  };
  /** Called once, when both cards' first reads have settled. */
  readonly onSettled?: () => void;
  /** What each card's state line spreads to be a live region, if anything. */
  readonly statusRegion?: StatusRegionProps;
}

interface CardWording {
  readonly section: "activities" | "notes";
  readonly title: string;
  readonly prefix: string;
  readonly action: string;
  readonly loading: string;
  readonly hidden: string;
  readonly failed: string;
  readonly empty: string;
  readonly count: (count: number) => string;
}

const CARDS: Readonly<Record<InteractionKind, CardWording>> = {
  activity: {
    action: "Log activity",
    count: (count) =>
      `${count} recent activit${
        count === 1 ? "y" : "ies"
      }. Listed in the timeline above.`,
    empty: "No activities recorded yet.",
    failed: "Activities could not be loaded. Saved activity is unchanged.",
    hidden: "Activities are hidden by workspace personalization.",
    loading: "Loading recent activities…",
    prefix: "person-activities",
    section: "activities",
    title: "Activities",
  },
  note: {
    action: "Add note",
    count: (count) =>
      `${count} recent note${
        count === 1 ? "" : "s"
      }. Listed in the timeline above.`,
    empty: "No notes recorded yet.",
    failed: "Notes could not be loaded. Saved notes are unchanged.",
    hidden: "Notes are hidden by workspace personalization.",
    loading: "Loading recent notes…",
    prefix: "person-notes",
    section: "notes",
    title: "Notes",
  },
};

const SHORTCUT = "[data-person-interaction-capture]";

/** How many recent records of its kind each card's read lists. */
const RECENT = 20;

export function PersonInteractions(props: PersonInteractionsProps) {
  const { hidden, personId, sections } = props;
  const [archived, setArchived] = useState(props.archived);
  const pending = useRef(2);
  const settled = useRef(props.onSettled);
  const onCardSettled = useCallback(() => {
    pending.current -= 1;
    if (pending.current > 0) return;
    settled.current?.();
    settled.current = undefined;
  }, []);

  useDocumentEvent<CustomEvent<{ archived?: unknown; personId?: unknown }>>(
    "person-lifecycle-changed",
    (event) => {
      const detail = event.detail;
      if (
        detail?.personId !== personId || typeof detail.archived !== "boolean"
      ) return;
      setArchived(detail.archived);
    },
  );

  // Every shortcut to Quick capture for this person, the hero's included.
  useLayoutEffect(() => {
    for (
      const button of document.querySelectorAll<HTMLButtonElement>(SHORTCUT)
    ) {
      const kind = button.dataset.interactionIntendedKind;
      const off = (kind === "activity" && hidden.activities) ||
        (kind === "note" && hidden.notes);
      // Quick capture's observer sees the change and writes `disabled`.
      button.hidden = archived || off;
    }
  }, [archived, hidden.activities, hidden.notes]);

  const card = (kind: InteractionKind, section: HTMLElement) => (
    <InteractionCard
      hidden={kind === "activity" ? hidden.activities : hidden.notes}
      kind={kind}
      onSettled={onCardSettled}
      personId={personId}
      section={section}
      statusRegion={props.statusRegion}
      total={kind === "activity"
        ? props.totals?.activities
        : props.totals?.notes}
      workspaceId={props.workspaceId}
    />
  );

  return (
    <>
      {card("activity", sections.activities)}
      {createPortal(card("note", sections.notes), sections.notes)}
    </>
  );
}

function InteractionCard(
  props: {
    readonly kind: InteractionKind;
    readonly hidden: boolean;
    readonly personId: string;
    readonly workspaceId: string;
    readonly section: HTMLElement;
    readonly onSettled: () => void;
    readonly statusRegion?: StatusRegionProps | undefined;
    readonly total?: number | undefined;
  },
) {
  const { kind, personId, section, workspaceId } = props;
  const wording = CARDS[kind];
  const [state, dispatch] = useReducer(
    recentCardReducer,
    undefined,
    () => initialRecentCard(props.hidden, props.total),
  );
  const current = useRef(state);
  useLayoutEffect(() => {
    current.current = state;
  }, [state]);
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);

  const read = useCallback(
    (): Promise<void> =>
      request(() =>
        getActivityReport(personId, { kind, limit: RECENT }, workspaceId)
      ).then((answer) => {
        if (!answer) return;
        dispatch(
          answer.status === "ready" && answer.data
            ? {
              count: answer.data.items.filter((item) => item.kind === kind)
                .length,
              type: "loaded",
            }
            : { type: "failed" },
        );
      }),
    [kind, personId, request, workspaceId],
  );

  const load = useCallback(() => {
    dispatch({ type: "loading" });
    void read();
  }, [read]);

  // The first read starts in the loading state the card mounted with; a
  // card counted empty or hidden has nothing to read.
  const firstRead = useEffectEvent(() =>
    current.current.status === "loading" ? read() : Promise.resolve()
  );
  useEffect(() => {
    void firstRead().finally(() => settled.current());
  }, []);

  // A recorded interaction is counted on its card, which reads again only
  // when the record alone cannot say what it now holds (FEQ-10).
  const created = useEffectEvent((detail: unknown) => {
    const event = {
      detail,
      kind,
      limit: RECENT,
      personId,
      type: "created",
    } as const;
    const next = recentCardReducer(current.current, event);
    if (next === current.current) return;
    if (next.status === "loading") load();
    else dispatch(event);
  });
  const hidden = props.hidden;
  useEffect(() => {
    if (hidden) return;
    const onCreated = (event: Event) =>
      created((event as CustomEvent<unknown>).detail);
    globalThis.addEventListener(INTERACTION_CREATED_EVENT, onCreated);
    return () =>
      globalThis.removeEventListener(INTERACTION_CREATED_EVENT, onCreated);
  }, [hidden]);

  useLayoutEffect(() => {
    section.setAttribute("data-section-state", state.status);
    section.toggleAttribute("hidden", state.status === "hidden");
  }, [section, state.status]);

  const listId = `${wording.prefix}-list`;
  return (
    <>
      <header className="profile-section-heading">
        <SectionGlyph
          className="profile-section-glyph"
          name={wording.section}
        />
        <div className="profile-section-title">
          <h3 id={`profile-section-${wording.section}-heading`}>
            {wording.title}
          </h3>
        </div>
        {
          /* Quick capture enables it once wired; `PersonInteractions` shows
            or hides it with the hero's. */
        }
        <button
          className={buttonVariants({ className: "profile-section-cta" })}
          data-interaction-capture-ready="false"
          data-interaction-intended-kind={kind}
          data-person-interaction-capture=""
          data-quick-capture=""
          disabled
          type="button"
        >
          {wording.action}
        </button>
      </header>
      <p
        className="section-state"
        id={`${wording.prefix}-state`}
        {...props.statusRegion}
      >
        {state.status === "loading"
          ? state.initial
            ? <SectionLoading label={wording.loading} />
            : wording.loading
          : state.status === "hidden"
          ? wording.hidden
          : state.status === "error"
          ? wording.failed
          : state.count === 0
          ? wording.empty
          : wording.count(state.count)}
      </p>
      {/* The records are listed in the timeline; this list stays empty. */}
      <ul
        aria-label={`Recent ${wording.section}`}
        className="interaction-list"
        hidden
        id={listId}
      />
      <Button
        aria-controls={listId}
        hidden={state.status !== "error"}
        id={`${wording.prefix}-retry`}
        onClick={load}
        type="button"
        variant="outline"
      >
        Retry {wording.section}
      </Button>
      {kind === "activity"
        ? (
          <div className="profile-section-footer">
            <a
              className={buttonVariants({ variant: "outline" })}
              data-activity-report-link=""
              href={`/app/people/${
                encodeURIComponent(personId)
              }/activity-report`}
            >
              Open activity report
            </a>
          </div>
        )
        : null}
    </>
  );
}
