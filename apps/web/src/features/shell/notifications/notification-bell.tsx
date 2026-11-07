/**
 * The notification bell in the application header (GAP-053, `TODAY-002`).
 *
 * One small island in the header. Until the member first opens the panel,
 * `notification-count.ts` keeps the static bell's count without React
 * (FER-01); that first click loads this island, which takes the bell over
 * with the page the count last read and opens the panel once the session is
 * known. From then on it is the only owner of the bell: it reads the
 * member's notifications through one latest-request slot when it mounts,
 * when the panel opens, and once a minute while the page is visible, so only
 * the latest answer lands and no websocket is needed. The badge and the
 * button's accessible name carry the unread count.
 *
 * The panel is a Base UI popover: it opens from the bell, closes on Escape
 * or a click outside, and hands focus back to the bell. "Mark all read"
 * saves the newest shown item's time as the member's read-through watermark
 * through the `workspaces` interface-state route; once it is saved, the
 * panel's title takes focus from the button that just became disabled, and
 * the slot reads once more so an older read can never land afterwards.
 */

import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { Bell } from "lucide-react";
import {
  listNotifications,
  type NotificationsPage,
  saveMemberUiState,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { Button } from "@/components/ui/button.tsx";
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover.tsx";
import {
  mountIsland,
  settle,
  useLatestRequest,
} from "../../../islands/core/index.ts";
import { resolveWorkspaceSession } from "../../../lib/workspace-context.ts";
import {
  badgeText,
  bellLabel,
  initialNotifications,
  NOTIFICATION_REFRESH_MS,
  notificationsReducer,
  type NotificationsState,
  notificationText,
} from "./notifications.ts";

export const NOTIFICATION_BELL_ISLAND = "notification-bell";

const timeFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The contract guarantees a valid instant, so it always formats. */
function formatted(instant: string): string {
  return timeFormat.format(new Date(instant));
}

export interface NotificationBellProps {
  /** The page the static bell's count last read, shown until a new read. */
  readonly initialPage?: NotificationsPage | undefined;
  /** Opens the panel once the session is known: the click that loaded it. */
  readonly openOnReady?: boolean;
  /** The refresh interval; tests shorten it. */
  readonly refreshMs?: number;
}

function startingState(page: NotificationsPage | undefined) {
  return page
    ? notificationsReducer(initialNotifications, { page, type: "read-loaded" })
    : initialNotifications;
}

export function NotificationBell(props: NotificationBellProps) {
  const [state, dispatch] = useReducer(
    notificationsReducer,
    props.initialPage,
    startingState,
  );
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const opensOnReady = useRef(props.openOnReady === true);
  // The workspace the session resolved to; every read and save names it.
  const workspaceId = useRef<string | undefined>(undefined);
  const read = useLatestRequest();
  const title = useRef<HTMLHeadingElement>(null);

  /** Reads the first page through the one slot, once the session is known. */
  const refresh = async () => {
    const workspace = workspaceId.current;
    if (!workspace) return;
    dispatch({ type: "read-started" });
    const answer = await read(() => listNotifications(undefined, workspace));
    if (!answer) return;
    if (answer.status === "ready" && answer.data) {
      dispatch({ page: answer.data, type: "read-loaded" });
    } else {
      dispatch({ type: "read-failed" });
    }
  };

  /** Resolves the workspace, then reads the first page. */
  const begin = async (): Promise<void> => {
    const session = await resolveWorkspaceSession();
    if (session.status !== "ready") {
      dispatch({
        session: session.status === "access-lost" ? "gone" : "pending",
        type: "session",
      });
      return;
    }
    const workspace = session.session.workspace.id;
    workspaceId.current = workspace;
    dispatch({ session: "ready", type: "session" });
    await refresh();
  };
  const first = useEffectEvent(() => begin());
  useEffect(() => {
    void first();
  }, []);

  const tick = useEffectEvent(() => {
    if (document.visibilityState === "hidden") return;
    void refresh();
  });
  useEffect(() => {
    const timer = globalThis.setInterval(
      () => tick(),
      Math.max(props.refreshMs ?? NOTIFICATION_REFRESH_MS, 1),
    );
    return () => globalThis.clearInterval(timer);
  }, [props.refreshMs]);

  const changeOpen = (next: boolean) => {
    setOpen(next);
    if (next) void refresh();
  };

  // The click that loaded the island opens the panel from the bell, which
  // takes the focus first so closing the panel hands it back there.
  const openFromLoad = useEffectEvent(
    (session: NotificationsState["session"]) => {
      if (session !== "ready" || !opensOnReady.current) return;
      opensOnReady.current = false;
      trigger.current?.focus();
      setOpen(true);
    },
  );
  useEffect(() => openFromLoad(state.session), [state.session]);

  const markAllRead = async () => {
    // The button is enabled only over a page with unread items, once the
    // session is known and while nothing is saving.
    const newest = state.items[0]!;
    const workspace = workspaceId.current!;
    dispatch({ type: "mark-started" });
    const answer = await settle(() =>
      saveMemberUiState(
        { notificationsReadThrough: newest.occurredAt },
        workspace,
      )
    );
    if (answer.status !== "ready") {
      dispatch({
        detail: answer.problem?.detail ??
          "Notifications could not be marked read. Try again.",
        type: "mark-failed",
      });
      return;
    }
    dispatch({ type: "mark-saved" });
    title.current?.focus();
    await refresh();
  };

  if (state.session === "gone") return null;
  const badge = badgeText(state.unreadCount);
  return (
    <Popover onOpenChange={changeOpen} open={open}>
      <PopoverTrigger
        aria-label={bellLabel(state.unreadCount)}
        className="notification-bell-button"
        disabled={state.session !== "ready"}
        id="notification-bell-button"
        ref={trigger}
      >
        <Bell aria-hidden="true" className="notification-bell-icon" />
        <span className="desktop-action-label">Notifications</span>
        {badge
          ? (
            <span aria-hidden="true" className="notification-bell-badge">
              {badge}
            </span>
          )
          : null}
      </PopoverTrigger>
      <PopoverContent
        className="notification-panel"
        id="notification-panel"
        initialFocus={title}
      >
        <div className="notification-panel-header">
          <PopoverTitle
            ref={title}
            tabIndex={-1}
          >
            Notifications
          </PopoverTitle>
          <Button
            disabled={state.marking || state.unreadCount === 0 ||
              state.items.length === 0}
            onClick={() => void markAllRead()}
            type="button"
            variant="outline"
          >
            Mark all read
          </Button>
        </div>
        <p
          aria-live="polite"
          className="notification-panel-status"
          role="status"
        >
          {state.marking ? "Marking notifications read…" : state.notice}
        </p>
        {state.status === "error"
          ? (
            <div className="notification-panel-state" role="alert">
              <p>Notifications could not be loaded.</p>
              <Button
                onClick={() => void refresh()}
                type="button"
                variant="outline"
              >
                Try again
              </Button>
            </div>
          )
          : state.status !== "ready"
          ? <p className="notification-panel-state">Loading notifications…</p>
          : state.items.length === 0
          ? (
            <p className="notification-panel-state">
              No notifications yet. Delivered reminders and finished exports
              appear here.
            </p>
          )
          : (
            <ul aria-label="Recent notifications" className="notification-list">
              {state.items.map((item) => {
                const text = notificationText(item);
                return (
                  <li data-unread={item.unread ? "" : undefined} key={item.id}>
                    <a href={item.href}>
                      <span className="notification-title">
                        {item.unread
                          ? <span className="sr-only">Unread:</span>
                          : null}
                        {text.title}
                      </span>
                      <span className="notification-detail">{text.detail}</span>
                      <time dateTime={item.occurredAt}>
                        {formatted(item.occurredAt)}
                      </time>
                    </a>
                  </li>
                );
              })}
            </ul>
          )}
      </PopoverContent>
    </Popover>
  );
}

/** Mounts the bell over the header slot the layout drew. */
export function mountNotificationBell(
  root: ParentNode = document,
  props: NotificationBellProps = {},
): () => void {
  const container = root.querySelector<HTMLElement>("[data-notification-bell]");
  if (!container) return () => undefined;
  return mountIsland(
    container,
    NOTIFICATION_BELL_ISLAND,
    <NotificationBell {...props} />,
  );
}
