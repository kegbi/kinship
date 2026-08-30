import {
  getSession,
  type SessionContext,
  signOut,
} from "../../../../packages/contracts/generated/auth-client.ts";
import {
  ACTIVE_WORKSPACE_KEY,
  requestWorkspaceChange,
  resolveWorkspaceSession,
} from "./workspace-context.ts";
import { clearToasts, showToast } from "./toasts.ts";

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
  elements.root.querySelectorAll("[data-requires-workspace-owner]").forEach(
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
  const storage = document.body.dataset.pageId === "settings.storage";
  const importSettings =
    document.body.dataset.pageId?.startsWith("settings.import") === true;
  const exportSettings = document.body.dataset.pageId === "settings.export";
  const workspaceDanger = document.body.dataset.pageId ===
    "settings.workspace-danger";
  const auditHistory = document.body.dataset.pageId === "people.audit" ||
    document.body.dataset.pageId === "settings.audit";
  heading.textContent = workspaceDanger
    ? "Workspace danger zone unavailable"
    : workspaceSettings
    ? "Workspace settings unavailable"
    : personalization
    ? "Personalization unavailable"
    : storage
    ? "Storage settings unavailable"
    : importSettings
    ? "Import unavailable"
    : exportSettings
    ? "Export unavailable"
    : auditHistory
    ? "Audit history unavailable"
    : "You don’t have access to Members";
  const copy = document.createElement("p");
  copy.textContent = workspaceDanger
    ? "Only an active workspace owner can reset or delete this workspace."
    : workspaceSettings
    ? "Only workspace owners and admins can manage workspace identity and defaults."
    : personalization
    ? "Only workspace owners and admins can manage workspace personalization."
    : storage
    ? "Only workspace owners and admins can review workspace storage and provider health."
    : importSettings
    ? "Only workspace owners and admins can import workspace data."
    : exportSettings
    ? "Only workspace owners and admins can export workspace data."
    : auditHistory
    ? "Only workspace owners and admins can review audit history."
    : "Only workspace owners and admins can view members and invitations.";
  const link = document.createElement("a");
  link.className = "button-link";
  link.href = document.body.dataset.pageId === "people.audit"
    ? "/app/people"
    : "/app/settings";
  link.textContent = document.body.dataset.pageId === "people.audit"
    ? "Return to people"
    : "Return to settings";
  const main = document.createElement("main");
  main.id = "forbidden-main-content";
  main.tabIndex = -1;
  main.append(heading, copy, link);
  elements.access.append(main);
  const skipLink = document.querySelector<HTMLAnchorElement>(".skip-link");
  if (skipLink) {
    skipLink.href = "#forbidden-main-content";
    skipLink.addEventListener("click", () => main.focus());
  }
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
  const isWorkspaceOwner = resolved.session.member.role === "owner";
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
  if (
    (document.body.dataset.pageId === "settings.members" ||
      document.body.dataset.pageId === "settings.workspace" ||
      document.body.dataset.pageId === "settings.personalization" ||
      document.body.dataset.pageId === "settings.storage" ||
      document.body.dataset.pageId?.startsWith("settings.import") === true ||
      document.body.dataset.pageId === "settings.export" ||
      document.body.dataset.pageId === "people.audit" ||
      document.body.dataset.pageId === "settings.audit") &&
    !isWorkspaceAdmin
  ) {
    renderRouteForbidden(elements);
    return;
  }
  if (
    document.body.dataset.pageId === "settings.workspace-danger" &&
    !isWorkspaceOwner
  ) {
    renderRouteForbidden(elements);
    return;
  }
  const requiredLegalDocuments = resolved.session.requiredLegalDocuments ?? [];
  if (
    requiredLegalDocuments.length > 0 &&
    document.body.dataset.pageId !== "compliance.accept"
  ) {
    const next = `${globalThis.location.pathname}${globalThis.location.search}`;
    navigate(`/app/compliance?next=${encodeURIComponent(next)}`);
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
      showToast({
        message:
          "That workspace is no longer available. Your current workspace was not changed.",
        tone: "error",
      });
      elements.select.value = activeWorkspaceId;
    }
    elements.select.disabled = false;
    if (hadFocus) elements.select.focus();
  });

  elements.signOutButton.addEventListener("click", async () => {
    const hadFocus = document.activeElement === elements.signOutButton;
    elements.signOutButton.disabled = true;
    showToast({ message: "Signing out securely…", tone: "info" });
    const result = await signOut().catch(() => undefined);
    if (result?.ok) {
      sessionStorage.removeItem(ACTIVE_WORKSPACE_KEY);
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
