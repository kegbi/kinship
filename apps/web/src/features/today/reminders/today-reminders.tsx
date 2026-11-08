/**
 * Today's "People to reconnect" section as one island (GAP-033): the
 * stay-in-touch cadences due for contact and the reminder delivery states
 * beneath them, both from `GET /today/reminders` through one latest-request
 * slot (`reminders.ts`).
 *
 * Each cadence of an active person offers "Log interaction", a Quick capture
 * opener that names the person. Quick capture owns whether an opener works:
 * it renders disabled with `data-interaction-capture-ready="false"` and Quick
 * capture enables it once wired (REL-039). When Quick capture saves the
 * reconnect it sends `TODAY_RECONNECT_RECORDED_EVENT`, and this section reads
 * the cadences again and moves focus to their status. When the attention
 * queue dismisses an undelivered reminder it sends
 * `REMINDER_ACKNOWLEDGED_EVENT`, and this section reads its reminders again
 * without moving focus (REL-088).
 */

import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useReducer,
  useRef,
} from "react";
import {
  type ApiResult,
  getTodayReminders,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { badgeVariants, buttonVariants } from "@/components/ui/variants.ts";
import { mountIsland, useLatestRequest } from "../../../islands/core/index.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import { TODAY_RECONNECT_RECORDED_EVENT } from "../../interactions/shared.ts";
import { REMINDER_ACKNOWLEDGED_EVENT } from "../regions.ts";
import {
  cadenceLine,
  initialRemindersState,
  reminderLine,
  type RemindersAnswer,
  remindersReducer,
  type RemindersRegion,
  remindersView,
} from "./reminders.ts";

export const TODAY_REMINDERS_ISLAND = "today-reminders";

const BOTH: readonly RemindersRegion[] = ["reminder", "cadence"];

async function readReminders(): Promise<ApiResult<RemindersAnswer>> {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") throw new Error("No workspace session");
  const workspaceId = session.session.workspace.id;
  const value = await getTodayReminders(workspaceId);
  const preferences = session.session.preferences;
  return value.ok
    ? { ok: true, value: { preferences, value: value.value } }
    : value;
}

const wrapping = buttonVariants({ variant: "outline", wrap: true });

export function TodayReminders(props: { readonly onSettled?: () => void }) {
  const [state, dispatch] = useReducer(
    remindersReducer,
    initialRemindersState,
  );
  const request = useLatestRequest();
  const settled = useRef(props.onSettled);
  const reminderStatus = useRef<HTMLParagraphElement>(null);
  const cadenceStatus = useRef<HTMLParagraphElement>(null);
  const view = remindersView(state);

  const read = async (
    regions: readonly RemindersRegion[],
    focus?: RemindersRegion,
  ): Promise<void> => {
    dispatch({ regions, type: "read", ...(focus ? { focus } : {}) });
    const answer = await request(readReminders);
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

  const reconnected = useEffectEvent(() => void read(["cadence"], "cadence"));
  useEffect(() => {
    const listener = () => reconnected();
    globalThis.addEventListener(TODAY_RECONNECT_RECORDED_EVENT, listener);
    return () =>
      globalThis.removeEventListener(TODAY_RECONNECT_RECORDED_EVENT, listener);
  }, []);

  const acknowledged = useEffectEvent(() => void read(["reminder"]));
  useEffect(() => {
    const listener = () => acknowledged();
    globalThis.addEventListener(REMINDER_ACKNOWLEDGED_EVENT, listener);
    return () =>
      globalThis.removeEventListener(REMINDER_ACKNOWLEDGED_EVENT, listener);
  }, []);

  useLayoutEffect(() => {
    const target = state.focus?.target;
    if (target === "reminder") reminderStatus.current?.focus();
    else if (target === "cadence") cadenceStatus.current?.focus();
  }, [state.focus]);

  const { preferences } = state;
  return (
    <>
      <div className="section-heading">
        <h2 id="reconnect-heading">People to reconnect</h2>
        <span className={badgeVariants({ variant: "secondary" })}>
          Stay-in-touch cadence
        </span>
      </div>
      <p
        aria-live="polite"
        className="section-state"
        id="today-cadences-state"
        ref={cadenceStatus}
        role="status"
        tabIndex={-1}
      >
        {view.cadenceStatus}
      </p>
      <ul
        aria-label="People due for contact"
        className="task-list"
        id="today-cadences-list"
      >
        {state.cadence.value?.map((item) => (
          <li key={item.id}>
            <a
              className="today-touch-target"
              href={`/app/people/${
                encodeURIComponent(item.person.id)
              }?section=stay-in-touch`}
            >
              {item.person.name}
            </a>
            <p>{cadenceLine(item, preferences)}</p>
            {item.person.archived ? null : (
              // Quick capture enables it once wired, and handles its click.
              <button
                className={wrapping}
                data-interaction-capture-ready="false"
                data-interaction-intended-kind="activity"
                data-interaction-person-id={item.person.id}
                data-quick-capture=""
                data-today-reconnect-capture=""
                disabled
                type="button"
              >
                Log interaction
              </button>
            )}
          </li>
        ))}
      </ul>
      <button
        className={wrapping}
        hidden={!view.cadenceRetry}
        id="today-cadences-retry"
        onClick={() => void read(["cadence"], "cadence")}
        type="button"
      >
        Retry reconnect suggestions
      </button>
      <div
        aria-labelledby="reminder-delivery-heading"
        className="reminder-delivery-state"
      >
        <h3 id="reminder-delivery-heading">Reminder delivery state</h3>
        <p
          aria-live="polite"
          className="section-state"
          id="today-reminders-state"
          ref={reminderStatus}
          role="status"
          tabIndex={-1}
        >
          {view.reminderStatus}
        </p>
        <ul
          aria-label="Reminder delivery states"
          className="task-list"
          id="today-reminders-list"
        >
          {state.reminder.value?.map((item) => (
            <li
              className={`reminder-item reminder-${item.status}`}
              key={item.id}
            >
              <a
                className="today-touch-target"
                href={`/app/people/${
                  encodeURIComponent(item.person.id)
                }?section=reminders`}
              >
                {`${item.title} · ${item.person.name}`}
              </a>
              <p>{reminderLine(item, preferences)}</p>
            </li>
          ))}
        </ul>
      </div>
      <button
        className={wrapping}
        hidden={!view.reminderRetry}
        id="today-reminders-retry"
        onClick={() => void read(["reminder"], "reminder")}
        type="button"
      >
        Retry reminder state
      </button>
    </>
  );
}

/**
 * Mounts the section over the one `pages/app.astro` drew and resolves, once
 * its first read has settled, with the function that unmounts it.
 */
export function mountTodayReminders(
  root: ParentNode = document,
): Promise<() => void> {
  const section = root.querySelector<HTMLElement>("[data-today-reminders]");
  if (!section) return Promise.resolve(() => undefined);
  return new Promise((resolve) => {
    const unmount = mountIsland(
      section,
      TODAY_REMINDERS_ISLAND,
      <TodayReminders onSettled={() => resolve(unmount)} />,
    );
  });
}
