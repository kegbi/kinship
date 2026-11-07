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
 *   its Ctrl+K or `/` shortcut, and its chunk is prefetched when the browser
 *   is idle;
 * - Quick capture enables its openers and loads on the first click on one,
 *   then opens from that opener;
 * - the bell keeps its count without React (`notification-count.ts`) and
 *   loads its panel on the first click.
 */

import type { SessionContext } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { whenIdle } from "../../../lib/idle.ts";
import { searchShortcut } from "../../../islands/global-people-search/shortcuts.ts";
import { mountApplicationShell } from "../application-shell/application-shell.ts";
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

const nothing = (): void => undefined;

/**
 * Mounts the palette on the first intent toward the header's search. Who
 * asked it to open before it loaded — Ctrl+K, or its Search button — is
 * remembered until it mounts, so the palette opens for them. Answers the
 * function that stops waiting.
 */
function wireSearch(load: ShellIslandLoaders["search"]): () => void {
  const container = document.querySelector<HTMLElement>(
    "[data-global-people-search]",
  );
  if (!container) return nothing;
  let loading: Promise<void> | undefined;
  let opener: HTMLElement | null | undefined;
  let openButton = false;

  const mount = (): void => {
    loading ??= load().then((module) => {
      disarm();
      module.mountGlobalPeopleSearch(undefined, opener);
      if (openButton && opener === undefined) {
        container.querySelector<HTMLButtonElement>(
          "[data-global-people-search-open]",
        )?.click();
      }
    }, () => {
      loading = undefined;
    });
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
      container.querySelector<HTMLInputElement>("input")?.focus();
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
      container.removeEventListener(type, mount);
    }
    container.removeEventListener("click", click);
    document.removeEventListener("keydown", shortcut);
  };

  for (const type of SEARCH_INTENTS) container.addEventListener(type, mount);
  container.addEventListener("click", click);
  document.addEventListener("keydown", shortcut);
  whenIdle(() => void load().catch(() => undefined));
  return disarm;
}

/**
 * Enables every Quick capture opener on the page, including ones drawn
 * later, and loads Quick capture on the first click, Enter, or Space on one
 * (the island's own activation keys). The island then
 * owns the openers; if it cannot load, the next click tries again. Answers
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
      arm,
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
