// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPeopleProfile } from "./people-profile.ts";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const session = {
  member: { id: "member", role: "member" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
};

function markup(path = `/app/people/${personId}`): void {
  history.replaceState({}, "", path);
  document.body.innerHTML = `
    <section id="person-profile-state" tabindex="-1"><h1>Opening person…</h1></section>
    <section id="person-profile-ready" hidden>
      <h1 id="person-profile-name" tabindex="-1"></h1>
      <p id="person-profile-archived" hidden></p>
      <p id="person-profile-partial" hidden></p>
      <span data-profile-field="givenName"></span>
      <span data-profile-field="middleName"></span>
      <span data-profile-field="familyName"></span>
      <span data-profile-field="nickname"></span>
    </section>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  document.body.innerHTML = "";
});

describe("PEOPLE-001 canonical person identity shell", () => {
  it("loads a partial identity through the generated active-workspace client", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        person: {
          familyName: "Lovelace",
          givenName: "Ada",
          id: personId,
          isPartial: true,
        },
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleProfile();
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}`,
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      "X-Workspace-Id": workspaceId,
      "content-type": "application/json",
    });
    expect(
      document.querySelector("#person-profile-ready")?.hasAttribute(
        "hidden",
      ),
    ).toBe(false);
    expect(document.querySelector("#person-profile-name")?.textContent).toBe(
      "Ada Lovelace",
    );
    expect(
      document.querySelector('[data-profile-field="nickname"]')?.textContent,
    ).toBe("Unknown");
    expect(
      document.querySelector("#person-profile-partial")?.hasAttribute(
        "hidden",
      ),
    ).toBe(false);
  });

  it("renders explicit not-found, forbidden, and unavailable states", async () => {
    for (
      const state of [
        { heading: "Person not found", status: 404 },
        { heading: "Person unavailable", status: 403 },
        { heading: "Person temporarily unavailable", status: 503 },
      ]
    ) {
      markup();
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(response(session))
          .mockResolvedValueOnce(
            response({ status: state.status }, state.status),
          ),
      );
      await mountPeopleProfile();
      expect(document.querySelector("#person-profile-state h1")?.textContent)
        .toBe(state.heading);
    }

    markup("/app/people/not-a-person");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleProfile();
    expect(document.querySelector("#person-profile-state h1")?.textContent)
      .toBe("Person not found");
    expect(fetchMock).not.toHaveBeenCalled();

    document.body.innerHTML = "<main></main>";
    await expect(mountPeopleProfile()).resolves.toBeUndefined();
  });

  it("distinguishes an archived canonical person as read-only", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          person: {
            givenName: "Harriet",
            id: personId,
            isPartial: false,
          },
          status: "archived",
        })),
    );
    await mountPeopleProfile();
    expect(
      document.querySelector("#person-profile-archived")?.hasAttribute(
        "hidden",
      ),
    ).toBe(false);
  });
});
