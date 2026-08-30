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
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("protected workspace session resolution", () => {
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
