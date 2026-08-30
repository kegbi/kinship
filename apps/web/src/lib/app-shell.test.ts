// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountApplicationShell, mountSettingsSearch } from "./app-shell.ts";
import { mountProfileSettings } from "./settings.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function shellMarkup(): void {
  document.body.innerHTML = `
    <a class="skip-link" href="#main-content">Skip to main content</a>
    <section id="access-state" role="status">Checking</section>
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
          </div>
        </div>
        <a href="/app/settings/profile">Profile</a>
        <a href="/app/settings">Settings</a>
        <button id="member-sign-out" type="button">Sign out</button>
      </div>
      <ul id="app-toasts" aria-live="polite" aria-label="Notifications"></ul>
    </div>`;
}

function profileMarkup(): void {
  document.querySelector("#protected-shell")?.insertAdjacentHTML(
    "beforeend",
    `<form id="profile-form"><div id="settings-errors" hidden></div><input name="email"><input name="firstName"><input name="lastName"><button type="submit">Save changes</button><p id="settings-dirty"></p></form><p id="settings-status"></p>`,
  );
}

function session(
  activeId = "00000000-0000-4000-8000-000000000001",
  workspaces = [
    {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Family circle",
    },
  ],
): unknown {
  return {
    status: "authenticated",
    principal: { userId: "00000000-0000-4000-8000-000000000010" },
    workspace: workspaces.find((workspace) => workspace.id === activeId),
    member: {
      id: "00000000-0000-4000-8000-000000000020",
      role: "owner",
    },
    workspaces,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
});

describe("APP-002C protected application shell", () => {
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        ...(session() as Record<string, unknown>),
        requiredLegalDocuments: [{
          content: "Exact terms",
          documentType: "terms",
          id: "00000000-0000-4000-8000-000000000101",
          version: "2026-08",
        }],
      })),
    );
    const navigate = vi.fn();

    await mountApplicationShell(navigate);

    expect(navigate).toHaveBeenCalledWith(
      "/app/compliance?next=%2Fapp%2Fjournal%3Fview%3Drecent",
    );
    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
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
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response({
          ...(session() as Record<string, unknown>),
          member: { id: "member", role: "member" },
        })),
      );

      await mountApplicationShell();

      expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
        .toBe(true);
      expect(document.querySelector("#access-state")?.textContent).toContain(
        "Audit history unavailable",
      );
      expect(document.querySelector("#access-state")?.hasAttribute("hidden"))
        .toBe(false);
      expect(document.querySelector("#access-state main")).not.toBeNull();
    },
  );

  it.each(["owner", "admin"])(
    "allows the server-resolved %s role to enter an audit route",
    async (role) => {
      shellMarkup();
      document.body.dataset.pageId = "settings.audit";
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response({
          ...(session() as Record<string, unknown>),
          member: { id: "administrator", role },
        })),
      );

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
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response({
          ...(session() as Record<string, unknown>),
          member: { id: "non-owner", role },
        })),
      );

      await mountApplicationShell();

      expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
        .toBe(true);
      expect(document.querySelector("#access-state")?.textContent).toContain(
        "Only an active workspace owner",
      );
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        ...(session() as Record<string, unknown>),
        member: { id: "member", role: "member" },
      })),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        ...(session() as Record<string, unknown>),
        member: { id: "member", role: "member" },
      })),
    );
    await mountApplicationShell();
    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    expect(document.querySelector("#access-state")?.textContent).toContain(
      "You don’t have access to Members",
    );
    expect(document.body.textContent).not.toContain("Privileged members UI");
  });

  it("returns a canonical forbidden state for direct workspace-settings access", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.workspace";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        ...(session() as Record<string, unknown>),
        member: { id: "member", role: "member" },
      })),
    );
    await mountApplicationShell();
    expect(document.querySelector("#access-state")?.textContent).toContain(
      "Workspace settings unavailable",
    );
  });

  it("renders a whole-route forbidden state for direct personalization access", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.personalization";
    document.querySelector("#protected-shell")?.insertAdjacentHTML(
      "beforeend",
      "<main data-requires-workspace-admin>Personalization controls</main>",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        ...(session() as Record<string, unknown>),
        member: { id: "member", role: "member" },
      })),
    );

    await mountApplicationShell();

    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    expect(document.querySelector("#access-state")?.textContent).toContain(
      "Personalization unavailable",
    );
    expect(document.body.textContent).not.toContain("Personalization controls");
  });

  it("renders the canonical forbidden main for direct member storage access", async () => {
    shellMarkup();
    document.body.dataset.pageId = "settings.storage";
    document.querySelector("#protected-shell")?.insertAdjacentHTML(
      "beforeend",
      '<main id="main-content" data-requires-workspace-admin>Workspace inventory and provider diagnostics</main>',
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        ...(session() as Record<string, unknown>),
        member: { id: "member", role: "member" },
      })),
    );

    await mountApplicationShell();

    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    expect(document.querySelector("#access-state")?.hasAttribute("hidden"))
      .toBe(false);
    expect(document.querySelector("#access-state main")?.id).toBe(
      "forbidden-main-content",
    );
    expect(document.querySelector("#access-state")?.textContent).toContain(
      "Storage settings unavailable",
    );
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        ...(session() as Record<string, unknown>),
        member: { id: "member", role: "member" },
      })),
    );
    await mountApplicationShell();
    expect(document.querySelector("#access-state")?.textContent).toContain(
      "Export unavailable",
    );
    expect(document.body.textContent).not.toContain(
      "Portable workspace export",
    );
  });

  it("reveals one active workspace and signs out without browser token storage", async () => {
    shellMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        status: "signed-out",
        next: "/auth/sign-in",
      }));
    vi.stubGlobal("fetch", fetchMock);
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
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/sign-out");
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");
  });

  it("shows and changes the switcher only for multiple accessible workspaces", async () => {
    shellMarkup();
    history.replaceState({}, "", "/app/settings/members");
    document.body.dataset.pageId = "settings.members";
    const workspaces = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Family circle",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Community circle",
      },
    ];
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session(workspaces[0]!.id, workspaces)))
      .mockRejectedValueOnce(new Error("workspace unavailable"))
      .mockResolvedValueOnce(response(session(workspaces[1]!.id, workspaces)));
    vi.stubGlobal("fetch", fetchMock);

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
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      "X-Workspace-Id": workspaces[1]!.id,
      "content-type": "application/json",
    });
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      workspaces[1]!.id,
    );
    expect(fetchMock.mock.calls[2]?.[1]?.headers).toEqual({
      "X-Workspace-Id": workspaces[1]!.id,
      "content-type": "application/json",
    });
  });

  it("cancels a dirty workspace switch before changing selection or storage", async () => {
    shellMarkup();
    profileMarkup();
    const workspaces = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Family circle",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Community circle",
      },
    ];
    sessionStorage.setItem("kinship.active-workspace", workspaces[0]!.id);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session(workspaces[0]!.id, workspaces)))
      .mockResolvedValueOnce(response(session(workspaces[0]!.id, workspaces)))
      .mockResolvedValueOnce(response({
        status: "ready",
        profile: {
          email: "owner@example.test",
          firstName: "Original",
          lastName: "Owner",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const navigate = vi.fn();

    await mountApplicationShell(navigate);
    await mountProfileSettings();
    const firstName = document.querySelector<HTMLInputElement>(
      '[name="firstName"]',
    )!;
    firstName.value = "Unsaved for family";
    firstName.dispatchEvent(new Event("input", { bubbles: true }));
    const select = document.querySelector<HTMLSelectElement>(
      "#workspace-switcher",
    )!;
    select.focus();
    select.value = workspaces[1]!.id;
    select.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => expect(confirm).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(select.value).toBe(workspaces[0]!.id);
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      workspaces[0]!.id,
    );
    expect(firstName.value).toBe("Unsaved for family");
    expect(document.querySelector("#profile-form")?.getAttribute("data-dirty"))
      .toBe("true");
    expect(document.querySelector("#app-toasts")?.textContent).toMatch(
      /canceled/i,
    );
    expect(document.activeElement).toBe(select);
    expect(navigate).not.toHaveBeenCalled();
  });

  it("discards dirty state once before committing a workspace switch", async () => {
    shellMarkup();
    profileMarkup();
    history.replaceState({}, "", "/app/settings/profile");
    const workspaces = [
      {
        id: "00000000-0000-4000-8000-000000000001",
        name: "Family circle",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        name: "Community circle",
      },
    ];
    sessionStorage.setItem("kinship.active-workspace", workspaces[0]!.id);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session(workspaces[0]!.id, workspaces)))
      .mockResolvedValueOnce(response(session(workspaces[0]!.id, workspaces)))
      .mockResolvedValueOnce(response({
        status: "ready",
        profile: {
          email: "owner@example.test",
          firstName: "Original",
          lastName: "Owner",
        },
      }))
      .mockResolvedValueOnce(response(session(workspaces[1]!.id, workspaces)));
    vi.stubGlobal("fetch", fetchMock);
    const confirm = vi.fn(() => true);
    vi.stubGlobal("confirm", confirm);
    const navigate = vi.fn();

    await mountApplicationShell(navigate);
    await mountProfileSettings();
    const firstName = document.querySelector<HTMLInputElement>(
      '[name="firstName"]',
    )!;
    firstName.value = "Discard this";
    firstName.dispatchEvent(new Event("input", { bubbles: true }));
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
    expect(document.querySelector("#profile-form")?.getAttribute("data-dirty"))
      .toBe("false");
    const unload = new Event("beforeunload", { cancelable: true });
    globalThis.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(false);
  });

  it("retains a saved workspace when its session request is offline", async () => {
    shellMarkup();
    const savedWorkspaceId = "00000000-0000-4000-8000-000000000099";
    sessionStorage.setItem(
      "kinship.active-workspace",
      savedWorkspaceId,
    );
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await mountApplicationShell(vi.fn());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      "X-Workspace-Id": savedWorkspaceId,
      "content-type": "application/json",
    });
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      savedWorkspaceId,
    );
    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    expect(document.querySelector("#access-state")?.textContent).toMatch(
      /temporarily unavailable/i,
    );
    expect(
      document.querySelector<HTMLButtonElement>("#access-state button")
        ?.textContent,
    ).toMatch(/try again/i);
  });

  it("retains a saved workspace when its session request returns 503", async () => {
    shellMarkup();
    const savedWorkspaceId = "00000000-0000-4000-8000-000000000099";
    sessionStorage.setItem("kinship.active-workspace", savedWorkspaceId);
    const fetchMock = vi.fn().mockResolvedValue(
      response({ code: "session_unavailable", status: 503 }, 503),
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountApplicationShell(vi.fn());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
      savedWorkspaceId,
    );
    expect(document.querySelector("#access-state")?.textContent).toMatch(
      /temporarily unavailable/i,
    );
  });

  it("clears a definitively stale workspace only after resolving a valid default", async () => {
    shellMarkup();
    const savedWorkspaceId = "00000000-0000-4000-8000-000000000099";
    sessionStorage.setItem("kinship.active-workspace", savedWorkspaceId);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ code: "session_invalid", status: 401 }, 401),
      )
      .mockResolvedValueOnce(response(session()));
    vi.stubGlobal("fetch", fetchMock);

    await mountApplicationShell(vi.fn());

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      "X-Workspace-Id": savedWorkspaceId,
      "content-type": "application/json",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          response({ code: "session_invalid", status: 401 }, 401),
        )
        .mockResolvedValueOnce(
          response({ code: "entry_handoff_invalid", status: 409 }, 409),
        ),
    );

    await mountApplicationShell(vi.fn());

    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
    expect(document.querySelector("#access-state")?.textContent).toMatch(
      /missing, expired, revoked, or no longer active/i,
    );
    expect(document.querySelector<HTMLAnchorElement>("#access-state a")?.href)
      .toContain("/auth/sign-in");
  });

  it("exchanges a first-workspace entry before revealing the shell", async () => {
    shellMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ code: "session_invalid", status: 401 }, 401),
      )
      .mockResolvedValueOnce(response({
        status: "ready",
        workspace: {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Family circle",
        },
        member: {
          id: "00000000-0000-4000-8000-000000000020",
          firstName: "Avery",
        },
      }))
      .mockResolvedValueOnce(response(session()));
    vi.stubGlobal("fetch", fetchMock);

    await mountApplicationShell(vi.fn());

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/session",
      "/api/v1/application-entry",
      "/api/v1/session",
    ]);
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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session()))
        .mockRejectedValueOnce(new Error("offline")),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session()))
        .mockRejectedValueOnce(new Error("offline")),
    );
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

  it("does not mount without the required shell or settings elements", async () => {
    document.body.innerHTML = "<main></main>";
    await mountApplicationShell(vi.fn());
    mountSettingsSearch();
    expect(document.body.innerHTML).toBe("<main></main>");
  });

  it("does not consume application entry when session resolution is offline", async () => {
    shellMarkup();
    const fetchMock = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await mountApplicationShell(vi.fn());

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector("#access-state")?.textContent).toMatch(
      /temporarily unavailable/i,
    );
  });

  it("fails closed when an exchanged entry cannot resolve its session", async () => {
    shellMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          response({ code: "session_invalid", status: 401 }, 401),
        )
        .mockResolvedValueOnce(response({
          status: "ready",
          workspace: { id: "workspace", name: "Circle" },
          member: { id: "member", firstName: "Avery" },
        }))
        .mockRejectedValueOnce(new Error("offline")),
    );

    await mountApplicationShell(vi.fn());

    expect(document.querySelector("#protected-shell")?.hasAttribute("hidden"))
      .toBe(true);
  });

  it("filters the grouped settings overview without mutating settings", () => {
    document.body.innerHTML = `
      <label for="settings-search">Search settings</label>
      <input id="settings-search" type="search">
      <article data-settings-item data-search="profile name email">Profile</article>
      <article data-settings-item data-search="security sessions password">Security</article>
      <p id="settings-no-results" hidden>No settings match.</p>`;

    mountSettingsSearch();
    const input = document.querySelector<HTMLInputElement>("#settings-search")!;
    input.value = "password";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    const items = document.querySelectorAll<HTMLElement>(
      "[data-settings-item]",
    );
    expect(items[0]?.hidden).toBe(true);
    expect(items[1]?.hidden).toBe(false);
    input.value = "unknown";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(
      document.querySelector("#settings-no-results")?.hasAttribute(
        "hidden",
      ),
    ).toBe(false);
  });
});
