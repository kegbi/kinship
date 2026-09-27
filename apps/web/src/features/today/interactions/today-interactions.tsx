/**
 * Today's favorite notes and recent activity (GAP-033): two read-only
 * projections of the interactions module, each its own island over the
 * section `pages/app.astro` drew, each with one latest-request slot.
 *
 * Both refresh when Quick capture announces a saved interaction
 * (`INTERACTION_CREATED_EVENT`): recent activity always, favorite notes
 * unless what was saved is an activity, which cannot be a favorite note. The
 * favorite-notes section hides while it has nothing to show and a read
 * confirmed it; a failed read keeps the rows the reader had.
 */

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  type ActivityOrNoteInteraction,
  type ApiResult,
  getTodayFavoriteNotes,
  getTodayRecentActivity,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { badgeVariants, buttonVariants } from "@/components/ui/variants.ts";
import {
  mountIsland,
  type Settled,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import {
  loadTimePreferences,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import { InteractionEntry } from "../../interactions/interaction-entry.tsx";
import { INTERACTION_CREATED_EVENT } from "../../interactions/shared.ts";

export const TODAY_FAVORITE_NOTES_ISLAND = "today-favorite-notes";
export const TODAY_RECENT_ACTIVITY_ISLAND = "today-recent-activity";

type Projection = "favorites" | "recent";

interface Wording {
  readonly island: string;
  readonly prefix: string;
  readonly heading: string;
  readonly headingId: string;
  readonly badge: string;
  readonly label: string;
  readonly loading: string;
  readonly noSession: string;
  readonly failed: string;
  readonly retry: string;
  readonly count: (count: number) => string;
  readonly read: (
    workspaceId: string,
  ) => Promise<
    ApiResult<{ readonly items: readonly ActivityOrNoteInteraction[] }>
  >;
}

const WORDING: Readonly<Record<Projection, Wording>> = {
  favorites: {
    badge: "Reference",
    count: (count) => `${count} favorite note${count === 1 ? "" : "s"}.`,
    failed: "Favorite notes could not be loaded. Recent activity is unchanged.",
    heading: "Favorite notes",
    headingId: "favorite-notes-heading",
    island: TODAY_FAVORITE_NOTES_ISLAND,
    label: "Favorite notes",
    loading: "Loading favorite notes…",
    noSession: "Favorite notes are unavailable.",
    prefix: "today-favorite-notes",
    read: getTodayFavoriteNotes,
    retry: "Retry favorite notes",
  },
  recent: {
    badge: "Latest 20",
    count: (count) =>
      count === 0
        ? "No activities or notes recorded yet."
        : `${count} recent interaction${count === 1 ? "" : "s"}.`,
    failed:
      "Recent activity could not be loaded. Favorite notes are unchanged.",
    heading: "Recent activity",
    headingId: "activity-heading",
    island: TODAY_RECENT_ACTIVITY_ISLAND,
    label: "Recent activities and notes",
    loading: "Loading recent activity…",
    noSession: "Recent activity is unavailable.",
    prefix: "today-recent-activity",
    read: getTodayRecentActivity,
    retry: "Retry recent activity",
  },
};

interface Loaded {
  readonly items: readonly ActivityOrNoteInteraction[];
  readonly preferences: TimePreferences | undefined;
}

interface ProjectionState {
  readonly status: "loading" | "ready" | "failed" | "no-session";
  readonly loaded?: Loaded | undefined;
}

type ProjectionAction =
  | { readonly type: "loading" }
  | {
    readonly type: "answered";
    readonly answer: Settled<Loaded | undefined>;
  };

/** A read replaces the rows; a failed one keeps what the reader had. */
function projectionReducer(
  state: ProjectionState,
  action: ProjectionAction,
): ProjectionState {
  if (action.type === "loading") return { ...state, status: "loading" };
  const { answer } = action;
  if (answer.status !== "ready") return { ...state, status: "failed" };
  return answer.data
    ? { loaded: answer.data, status: "ready" }
    : { ...state, status: "no-session" };
}

export function TodayInteractions(
  props: {
    readonly projection: Projection;
    readonly section: HTMLElement;
    readonly onSettled?: () => void;
  },
) {
  const wording = WORDING[props.projection];
  const { section } = props;
  const [state, dispatch] = useReducer(projectionReducer, {
    status: "loading",
  });
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);

  const read = async (): Promise<void> => {
    dispatch({ type: "loading" });
    const answer = await request<Loaded | undefined>(async () => {
      const session = await resolveWorkspaceSession();
      if (session.status !== "ready") return { ok: true, value: undefined };
      const workspaceId = session.session.workspace.id;
      const [result, preferences] = await Promise.all([
        wording.read(workspaceId),
        loadTimePreferences(workspaceId),
      ]);
      return result.ok
        ? { ok: true, value: { items: result.value.items, preferences } }
        : result;
    });
    if (!answer) return;
    dispatch({ answer, type: "answered" });
    settled.current?.();
    settled.current = undefined;
  };

  const first = useEffectEvent(() => void read());
  useEffect(() => first(), []);

  const created = useEffectEvent((event: Event) => {
    const kind = (event as CustomEvent<{ readonly kind?: unknown }>).detail
      ?.kind;
    if (props.projection === "favorites" && kind === "activity") return;
    void read();
  });
  useEffect(() => {
    const listener = (event: Event) => created(event);
    globalThis.addEventListener(INTERACTION_CREATED_EVENT, listener);
    return () =>
      globalThis.removeEventListener(INTERACTION_CREATED_EVENT, listener);
  }, []);

  const count = state.loaded?.items.length ?? 0;
  const empty = state.status === "ready" && count === 0;
  useLayoutEffect(() => {
    if (props.projection === "favorites") {
      section.toggleAttribute("hidden", empty);
    }
  }, [empty, props.projection, section]);

  const line = state.status === "loading"
    ? wording.loading
    : state.status === "no-session"
    ? wording.noSession
    : state.status === "failed"
    ? wording.failed
    : wording.count(count);
  return (
    <>
      <div className="section-heading">
        <h2 id={wording.headingId}>{wording.heading}</h2>
        <span className={badgeVariants({ variant: "secondary" })}>
          {wording.badge}
        </span>
      </div>
      <p
        aria-live="polite"
        className="section-state"
        id={`${wording.prefix}-state`}
      >
        {line}
      </p>
      <ul
        aria-label={wording.label}
        className="interaction-list"
        id={props.projection === "favorites"
          ? "today-favorite-notes"
          : "today-recent-activity"}
      >
        {state.loaded?.items.map((entry) => (
          <InteractionEntry
            entry={entry}
            key={`${entry.kind}:${entry.id}`}
            preferences={state.loaded?.preferences}
          />
        ))}
      </ul>
      <button
        className={buttonVariants({ variant: "outline", wrap: true })}
        hidden={state.status !== "failed" && state.status !== "no-session"}
        id={`${wording.prefix}-retry`}
        onClick={() => void read()}
        type="button"
      >
        {wording.retry}
      </button>
    </>
  );
}

function mountProjection(
  root: ParentNode,
  projection: Projection,
): Promise<() => void> {
  const section = root.querySelector<HTMLElement>(
    `#${WORDING[projection].prefix}-region`,
  );
  if (!section) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    const unmount = mountIsland(
      section,
      WORDING[projection].island,
      <TodayInteractions
        onSettled={() => resolve(unmount)}
        projection={projection}
        section={section}
      />,
    );
  });
}

/**
 * Mounts both projections over the sections `pages/app.astro` drew and
 * resolves, once both first reads have settled, with the function that
 * unmounts them.
 */
export async function mountTodayInteractions(
  root: ParentNode = document,
): Promise<() => void> {
  const unmounts = await Promise.all([
    mountProjection(root, "favorites"),
    mountProjection(root, "recent"),
  ]);
  return () => {
    for (const unmount of unmounts) unmount();
  };
}
