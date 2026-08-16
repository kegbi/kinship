import {
  consumeApplicationEntry,
  getSession,
  type SessionContext,
  signOut,
} from "../../../../packages/contracts/generated/auth-client.ts";
import {
  ACTIVE_WORKSPACE_KEY,
  requestWorkspaceChange,
  resolveWorkspaceSession,
} from "./workspace-context.ts";

type Navigate = (path: string) => void;

const browserNavigate: Navigate = (path) => globalThis.location.assign(path);

interface ShellElements {
  readonly access: HTMLElement;
  readonly root: HTMLElement;
  readonly select: HTMLSelectElement;
  readonly signOutButton: HTMLButtonElement;
  readonly status: HTMLElement;
  readonly switcher: HTMLElement;
}

interface ResolvedShellSession {
  readonly firstName?: string;
  readonly session: SessionContext;
}

type ShellResolution = ResolvedShellSession | "unavailable" | undefined;

function shellElements(): ShellElements | undefined {
  const access = document.querySelector<HTMLElement>("#access-state");
  const root = document.querySelector<HTMLElement>("#protected-shell");
  const select = document.querySelector<HTMLSelectElement>(
    "#workspace-switcher",
  );
  const signOutButton = document.querySelector<HTMLButtonElement>(
    "#member-sign-out",
  );
  const status = document.querySelector<HTMLElement>("#shell-status");
  const switcher = document.querySelector<HTMLElement>(
    "#workspace-switcher-container",
  );
  return access && root && select && signOutButton && status && switcher
    ? { access, root, select, signOutButton, status, switcher }
    : undefined;
}

function renderAccessFailure(elements: ShellElements): void {
  elements.root.hidden = true;
  elements.access.hidden = false;
  elements.access.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = "Sign in to Kinship";
  const copy = document.createElement("p");
  copy.textContent =
    "Your session is missing, expired, revoked, or no longer active in this workspace.";
  const link = document.createElement("a");
  link.className = "button-link";
  link.href = "/auth/sign-in";
  link.textContent = "Go to sign-in";
  elements.access.append(heading, copy, link);
  elements.access.focus();
}

function renderSessionUnavailable(elements: ShellElements): void {
  elements.root.hidden = true;
  elements.access.hidden = false;
  elements.access.replaceChildren();
  const heading = document.createElement("h1");
  heading.textContent = "Kinship is temporarily unavailable";
  const copy = document.createElement("p");
  copy.textContent =
    "We could not confirm your active workspace. Any saved workspace choice is unchanged.";
  const retry = document.createElement("button");
  retry.className = "button-link";
  retry.type = "button";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => globalThis.location.reload());
  elements.access.append(heading, copy, retry);
  elements.access.focus();
}

function renderRouteForbidden(elements: ShellElements): void {
  elements.root.querySelectorAll("[data-requires-workspace-admin]").forEach(
    (node) => node.remove(),
  );
  elements.root.hidden = true;
  elements.access.hidden = false;
  elements.access.replaceChildren();
  const heading = document.createElement("h1");
  const workspaceSettings = document.body.dataset.pageId ===
    "settings.workspace";
  const personalization = document.body.dataset.pageId ===
    "settings.personalization";
  heading.textContent = workspaceSettings
    ? "Workspace settings unavailable"
    : personalization
    ? "Personalization unavailable"
    : "You don’t have access to Members";
  const copy = document.createElement("p");
  copy.textContent = workspaceSettings
    ? "Only workspace owners and admins can manage workspace identity and defaults."
    : personalization
    ? "Only workspace owners and admins can manage workspace personalization."
    : "Only workspace owners and admins can view members and invitations.";
  const link = document.createElement("a");
  link.className = "button-link";
  link.href = "/app/settings";
  link.textContent = "Return to settings";
  elements.access.append(heading, copy, link);
  elements.access.focus();
}

function renderSession(
  elements: ShellElements,
  session: SessionContext,
  firstName?: string,
): void {
  for (
    const target of document.querySelectorAll<HTMLElement>(
      "[data-workspace-name]",
    )
  ) {
    target.textContent = session.workspace.name;
  }
  elements.select.replaceChildren(
    ...session.workspaces.map((workspace) => {
      const option = document.createElement("option");
      option.value = workspace.id;
      option.textContent = workspace.name;
      option.selected = workspace.id === session.workspace.id;
      return option;
    }),
  );
  elements.switcher.hidden = session.workspaces.length <= 1;
  elements.access.hidden = true;
  elements.root.hidden = false;
  const heading = document.querySelector<HTMLElement>("#today-heading");
  if (heading) {
    heading.textContent = firstName
      ? `Welcome, ${firstName}.`
      : "Welcome back.";
  }
  const sessionMessage = firstName
    ? "You are its verified owner. Your protected session is active."
    : "Your protected session and active workspace membership were resolved by the server.";
  elements.status.textContent =
    `${session.workspace.name} is ready. ${sessionMessage}`;
}

function isUnavailableStatus(status: number): boolean {
  return status >= 500;
}

async function resolveSession(): Promise<ShellResolution> {
  const selected = await resolveWorkspaceSession();
  if (selected.status === "ready") return { session: selected.session };
  if (selected.status === "unavailable") return "unavailable";
  const entry = await consumeApplicationEntry().catch(() => undefined);
  if (!entry) return "unavailable";
  if (!entry.ok) {
    return isUnavailableStatus(entry.problem.status)
      ? "unavailable"
      : undefined;
  }
  const entered = await getSession().catch(() => undefined);
  if (!entered) return "unavailable";
  if (entered.ok) {
    return { firstName: entry.value.member.firstName, session: entered.value };
  }
  return isUnavailableStatus(entered.problem.status)
    ? "unavailable"
    : undefined;
}

export async function mountApplicationShell(
  navigate: Navigate = browserNavigate,
): Promise<void> {
  const elements = shellElements();
  if (!elements) return;
  const resolved = await resolveSession();
  if (resolved === "unavailable") {
    renderSessionUnavailable(elements);
    return;
  }
  if (!resolved) {
    renderAccessFailure(elements);
    return;
  }
  const isWorkspaceAdmin = resolved.session.member.role === "owner" ||
    resolved.session.member.role === "admin";
  if (!isWorkspaceAdmin) {
    document.querySelectorAll("[data-requires-workspace-admin]").forEach(
      (node) => node.remove(),
    );
  }
  if (
    (document.body.dataset.pageId === "settings.members" ||
      document.body.dataset.pageId === "settings.workspace" ||
      document.body.dataset.pageId === "settings.personalization") &&
    !isWorkspaceAdmin
  ) {
    renderRouteForbidden(elements);
    return;
  }
  renderSession(elements, resolved.session, resolved.firstName);
  let activeWorkspaceId = resolved.session.workspace.id;

  const menuToggle = document.querySelector<HTMLButtonElement>(
    "#member-menu-toggle",
  );
  const menu = document.querySelector<HTMLElement>("#member-popover");
  menuToggle?.addEventListener("click", () => {
    if (!menu) return;
    menu.hidden = !menu.hidden;
    menuToggle.setAttribute("aria-expanded", String(!menu.hidden));
  });

  elements.select.addEventListener("change", async () => {
    const hadFocus = document.activeElement === elements.select;
    const change = requestWorkspaceChange(
      activeWorkspaceId,
      elements.select.value,
    );
    if (!change.allowed) {
      elements.select.value = activeWorkspaceId;
      elements.status.textContent =
        "Workspace switch canceled. Your unsaved changes and active workspace were kept.";
      if (hadFocus) elements.select.focus();
      return;
    }
    elements.select.disabled = true;
    elements.status.textContent = "Switching workspace…";
    const selected = await getSession(elements.select.value).catch(() =>
      undefined
    );
    if (selected?.ok) {
      change.proceed();
      activeWorkspaceId = selected.value.workspace.id;
      sessionStorage.setItem(
        ACTIVE_WORKSPACE_KEY,
        activeWorkspaceId,
      );
      elements.select.disabled = false;
      navigate(`${globalThis.location.pathname}${globalThis.location.search}`);
      return;
    } else {
      elements.status.textContent =
        "That workspace is no longer available. Your current workspace was not changed.";
      elements.select.value = activeWorkspaceId;
    }
    elements.select.disabled = false;
    if (hadFocus) elements.select.focus();
  });

  elements.signOutButton.addEventListener("click", async () => {
    const hadFocus = document.activeElement === elements.signOutButton;
    elements.signOutButton.disabled = true;
    elements.status.textContent = "Signing out securely…";
    const result = await signOut().catch(() => undefined);
    if (result?.ok) {
      sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
      navigate(result.value.next);
      return;
    }
    elements.signOutButton.disabled = false;
    elements.status.textContent =
      "Your session could not be revoked. Check your connection and try again.";
    if (hadFocus) elements.signOutButton.focus();
  });

  const todayDate = document.querySelector<HTMLTimeElement>(
    "[data-today-date]",
  );
  if (todayDate) {
    const now = new Date();
    todayDate.dateTime = now.toISOString().slice(0, 10);
    todayDate.textContent = new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
    }).format(now);
  }
}

export function mountSettingsSearch(): void {
  const input = document.querySelector<HTMLInputElement>("#settings-search");
  const noResults = document.querySelector<HTMLElement>(
    "#settings-no-results",
  );
  const items = [...document.querySelectorAll<HTMLElement>(
    "[data-settings-item]",
  )];
  if (!input || !noResults || items.length === 0) return;
  input.addEventListener("input", () => {
    const query = input.value.trim().toLocaleLowerCase();
    let visible = 0;
    for (const item of items) {
      item.hidden = query.length > 0 &&
        !(item.dataset.search ?? item.textContent ?? "")
          .toLocaleLowerCase().includes(query);
      if (!item.hidden) visible += 1;
    }
    noResults.hidden = visible > 0;
  });
}
