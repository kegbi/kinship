// @vitest-environment happy-dom

import { within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Layout reads have focused coverage in application-shell-layout.test.ts; these cases
// exercise session, access, and menu requests independently.
vi.mock(
  "../../../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<
      typeof import("../../../../../../packages/contracts/generated/auth-client.ts")
    >(),
    getMemberPreferences: vi.fn().mockResolvedValue({
      ok: true,
      value: { preferences: { fluidLayout: false } },
    }),
  }),
);

import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { workspaceSession } from "../../../testing/fixtures.ts";
import { drawShell } from "../../../testing/render.tsx";
import {
  ACCESS_TEMPLATES,
  TOAST_REGION,
  WORKSPACE_OPTION_TEMPLATE,
} from "../../../testing/shell.ts";
import { mountUnsavedChangesGuard } from "../../../lib/unsaved-changes.ts";
import { forbiddenCopy, mountApplicationShell } from "./application-shell.ts";

const SESSION = "GET /api/v1/session";
const SIGN_OUT = "POST /api/v1/sign-out";
const ENTRY = "POST /api/v1/application-entry";

function shellMarkup(): void {
  drawShell(`
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <section id="access-state" role="status" tabindex="-1">Checking</section>
    ${ACCESS_TEMPLATES}
    <div id="protected-shell" hidden>
      <h1 id="today-heading">Opening</h1>
      <time data-today-date>Loading date…</time>
      <button id="member-menu-toggle" type="button" aria-expanded="false">Member menu</button>
      <div id="member-popover" hidden>
        <div class="menu-workspace">
          <label for="workspace-switcher">Active workspace</label>
          <strong data-workspace-name></strong>
          <div id="workspace-switcher-container" hidden>
            <select id="workspace-switcher"></select>
            ${WORKSPACE_OPTION_TEMPLATE}
          </div>
        </div>
        <a href="/app/settings/profile">Profile</a>
        <a href="/app/settings">Settings</a>
        <button id="member-sign-out" type="button">Sign out</button>
      </div>
      ${TOAST_REGION}
    </div>`);
}

/** The access state, for queries by role. */
function access() {
  return within(document.querySelector<HTMLElement>("#access-state")!);
}

/**
 * A profile form under the unsaved-changes guard, as a settings page mounts
 * it, holding `draft` in its first-name field.
 */
function draftMarkup(draft: string): HTMLInputElement {
  document.querySelector("#protected-shell")?.insertAdjacentHTML(
    "beforeend",
    `<form method="post" id="profile-form"><label>First name<input name="firstName" value="Original"></label><button type="submit">Save changes</button></form>`,
  );
  mountUnsavedChangesGuard({
    confirmMessage: "Discard your unsaved profile changes?",
    root: document.querySelector<HTMLElement>("#protected-shell")!,
  });
  const firstName = document.querySelector<HTMLInputElement>(
    '[name="firstName"]',
  )!;
  firstName.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  firstName.value = draft;
  firstName.dispatchEvent(new Event("input", { bubbles: true }));
  return firstName;
}

const family = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Family circle",
};
const community = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Community circle",
};
const asMember = { member: { id: "member", role: "member" } };

function session(activeId = family.id, workspaces = [family]) {
  const workspace = workspaces.find(({ id }) => id === activeId)!;
  // As the suite's sessions always were: without the legal-document list, so
  // the shell's fallback for a session that carries none stays exercised.
  const { requiredLegalDocuments: _none, ...answer } = workspaceSession({
    workspace,
    workspaces,
  });
  return answer;
}

/** Answers every session read with the default session and `overrides`. */
function serveSession(overrides: Record<string, unknown> = {}) {
  return stubApi({ [SESSION]: jsonResponse({ ...session(), ...overrides }) });
}

function cacheSession(value: unknown): void {
  sessionStorage.setItem(
    "kinship.session",
    JSON.stringify({ savedAt: Date.now(), session: value }),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

describe("APP-002C protected application shell", () => {
  it.each(["workspace", "sign-out"] as const)(
    "APR-007 keeps the menu open when pending %s disables its focused control",
    async (action) => {
      shellMarkup();
      const workspaces = [family, community];
      const pending = deferred<Response>();
      stubApi({
        [SESSION]: [
          jsonResponse(session(family.id, workspaces)),
          pending.promise,
        ],
        [SIGN_OUT]: [pending.promise],
      });
      const navigate = vi.fn();
      await mountApplicationShell(navigate);
      const toggle = document.querySelector<HTMLButtonElement>(
        "#member-menu-toggle",
      )!;
      const menu = document.querySelector<HTMLElement>("#member-popover")!;
      const control = document.querySelector<
        HTMLSelectElement | HTMLButtonElement
      >(
        action === "workspace" ? "#workspace-switcher" : "#member-sign-out",
      )!;
      toggle.click();
      control.focus();
      if (action === "workspace") {
        control.value = workspaces[1]!.id;
        control.dispatchEvent(new Event("change", { bubbles: true }));
      } else {
        control.click();
      }
      expect(control.disabled).toBe(true);
      // Disabling a focused control blurs it without a new focus destination in Chromium.
      control.blur();
      control.dispatchEvent(
        new FocusEvent("focusout", {
          bubbles: true,
          relatedTarget: null,
        }),
      );
      const hiddenWhilePending = menu.hidden;
      pending.resolve(jsonResponse({ title: "Temporarily unavailable" }, 503));
      await vi.waitFor(() => expect(control.disabled).toBe(false));
      expect(hiddenWhilePending).toBe(false);
      expect(menu.hidden).toBe(false);
      expect(toggle.getAttribute("aria-expanded")).toBe("true");
      expect(document.activeElement).toBe(control);
      expect(navigate).not.toHaveBeenCalled();
      if (action === "workspace") expect(control.value).toBe(workspaces[0]!.id);
    },
  );

  it("APR-007 handles Escape after pointer activation without native button focus", async () => {
    shellMarkup();
    cacheSession(session());
    serveSession();
    await mountApplicationShell(vi.fn());
    const toggle = document.querySelector<HTMLButtonElement>(
      "#member-menu-toggle",
    )!;
    const menu = document.querySelector<HTMLElement>("#member-popover")!;
    expect(document.activeElement).toBe(document.body);
    // Like a WebKit pointer click, DOM click() does not focus the button itself.
    toggle.click();
    expect(menu.hidden).toBe(false);
    const focusAfterOpening = document.activeElement;
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(menu.hidden).toBe(true);
    expect(focusAfterOpening).toBe(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
  });

  it("APR-007 dismisses the member menu with Escape and restores its toggle", async () => {
    shellMarkup();
    cacheSession(session());
    serveSession();
    await mountApplicationShell(vi.fn());
    const toggle = document.querySelector<HTMLButtonElement>(
      "#member-menu-toggle",
    )!;
    const menu = document.querySelector<HTMLElement>("#member-popover")!;
    toggle.click();
    menu.querySelector<HTMLAnchorElement>("a")!.focus();
    document.activeElement!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(menu.hidden).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(toggle);
  });

  it("APR-007 dismisses on outside pointer or focus while keeping internal controls usable", async () => {
    shellMarkup();
    cacheSession(session());
    serveSession();
    await mountApplicationShell(vi.fn());
    const toggle = document.querySelector<HTMLButtonElement>(
      "#member-menu-toggle",
    )!;
    const menu = document.querySelector<HTMLElement>("#member-popover")!;
    const profile = menu.querySelector<HTMLAnchorElement>("a")!;
    toggle.click();
    profile.focus();
    profile.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(menu.hidden).toBe(false);
    document.querySelector("#today-heading")!.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true }),
    );
    expect(menu.hidden).toBe(true);
    toggle.click();
    profile.focus();
    document.querySelector<HTMLAnchorElement>(".skip-link")!.focus();
    expect(menu.hidden).toBe(true);
    expect(document.activeElement?.className).toBe("skip-link");
    toggle.click();
    toggle.click();
    expect(menu.hidden).toBe(true);
  });

  it("APR-005 opens an authenticated shell and signs out with storage disabled", async () => {
    shellMarkup();
    document.body.dataset.pageId = "app.today";
    vi.stubGlobal("sessionStorage", {
      getItem() {
        throw new DOMException("Disabled", "SecurityError");
      },
      setItem() {
        throw new DOMException("Full", "QuotaExceededError");
      },
      removeItem() {
        throw new DOMException("Disabled", "SecurityError");
      },
    });
    const api = stubApi({
      [SESSION]: [jsonResponse(session())],
      [SIGN_OUT]: [
        jsonResponse({ status: "signed-out", next: "/auth/sign-in" }),
      ],
    });
    const navigate = vi.fn();

    await mountApplicationShell(navigate);

    expect(document.querySelector<HTMLElement>("#protected-shell")?.hidden)
      .toBe(false);
    document.querySelector<HTMLButtonElement>("#member-sign-out")!.click();
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/auth/sign-in")
    );
    expect(api.calls()).toEqual([SESSION, SIGN_OUT]);
  });

  it.each(["getItem", "setItem"] as const)(
    "APR-005 preserves a confirmed dirty draft when selection %s fails, then retries",
    async (method) => {
      shellMarkup();
      document.body.dataset.pageId = "settings.profile";
      history.replaceState({}, "", "/app/settings/profile");
      const workspaces = [
        { id: "current", name: "Current circle" },
        { id: "other", name: "Other circle" },
      ];
      sessionStorage.setItem("kinship.active-workspace", "current");
      const api = stubApi({
        [SESSION]: [
          jsonResponse(session("current", workspaces)),
          jsonResponse(session("current", workspaces)),
        ],
      });
      vi.stubGlobal("confirm", vi.fn(() => true));
      const navigate = vi.fn();
      await mountApplicationShell(navigate);
      const firstName = draftMarkup("Keep this draft");
      api.route(SESSION, jsonResponse(session("other", workspaces)));
      const storage = sessionStorage;
      vi.stubGlobal("sessionStorage", {
        getItem: storage.getItem.bind(storage),
        setItem: storage.setItem.bind(storage),
        removeItem: storage.removeItem.bind(storage),
        [method]() {
          throw new DOMException("Unavailable", "SecurityError");
        },
      });
      const select = document.querySelector<HTMLSelectElement>(
        "#workspace-switcher",
      )!;
      select.focus();
      select.value = "other";
      select.dispatchEvent(new Event("change", { bubbles: true }));

      await vi.waitFor(() =>
        expect(document.querySelector("#app-toasts")?.textContent).toContain(
          "Browser storage",
        )
      );
      expect(navigate).not.toHaveBeenCalled();
      expect(select.disabled).toBe(false);
      expect(select.value).toBe("current");
      expect(document.activeElement).toBe(select);
      expect(storage.getItem("kinship.active-workspace")).toBe("current");
      expect(firstName.value).toBe("Keep this draft");
      const unload = new Event("beforeunload", { cancelable: true });
      globalThis.dispatchEvent(unload);
      expect(unload.defaultPrevented).toBe(true);

      vi.stubGlobal("sessionStorage", storage);
      select.value = "other";
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() =>
        expect(navigate).toHaveBeenCalledWith("/app/settings/profile")
      );
      expect(storage.getItem("kinship.active-workspace")).toBe("other");
      const later = new Event("beforeunload", { cancelable: true });
      globalThis.dispatchEvent(later);
      expect(later.defaultPrevented).toBe(false);
    },
  );

  it("keeps workspace switching and sign out inside the member popover", () => {
    shellMarkup();

    const popover = document.querySelector("#member-popover")!;
    expect(popover.firstElementChild?.className).toBe("menu-workspace");
    expect(popover.querySelector("#workspace-switcher-container")).not
      .toBeNull();
    expect(popover.lastElementChild?.id).toBe("member-sign-out");
  });

  it("GOVERNANCE-001 interrupts protected navigation for a required version", async () => {
    shellMarkup();
    history.replaceState({}, "", "/app/journal?view=recent");
    document.body.dataset.pageId = "journal.index";
    serveSession({
      requiredLegalDocuments: [{
        content: "Exact terms",
        documentType: "terms",
        id: "00000000-0000-4000-8000-000000000101",
        version: "2026-08",
      }],
    });
    const navigate = vi.fn();

    await mountApplicationShell(navigate);

    expect(navigate).toHaveBeenCalledWith(
      "/app/compliance?next=%2Fapp%2Fjournal%3Fview%3Drecent",
    );
    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
  });

  it("renders access lost when cached session revalidation returns 401", async () => {
    shellMarkup();
    cacheSession(session());
    const invalid = problemResponse(401, { code: "session_invalid" });
    stubApi({
      [SESSION]: [invalid, invalid],
      [ENTRY]: [problemResponse(409, { code: "entry_invalid" })],
    });
    vi.resetModules();
    const { mountApplicationShell: mountFreshShell } = await import(
      "./application-shell.ts"
    );

    await mountFreshShell(vi.fn());

    await vi.waitFor(() =>
      access().getByText(/session is missing, expired, revoked/i)
    );
    expect(sessionStorage.getItem("kinship.session")).toBeNull();
  });

  it("reapplies route gating when cached admin access is demoted", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.members";
    document.querySelector("#protected-shell")?.insertAdjacentHTML(
      "beforeend",
      "<article data-requires-workspace-admin>Privileged members UI</article>",
    );
    cacheSession(session());
    serveSession(asMember);
    vi.resetModules();
    const { mountApplicationShell: mountFreshShell } = await import(
      "./application-shell.ts"
    );

    await mountFreshShell(vi.fn());

    await vi.waitFor(() =>
      access().getByRole("heading", {
        name: "You don’t have access to Members",
      })
    );
    expect(document.body.textContent).not.toContain("Privileged members UI");
  });

  it("reapplies compliance gating after cached session revalidation", async () => {
    shellMarkup();
    history.replaceState({}, "", "/app/journal?view=recent");
    document.body.dataset.pageId = "journal.index";
    cacheSession(session());
    serveSession({
      requiredLegalDocuments: [{
        content: "Exact terms",
        documentType: "terms",
        id: "00000000-0000-4000-8000-000000000101",
        version: "2026-09",
      }],
    });
    const navigate = vi.fn();
    vi.resetModules();
    const { mountApplicationShell: mountFreshShell } = await import(
      "./application-shell.ts"
    );

    await mountFreshShell(navigate);

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith(
        "/app/compliance?next=%2Fapp%2Fjournal%3Fview%3Drecent",
      )
    );
  });

  it("keeps the rendered cached session when revalidation is unavailable", async () => {
    shellMarkup();
    cacheSession(session());
    const api = stubApi({ [SESSION]: unreachable });
    const navigate = vi.fn();
    vi.resetModules();
    const { mountApplicationShell: mountFreshShell } = await import(
      "./application-shell.ts"
    );

    await mountFreshShell(navigate);
    await vi.waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(1));

    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(false);
    expect(document.querySelector("#access-state")?.hasAttribute("hidden"))
      .toBe(true);
    expect(sessionStorage.getItem("kinship.session")).not.toBeNull();
    expect(navigate).not.toHaveBeenCalled();
  });

  it("repaints the workspace presentation when revalidation adds a workspace", async () => {
    shellMarkup();
    const workspaces = [
      { ...family, name: "Renamed family circle" },
      community,
    ];
    cacheSession(session());
    stubApi({ [SESSION]: jsonResponse(session(family.id, workspaces)) });
    vi.resetModules();
    const { mountApplicationShell: mountFreshShell } = await import(
      "./application-shell.ts"
    );

    await mountFreshShell(vi.fn());

    const select = document.querySelector<HTMLSelectElement>(
      "#workspace-switcher",
    )!;
    await vi.waitFor(() => expect(select.options.length).toBe(2));
    expect([...select.options].map((option) => option.textContent)).toEqual([
      "Renamed family circle",
      "Community circle",
    ]);
    expect(document.querySelector("[data-workspace-name]")?.textContent).toBe(
      "Renamed family circle",
    );
    expect(
      document.querySelector<HTMLElement>("#workspace-switcher-container")
        ?.hidden,
    ).toBe(false);
  });
  it.each(["people.audit", "settings.audit"])(
    "renders an audit-specific whole-route forbidden state for members on %s",
    async (pageId) => {
      shellMarkup();
      document.body.dataset.pageId = pageId;
      document.querySelector("#protected-shell")?.insertAdjacentHTML(
        "beforeend",
        "<main>Privileged audit filters</main>",
      );
      serveSession(asMember);

      await mountApplicationShell();

      expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
        .toBe(true);
      access().getByRole("heading", { name: "Audit history unavailable" });
      expect(document.querySelector("#access-state")?.hasAttribute("hidden"))
        .toBe(false);
      expect(access().getByRole("main").id).toBe("forbidden-main-content");
    },
  );

  it.each(["owner", "admin"])(
    "allows the server-resolved %s role to enter an audit route",
    async (role) => {
      shellMarkup();
      document.body.dataset.pageId = "settings.audit";
      serveSession({ member: { id: "administrator", role } });

      await mountApplicationShell();

      expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
        .toBe(false);
      expect(document.querySelector("#access-state")?.hasAttribute("hidden"))
        .toBe(true);
    },
  );

  it.each(["admin", "member"])(
    "blocks the %s role from the owner-only workspace danger route",
    async (role) => {
      shellMarkup();
      document.body.dataset.pageId = "settings.workspace-danger";
      document.querySelector("#protected-shell")?.insertAdjacentHTML(
        "beforeend",
        "<main data-requires-workspace-owner>Workspace deletion controls</main>",
      );
      serveSession({ member: { id: "non-owner", role } });

      await mountApplicationShell();

      expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
        .toBe(true);
      access().getByText(/Only an active workspace owner/);
      expect(document.body.textContent).not.toContain(
        "Workspace deletion controls",
      );
    },
  );

  it("retargets the skip link to the visible forbidden main", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.audit";
    document.querySelector("#protected-shell")?.insertAdjacentHTML(
      "beforeend",
      '<main id="main-content" tabindex="-1">Audit filters</main>',
    );
    serveSession(asMember);

    await mountApplicationShell();

    const skip = document.querySelector<HTMLAnchorElement>(".skip-link")!;
    skip.click();
    const target = document.querySelector<HTMLElement>(skip.hash);
    expect(skip.hash).toBe("#forbidden-main-content");
    expect(target?.closest("#access-state")).not.toBeNull();
    expect(target?.tabIndex).toBe(-1);
    expect(document.querySelectorAll("#forbidden-main-content")).toHaveLength(
      1,
    );
    expect(document.activeElement).toBe(target);
  });

  it("hides admin navigation and renders a whole-route forbidden state for members", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.members";
    document.querySelector("#protected-shell")?.insertAdjacentHTML(
      "beforeend",
      "<article data-requires-workspace-admin>Privileged members UI</article>",
    );
    serveSession(asMember);
    await mountApplicationShell();
    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    access().getByRole("heading", { name: "You don’t have access to Members" });
    expect(document.body.textContent).not.toContain("Privileged members UI");
  });

  it("returns a canonical forbidden state for direct workspace-settings access", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.workspace";
    serveSession(asMember);
    await mountApplicationShell();
    access().getByRole("heading", { name: "Workspace settings unavailable" });
  });

  it("renders a whole-route forbidden state for direct personalization access", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.personalization";
    document.querySelector("#protected-shell")?.insertAdjacentHTML(
      "beforeend",
      "<main data-requires-workspace-admin>Personalization controls</main>",
    );
    serveSession(asMember);

    await mountApplicationShell();

    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    access().getByRole("heading", { name: "Personalization unavailable" });
    expect(document.body.textContent).not.toContain("Personalization controls");
  });

  it("renders the canonical forbidden main for direct member storage access", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.storage";
    document.querySelector("#protected-shell")?.insertAdjacentHTML(
      "beforeend",
      '<main id="main-content" data-requires-workspace-admin>Workspace inventory and provider diagnostics</main>',
    );
    serveSession(asMember);

    await mountApplicationShell();

    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    expect(document.querySelector("#access-state")?.hasAttribute("hidden"))
      .toBe(false);
    expect(access().getByRole("main").id).toBe("forbidden-main-content");
    access().getByRole("heading", { name: "Storage settings unavailable" });
    expect(document.body.textContent).not.toContain(
      "Workspace inventory and provider diagnostics",
    );
  });

  it("renders the canonical forbidden main for direct member export access", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.export";
    document.querySelector("#protected-shell")?.insertAdjacentHTML(
      "beforeend",
      '<main id="main-content" data-requires-workspace-admin>Portable workspace export</main>',
    );
    serveSession(asMember);
    await mountApplicationShell();
    access().getByRole("heading", { name: "Export unavailable" });
    expect(document.body.textContent).not.toContain(
      "Portable workspace export",
    );
  });

  it("reveals one active workspace and signs out without browser token storage", async () => {
    shellMarkup();
    const api = stubApi({
      [SESSION]: [jsonResponse(session())],
      [SIGN_OUT]: [
        jsonResponse({ status: "signed-out", next: "/auth/sign-in" }),
      ],
    });
    const navigate = vi.fn();
    const skipLink = document.querySelector<HTMLAnchorElement>(".skip-link")!;
    skipLink.focus();

    await mountApplicationShell(navigate);

    expect(document.activeElement).toBe(skipLink);
    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(false);
    expect(document.querySelector("[data-workspace-name]")?.textContent).toBe(
      "Family circle",
    );
    expect(document.querySelectorAll("#app-toasts > li")).toHaveLength(0);
    expect(document.querySelector("#today-heading")?.textContent).toBe(
      "Welcome back.",
    );
    expect(document.querySelector("time")?.getAttribute("datetime")).toBeNull();
    expect(document.querySelector("time")?.textContent).toBe("Loading date…");
    document.querySelector<HTMLButtonElement>("#member-menu-toggle")?.click();
    expect(document.querySelector("#member-popover")?.hasAttribute("hidden"))
      .toBe(false);
    expect(
      document.querySelector("#workspace-switcher-container")?.hasAttribute(
        "hidden",
      ),
    ).toBe(true);
    expect(localStorage.length).toBe(0);

    document.querySelector<HTMLButtonElement>("#member-sign-out")?.click();
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/auth/sign-in")
    );
    expect(sessionStorage.getItem("kinship.session")).toBeNull();
    expect(api.calls()[1]).toBe("POST /api/v1/sign-out");
  });

  it("shows and changes the switcher only for multiple accessible workspaces", async () => {
    shellMarkup();
    history.replaceState({}, "", "/app/settings/members");
    document.body.dataset.pageId = "settings.members";
    const workspaces = [family, community];
    const api = stubApi({
      [SESSION]: [
        jsonResponse(session(family.id, workspaces)),
        unreachable,
        jsonResponse(session(community.id, workspaces)),
      ],
    });

    const navigate = vi.fn();
    await mountApplicationShell(navigate);
    const container = document.querySelector<HTMLElement>(
      "#workspace-switcher-container",
    );
    const select = document.querySelector<HTMLSelectElement>(
      "#workspace-switcher",
    )!;
    expect(container?.hasAttribute("hidden")).toBe(false);
    expect(select.options).toHaveLength(2);
    select.focus();
    select.value = workspaces[1]!.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(document.querySelector("#app-toasts")?.textContent).toMatch(
        /no longer available/i,
      )
    );
    expect(select.value).toBe(workspaces[0]!.id);
    expect(document.activeElement).toBe(select);
    expect(navigate).not.toHaveBeenCalled();

    select.value = workspaces[1]!.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/app/settings/members")
    );
    expect(api.fetch.mock.calls[1]?.[1]?.headers).toEqual({
      "X-Workspace-Id": workspaces[1]!.id,
      "content-type": "application/json",
    });
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      workspaces[1]!.id,
    );
    expect(sessionStorage.getItem("kinship.session")).toBeNull();
    expect(api.fetch.mock.calls[2]?.[1]?.headers).toEqual({
      "X-Workspace-Id": workspaces[1]!.id,
      "content-type": "application/json",
    });
  });

  it("cancels a dirty workspace switch before changing selection or storage", async () => {
    shellMarkup();
    const workspaces = [family, community];
    sessionStorage.setItem("kinship.active-workspace", workspaces[0]!.id);
    const api = stubApi({
      [SESSION]: jsonResponse(session(family.id, workspaces)),
    });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const navigate = vi.fn();

    await mountApplicationShell(navigate);
    const firstName = draftMarkup("Unsaved for family");
    const reads = api.fetch.mock.calls.length;
    const select = document.querySelector<HTMLSelectElement>(
      "#workspace-switcher",
    )!;
    select.focus();
    select.value = workspaces[1]!.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(api.fetch).toHaveBeenCalledTimes(reads);
    expect(select.value).toBe(workspaces[0]!.id);
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      workspaces[0]!.id,
    );
    expect(firstName.value).toBe("Unsaved for family");
    expect(document.querySelector("#app-toasts")?.textContent).toMatch(
      /canceled/i,
    );
    expect(document.activeElement).toBe(select);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("discards dirty state once before committing a workspace switch", async () => {
    shellMarkup();
    history.replaceState({}, "", "/app/settings/profile");
    const workspaces = [family, community];
    sessionStorage.setItem("kinship.active-workspace", workspaces[0]!.id);
    stubApi({
      [SESSION]: [
        jsonResponse(session(family.id, workspaces)),
        jsonResponse(session(community.id, workspaces)),
      ],
    });
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const navigate = vi.fn();

    await mountApplicationShell(navigate);
    draftMarkup("Discard this");
    const select = document.querySelector<HTMLSelectElement>(
      "#workspace-switcher",
    )!;
    select.value = workspaces[1]!.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith("/app/settings/profile")
    );
    expect(confirm).toHaveBeenCalledOnce();
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      workspaces[1]!.id,
    );
    const unload = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("retains a saved workspace when its session request is offline", async () => {
    shellMarkup();
    const savedWorkspaceId = "00000000-0000-4000-8000-000000000099";
    sessionStorage.setItem("kinship.active-workspace", savedWorkspaceId);
    const api = stubApi({ [SESSION]: unreachable });

    await mountApplicationShell(vi.fn());

    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(api.fetch.mock.calls[0]?.[1]?.headers).toEqual({
      "X-Workspace-Id": savedWorkspaceId,
      "content-type": "application/json",
    });
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      savedWorkspaceId,
    );
    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    access().getByRole("heading", { name: /temporarily unavailable/i });
    expect(access().getByRole("button", { name: "Try again" }).hidden)
      .toBe(false);
  });

  it("retains a saved workspace when its session request returns 503", async () => {
    shellMarkup();
    const savedWorkspaceId = "00000000-0000-4000-8000-000000000099";
    sessionStorage.setItem("kinship.active-workspace", savedWorkspaceId);
    const api = stubApi({
      [SESSION]: problemResponse(503, { code: "session_unavailable" }),
    });

    await mountApplicationShell(vi.fn());

    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      savedWorkspaceId,
    );
    access().getByRole("heading", { name: /temporarily unavailable/i });
  });

  it("clears a definitively stale workspace only after resolving a valid default", async () => {
    shellMarkup();
    const savedWorkspaceId = "00000000-0000-4000-8000-000000000099";
    sessionStorage.setItem("kinship.active-workspace", savedWorkspaceId);
    const api = stubApi({
      [SESSION]: [
        problemResponse(401, { code: "session_invalid" }),
        jsonResponse(session()),
      ],
    });

    await mountApplicationShell(vi.fn());

    expect(api.fetch).toHaveBeenCalledTimes(2);
    expect(api.fetch.mock.calls[0]?.[1]?.headers).toEqual({
      "X-Workspace-Id": savedWorkspaceId,
      "content-type": "application/json",
    });
    expect(api.fetch.mock.calls[1]?.[1]?.headers).toEqual({
      "content-type": "application/json",
    });
    expect(sessionStorage.getItem("kinship.active-workspace")).toBeNull();
    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(false);
    expect(document.querySelector("[data-workspace-name]")?.textContent).toBe(
      "Family circle",
    );
  });

  it("shows sign-in after definitive session and entry access loss", async () => {
    shellMarkup();
    stubApi({
      [SESSION]: [problemResponse(401, { code: "session_invalid" })],
      [ENTRY]: [problemResponse(409, { code: "entry_handoff_invalid" })],
    });

    await mountApplicationShell(vi.fn());

    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    access().getByText(/missing, expired, revoked, or no longer active/i);
    expect(
      access().getByRole<HTMLAnchorElement>("link", { name: "Go to sign-in" })
        .href,
    ).toContain("/auth/sign-in");
  });

  it("exchanges a first-workspace entry before revealing the shell", async () => {
    shellMarkup();
    const api = stubApi({
      [SESSION]: [
        problemResponse(401, { code: "session_invalid" }),
        jsonResponse(session()),
      ],
      [ENTRY]: [jsonResponse({
        status: "ready",
        workspace: family,
        member: {
          id: "00000000-0000-4000-8000-000000000020",
          firstName: "Avery",
        },
      })],
    });

    await mountApplicationShell(vi.fn());

    expect(api.calls()).toEqual([SESSION, ENTRY, SESSION]);
    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(false);
    expect(document.querySelectorAll("#app-toasts > li")).toHaveLength(0);
    expect(document.querySelector("#today-heading")?.textContent).toBe(
      "Welcome, Avery.",
    );
  });

  it("keeps later session errors visible without a routine mount notice", async () => {
    vi.useFakeTimers();
    shellMarkup();
    stubApi({ [SESSION]: [jsonResponse(session())], [SIGN_OUT]: unreachable });

    await mountApplicationShell(vi.fn());
    const toasts = document.querySelector<HTMLElement>("#app-toasts")!;
    expect(toasts.children).toHaveLength(0);

    document.querySelector<HTMLButtonElement>("#member-sign-out")!.click();
    expect(toasts.textContent).toContain("Signing out securely…");
    await vi.advanceTimersByTimeAsync(0);
    expect(toasts.textContent).toMatch(/could not be revoked/i);

    await vi.advanceTimersByTimeAsync(10_000);
    expect(toasts.textContent).toMatch(/could not be revoked/i);
  });

  it("keeps a failed sign-out retryable and does not navigate", async () => {
    shellMarkup();
    stubApi({ [SESSION]: [jsonResponse(session())], [SIGN_OUT]: unreachable });
    const navigate = vi.fn();

    await mountApplicationShell(navigate);
    const signOutButton = document.querySelector<HTMLButtonElement>(
      "#member-sign-out",
    )!;
    signOutButton.focus();
    signOutButton.click();

    await vi.waitFor(() =>
      expect(document.querySelector("#app-toasts")?.textContent).toMatch(
        /could not be revoked/i,
      )
    );
    expect(navigate).not.toHaveBeenCalled();
    expect(
      document.querySelector<HTMLButtonElement>("#member-sign-out")?.disabled,
    )
      .toBe(false);
    expect(document.activeElement).toBe(signOutButton);
  });

  it("does not mount without the required shell elements", async () => {
    drawShell("<main></main>");
    await mountApplicationShell(vi.fn());
    expect(document.body.innerHTML).toBe("<main></main>");
  });

  it("does not consume application entry when session resolution is offline", async () => {
    shellMarkup();
    const api = stubApi({ [SESSION]: unreachable });

    await mountApplicationShell(vi.fn());

    expect(api.fetch).toHaveBeenCalledTimes(1);
    access().getByRole("heading", { name: /temporarily unavailable/i });
  });

  it("fails closed when an exchanged entry cannot resolve its session", async () => {
    shellMarkup();
    stubApi({
      [SESSION]: [
        problemResponse(401, { code: "session_invalid" }),
        unreachable,
      ],
      [ENTRY]: [jsonResponse({
        status: "ready",
        workspace: { id: "workspace", name: "Circle" },
        member: { id: "member", firstName: "Avery" },
      })],
    });

    await mountApplicationShell(vi.fn());

    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
  });

  it("GAP-033 answers a lost session from the layout's template and focuses it", async () => {
    shellMarkup();
    stubApi({
      [SESSION]: [problemResponse(401, { code: "session_invalid" })],
      [ENTRY]: [problemResponse(409, { code: "entry_handoff_invalid" })],
    });

    await mountApplicationShell(vi.fn());

    const state = document.querySelector<HTMLElement>("#access-state")!;
    expect(state.textContent).not.toContain("Checking");
    expect(access().getByRole("heading", { level: 1 }).textContent).toBe(
      "Sign in to Kinship",
    );
    expect(document.activeElement).toBe(state);
    expect(
      document.querySelector<HTMLTemplateElement>("#access-sign-in-template")
        ?.content.childElementCount,
    ).toBe(3);
  });

  it("GAP-033 reloads the page from the unavailable state's Try again", async () => {
    shellMarkup();
    stubApi({ [SESSION]: unreachable });
    const reload = vi.fn();
    vi.stubGlobal("location", { ...globalThis.location, reload });

    await mountApplicationShell(vi.fn());
    access().getByRole("button", { name: "Try again" }).click();

    expect(reload).toHaveBeenCalledOnce();
  });

  it("GAP-033 still hides the shell on a page without the access templates", async () => {
    drawShell(`
      <section id="access-state" role="status" tabindex="-1">Checking</section>
      <div id="protected-shell">
        <div id="workspace-switcher-container"><select id="workspace-switcher"></select></div>
        <button id="member-sign-out" type="button">Sign out</button>
      </div>`);
    document.body.dataset.pageId = "settings.members";
    serveSession(asMember);

    await mountApplicationShell(vi.fn());

    expect(document.querySelector<HTMLElement>("#protected-shell")?.hidden)
      .toBe(true);
    expect(document.querySelector("#access-state")?.childElementCount).toBe(0);
  });

  it("GAP-033 draws no workspace option on a page without the option template", async () => {
    drawShell(`
      <section id="access-state" role="status" tabindex="-1">Checking</section>
      <div id="protected-shell" hidden>
        <div id="workspace-switcher-container" hidden><select id="workspace-switcher"></select></div>
        <button id="member-sign-out" type="button">Sign out</button>
      </div>`);
    stubApi({
      [SESSION]: jsonResponse(session(family.id, [family, community])),
    });

    await mountApplicationShell(vi.fn());

    expect(document.querySelector<HTMLElement>("#protected-shell")?.hidden)
      .toBe(false);
    expect(
      document.querySelector<HTMLSelectElement>("#workspace-switcher")?.options,
    ).toHaveLength(0);
  });
});

describe("GAP-033 forbidden route copy", () => {
  it.each([
    ["settings.members", "You don’t have access to Members", "view members"],
    ["settings.workspace", "Workspace settings unavailable", "identity"],
    [
      "settings.personalization",
      "Personalization unavailable",
      "personalization",
    ],
    ["settings.storage", "Storage settings unavailable", "provider health"],
    ["settings.import", "Import unavailable", "import workspace data"],
    ["settings.import-report", "Import unavailable", "import workspace data"],
    ["settings.export", "Export unavailable", "export workspace data"],
    ["settings.audit", "Audit history unavailable", "review audit history"],
    [
      "settings.workspace-danger",
      "Workspace danger zone unavailable",
      "reset or delete",
    ],
    ["settings.unknown", "You don’t have access to Members", "view members"],
    [undefined, "You don’t have access to Members", "view members"],
  ])("names %s as %s", (pageId, heading, detail) => {
    const copy = forbiddenCopy(pageId);
    expect(copy.heading).toBe(heading);
    expect(copy.detail).toContain(detail);
    expect([copy.returnHref, copy.returnLabel]).toEqual([
      "/app/settings",
      "Return to settings",
    ]);
  });

  it("sends people audit back to people", () => {
    expect(forbiddenCopy("people.audit")).toEqual({
      detail: "Only workspace owners and admins can review audit history.",
      heading: "Audit history unavailable",
      returnHref: "/app/people",
      returnLabel: "Return to people",
    });
  });

  it("renders the page's copy and return link in the forbidden main", async () => {
    shellMarkup();
    document.body.dataset.pageId = "people.audit";
    serveSession(asMember);

    await mountApplicationShell(vi.fn());

    const main = access().getByRole("main");
    expect(within(main).getByRole("heading", { level: 1 }).textContent).toBe(
      "Audit history unavailable",
    );
    expect(
      within(main).getByRole<HTMLAnchorElement>("link", {
        name: "Return to people",
      }).getAttribute("href"),
    ).toBe("/app/people");
  });
});
