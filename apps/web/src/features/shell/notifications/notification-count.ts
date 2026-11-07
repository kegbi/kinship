/**
 * The notification bell before its panel loads (FER-01, `TODAY-002`).
 *
 * `ApplicationLayout.astro` draws the bell as a static button with a hidden
 * badge. Once the shell has a ready session this module enables it and keeps
 * its unread count current without React: the badge and the button's
 * accessible name. It reads the first page when the browser is next idle
 * (FEQ-09) and once a minute while the page is visible, through one
 * latest-read slot.
 *
 * The first click hands the bell to the React island
 * (`notification-bell.tsx`), which opens the panel with the page read here
 * and owns every later read. The count stops reading before it loads the
 * island, so one owner at a time polls; if the island cannot load, the count
 * keeps the bell and a later click tries again.
 */

import {
  listNotifications,
  type NotificationsPage,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import { whenIdle } from "../../../lib/idle.ts";
import {
  badgeText,
  bellLabel,
  NOTIFICATION_REFRESH_MS,
} from "./notifications.ts";

/** The part of the bell island's module the count hands over to. */
export interface NotificationPanelModule {
  mountNotificationBell(
    root: ParentNode,
    props: {
      readonly initialPage?: NotificationsPage | undefined;
      readonly openOnReady?: boolean;
    },
  ): () => void;
}

/**
 * Keeps the static bell's count for workspace `workspaceId` until its first
 * click loads the panel through `loadPanel`, and answers the function that
 * stops it.
 */
export function mountNotificationCount(
  workspaceId: string,
  loadPanel: () => Promise<NotificationPanelModule>,
  refreshMs: number = NOTIFICATION_REFRESH_MS,
): () => void {
  const button = document.querySelector<HTMLButtonElement>(
    "[data-notification-bell] button",
  );
  if (!button) return () => undefined;
  const badge = button.querySelector<HTMLElement>(".notification-bell-badge");
  let page: NotificationsPage | undefined;
  let latest = 0;
  let handedOver = false;
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | undefined;

  const read = async (): Promise<void> => {
    if (handedOver) return;
    const id = ++latest;
    const answer = await listNotifications(undefined, workspaceId).catch(() =>
      undefined
    );
    if (handedOver || id !== latest || !answer?.ok) return;
    page = answer.value;
    button.setAttribute("aria-label", bellLabel(page.unreadCount));
    if (badge) {
      badge.textContent = badgeText(page.unreadCount);
      badge.hidden = badge.textContent === "";
    }
  };
  const poll = (): void => {
    timer = setInterval(() => {
      if (document.visibilityState !== "hidden") void read();
    }, Math.max(refreshMs, 1));
  };
  const handOver = async (): Promise<void> => {
    if (handedOver) return;
    handedOver = true;
    clearInterval(timer);
    button.setAttribute("aria-busy", "true");
    try {
      const panel = await loadPanel();
      panel.mountNotificationBell(document, {
        initialPage: page,
        openOnReady: true,
      });
    } catch {
      button.removeAttribute("aria-busy");
      if (stopped) return;
      handedOver = false;
      poll();
    }
  };

  const click = (): void => void handOver();
  button.addEventListener("click", click);
  button.disabled = false;
  whenIdle(() => void read());
  poll();
  return () => {
    stopped = true;
    handedOver = true;
    clearInterval(timer);
    button.removeEventListener("click", click);
  };
}
