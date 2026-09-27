/**
 * Today's attention queue and upcoming work as one island (GAP-033).
 *
 * `pages/app.astro` draws the queue's section, the Upcoming section, and the
 * heading's date; `mountTodayAttention` renders this island over the queue's
 * section and portals the Upcoming list and the date into the places the page
 * reserved for them, because one read (`GET /today/attention`) answers all
 * three. That read goes through one latest-request slot: the first load,
 * each region's retry, a recorded reconnect, and the refresh after a
 * completion all ask it, and whichever answer lands last settles every region
 * still loading (`attention.ts`, REL-048). The session, the snapshot, and the
 * member's time preferences are read inside that one request.
 *
 * Complete calls the tasks module's own completion use case, the same one the
 * person and global task surfaces use, and tells them with
 * `TASK_CHANGED_EVENT`. Every control renders with its handler attached.
 */

import {
  type ReactNode,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import {
  type ApiResult,
  getTodayAttention,
  setTaskCompletion,
  type TodayAttentionItem,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  badgeVariants,
  buttonVariants,
  formActionsVariants,
} from "@/components/ui/variants.ts";
import {
  mountIsland,
  settle,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import {
  loadTimePreferences,
  type TimePreferences,
} from "../../../lib/time-presentation.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import { TODAY_RECONNECT_RECORDED_EVENT } from "../../interactions/shared.ts";
import { TASK_CHANGED_EVENT } from "../../tasks/tasks.ts";
import {
  type AttentionAnswer,
  attentionDestination,
  type AttentionFocus,
  attentionMeta,
  attentionReducer,
  type AttentionRegion,
  attentionView,
  completable,
  initialAttentionState,
  upcomingMeta,
} from "./attention.ts";

export const TODAY_ATTENTION_ISLAND = "today-attention";

const BOTH: readonly AttentionRegion[] = ["attention", "upcoming"];

/** The one read: the session's workspace, its snapshot, and preferences. */
async function readAttention(): Promise<ApiResult<AttentionAnswer>> {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") throw new Error("No workspace session");
  const workspaceId = session.session.workspace.id;
  const principalId = session.session.principal.userId;
  const [snapshot, preferences] = await Promise.all([
    getTodayAttention(workspaceId),
    loadTimePreferences(workspaceId),
  ]);
  return snapshot.ok
    ? {
      ok: true,
      value: {
        preferences,
        principalId,
        snapshot: snapshot.value,
        workspaceId,
      },
    }
    : snapshot;
}

function Title(props: { readonly item: TodayAttentionItem }) {
  const { item } = props;
  const href = attentionDestination(item);
  if (!href) return <p className="attention-title">{item.title}</p>;
  return (
    <a
      className="attention-title today-touch-target"
      {...(item.kind === "task" ? { "data-task-id": item.id } : {})}
      href={href}
    >
      {item.title}
    </a>
  );
}

export interface TodayAttentionProps {
  /** Where the Upcoming status, list, and actions render. */
  readonly upcoming: HTMLElement;
  /** Where the heading's date renders. */
  readonly date: HTMLElement;
  /** Called once, when the first read has settled either way. */
  readonly onSettled?: () => void;
}

export function TodayAttention(props: TodayAttentionProps) {
  const [state, dispatch] = useReducer(
    attentionReducer,
    initialAttentionState,
  );
  const request = useLatestRequest();
  const completing = useRef(false);
  const settled = useRef(props.onSettled);
  const attentionStatus = useRef<HTMLParagraphElement>(null);
  const upcomingStatus = useRef<HTMLParagraphElement>(null);
  const groups = useRef<HTMLDivElement>(null);
  const view = attentionView(state);

  const read = async (
    regions: readonly AttentionRegion[],
    focus?: AttentionFocus,
  ): Promise<void> => {
    dispatch({ regions, type: "read", ...(focus ? { focus } : {}) });
    const answer = await request(readAttention);
    if (!answer) return;
    dispatch({
      answer: answer.status === "ready" ? answer.data : undefined,
      type: "answered",
    });
    settled.current?.();
    settled.current = undefined;
  };

  const first = useEffectEvent(() => void read(BOTH));
  useEffect(() => first(), []);

  const reconnected = useEffectEvent(() => void read(BOTH));
  useEffect(() => {
    const listener = () => reconnected();
    globalThis.addEventListener(TODAY_RECONNECT_RECORDED_EVENT, listener);
    return () =>
      globalThis.removeEventListener(TODAY_RECONNECT_RECORDED_EVENT, listener);
  }, []);

  useLayoutEffect(() => {
    const target = state.focus?.target;
    if (target === undefined) return;
    if (target === "attention") attentionStatus.current?.focus();
    else if (target === "upcoming") upcomingStatus.current?.focus();
    else {
      const control = [
        ...groups.current?.querySelectorAll<HTMLButtonElement>(
          "button[data-today-complete]",
        ) ?? [],
      ].find((button) =>
        button.dataset.taskId === target.taskId && !button.disabled
      );
      (control ?? attentionStatus.current)?.focus();
    }
  }, [state.focus]);

  const retry = (region: AttentionRegion) => {
    if (state.completion?.phase === "pending") return;
    void read([region], region);
  };

  const complete = async (taskId: string) => {
    if (completing.current || state.completion) return;
    completing.current = true;
    dispatch({ taskId, type: "complete" });
    const answer = await settle(() =>
      setTaskCompletion(taskId, true, state.workspaceId)
    );
    completing.current = false;
    if (answer.status !== "ready") {
      dispatch({ type: "completion-failed" });
      return;
    }
    dispatch({ type: "completion-confirmed" });
    globalThis.dispatchEvent(new CustomEvent(TASK_CHANGED_EVENT));
    await read(BOTH, "attention");
  };

  const preferences: TimePreferences | undefined = state.preferences;
  const attentionRow = (item: TodayAttentionItem) => (
    <li
      className={`attention-item attention-${item.kind}`}
      hidden={view.hiddenTaskId === item.id}
      key={`${item.kind}:${item.id}`}
    >
      <Title item={item} />
      <p>{attentionMeta(item, preferences)}</p>
      {completable(item)
        ? (
          <div className={formActionsVariants()}>
            <button
              className={buttonVariants({ variant: "outline" })}
              data-task-id={item.id}
              data-today-complete=""
              disabled={view.completeDisabled}
              onClick={() => void complete(item.id)}
              type="button"
            >
              Complete
            </button>
          </div>
        )
        : null}
    </li>
  );
  const group = (
    key: "overdue" | "today" | "nextSevenDays",
    id: string,
    headingId: string,
    heading: string,
  ): ReactNode => (
    <section aria-labelledby={headingId}>
      <h3 id={headingId}>{heading}</h3>
      <ul className="task-list" id={id}>
        {state.attention.value?.[key].map(attentionRow)}
      </ul>
    </section>
  );

  return (
    <>
      <div className="section-heading">
        <div>
          <p className="section-kicker">Current priorities</p>
          <h2 id="attention-heading">Needs attention</h2>
        </div>
        <span className={badgeVariants()}>Overdue · today · next 7 days</span>
      </div>
      <p
        aria-live="polite"
        className="section-state"
        id="today-attention-state"
        ref={attentionStatus}
        role="status"
        tabIndex={-1}
      >
        {view.attentionStatus}
      </p>
      <div className="attention-groups" ref={groups}>
        {group(
          "overdue",
          "today-overdue-list",
          "today-overdue-heading",
          "Overdue",
        )}
        {group("today", "today-due-today-list", "today-due-heading", "Today")}
        {group(
          "nextSevenDays",
          "today-next-seven-list",
          "today-next-seven-heading",
          "Next 7 days",
        )}
      </div>
      <div hidden={!view.onboarding} id="today-onboarding">
        <p>Build the context that will make Kinship useful:</p>
        <ol className="success-loop">
          <li>
            <strong>Add a person or start an import.</strong>
            <span>
              People creation and import arrive in their cataloged delivery
              slices.
            </span>
          </li>
          <li>
            <strong>Record the first interaction or note.</strong>
            <span>Keep the context you want to remember.</span>
          </li>
          <li>
            <strong>Create a task, reminder, or stay-in-touch cadence.</strong>
            <span>Planning work appears here when it becomes due.</span>
          </li>
        </ol>
      </div>
      <button
        className={buttonVariants({ variant: "outline", wrap: true })}
        hidden={!view.attentionRetry}
        id="today-attention-retry"
        onClick={() => retry("attention")}
        type="button"
      >
        Retry attention
      </button>
      <p className="projection-note">
        Task completion here uses the same planning action as the person and
        global task surfaces.
      </p>
      {createPortal(
        <>
          <p
            aria-live="polite"
            className="section-state"
            id="today-upcoming-state"
            ref={upcomingStatus}
            role="status"
            tabIndex={-1}
          >
            {view.upcomingStatus}
          </p>
          <ul
            aria-label="Upcoming relationship work"
            className="task-list"
            id="today-upcoming-list"
          >
            {state.upcoming.value?.map((item) => (
              <li
                className={`attention-item attention-${item.kind}`}
                key={`${item.kind}:${item.id}`}
              >
                <Title item={item} />
                <p>{upcomingMeta(item, preferences)}</p>
              </li>
            ))}
          </ul>
          <div className={formActionsVariants()}>
            <button
              className={buttonVariants({ variant: "outline", wrap: true })}
              hidden={!view.upcomingRetry}
              id="today-upcoming-retry"
              onClick={() => retry("upcoming")}
              type="button"
            >
              Retry upcoming
            </button>
            <a
              className={buttonVariants({ variant: "outline", wrap: true })}
              href="/app/tasks"
            >
              Open all tasks
            </a>
          </div>
        </>,
        props.upcoming,
      )}
      {createPortal(
        <time data-today-date="" dateTime={view.date.dateTime}>
          {view.date.text}
        </time>,
        props.date,
      )}
    </>
  );
}

/**
 * Mounts the queue over the section `pages/app.astro` drew and resolves, once
 * its first read has settled, with the function that unmounts it. Without the
 * section, the Upcoming slot, and the date slot there is nothing to own.
 */
export function mountTodayAttention(
  root: ParentNode = document,
): Promise<() => void> {
  const section = root.querySelector<HTMLElement>("[data-today-attention]");
  const upcoming = root.querySelector<HTMLElement>("[data-today-upcoming]");
  const date = root.querySelector<HTMLElement>("[data-today-date-root]");
  if (!section || !upcoming || !date) return Promise.resolve(() => undefined);
  // The portals replace the page's loading copy in the same task.
  upcoming.replaceChildren();
  date.replaceChildren();
  return new Promise((resolve) => {
    const unmount = mountIsland(
      section,
      TODAY_ATTENTION_ISLAND,
      <TodayAttention
        date={date}
        onSettled={() => resolve(unmount)}
        upcoming={upcoming}
      />,
    );
  });
}
