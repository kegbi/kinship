/**
 * Today's "Recently viewed people" (GAP-033): the return paths the people
 * module records when a person is opened, as one island over the section
 * `pages/app.astro` drew, with one latest-request slot.
 *
 * The section carries its state in `data-region-state` (`loading`, `ready`,
 * `empty`, or `error`) and its badge says the same in words. A retry moves
 * focus to the status once its answer lands.
 */

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  getTodayRecentPeople,
  type TodayRecentPeople,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { badgeVariants, buttonVariants } from "@/components/ui/variants.ts";
import {
  mountIsland,
  type Settled,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import { TodayPlaceholder } from "../today-placeholder.tsx";

export const TODAY_RECENT_PEOPLE_ISLAND = "today-recent-people";

type People = TodayRecentPeople["people"];

interface RecentPeopleState {
  readonly status: "loading" | "ready" | "no-session" | "failed";
  readonly people: People;
  /**
   * Whether a read has answered with the list, so a loading region holds its
   * place with a placeholder only while it has shown nothing (FER-06).
   */
  readonly loaded?: boolean;
  /** Bumped by each retry's answer, so focus follows it. */
  readonly focus: number;
}

type RecentPeopleAction =
  | { readonly type: "loading" }
  | {
    readonly type: "answered";
    readonly answer: Settled<People | undefined>;
    /** Whether the reader asked, so focus follows the answer. */
    readonly focus: boolean;
  };

function recentPeopleReducer(
  state: RecentPeopleState,
  action: RecentPeopleAction,
): RecentPeopleState {
  if (action.type === "loading") return { ...state, status: "loading" };
  const { answer } = action;
  return {
    focus: state.focus + (action.focus ? 1 : 0),
    loaded: state.loaded || (answer.status === "ready" && !!answer.data),
    people: answer.data ?? state.people,
    status: answer.status !== "ready"
      ? "failed"
      : answer.data
      ? "ready"
      : "no-session",
  };
}

function describe(state: RecentPeopleState) {
  const count = state.people.length;
  switch (state.status) {
    case "loading":
      return {
        badge: "Loading",
        region: "loading",
        text: "Loading recently viewed people…",
      };
    case "no-session":
      return {
        badge: "Unavailable",
        region: "error",
        text: "Recently viewed people could not be loaded.",
      };
    case "failed":
      return {
        badge: "Unavailable",
        region: "error",
        text:
          "Recently viewed people could not be loaded. Other Today regions are still available.",
      };
    case "ready":
      return count === 0
        ? {
          badge: "Empty",
          region: "empty",
          text:
            "No recently viewed people yet. Open a person to create a return path.",
        }
        : {
          badge: `${count} recent`,
          region: "ready",
          text: `${count} recently viewed ${
            count === 1 ? "person" : "people"
          }.`,
        };
  }
}

export function TodayRecentPeopleList(
  props: { readonly section: HTMLElement; readonly onSettled?: () => void },
) {
  const { section } = props;
  const [state, dispatch] = useReducer(recentPeopleReducer, {
    focus: 0,
    people: [],
    status: "loading",
  });
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);
  const status = useRef<HTMLParagraphElement>(null);

  const read = async (focus: boolean): Promise<void> => {
    dispatch({ type: "loading" });
    const answer = await request<People | undefined>(async () => {
      const session = await resolveWorkspaceSession();
      if (session.status !== "ready") return { ok: true, value: undefined };
      const result = await getTodayRecentPeople(session.session.workspace.id);
      return result.ok ? { ok: true, value: result.value.people } : result;
    });
    if (!answer) return;
    dispatch({ answer, focus, type: "answered" });
    settled.current?.();
    settled.current = undefined;
  };

  const first = useEffectEvent(() => void read(false));
  useEffect(() => first(), []);

  const view = describe(state);
  useLayoutEffect(() => {
    section.setAttribute("data-region-state", view.region);
  }, [section, view.region]);
  useLayoutEffect(() => {
    if (state.focus > 0) status.current?.focus();
  }, [state.focus]);

  const failed = state.status === "failed" || state.status === "no-session";
  return (
    <>
      <div className="section-heading">
        <h2 id="recent-people-heading">Recently viewed people</h2>
        <span
          className={badgeVariants({ variant: "secondary" })}
          id="today-recent-people-badge"
        >
          {view.badge}
        </span>
      </div>
      <p
        aria-live="polite"
        className="section-state"
        id="today-recent-people-state"
        ref={status}
        role="status"
        tabIndex={-1}
      >
        {view.text}
      </p>
      <ul
        aria-label="Recently viewed people"
        className="task-list"
        id="today-recent-people-list"
      >
        {state.people.map((person) => (
          <li key={person.id}>
            <a
              className={buttonVariants({ variant: "outline", wrap: true })}
              href={`/app/people/${encodeURIComponent(person.id)}`}
            >
              {person.name}
            </a>
            {person.archived
              ? (
                <span className={badgeVariants({ variant: "secondary" })}>
                  Archived
                </span>
              )
              : null}
          </li>
        ))}
      </ul>
      {state.status === "loading" && !state.loaded && (
        <TodayPlaceholder kind="recent-people" />
      )}
      <button
        className={buttonVariants({ variant: "outline", wrap: true })}
        hidden={!failed}
        id="today-recent-people-retry"
        onClick={() => void read(true)}
        type="button"
      >
        Retry recent people
      </button>
    </>
  );
}

/**
 * Mounts the section over the one `pages/app.astro` drew and resolves, once
 * its first read has settled, with the function that unmounts it.
 */
export function mountTodayRecentPeople(
  root: ParentNode = document,
): Promise<() => void> {
  const section = root.querySelector<HTMLElement>(
    "#today-recent-people-region",
  );
  if (!section) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    const unmount = mountIsland(
      section,
      TODAY_RECENT_PEOPLE_ISLAND,
      <TodayRecentPeopleList
        onSettled={() => resolve(unmount)}
        section={section}
      />,
    );
  });
}
