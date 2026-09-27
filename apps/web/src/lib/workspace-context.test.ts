// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../testing/api.ts";
import {
  resolveWorkspaceSession,
  updateCachedSessionUiState,
} from "./workspace-context.ts";

const SESSION_CACHE_KEY = "kinship.session";
const SESSION = "GET /api/v1/session";
const ENTRY = "POST /api/v1/application-entry";

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
      const api = stubApi({ [SESSION]: jsonResponse(session) });
      vi.resetModules();
      const context = await import("./workspace-context.ts");

      await expect(context.resolveWorkspaceSession()).resolves.toEqual({
        session,
        status: "ready",
      });
      expect(api.fetch).toHaveBeenCalledWith(
        "/api/v1/session",
        expect.anything(),
      );
      await expect(context.resolveWorkspaceSession()).resolves.toEqual({
        session,
        status: "ready",
      });
      expect(api.fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("APR-005 exchanges first-entry credentials when storage access throws", async () => {
    vi.spyOn(globalThis, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("Storage disabled", "SecurityError");
    });
    const api = stubApi({
      [SESSION]: [problemResponse(401), jsonResponse(session)],
      [ENTRY]: [jsonResponse({ member: { firstName: "Avery" } })],
    });
    vi.resetModules();
    const context = await import("./workspace-context.ts");

    await expect(context.resolveWorkspaceSession()).resolves.toEqual({
      entryFirstName: "Avery",
      session,
      status: "ready",
    });
    expect(api.calls()).toEqual([SESSION, ENTRY, SESSION]);
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
    const revalidation = deferred<Response>();
    const api = stubApi({ [SESSION]: revalidation.promise });
    vi.resetModules();
    const context = await import("./workspace-context.ts");

    await expect(context.resolveWorkspaceSession()).resolves.toEqual({
      session: cached,
      status: "ready",
    });
    const revalidated = vi.fn();
    context.onSessionRevalidated(revalidated);
    expect(api.fetch).toHaveBeenCalledWith(
      "/api/v1/session",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Id": "selected" }),
      }),
    );
    revalidation.resolve(jsonResponse(fresh));
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
    const api = stubApi({
      [SESSION]: [
        problemResponse(401, { code: "session_invalid" }),
        jsonResponse(session),
      ],
      [ENTRY]: [jsonResponse({
        member: { firstName: "Avery", id: "member" },
        status: "ready",
        workspace: { id: "workspace", name: "Circle" },
      })],
    });

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
    expect(api.calls()).toEqual([SESSION, ENTRY, SESSION]);
    expect(JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) ?? "null"))
      .toEqual({ savedAt: expect.any(Number), session });
  });

  it("serves a fresh cached session without awaiting its revalidation", async () => {
    stubApi({ [SESSION]: jsonResponse(session) });

    await resolveWorkspaceSession();

    expect(JSON.parse(sessionStorage.getItem(SESSION_CACHE_KEY) ?? "null"))
      .toEqual({ savedAt: expect.any(Number), session });

    vi.resetModules();
    const revalidation = deferred<Response>();
    const api = stubApi({ [SESSION]: revalidation.promise });
    const nextModule = await import("./workspace-context.ts");

    const cachedPromise = nextModule.resolveWorkspaceSession();
    const concurrentPromise = nextModule.resolveWorkspaceSession();
    const [cached, concurrent] = await Promise.all([
      cachedPromise,
      concurrentPromise,
    ]);

    expect(cached).toEqual({ session, status: "ready" });
    expect(concurrent).toEqual(cached);
    expect(api.fetch).toHaveBeenCalledTimes(1);
    revalidation.resolve(jsonResponse(session));
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
      const api = stubApi({ [SESSION]: jsonResponse(freshSession) });
      vi.resetModules();
      const currentModule = await import("./workspace-context.ts");

      await expect(currentModule.resolveWorkspaceSession()).resolves.toEqual({
        session: freshSession,
        status: "ready",
      });
      expect(api.fetch).toHaveBeenCalledTimes(1);
    }
  });

  it("answers unavailable when the default session read after a stale saved workspace fails", async () => {
    sessionStorage.setItem("kinship.active-workspace", "stale");
    const api = stubApi({
      [SESSION]: [
        problemResponse(401, { code: "session_invalid" }),
        unreachable,
      ],
    });
    vi.resetModules();
    const context = await import("./workspace-context.ts");

    await expect(context.resolveWorkspaceSession()).resolves.toEqual({
      status: "unavailable",
    });
    expect(api.calls()).toEqual([SESSION, SESSION]);
    expect(sessionStorage.getItem("kinship.active-workspace")).toBe("stale");
  });

  it("answers unavailable when the entry exchange cannot be reached", async () => {
    const api = stubApi({
      [SESSION]: problemResponse(401, { code: "session_invalid" }),
      [ENTRY]: unreachable,
    });
    vi.resetModules();
    const context = await import("./workspace-context.ts");

    await expect(context.resolveWorkspaceSession()).resolves.toEqual({
      status: "unavailable",
    });
    expect(api.calls()).toEqual([SESSION, ENTRY]);
  });

  it("replays a completed revalidation once, on a microtask, to a late handler", async () => {
    sessionStorage.setItem(
      SESSION_CACHE_KEY,
      JSON.stringify({ savedAt: Date.now(), session }),
    );
    const fresh = {
      ...session,
      workspace: { id: "workspace", name: "Renamed" },
    };
    stubApi({ [SESSION]: jsonResponse(fresh) });
    vi.resetModules();
    const context = await import("./workspace-context.ts");
    await context.resolveWorkspaceSession();
    const early = vi.fn();
    context.onSessionRevalidated(early);
    await vi.waitFor(() => expect(early).toHaveBeenCalledOnce());
    await new Promise((resolve) => setTimeout(resolve, 0));

    const late = vi.fn();
    context.onSessionRevalidated(late);
    expect(late).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(late).toHaveBeenCalledOnce();
    expect(late).toHaveBeenCalledWith({ session: fresh, status: "ready" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late).toHaveBeenCalledOnce();
  });
});
