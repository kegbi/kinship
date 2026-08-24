// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountTodayRecentPeople } from "./today-recent-people.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const session = {
  member: { id: "member", role: "member" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function markup(): void {
  document.body.innerHTML =
    `<section id="today-recent-people-region" data-region-state="loading">
    <span id="today-recent-people-badge">Loading</span>
    <p id="today-recent-people-state" role="status" tabindex="-1">Loading…</p>
    <ul id="today-recent-people-list"></ul>
    <button id="today-recent-people-retry" hidden>Retry recent people</button>
  </section>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.body.innerHTML = "";
});

describe("TODAY-001 actual recently viewed people", () => {
  it("renders bounded active and archived return paths with accessible targets", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        people: [
          { archived: false, id: personId, name: "Ada Lovelace" },
          {
            archived: true,
            id: "00000000-0000-4000-8000-000000000101",
            name: "Grace Hopper",
          },
          ...Array.from({ length: 6 }, (_, index) => ({
            archived: false,
            id: `00000000-0000-4000-8000-${
              (index + 102).toString().padStart(12, "0")
            }`,
            name: `Person ${index + 3}`,
          })),
        ],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayRecentPeople();

    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/today/recent-people");
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      "X-Workspace-Id": workspaceId,
      "content-type": "application/json",
    });
    const links = [...document.querySelectorAll<HTMLAnchorElement>("li a")];
    expect(links).toHaveLength(8);
    expect(links.slice(0, 2).map((link) => new URL(link.href).pathname))
      .toEqual([
        `/app/people/${personId}`,
        "/app/people/00000000-0000-4000-8000-000000000101",
      ]);
    expect(links.every((link) => link.classList.contains("today-touch-target")))
      .toBe(true);
    expect(document.body.textContent).toContain("Archived");
  });

  it("isolates failure, focuses a successful retry, and ignores stale remounts", async () => {
    markup();
    let resolveStale: ((value: Response) => void) | undefined;
    const stale = new Promise<Response>((resolve) => resolveStale = resolve);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(response({ status: 401 }, 401))
      .mockResolvedValueOnce(response({ status: 409 }, 409))
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({ people: [], status: "ready" }))
      .mockResolvedValueOnce(response(session))
      .mockReturnValueOnce(stale)
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        people: [{ archived: false, id: personId, name: "Current person" }],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayRecentPeople();
    const retry = document.querySelector<HTMLButtonElement>(
      "#today-recent-people-retry",
    )!;
    expect(retry.hidden).toBe(false);
    retry.click();
    await vi.waitFor(() => expect(retry.hidden).toBe(false));
    expect(fetchMock).toHaveBeenCalledTimes(4);
    retry.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector("#today-recent-people-region")
          ?.getAttribute("data-region-state"),
      ).toBe("empty");
      expect(document.activeElement?.id).toBe("today-recent-people-state");
    });

    const superseded = mountTodayRecentPeople();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(8));
    const current = mountTodayRecentPeople();
    await current;
    resolveStale?.(response({
      people: [{ archived: false, id: personId, name: "Stale person" }],
      status: "ready",
    }));
    await superseded;
    expect(document.body.textContent).toContain("Current person");
    expect(document.body.textContent).not.toContain("Stale person");
  });

  it("recovers an initially unavailable session on retry", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("session offline"))
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        people: [{ archived: false, id: personId, name: "Recovered person" }],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayRecentPeople();
    document.querySelector<HTMLButtonElement>("#today-recent-people-retry")!
      .click();
    await vi.waitFor(() => {
      expect(document.body.textContent).toContain("Recovered person");
      expect(document.activeElement?.id).toBe("today-recent-people-state");
    });
  });

  it.each([
    ["ninth item", {
      people: Array.from({ length: 9 }, (_, index) => ({
        archived: false,
        id: `00000000-0000-4000-8000-${
          (index + 100).toString().padStart(12, "0")
        }`,
        name: `Person ${index}`,
      })),
      status: "ready",
    }],
    ["invalid UUID", {
      people: [{ archived: false, id: "invalid", name: "Unsafe" }],
      status: "ready",
    }],
    ["unexpected property", { people: [], status: "ready", unexpected: true }],
  ])("isolates malformed 200 %s and recovers on retry", async (_name, body) => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response(body))
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({ people: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayRecentPeople();
    expect(document.querySelectorAll("li a")).toHaveLength(0);
    const retry = document.querySelector<HTMLButtonElement>(
      "#today-recent-people-retry",
    )!;
    expect(retry.hidden).toBe(false);
    retry.click();
    await vi.waitFor(() => {
      expect(
        document.querySelector("#today-recent-people-region")
          ?.getAttribute("data-region-state"),
      ).toBe("empty");
      expect(document.activeElement?.id).toBe("today-recent-people-state");
    });
  });
});
