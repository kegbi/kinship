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
      <div id="person-profile-avatar"></div>
      <p id="person-profile-archived" hidden></p>
      <p id="person-profile-partial" hidden></p>
      <p id="person-profile-favorite" hidden></p>
      <p id="person-profile-deceased" hidden></p>
      <p id="person-profile-self" hidden></p>
      <p data-profile-description></p>
      <ul id="person-profile-tags"></ul>
      <span data-profile-field="givenName"></span>
      <span data-profile-field="middleName"></span>
      <span data-profile-field="familyName"></span>
      <span data-profile-field="nickname"></span>
      <p id="person-profile-due-state"></p>
      <nav id="person-profile-sections">
        <a href="?section=important-dates" data-section-link="important-dates">Important dates</a>
        <a href="?section=documents" data-section-link="documents">Documents</a>
        <a href="?section=photos" data-section-link="photos">Photos</a>
      </nav>
      <section id="profile-section-important-dates" data-profile-section="important-dates" tabindex="-1"><h2>Important dates</h2></section>
      <section id="profile-section-documents" data-profile-section="documents" data-load-mode="independent" tabindex="-1"><h2>Documents</h2></section>
      <section id="profile-section-photos" data-profile-section="photos" data-load-mode="independent" tabindex="-1"><h2>Photos</h2></section>
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
        dueInformation: {
          detail: "Due information will become available with planning.",
          status: "unavailable",
        },
        person: {
          familyName: "Lovelace",
          givenName: "Ada",
          id: personId,
          isDeceased: false,
          isPartial: true,
          isSelf: false,
          isStarred: false,
          tagCount: 0,
          tags: [],
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

  it("[APP-003C] renders orientation first and focuses stable section deep links", async () => {
    markup(`/app/people/${personId}?section=documents`);
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "Due information will become available with planning.",
            status: "unavailable",
          },
          person: {
            description: "Mathematician and correspondent.",
            familyName: "Lovelace",
            givenName: "Ada",
            id: personId,
            isDeceased: true,
            isPartial: false,
            isSelf: false,
            isStarred: true,
            tagCount: 0,
            tags: [],
          },
          status: "ready",
        })),
    );

    await mountPeopleProfile();

    expect(document.querySelector("[data-profile-description]")?.textContent)
      .toBe("Mathematician and correspondent.");
    expect(
      document.querySelector<HTMLElement>("#person-profile-favorite")?.hidden,
    ).toBe(false);
    expect(
      document.querySelector<HTMLElement>("#person-profile-deceased")?.hidden,
    ).toBe(false);
    expect(document.querySelector("#person-profile-due-state")?.textContent)
      .toContain("planning");
    expect(document.activeElement).toBe(
      document.querySelector("#profile-section-documents"),
    );

    document.querySelector<HTMLAnchorElement>(
      '[data-section-link="photos"]',
    )?.click();
    expect(location.search).toBe("?section=photos");
    expect(document.activeElement).toBe(
      document.querySelector("#profile-section-photos"),
    );
  });

  it("[APP-003C] reconciles queryless and invalid section history", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          dueInformation: {
            detail: "Due information will become available with planning.",
            status: "unavailable",
          },
          person: {
            familyName: "Lovelace",
            givenName: "Ada",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            tagCount: 0,
            tags: [],
          },
          status: "ready",
        })),
    );

    await mountPeopleProfile();
    const heading = document.querySelector("#person-profile-name");
    const photos = document.querySelector<HTMLAnchorElement>(
      '[data-section-link="photos"]',
    );
    photos?.click();
    expect(location.search).toBe("?section=photos");
    expect(photos?.getAttribute("aria-current")).toBe("location");

    history.back();
    await vi.waitFor(() => expect(location.search).toBe(""));
    expect(document.querySelectorAll("[data-section-link][aria-current]"))
      .toHaveLength(0);
    expect(document.activeElement).toBe(heading);

    history.replaceState({}, "", `?section=not-a-section`);
    document.querySelector<HTMLAnchorElement>(
      '[data-section-link="documents"]',
    )?.click();
    history.back();
    await vi.waitFor(() =>
      expect(location.search).toBe("?section=not-a-section")
    );
    expect(document.querySelectorAll("[data-section-link][aria-current]"))
      .toHaveLength(0);
    expect(document.activeElement).toBe(heading);
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
          dueInformation: {
            detail: "Due information will become available with planning.",
            status: "unavailable",
          },
          person: {
            givenName: "Harriet",
            id: personId,
            isDeceased: false,
            isPartial: false,
            isSelf: false,
            isStarred: false,
            tagCount: 0,
            tags: [],
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
