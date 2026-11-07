/**
 * The protected layout's one script (FER-01): the shell first, and the
 * header's three React islands only for a signed-in member, each when it is
 * first needed.
 *
 * `ApplicationLayout.astro` draws the search field, the Quick capture button,
 * and the bell statically, so the header is whole before any React loads.
 * Nothing here imports an island until `mountApplicationShell` answers a
 * ready session: a signed-out visitor, an unavailable session, a forbidden
 * route, or a pending legal review loads none. Then each island is its own
 * dynamic import, so opening one never downloads the others:
 *
 * - the people palette mounts on the first `pointerenter`, `focusin`, or
 *   `keydown` on the header's search, on a click of its Search button, or on
 *   its Ctrl+K or `/` shortcut, or at once when the field already holds the
 *   focus or a query, and its chunk is prefetched when the browser is idle;
 * - Quick capture enables its openers and loads on the first click on one,
 *   then opens from that opener;
 * - the bell keeps its count without React (`notification-count.ts`) and
 *   loads its panel on the first click.
 *
 * An island that cannot load says so in one toast, shown again only once
 * that one is gone, and the next intent tries again.
 */

import type { SessionContext } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { whenIdle } from "../../../lib/idle.ts";
import { searchShortcut } from "../../../islands/global-people-search/shortcuts.ts";
import { mountApplicationShell } from "../application-shell/application-shell.ts";
import { showToastOnce } from "../toasts/toasts.ts";
import {
  mountNotificationCount,
  type NotificationPanelModule,
} from "../notifications/notification-count.ts";

/** The parts of the palette's module the shell calls. */
export interface SearchModule {
  mountGlobalPeopleSearch(
    navigate?: (path: string) => void,
    initialOpener?: HTMLElement | null,
  ): () => void;
}

/** The part of Quick capture's module the shell calls. */
export interface QuickCaptureModule {
  mountQuickCapture(opener?: HTMLButtonElement): () => void;
}

/** How the shell imports each island; tests replace them. */
export interface ShellIslandLoaders {
  readonly bell: () => Promise<NotificationPanelModule>;
  readonly capture: () => Promise<QuickCaptureModule>;
  readonly search: () => Promise<SearchModule>;
}

const LOADERS: ShellIslandLoaders = {
  bell: () => import("../notifications/notification-bell.tsx"),
  capture: () => import("../../interactions/mount.tsx"),
  search: () => import("../../../islands/global-people-search/mount.tsx"),
};

const CAPTURE_OPENER = "button[data-quick-capture]";
const SEARCH_INTENTS = ["pointerenter", "focusin", "keydown"] as const;

const SEARCH_FAILED =
  "Search could not load. Check your connection and try again.";
const CAPTURE_FAILED =
  "Quick capture could not load. Check your connection and try again.";

const nothing = (): void => undefined;

/**
 * Mounts the palette on the first intent toward the header's search, or at
 * once when the field already holds the focus or a query as the session
 * becomes ready (APR-008). Who asked it to open before it loaded — Ctrl+K,
 * or its Search button — is remembered until it mounts, so the palette opens
 * for them; the last key pressed in the field while it loaded is replayed on
 * the mounted field, and a load that fails on an intent says so. Answers the
 * function that stops waiting.
 */
function wireSearch(load: ShellIslandLoaders["search"]): () => void {
  const container = document.querySelector<HTMLElement>(
    "[data-global-people-search]",
  );
  if (!container) return nothing;
  const field = container.querySelector<HTMLInputElement>("input");
  let loading: Promise<void> | undefined;
  let opener: HTMLElement | null | undefined;
  let openButton = false;
  let pressed: KeyboardEvent | undefined;
  // Only a member who focused, typed, clicked, or pressed a shortcut hears
  // that the palette could not load; a pointer passing over it does not.
  let explicitIntent = false;

  const mount = (explicit = true): void => {
    explicitIntent ||= explicit;
    loading ??= load().then((module) => {
      disarm();
      module.mountGlobalPeopleSearch(undefined, opener);
      if (openButton && opener === undefined) {
        container.querySelector<HTMLButtonElement>(
          "[data-global-people-search-open]",
        )?.click();
      }
      replay();
    }, () => {
      // The failed attempt's asks are spent: a later hover only mounts.
      loading = undefined;
      opener = undefined;
      openButton = false;
      pressed = undefined;
      if (explicitIntent) {
        showToastOnce({ message: SEARCH_FAILED, tone: "error" });
      }
      explicitIntent = false;
    });
  };
  // A key the static field received fired no handler of the palette's; the
  // shortcut listener has already answered the ones it handles.
  const replay = (): void => {
    const key = pressed;
    pressed = undefined;
    const active = document.activeElement;
    if (
      !key || key.defaultPrevented || !(active instanceof HTMLInputElement) ||
      active.id !== field?.id || !container.contains(active)
    ) return;
    active.dispatchEvent(
      new KeyboardEvent("keydown", {
        altKey: key.altKey,
        bubbles: true,
        cancelable: true,
        ctrlKey: key.ctrlKey,
        key: key.key,
        metaKey: key.metaKey,
        shiftKey: key.shiftKey,
      }),
    );
  };
  const intent = (event: Event): void => {
    if (event instanceof KeyboardEvent && event.target === field) {
      pressed = event;
    }
    mount(event.type !== "pointerenter");
  };
  const click = (event: MouseEvent): void => {
    if (
      event.target instanceof Element &&
      event.target.closest("[data-global-people-search-open]")
    ) {
      openButton = true;
      mount();
    }
  };
  const shortcut = (event: KeyboardEvent): void => {
    const asked = searchShortcut(event);
    if (!asked) return;
    event.preventDefault();
    if (asked === "focus-field") {
      // Focusing the field is itself an intent, which mounts the palette.
      field?.focus();
      return;
    }
    const active = document.activeElement;
    opener = active instanceof HTMLElement && active !== document.body
      ? active
      : null;
    mount();
  };
  const disarm = (): void => {
    for (const type of SEARCH_INTENTS) {
      container.removeEventListener(type, intent);
    }
    container.removeEventListener("click", click);
    document.removeEventListener("keydown", shortcut);
  };

  for (const type of SEARCH_INTENTS) container.addEventListener(type, intent);
  container.addEventListener("click", click);
  document.addEventListener("keydown", shortcut);
  if (field && (field.value !== "" || document.activeElement === field)) {
    mount();
  }
  whenIdle(() => void load().catch(() => undefined));
  return disarm;
}

/**
 * Enables every Quick capture opener on the page, including ones drawn
 * later, and loads Quick capture on the first click, Enter, or Space on one
 * (the island's own activation keys). The island then owns the openers; if
 * it cannot load, a toast says so and the next click tries again. Answers
 * the function that stops waiting.
 */
function wireQuickCapture(load: ShellIslandLoaders["capture"]): () => void {
  const configure = (): void => {
    for (
      const opener of document.querySelectorAll<HTMLButtonElement>(
        CAPTURE_OPENER,
      )
    ) {
      const disabled = opener.hasAttribute("hidden");
      if (opener.disabled !== disabled) opener.disabled = disabled;
      if (opener.dataset.interactionCaptureReady !== "true") {
        opener.dataset.interactionCaptureReady = "true";
      }
    }
  };
  const observer = new MutationObserver(configure);
  const openerOf = (target: EventTarget | null) => {
    const opener = target instanceof Element
      ? target.closest<HTMLButtonElement>(CAPTURE_OPENER)
      : null;
    return opener && !opener.disabled ? opener : undefined;
  };
  const activate = (opener: HTMLButtonElement): void => {
    disarm();
    opener.setAttribute("aria-busy", "true");
    void load().then(
      (module) => void module.mountQuickCapture(opener),
      () => {
        arm();
        showToastOnce({ message: CAPTURE_FAILED, tone: "error" });
      },
    ).finally(() => opener.removeAttribute("aria-busy"));
  };
  const click = (event: MouseEvent): void => {
    const opener = openerOf(event.target);
    if (opener) activate(opener);
  };
  // As the island does, Enter and Space activate an opener by delegation:
  // a surface around one may keep the key from becoming a click.
  const key = (event: KeyboardEvent): void => {
    if (![" ", "Enter", "Spacebar"].includes(event.key)) return;
    const opener = openerOf(event.target);
    if (!opener) return;
    event.preventDefault();
    if (!event.repeat) activate(opener);
  };
  function arm(): void {
    configure();
    observer.observe(document.body, {
      attributeFilter: ["hidden"],
      attributes: true,
      childList: true,
      subtree: true,
    });
    document.addEventListener("click", click);
    document.addEventListener("keydown", key);
  }
  function disarm(): void {
    observer.disconnect();
    document.removeEventListener("click", click);
    document.removeEventListener("keydown", key);
  }
  arm();
  return disarm;
}

/**
 * Wires the header's three islands for the member of `session`, and answers
 * the function that stops waiting for the ones not loaded yet.
 */
export function mountShellIslands(
  session: SessionContext,
  loaders: ShellIslandLoaders = LOADERS,
): () => void {
  const stops = [
    wireSearch(loaders.search),
    wireQuickCapture(loaders.capture),
    mountNotificationCount(session.workspace.id, loaders.bell),
  ];
  return () => stops.forEach((stop) => stop());
}

/**
 * The layout script: the shell, then its islands for a ready session.
 * Answers the function that stops waiting for the islands.
 */
export async function startApplicationShell(
  loaders: ShellIslandLoaders = LOADERS,
): Promise<() => void> {
  const session = await mountApplicationShell();
  return session ? mountShellIslands(session, loaders) : nothing;
}
