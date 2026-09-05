// @vitest-environment happy-dom

vi.mock("./time-presentation.ts", async (original) => ({
  ...await original<typeof import("./time-presentation.ts")>(),
  loadTimePreferences: vi.fn().mockResolvedValue({
    locale: "en",
    effectiveTimezone: "UTC",
  }),
}));

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountMembersPage } from "./members.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function markup(managed = false): HTMLFormElement {
  document.body.innerHTML = `
    <form id="invitation-form"><input name="email" value="invitee@example.test"><select name="role"><option value="member">Member</option><option value="admin">Admin</option></select><button type="submit">Send</button></form>
    <p id="invitation-status"></p><span id="invitation-count"></span><span id="member-count"></span>
    <ul id="member-list" hidden></ul><div id="members-state"></div>
    <ul id="pending-list" hidden></ul><div id="pending-state"></div>
    ${
    managed
      ? '<ul id="managed-list" hidden></ul><p id="managed-state" hidden></p>'
      : ""
  }`;
  return document.querySelector<HTMLFormElement>("form")!;
}

const session = {
  status: "authenticated",
  principal: { userId: "user" },
  workspace: { id: "workspace", name: "Circle" },
  member: { id: "member", role: "owner" },
  workspaces: [{ id: "workspace", name: "Circle" }],
};

const members = {
  status: "ready",
  members: [{
    id: "member",
    email: "owner@example.test",
    name: "Owner Person",
    role: "owner",
    status: "active",
  }],
  invitations: [{
    id: "invite",
    email: "pending@example.test",
    role: "member",
    status: "pending",
    createdAt: "2026-08-15T12:00:00Z",
    expiresAt: "2026-08-22T12:00:00Z",
  }],
};

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("AUTH-002 members settings", () => {
  it("recovers a stale saved workspace through one valid default session", async () => {
    markup();
    const staleWorkspace = "00000000-0000-4000-8000-000000000099";
    sessionStorage.setItem("kinship.active-workspace", staleWorkspace);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ code: "session_invalid", status: 401 }, 401),
      )
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(members));
    vi.stubGlobal("fetch", fetchMock);

    await mountMembersPage();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toEqual({
      "X-Workspace-Id": staleWorkspace,
      "content-type": "application/json",
    });
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      "content-type": "application/json",
    });
    expect(sessionStorage.getItem("kinship.active-workspace")).toBeNull();
    expect(document.querySelector("#member-list")?.textContent).toContain(
      "Owner Person",
    );
  });

  it("retains a saved workspace on transport, 503, and 403 session failures", async () => {
    const staleWorkspace = "00000000-0000-4000-8000-000000000099";
    for (
      const failure of [
        new Error("offline"),
        response({ code: "session_unavailable", status: 503 }, 503),
        response({ code: "session_forbidden", status: 403 }, 403),
      ]
    ) {
      markup();
      sessionStorage.setItem("kinship.active-workspace", staleWorkspace);
      const fetchMock = vi.fn();
      if (failure instanceof Error) fetchMock.mockRejectedValueOnce(failure);
      else fetchMock.mockResolvedValueOnce(failure);
      vi.stubGlobal("fetch", fetchMock);

      await mountMembersPage();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(sessionStorage.getItem("kinship.active-workspace")).toBe(
        staleWorkspace,
      );
      expect(document.querySelector("#members-state")?.textContent).toMatch(
        /session could not be confirmed/i,
      );
      sessionStorage.clear();
    }
  });

  it("renders lists and submits one generated-client invitation", async () => {
    const form = markup();
    const selectedWorkspaceId = "selected-workspace";
    sessionStorage.setItem("kinship.active-workspace", selectedWorkspaceId);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        ...session,
        workspace: { id: selectedWorkspaceId, name: "Selected circle" },
      }))
      .mockResolvedValueOnce(response(members))
      .mockResolvedValueOnce(response({ status: "invited" }, 201))
      .mockResolvedValueOnce(response({ ...members, invitations: [] }));
    vi.stubGlobal("fetch", fetchMock);
    await mountMembersPage();
    expect(document.querySelector("#member-list")?.textContent).toContain(
      "Owner Person",
    );
    expect(document.querySelector("#pending-list")?.textContent).toContain(
      "pending@example.test",
    );
    expect(document.querySelector("#member-count")?.textContent).toBe(
      "1 active",
    );
    form.querySelector<HTMLSelectElement>("select")!.value = "admin";
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls.map((call) => call[1]?.headers)).toEqual([
      {
        "X-Workspace-Id": selectedWorkspaceId,
        "content-type": "application/json",
      },
      {
        "X-Workspace-Id": selectedWorkspaceId,
        "content-type": "application/json",
      },
      {
        "X-Workspace-Id": selectedWorkspaceId,
        "content-type": "application/json",
      },
      {
        "X-Workspace-Id": selectedWorkspaceId,
        "content-type": "application/json",
      },
    ]);
    expect(fetchMock.mock.calls[2]?.[1]?.body).toBe(
      JSON.stringify({ email: "invitee@example.test", role: "admin" }),
    );
    expect(document.querySelector("#invitation-status")?.textContent).toMatch(
      /seven days/i,
    );
    expect(document.querySelector("#pending-state")?.textContent).toMatch(
      /no pending/i,
    );
  });

  it("shows role denial and unavailable states honestly", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(
          response({ code: "members_forbidden", status: 403 }, 403),
        ),
    );
    await mountMembersPage();
    expect(document.querySelector<HTMLFormElement>("form")?.hidden).toBe(true);
    expect(document.querySelector("#members-state")?.textContent).toMatch(
      /owners and admins/i,
    );

    markup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await mountMembersPage();
    expect(document.querySelector("#members-state")?.textContent).toMatch(
      /session could not/i,
    );
  });

  it("handles invitation failures and incomplete markup", async () => {
    const form = markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(
          response({ ...members, members: [], invitations: [] }),
        )
        .mockResolvedValueOnce(
          response(
            { code: "already_member", status: 409, detail: "Already" },
            409,
          ),
        ),
    );
    await mountMembersPage();
    form.dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("#invitation-status")?.textContent).toMatch(
        /already/i,
      )
    );
    document.body.innerHTML = "<main></main>";
    await expect(mountMembersPage()).resolves.toBeUndefined();
  });

  it("keeps a successful member update announcement visible after refresh", async () => {
    markup(true);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(members))
      .mockResolvedValueOnce(
        response({ status: "ready", members: members.members }),
      )
      .mockResolvedValueOnce(
        response({ status: "ready", member: members.members[0] }),
      )
      .mockResolvedValueOnce(
        response({ status: "ready", members: members.members }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountMembersPage();
    document.querySelector<HTMLButtonElement>("#managed-list button")!.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const state = document.querySelector<HTMLElement>("#managed-state")!;
    expect(state.hidden).toBe(false);
    expect(state.textContent).toBe("owner@example.test updated.");
  });
});
