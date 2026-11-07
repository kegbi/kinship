/**
 * The protected application shell (GAP-033): the session gate, the member
 * menu, the workspace switcher, sign-out, and the member's layout width.
 *
 * `ApplicationLayout.astro` draws every piece of it. The access state's
 * three answers — sign in, retry, and a whole-route forbidden `<main>` — and
 * the switcher's `<option>` are `<template>`s this module clones; it never
 * builds an element itself. A forbidden route's copy depends on the page, so
 * the clone gets its heading, detail, and return link here.
 */

import {
  getMemberPreferences,
  getSession,
  type SessionContext,
  signOut,
} from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  MEMBER_LAYOUT_SAVED_EVENT,
  type MemberLayoutSavedDetail,
} from "../../../lib/app-shell.ts";
import {
  clearActiveWorkspace,
  onSessionRevalidated,
  requestWorkspaceChange,
  resolveWorkspaceSession,
  setActiveWorkspace,
} from "../../../lib/workspace-context.ts";
import {
  ACCESS_FORBIDDEN_TEMPLATE_ID,
  ACCESS_SIGN_IN_TEMPLATE_ID,
  ACCESS_UNAVAILABLE_TEMPLATE_ID,
  cloneTemplate,
  WORKSPACE_OPTION_TEMPLATE_ID,
} from "../templates.ts";
import { clearToasts, showToast } from "../toasts/toasts.ts";

type Navigate = (path: string) => void;

const browserNavigate: Navigate = (path) => globalThis.location.assign(path);

interface ShellElements {
  readonly access: HTMLElement;
  readonly root: HTMLElement;
  readonly select: HTMLSelectElement;
  readonly signOutButton: HTMLButtonElement;
  readonly switcher: HTMLElement;
}

interface ResolvedShellSession {
  readonly firstName?: string;
  readonly session: SessionContext;
}

type ShellResolution = ResolvedShellSession | "unavailable" | undefined;

/** A forbidden route's heading, detail, and way back. */
export interface ForbiddenCopy {
  readonly detail: string;
  readonly heading: string;
  readonly returnHref: string;
  readonly returnLabel: string;
}

const ADMIN_PAGES: Readonly<Record<string, readonly [string, string]>> = {
  "people.audit": [
    "Audit history unavailable",
    "Only workspace owners and admins can review audit history.",
  ],
  "settings.audit": [
    "Audit history unavailable",
    "Only workspace owners and admins can review audit history.",
  ],
  "settings.export": [
    "Export unavailable",
    "Only workspace owners and admins can export workspace data.",
  ],
  "settings.members": [
    "You don’t have access to Members",
    "Only workspace owners and admins can view members and invitations.",
  ],
  "settings.personalization": [
    "Personalization unavailable",
    "Only workspace owners and admins can manage workspace personalization.",
  ],
  "settings.storage": [
    "Storage settings unavailable",
    "Only workspace owners and admins can review workspace storage and provider health.",
  ],
  "settings.workspace": [
    "Workspace settings unavailable",
    "Only workspace owners and admins can manage workspace identity and defaults.",
  ],
};

const IMPORT_PAGE: readonly [string, string] = [
  "Import unavailable",
  "Only workspace owners and admins can import workspace data.",
];

const OWNER_PAGE = "settings.workspace-danger";

const OWNER_PAGE_COPY: readonly [string, string] = [
  "Workspace danger zone unavailable",
  "Only an active workspace owner can reset or delete this workspace.",
];

/** The workspace-admin copy of page `pageId`, when only admins may enter. */
function adminPage(pageId: string): readonly [string, string] | undefined {
  return Object.hasOwn(ADMIN_PAGES, pageId)
    ? ADMIN_PAGES[pageId]
    : pageId.startsWith("settings.import")
    ? IMPORT_PAGE
    : undefined;
}

/** What a member who may not enter page `pageId` reads instead. */
export function forbiddenCopy(pageId: string | undefined): ForbiddenCopy {
  const [heading, detail] = pageId === OWNER_PAGE
    ? OWNER_PAGE_COPY
    : adminPage(pageId ?? "") ?? ADMIN_PAGES["settings.members"]!;
  const people = pageId === "people.audit";
  return {
    detail,
    heading,
    returnHref: people ? "/app/people" : "/app/settings",
    returnLabel: people ? "Return to people" : "Return to settings",
  };
}

function shellElements(): ShellElements | undefined {
  const access = document.querySelector<HTMLElement>("#access-state");
  const root = document.querySelector<HTMLElement>("#protected-shell");
  const select = document.querySelector<HTMLSelectElement>(
    "#workspace-switcher",
  );
  const signOutButton = document.querySelector<HTMLButtonElement>(
    "#member-sign-out",
  );
  const switcher = document.querySelector<HTMLElement>(
    "#workspace-switcher-container",
  );
  return access && root && select && signOutButton && switcher
    ? { access, root, select, signOutButton, switcher }
    : undefined;
}

/** Hides the shell and shows `content` as the whole access state. */
function showAccess(
  elements: ShellElements,
  content: DocumentFragment | undefined,
): void {
  elements.root.hidden = true;
  elements.access.hidden = false;
  elements.access.replaceChildren(...content ? [content] : []);
  elements.access.focus();
}

function renderAccessFailure(elements: ShellElements): void {
  showAccess(elements, cloneTemplate(ACCESS_SIGN_IN_TEMPLATE_ID));
}

function renderSessionUnavailable(elements: ShellElements): void {
  const content = cloneTemplate(ACCESS_UNAVAILABLE_TEMPLATE_ID);
  content?.querySelector("button")?.addEventListener(
    "click",
    () => globalThis.location.reload(),
  );
  showAccess(elements, content);
}

function renderRouteForbidden(elements: ShellElements): void {
  elements.root.querySelectorAll(
    "[data-requires-workspace-admin], [data-requires-workspace-owner]",
  ).forEach((node) => node.remove());
  const content = cloneTemplate(ACCESS_FORBIDDEN_TEMPLATE_ID);
  const main = content?.querySelector<HTMLElement>("main");
  if (main) {
    const copy = forbiddenCopy(document.body.dataset.pageId);
    main.querySelector("h1")!.textContent = copy.heading;
    main.querySelector("p")!.textContent = copy.detail;
    const link = main.querySelector("a")!;
    link.href = copy.returnHref;
    link.textContent = copy.returnLabel;
    const skipLink = document.querySelector<HTMLAnchorElement>(".skip-link");
    if (skipLink) {
      skipLink.href = `#${main.id}`;
      skipLink.addEventListener("click", () => main.focus());
    }
  }
  showAccess(elements, content);
}

function applySessionGating(
  elements: ShellElements,
  session: SessionContext,
  navigate: Navigate,
): "blocked" | "allowed" {
  const isWorkspaceAdmin = session.member.role === "owner" ||
    session.member.role === "admin";
  const isWorkspaceOwner = session.member.role === "owner";
  if (!isWorkspaceAdmin) {
    document.querySelectorAll("[data-requires-workspace-admin]").forEach(
      (node) => node.remove(),
    );
  }
  if (!isWorkspaceOwner) {
    document.querySelectorAll("[data-requires-workspace-owner]").forEach(
      (node) => node.remove(),
    );
  }
  const pageId = document.body.dataset.pageId ?? "";
  if (
    (adminPage(pageId) && !isWorkspaceAdmin) ||
    (pageId === OWNER_PAGE && !isWorkspaceOwner)
  ) {
    renderRouteForbidden(elements);
    return "blocked";
  }
  const requiredLegalDocuments = session.requiredLegalDocuments ?? [];
  if (requiredLegalDocuments.length > 0 && pageId !== "compliance.accept") {
    const next = `${globalThis.location.pathname}${globalThis.location.search}`;
    navigate(`/app/compliance?next=${encodeURIComponent(next)}`);
    return "blocked";
  }
  return "allowed";
}

function renderWorkspacePresentation(
  elements: ShellElements,
  session: SessionContext,
): void {
  for (
    const target of document.querySelectorAll<HTMLElement>(
      "[data-workspace-name]",
    )
  ) {
    target.textContent = session.workspace.name;
  }
  const options: HTMLOptionElement[] = [];
  for (const workspace of session.workspaces) {
    const option = cloneTemplate(WORKSPACE_OPTION_TEMPLATE_ID)
      ?.querySelector("option");
    if (!option) continue;
    option.value = workspace.id;
    option.textContent = workspace.name;
    option.selected = workspace.id === session.workspace.id;
    options.push(option);
  }
  elements.select.replaceChildren(...options);
  elements.switcher.hidden = session.workspaces.length <= 1;
}

function renderSession(
  elements: ShellElements,
  session: SessionContext,
  firstName?: string,
): void {
  renderWorkspacePresentation(elements, session);
  elements.access.hidden = true;
  elements.root.hidden = false;
  const heading = document.querySelector<HTMLElement>("#today-heading");
  if (heading) {
    heading.textContent = firstName
      ? `Welcome, ${firstName}.`
      : "Welcome back.";
  }
  clearToasts();
}

async function resolveSession(): Promise<ShellResolution> {
  const selected = await resolveWorkspaceSession();
  if (selected.status === "ready") {
    return {
      ...(selected.entryFirstName
        ? { firstName: selected.entryFirstName }
        : {}),
      session: selected.session,
    };
  }
  if (selected.status === "unavailable") return "unavailable";
  return undefined;
}

/**
 * Resolves the session and draws the shell, and answers the session once the
 * member may use the page: `undefined` while they are signed out, the
 * session is unavailable, the route is forbidden, or a legal review comes
 * first. The header's islands wait for this answer (FER-01).
 */
export async function mountApplicationShell(
  navigate: Navigate = browserNavigate,
): Promise<SessionContext | undefined> {
  const elements = shellElements();
  if (!elements) return undefined;
  elements.root.dataset.fluidLayout = "false";
  const resolved = await resolveSession();
  if (resolved === "unavailable") {
    renderSessionUnavailable(elements);
    return undefined;
  }
  if (!resolved) {
    renderAccessFailure(elements);
    return undefined;
  }
  if (applySessionGating(elements, resolved.session, navigate) === "blocked") {
    return undefined;
  }
  renderSession(elements, resolved.session, resolved.firstName);
  let activeWorkspaceId = resolved.session.workspace.id;
  let activeMemberId = resolved.session.member.id;
  let layoutRevision = 0;
  const resetLayout = (): void => {
    layoutRevision += 1;
    elements.root.dataset.fluidLayout = "false";
  };
  const loadLayout = async (): Promise<void> => {
    const revision = ++layoutRevision;
    const result = await getMemberPreferences(activeWorkspaceId).catch(() =>
      undefined
    );
    if (revision !== layoutRevision || !elements.root.isConnected) return;
    elements.root.dataset.fluidLayout = String(
      result?.ok ? result.value.preferences.fluidLayout : false,
    );
  };
  elements.root.addEventListener(MEMBER_LAYOUT_SAVED_EVENT, (event) => {
    const saved = (event as CustomEvent<MemberLayoutSavedDetail>).detail;
    if (saved.workspaceId !== activeWorkspaceId || elements.root.hidden) return;
    // A completed save supersedes any older preference read on this page.
    layoutRevision += 1;
    elements.root.dataset.fluidLayout = String(saved.fluidLayout);
  });
  void loadLayout();
  onSessionRevalidated((revalidated) => {
    if (revalidated.status === "access-lost") {
      resetLayout();
      renderAccessFailure(elements);
    } else if (revalidated.status === "ready") {
      if (
        applySessionGating(elements, revalidated.session, navigate) ===
          "allowed"
      ) {
        renderWorkspacePresentation(elements, revalidated.session);
        const membershipChanged = activeWorkspaceId !==
            revalidated.session.workspace.id ||
          activeMemberId !== revalidated.session.member.id;
        activeWorkspaceId = revalidated.session.workspace.id;
        activeMemberId = revalidated.session.member.id;
        if (membershipChanged) {
          resetLayout();
          void loadLayout();
        }
      } else {
        resetLayout();
      }
    }
  });

  const menuToggle = document.querySelector<HTMLButtonElement>(
    "#member-menu-toggle",
  );
  const menu = document.querySelector<HTMLElement>("#member-popover");
  const closeMenu = (): void => {
    if (menu) menu.hidden = true;
    menuToggle?.setAttribute("aria-expanded", "false");
  };
  const insideMenu = (target: EventTarget | null): boolean =>
    target instanceof Node &&
    (menu?.contains(target) === true || menuToggle?.contains(target) === true);
  menuToggle?.addEventListener("click", () => {
    if (!menu) return;
    menu.hidden = !menu.hidden;
    menuToggle.setAttribute("aria-expanded", String(!menu.hidden));
    menuToggle.focus();
  });
  elements.root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || menu?.hidden !== false) return;
    event.preventDefault();
    closeMenu();
    menuToggle?.focus();
  });
  elements.root.addEventListener("pointerdown", (event) => {
    if (!insideMenu(event.target)) closeMenu();
  });
  elements.root.addEventListener("focusout", (event) => {
    // A pending action can disable its focused control without moving focus elsewhere.
    if (
      event.relatedTarget !== null && insideMenu(event.target) &&
      !insideMenu(event.relatedTarget)
    ) {
      closeMenu();
    }
  });

  elements.select.addEventListener("change", async () => {
    const hadFocus = document.activeElement === elements.select;
    const change = requestWorkspaceChange(
      activeWorkspaceId,
      elements.select.value,
    );
    if (!change.allowed) {
      elements.select.value = activeWorkspaceId;
      showToast({
        message:
          "Workspace switch canceled. Your unsaved changes and active workspace were kept.",
        tone: "warning",
      });
      if (hadFocus) elements.select.focus();
      return;
    }
    elements.select.disabled = true;
    showToast({ message: "Switching workspace…", tone: "info" });
    const selected = await getSession(elements.select.value).catch(() =>
      undefined
    );
    if (selected?.ok) {
      if (setActiveWorkspace(selected.value.workspace.id)) {
        change.proceed();
        activeWorkspaceId = selected.value.workspace.id;
        resetLayout();
        elements.select.disabled = false;
        navigate(
          `${globalThis.location.pathname}${globalThis.location.search}`,
        );
        return;
      }
      showToast({
        message:
          "Browser storage is unavailable. Your current workspace and unsaved changes were kept. Enable browser storage or free space, then try switching again.",
        tone: "error",
      });
    } else {
      showToast({
        message:
          "That workspace is no longer available. Your current workspace was not changed.",
        tone: "error",
      });
    }
    elements.select.value = activeWorkspaceId;
    elements.select.disabled = false;
    if (hadFocus) elements.select.focus();
  });

  elements.signOutButton.addEventListener("click", async () => {
    const hadFocus = document.activeElement === elements.signOutButton;
    elements.signOutButton.disabled = true;
    showToast({ message: "Signing out securely…", tone: "info" });
    const result = await signOut().catch(() => undefined);
    if (result?.ok) {
      clearActiveWorkspace();
      resetLayout();
      navigate(result.value.next);
      return;
    }
    elements.signOutButton.disabled = false;
    showToast({
      message:
        "Your session could not be revoked. Check your connection and try again.",
      tone: "error",
    });
    if (hadFocus) elements.signOutButton.focus();
  });
  return resolved.session;
}
