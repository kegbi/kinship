// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveWorkspaceSession } from "./workspace-context.ts";

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
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

describe("protected workspace session resolution", () => {
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
  });
});
