// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveWorkspaceSession,
  updateCachedSessionUiState,
} from "./workspace-context.ts";

const SESSION_CACHE_KEY = "kinship.session";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const session = {
  member: { id: "member", role: "owner" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: "workspace", name: "Circle" },
  workspaces: [{ id: "workspace", name: "Circle" }],
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("protected workspace session resolution", () => {
  it.each(["getItem", "setItem", "removeItem"] as const)(
    "APR-005 reaches the API when storage %s throws",
    async (method) => {
      sessionStorage.setItem(
        SESSION_CACHE_KEY,
        JSON.stringify({
          savedAt: Date.now(),
          session: { ...session, principal: { userId: "previous-user" } },
        }),
      );
      const storage = sessionStorage;
      vi.stubGlobal("sessionStorage", {
        getItem: storage.getItem.bind(storage),
        setItem: storage.setItem.bind(storage),
        removeItem: storage.removeItem.bind(storage),
        [method]() {
          throw new DOMException("Storage unavailable", "SecurityError");
        },
      });
      const fetchMock = vi.fn(() => Promise.resolve(response(session)));
      vi.stubGlobal("fetch", fetchMock);
      vi.resetModules();
      const context = await import("./workspace-context.ts");

      await expect(context.resolveWorkspaceSession()).resolves.toEqual({
        session,
        status: "ready",
      });
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/v1/session",
        expect.anything(),
      );
      await expect(context.resolveWorkspaceSession()).resolves.toEqual({
        session,
        status: "ready",
      });
      expect(fetchMock).toHaveBeenCalledTimes(2);
    },
  );

  it("APR-005 exchanges first-entry credentials when storage access throws", async () => {
    vi.spyOn(globalThis, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ status: 401 }, 401))
      .mockResolvedValueOnce(response({ member: { firstName: "Avery" } }))
      .mockResolvedValueOnce(response(session));
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const context = await import("./workspace-context.ts");

    await expect(context.resolveWorkspaceSession()).resolves.toEqual({
      entryFirstName: "Avery",
      session,
      status: "ready",
    });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/session",
      "/api/v1/application-entry",
      "/api/v1/session",
    ]);
  });

  it.each(["getItem", "setItem"] as const)(
    "APR-005 refuses to change workspace when storage %s throws",
    async (method) => {
      sessionStorage.setItem("kinship.active-workspace", "current");
      const storage = sessionStorage;
      vi.stubGlobal("sessionStorage", {
        getItem: storage.getItem.bind(storage),
        setItem: storage.setItem.bind(storage),
        removeItem: storage.removeItem.bind(storage),
        [method]() {
          throw new DOMException("Storage unavailable", "QuotaExceededError");
        },
      });
      const { setActiveWorkspace } = await import("./workspace-context.ts");

      expect(setActiveWorkspace("other")).toBe(false);
      expect(storage.getItem("kinship.active-workspace")).toBe("current");
    },
  );

  it("APR-005 clears the session cache even when workspace removal throws", async () => {
    sessionStorage.setItem(SESSION_CACHE_KEY, "previous identity");
    const storage = sessionStorage;
    vi.stubGlobal("sessionStorage", {
      removeItem(key: string) {
        if (key === "kinship.active-workspace") throw new Error("disabled");
        storage.removeItem(key);
      },
    });
    const { clearActiveWorkspace } = await import("./workspace-context.ts");

    expect(() => clearActiveWorkspace()).not.toThrow();
    expect(storage.getItem(SESSION_CACHE_KEY)).toBeNull();
  });

  it("APR-005 revalidates the rendered workspace when storage becomes unavailable", async () => {
    const cached = {
      ...session,
      workspace: { id: "selected", name: "Selected" },
    };
    const raw = JSON.stringify({ savedAt: Date.now(), session: cached });
    const fresh = { ...cached, member: { id: "member", role: "member" } };
    vi.stubGlobal("sessionStorage", {
      getItem: vi.fn().mockReturnValueOnce(raw).mockReturnValueOnce("selected")
        .mockImplementation(() => {
          throw new Error("reads disabled");
        }),
      removeItem: vi.fn(),
      setItem: vi.fn().mockImplementationOnce(() => undefined)
        .mockImplementation(() => {
          throw new DOMException("Quota reached", "QuotaExceededError");
        }),
    });
    let finish!: (value: Response) => void;
    const fetchMock = vi.fn(() =>
      new Promise<Response>((resolve) => {
        finish = resolve;
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();
    const context = await import("./workspace-context.ts");

    await expect(context.resolveWorkspaceSession()).resolves.toEqual({
      session: cached,
      status: "ready",
    });
    const revalidated = vi.fn();
    context.onSessionRevalidated(revalidated);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/session",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Id": "selected" }),
      }),
    );
    finish(response(fresh));
    await vi.waitFor(() =>
      expect(revalidated).toHaveBeenCalledWith({
        session: fresh,
        status: "ready",
      })
    );
  });

  it("updates a valid cached UI state without refreshing its age", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
    const savedAt = Date.now() - 12_000;
    sessionStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({
        savedAt,
        session: {
          ...session,
          uiState: { personWorkspaceView: "planning" },
        },
      }),
    );

    updateCachedSessionUiState({ personWorkspaceView: "timeline" });

    expect(JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) ?? "null"))
      .toEqual({
        savedAt,
        session: {
          ...session,
          uiState: { personWorkspaceView: "timeline" },
        },
      });
  });

  it("does not rewrite an empty or expired session cache", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
    const setItem = vi.spyOn(sessionStorage, "setItem");

    updateCachedSessionUiState({ personWorkspaceView: "timeline" });
    expect(setItem).not.toHaveBeenCalled();

    sessionStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now() - 60_000, session }),
    );
    setItem.mockClear();
    updateCachedSessionUiState({ personWorkspaceView: "timeline" });
    expect(setItem).not.toHaveBeenCalled();
  });

  it("serializes concurrent first-entry consumers through one application handoff", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ code: "session_invalid", status: 401 }, 401),
      )
      .mockResolvedValueOnce(response({
        member: { firstName: "Avery", id: "member" },
        status: "ready",
        workspace: { id: "workspace", name: "Circle" },
      }))
      .mockResolvedValueOnce(response(session));
    vi.stubGlobal("fetch", fetchMock);

    const resolutions = await Promise.all([
      resolveWorkspaceSession(),
      resolveWorkspaceSession(),
      resolveWorkspaceSession(),
    ]);

    expect(resolutions).toEqual([
      { entryFirstName: "Avery", session, status: "ready" },
      { entryFirstName: "Avery", session, status: "ready" },
      { entryFirstName: "Avery", session, status: "ready" },
    ]);
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      "/api/v1/session",
      "/api/v1/application-entry",
      "/api/v1/session",
    ]);
    expect(JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) ?? "null"))
      .toEqual({ savedAt: expect.any(Number), session });
  });

  it("serves a fresh cached session without awaiting its revalidation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(session));
    vi.stubGlobal("fetch", fetchMock);

    await resolveWorkspaceSession();

    expect(JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) ?? "null"))
      .toEqual({ savedAt: expect.any(Number), session });

    vi.resetModules();
    let finishRevalidation!: (value: Response) => void;
    const revalidation = new Promise<Response>((resolve) => {
      finishRevalidation = resolve;
    });
    const revalidationFetch = vi.fn(() => revalidation);
    vi.stubGlobal("fetch", revalidationFetch);
    const nextModule = await import("./workspace-context.ts");

    const cachedPromise = nextModule.resolveWorkspaceSession();
    const concurrentPromise = nextModule.resolveWorkspaceSession();
    const [cached, concurrent] = await Promise.all([
      cachedPromise,
      concurrentPromise,
    ]);

    expect(cached).toEqual({ session, status: "ready" });
    expect(concurrent).toEqual(cached);
    expect(revalidationFetch).toHaveBeenCalledTimes(1);
    finishRevalidation(response(session));
    await Promise.resolve();
  });

  it("treats expired, malformed, and workspace-mismatched entries as cache misses", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T12:00:00Z"));
    const cases = [
      {
        cached: JSON.stringify({ savedAt: Date.now() - 60_000, session }),
      },
      { cached: "{malformed" },
      { cached: JSON.stringify({ savedAt: Date.now(), session: {} }) },
      { cached: JSON.stringify({ savedAt: Date.now() + 1, session }) },
      {
        activeWorkspace: "other-workspace",
        cached: JSON.stringify({ savedAt: Date.now(), session }),
      },
    ];

    for (const { activeWorkspace, cached } of cases) {
      sessionStorage.clear();
      sessionStorage.setItem(SESSION_CACHE_KEY, cached);
      if (activeWorkspace) {
        sessionStorage.setItem("kinship.active-workspace", activeWorkspace);
      }
      const freshSession = activeWorkspace
        ? {
          ...session,
          workspace: { id: activeWorkspace, name: "Other circle" },
          workspaces: [{ id: activeWorkspace, name: "Other circle" }],
        }
        : session;
      const fetchMock = vi.fn().mockResolvedValue(response(freshSession));
      vi.stubGlobal("fetch", fetchMock);
      vi.resetModules();
      const currentModule = await import("./workspace-context.ts");

      await expect(currentModule.resolveWorkspaceSession()).resolves.toEqual({
        session: freshSession,
        status: "ready",
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });
});
