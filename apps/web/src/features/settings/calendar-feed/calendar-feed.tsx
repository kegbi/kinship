/**
 * The calendar feed section of the personal preferences page (GAP-052,
 * `INTEGRATION-002`): creating a member's read-only iCalendar subscription,
 * showing its link once, and rotating or revoking it.
 *
 * It is a personal setting, so it sits beside the reminder-delivery controls,
 * as its own island over its own region: it shares nothing with the
 * preferences form. One read owns the feed's status, and every change runs
 * one at a time: while one runs, every feed control is disabled, and the
 * answer is the new state, so nothing is read again. The link a change mints
 * lives only in this island's memory. Focus moves to the link once it is
 * shown, and to "Create calendar feed" once the feed is revoked, in the commit
 * that shows the change.
 */

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import { flushSync } from "react-dom";
import {
  type ApiResult,
  type CalendarFeedIssued,
  createCalendarFeed,
  getCalendarFeed,
  revokeCalendarFeed,
  rotateCalendarFeed,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { settle, useLatestRequest } from "../../../islands/core/index.ts";
import { mountSettingsSurface } from "../form/settings-form.tsx";
import { resolveSettingsContext } from "../shared/context.ts";
import {
  calendarFeedReducer,
  feedSummary,
  initialCalendarFeed,
} from "./calendar-feed.ts";

export const CALENDAR_FEED_ISLAND = "settings-calendar-feed";

export function CalendarFeedSettings(
  props: { readonly onSettled?: () => void },
) {
  const [state, dispatch] = useReducer(
    calendarFeedReducer,
    initialCalendarFeed,
  );
  const request = useLatestRequest();
  const workspace = useRef<string | undefined>(undefined);
  const busy = useRef(false);
  const settled = useRef(props.onSettled);
  const linkField = useRef<HTMLInputElement>(null);
  const createButton = useRef<HTMLButtonElement>(null);
  const rotateButton = useRef<HTMLButtonElement>(null);

  const first = useEffectEvent(async () => {
    const context = await resolveSettingsContext({ timePreferences: true });
    if (!context) {
      dispatch({
        message: "Your session could not be confirmed.",
        type: "failed",
      });
      return;
    }
    workspace.current = context.workspaceId;
    const answer = await request(() => getCalendarFeed(context.workspaceId));
    if (!answer) return;
    if (answer.status !== "ready" || !answer.data) {
      dispatch({
        message: answer.problem?.detail ??
          "Your calendar feed could not be loaded.",
        type: "failed",
      });
      return;
    }
    dispatch({
      feed: answer.data.feed,
      timePreferences: context.timePreferences,
      type: "loaded",
    });
  });
  useEffect(() => {
    void first().finally(() => {
      settled.current?.();
      settled.current = undefined;
    });
  }, []);

  // The one focus owner (REL-070): a layout effect moves focus in the same
  // commit that shows a change's outcome, so the new status and the new focus
  // arrive together. A passive effect ran later, whenever the scheduler got
  // to it, and under load the status was read before focus had moved.
  useLayoutEffect(() => {
    if (!state.focus) return;
    ({ create: createButton, rotate: rotateButton, url: linkField })[
      state.focus
    ].current?.focus();
    dispatch({ type: "focused" });
  }, [state.focus]);

  /**
   * Runs one feed change; the controls stay held until it answers. A refusal
   * with the `stale` status — what another window's change leaves behind —
   * reads the feed once more and shows it as it now is.
   */
  const change = async <T,>(
    message: string,
    call: (workspaceId: string) => Promise<ApiResult<T>>,
    landed: (value: T) => void,
    failed: string,
    stale: number,
  ) => {
    if (busy.current) return;
    const workspaceId = workspace.current!;
    busy.current = true;
    dispatch({ busy: true, message, type: "busy" });
    const result = await settle(() => call(workspaceId));
    if (result.status === "ready") {
      busy.current = false;
      landed(result.data as T);
      return;
    }
    if (result.problem?.status === stale) {
      const current = await settle(() => getCalendarFeed(workspaceId));
      busy.current = false;
      if (current.status === "ready" && current.data) {
        dispatch({ feed: current.data.feed, type: "changed-elsewhere" });
        return;
      }
    }
    busy.current = false;
    dispatch({ message: result.problem?.detail ?? failed, type: "failed" });
  };

  const issued = (value: CalendarFeedIssued) =>
    dispatch({
      feed: value.feed,
      status: value.status,
      type: "issued",
      url: value.url,
    });

  const create = () =>
    void change(
      "Creating calendar feed…",
      createCalendarFeed,
      issued,
      "The calendar feed could not be created.",
      409,
    );
  const rotate = () =>
    void change(
      "Rotating calendar feed link…",
      rotateCalendarFeed,
      issued,
      "The calendar feed link could not be rotated.",
      404,
    );
  const revoke = () =>
    void change(
      "Revoking calendar feed…",
      revokeCalendarFeed,
      () => dispatch({ type: "revoked" }),
      "The calendar feed could not be revoked.",
      404,
    );

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      dispatch({ message: "Link copied.", type: "status" });
    } catch {
      dispatch({
        message: "Copy failed. Select the link and copy it manually.",
        type: "status",
      });
    }
  };

  return (
    <>
      <header>
        <p className="scope-label">Your subscription</p>
        <h2 id="calendar-feed-heading">Calendar feed</h2>
      </header>
      <p>
        Subscribe to your important dates and reminders from any calendar app
        that accepts an iCalendar link. Only you can see or change this feed.
      </p>
      <p
        aria-live="polite"
        className="api-access-state"
        data-calendar-feed-state=""
        role="status"
      >
        {state.status}
      </p>
      {state.feed
        ? (
          <p data-calendar-feed-summary="">
            {feedSummary(state.feed, state.timePreferences)}
          </p>
        )
        : null}
      {state.url === undefined
        ? null
        : (
          <div className="api-secret-panel" data-calendar-feed-link="">
            <p>
              <strong>
                Anyone with this link can see the names, dates, and reminders in
                this feed.
              </strong>{" "}
              It is shown only once. Rotate the feed if the link is ever shared
              by mistake.
            </p>
            <div className="api-secret-control">
              <input
                aria-label="Calendar feed link"
                readOnly
                ref={linkField}
                value={state.url}
              />
              <button
                className={buttonVariants()}
                onClick={() => void copy(state.url)}
                type="button"
              >
                Copy link
              </button>
            </div>
            <button
              className={buttonVariants({ variant: "outline" })}
              onClick={() => {
                // The dismissed panel held the focus: committing inside this
                // click runs the focus owner, which hands it to "Rotate link"
                // before the click returns, as REL-051 asks of every island.
                flushSync(() => dispatch({ type: "dismissed" }));
              }}
              type="button"
            >
              I have saved it
            </button>
          </div>
        )}
      {state.phase !== "ready"
        ? null
        : state.feed
        ? (
          <div className="api-token-form" data-calendar-feed-actions="">
            <button
              className={buttonVariants()}
              disabled={state.busy}
              onClick={rotate}
              ref={rotateButton}
              type="button"
            >
              Rotate link
            </button>
            <button
              className={buttonVariants({ variant: "outline" })}
              disabled={state.busy}
              onClick={revoke}
              type="button"
            >
              Revoke feed
            </button>
          </div>
        )
        : (
          <div className="api-token-form" data-calendar-feed-actions="">
            <button
              className={buttonVariants()}
              disabled={state.busy}
              onClick={create}
              ref={createButton}
              type="button"
            >
              Create calendar feed
            </button>
          </div>
        )}
    </>
  );
}

/** Mounts the section over the region `preferences.astro` drew. */
export function mountCalendarFeed(
  root: ParentNode = document,
): Promise<() => void> {
  return mountSettingsSurface(
    root,
    "[data-calendar-feed-surface]",
    CALENDAR_FEED_ISLAND,
    (onSettled) => <CalendarFeedSettings onSettled={onSettled} />,
  );
}
