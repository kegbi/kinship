// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMemberPreferences } from "../../../../packages/contracts/generated/auth-client.ts";
import { mountPeopleDirectory } from "./people-directory.ts";

vi.mock(
  "../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<Record<string, unknown>>(),
    getMemberPreferences: vi.fn(),
  }),
);

beforeEach(() => {
  vi.mocked(getMemberPreferences).mockReset().mockResolvedValue({
    ok: true,
    value: {
      status: "ready",
      preferences: {
        effectiveTimezone: "UTC",
        contactNameOrder: "given_family_nickname",
        contactSortOrder: "given_name_asc",
        fluidLayout: false,
        locale: "en",
        measurementSystem: "metric",
        temperatureScale: "celsius",
      },
    },
  });
});

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

function markup(selectedLifecycle: "active" | "archived" = "active"): void {
  history.replaceState(
    {},
    "",
    selectedLifecycle === "archived" ? "/app/people/archived" : "/app/people",
  );
  document.body.innerHTML = `
    <main data-people-lifecycle="${selectedLifecycle}">
      <form id="people-directory-controls">
        <input id="people-directory-search" />
        <input id="people-tag-options-search" />
        <button id="people-tag-options-search-button" type="button">Search tags</button>
        <select id="people-directory-tag"><option value="">All tags</option></select>
        <button id="people-tag-options-more" type="button" hidden>Load more tags</button>
        <p id="people-tag-options-status"></p>
        <select id="people-directory-sort">
          <option value="given-name">Given</option>
          <option value="family-name">Family</option>
          <option value="recently-added">Recent</option>
        </select>
        <button type="submit">Find people</button>
      </form>
      <p id="people-directory-announcement"></p>
      <section id="people-directory-state"><h2>Loading people…</h2></section>
      <section id="people-directory-error" tabindex="-1" hidden>
        <h2>People temporarily unavailable</h2><p></p>
        <button id="people-directory-retry">Try again</button>
      </section>
      <section id="people-directory-empty" tabindex="-1" hidden><h2></h2><p></p></section>
      <ul id="people-directory-list" hidden></ul>
      <button id="people-directory-more" hidden>Load more people</button>
    </main>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
  document.body.innerHTML = "";
});

describe("PEOPLE-002 people directory island", () => {
  it("APR-008 applies saved display and sort order but preserves an explicit given-name URL", async () => {
    vi.mocked(getMemberPreferences).mockResolvedValue({
      ok: true,
      value: {
        status: "ready",
        preferences: {
          effectiveTimezone: "UTC",
          contactNameOrder: "family_given_nickname",
          contactSortOrder: "family_name_asc",
          fluidLayout: false,
          locale: "en",
          measurementSystem: "metric",
          temperatureScale: "celsius",
        },
      },
    });
    for (const query of ["", "?sort=given-name", "?sort=invalid"]) {
      const explicitSort = query === "?sort=given-name";
      markup();
      history.replaceState({}, "", `/app/people${query}`);
      const fetchMock = vi.fn((url: string) =>
        Promise.resolve(response(
          url === "/api/v1/session"
            ? session
            : url.includes("tag-options")
            ? { options: [], status: "ready" }
            : {
              lifecycle: "active",
              status: "ready",
              people: [{
                givenName: "Ada",
                middleName: "Byron",
                familyName: "Lovelace",
                nickname: "Enchantress",
                id: personId,
                isPartial: false,
                isStarred: false,
                lifecycle: "active",
                tagCount: 0,
                tags: [],
              }],
            },
        ))
      );
      vi.stubGlobal("fetch", fetchMock);
      await mountPeopleDirectory();
      expect(document.querySelector("#people-directory-list h2")?.textContent)
        .toBe("Lovelace Ada Byron “Enchantress”");
      expect(
        fetchMock.mock.calls.some(([url]) =>
          url.includes(`sort=${explicitSort ? "given-name" : "family-name"}`)
        ),
      ).toBe(true);
      expect(location.search).toBe(explicitSort ? "?sort=given-name" : "");
      expect(getMemberPreferences).toHaveBeenCalledWith(workspaceId);
    }
  });
  it("keeps loading visible, then renders active people with tags and canonical links", async () => {
    markup();
    let release = (_value: Response) => {};
    const pending = new Promise<Response>((resolve) => release = resolve);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockReturnValueOnce(pending)
      .mockResolvedValueOnce(response({
        options: [{
          id: "00000000-0000-4000-8000-000000000090",
          name: "Friends",
        }],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);

    const mounted = mountPeopleDirectory();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(
      document.querySelector("#people-directory-state")?.hasAttribute("hidden"),
    )
      .toBe(false);
    release(response({
      lifecycle: "active",
      people: [{
        familyName: "Lovelace",
        givenName: "Ada",
        id: personId,
        isPartial: false,
        isStarred: true,
        lifecycle: "active",
        tagCount: 8,
        tags: [{
          id: "00000000-0000-4000-8000-000000000090",
          name: "Friends",
        }],
      }],
      status: "ready",
    }));
    await mounted;

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "/api/v1/people?lifecycle=active&limit=20&sort=given-name",
    );
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toEqual({
      "X-Workspace-Id": workspaceId,
      "content-type": "application/json",
    });
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "/api/v1/people/tag-options",
    );
    const link = document.querySelector<HTMLAnchorElement>(
      "#people-directory-list a",
    );
    expect(link?.href).toContain(`/app/people/${personId}`);
    expect(link?.textContent).toContain("Ada Lovelace");
    expect(link?.textContent).toContain("Friends");
    expect(link?.textContent).toContain("+7 more");
    expect(link?.querySelectorAll(".directory-person-tags > li")).toHaveLength(
      2,
    );
    expect(
      link?.querySelector(".directory-person-tags")?.getAttribute(
        "aria-label",
      ),
    ).toContain("8 total");
  });

  it("renders filtered empty and dependency-error states honestly", async () => {
    markup();
    history.replaceState({}, "", "/app/people?search=Nobody");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          lifecycle: "active",
          people: [],
          status: "ready",
        }))
        .mockResolvedValueOnce(response({ options: [], status: "ready" })),
    );
    await mountPeopleDirectory();
    expect(document.querySelector("#people-directory-empty h2")?.textContent)
      .toBe("No people match these filters");
    expect(location.search).toBe("?search=Nobody");

    markup("archived");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({ status: 503 }, 503))
        .mockResolvedValueOnce(response({ options: [], status: "ready" })),
    );
    await mountPeopleDirectory();
    expect(document.querySelector("#people-directory-error h2")?.textContent)
      .toBe("People temporarily unavailable");
    expect(document.activeElement?.id).toBe("people-directory-error");
  });

  it("distinguishes an archived empty list from lost workspace access", async () => {
    markup("archived");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response(session))
        .mockResolvedValueOnce(response({
          lifecycle: "archived",
          people: [],
          status: "ready",
        }))
        .mockResolvedValueOnce(response({ options: [], status: "ready" })),
    );
    await mountPeopleDirectory();
    expect(document.querySelector("#people-directory-empty h2")?.textContent)
      .toBe("No archived people");
    expect(document.querySelector("#people-directory-empty p")?.textContent)
      .toBe("People you archive will appear here.");

    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({
        code: "authentication_required",
        detail: "Sign in again",
        status: 401,
        title: "Authentication required",
        type: "about:blank",
      }, 401)).mockResolvedValueOnce(response({
        code: "entry_handoff_invalid",
        detail: "Sign in again",
        status: 409,
        title: "Application entry unavailable",
        type: "about:blank",
      }, 409)),
    );
    await mountPeopleDirectory();
    expect(document.querySelector("#people-directory-error h2")?.textContent)
      .toBe("People unavailable");
    expect(document.querySelector("#people-directory-error p")?.textContent)
      .toContain("active workspace no longer permits");
  });

  it("recovers a stale load-more cursor from the current first page", async () => {
    markup();
    const person = {
      givenName: "Ada",
      id: personId,
      isPartial: false,
      isStarred: false,
      lifecycle: "active",
      tagCount: 0,
      tags: [],
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        nextCursor: "first-cursor",
        people: [person],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({ options: [], status: "ready" }))
      .mockResolvedValueOnce(response({
        code: "stale_cursor",
        detail: "Changed",
        status: 409,
        title: "Changed",
        type: "about:blank",
      }, 409))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        people: [person],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleDirectory();
    document.querySelector<HTMLButtonElement>("#people-directory-more")
      ?.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(document.querySelectorAll("#people-directory-list li")).toHaveLength(
      1,
    );
    expect(
      document.querySelector("#people-directory-announcement")?.textContent,
    )
      .toContain("shown");
  });

  it("keeps tag choices bounded while reaching later options by continuation and refinement", async () => {
    markup();
    const selectedId = "00000000-0000-4000-8000-000000000190";
    const needleId = "00000000-0000-4000-8000-000000000191";
    history.replaceState({}, "", `/app/people?tag=${selectedId}`);
    const firstOptions = Array.from({ length: 20 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
      name: `Tag ${String(index + 1).padStart(2, "0")}`,
    }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(session))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        people: [],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        nextCursor: "tag-cursor",
        options: firstOptions,
        selected: { id: selectedId, name: "Selected beyond first page" },
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        options: [{
          id: "00000000-0000-4000-8000-000000000220",
          name: "Tag 21",
        }],
        selected: { id: selectedId, name: "Selected beyond first page" },
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        options: [{ id: needleId, name: "Needle tag" }],
        selected: { id: selectedId, name: "Selected beyond first page" },
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountPeopleDirectory();

    const tag = document.querySelector<HTMLSelectElement>(
      "#people-directory-tag",
    )!;
    expect(tag.value).toBe(selectedId);
    expect(tag.selectedOptions[0]?.textContent).toBe(
      "Selected beyond first page",
    );
    expect(tag.options).toHaveLength(22);

    document.querySelector<HTMLButtonElement>("#people-tag-options-more")!
      .click();
    await vi.waitFor(() =>
      expect([...tag.options].some((option) => option.text === "Tag 21"))
        .toBe(true)
    );
    expect(String(fetchMock.mock.calls[3]?.[0])).toContain(
      "cursor=tag-cursor",
    );

    document.querySelector<HTMLInputElement>("#people-tag-options-search")!
      .value = "  Needle  ";
    document.querySelector<HTMLButtonElement>(
      "#people-tag-options-search-button",
    )!.click();
    await vi.waitFor(() =>
      expect([...tag.options].some((option) => option.text === "Needle tag"))
        .toBe(true)
    );
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain("search=Needle");
    expect(tag.value).toBe(selectedId);
  });

  it("does nothing when the directory markup is absent", async () => {
    document.body.innerHTML = "<main></main>";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(mountPeopleDirectory()).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
