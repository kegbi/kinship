// @vitest-environment happy-dom

import { act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import {
  ids,
  preferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { mountPeopleDirectory } from "./people-directory.tsx";

const { person: personId, workspace: workspaceId } = ids;
const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";
const PEOPLE = "GET /api/v1/people";
const TAGS = "GET /api/v1/people/tag-options";
const FACET = "GET /api/v1/people/tag-facet";
const ENTRY = "POST /api/v1/application-entry";

const session = jsonResponse(workspaceSession());
const savedPreferences = (overrides = {}) =>
  jsonResponse({ preferences: preferences(overrides), status: "ready" });
const noTags = jsonResponse({ options: [], status: "ready" });
const noFacet = jsonResponse({
  lifecycle: "active",
  status: "ready",
  tags: [],
  truncated: false,
});
const page = (
  people: readonly unknown[],
  extra: Record<string, unknown> = {},
) => jsonResponse({ lifecycle: "active", people, status: "ready", ...extra });

function person(overrides: Record<string, unknown> = {}) {
  return {
    givenName: "Ada",
    id: personId,
    isPartial: false,
    isStarred: false,
    lifecycle: "active",
    tagCount: 0,
    tags: [],
    ...overrides,
  };
}

/** The directory region as `PeopleDirectory.astro` draws it. */
function markup(lifecycle: "active" | "archived" = "active", query = ""): void {
  history.replaceState(
    {},
    "",
    `${
      lifecycle === "archived" ? "/app/people/archived" : "/app/people"
    }${query}`,
  );
  drawShell(`
    <main data-people-lifecycle="${lifecycle}">
      <h1>${lifecycle === "archived" ? "Archived people" : "People"}</h1>
      <div class="contents" data-people-directory>
        <form method="post" id="people-directory-controls" role="search">
          <label>Search people <input id="people-directory-search" name="search" type="search" /></label>
          <fieldset><legend>Tag filter</legend>
            <label for="people-tag-options-search">Search tag options</label>
            <input id="people-tag-options-search" name="tagSearch" type="search" />
            <button id="people-tag-options-search-button" type="button" disabled>Search tags</button>
            <label for="people-directory-tag">Tag</label>
            <select id="people-directory-tag" name="tag"><option value="">All tags</option></select>
            <button id="people-tag-options-more" type="button" hidden>Load more tags</button>
            <p id="people-tag-options-status" role="status"></p>
          </fieldset>
          <label>Sort by <select id="people-directory-sort" name="sort">
            <option value="given-name">Given name</option>
            <option value="family-name">Family name</option>
            <option value="recently-added">Recently added</option>
          </select></label>
          <button type="submit" disabled>Find people</button>
        </form>
        <p id="people-directory-announcement" role="status"></p>
        <section id="people-directory-state" role="status"><h2>Loading people…</h2></section>
        <section id="people-directory-error" role="alert" tabindex="-1" hidden>
          <h2>People temporarily unavailable</h2><p></p>
          <button id="people-directory-retry" type="button" disabled>Try again</button>
        </section>
        <section id="people-directory-empty" tabindex="-1" hidden><h2>No people found</h2><p></p></section>
        <ul id="people-directory-list" hidden></ul>
        <button id="people-directory-more" type="button" hidden>Load more people</button>
      </div>
    </main>`);
}

const mount = () => mountSettled(() => mountPeopleDirectory());
const region = () => within(element("[data-people-directory]"));
const listRequests = (api: ReturnType<typeof stubApi>) =>
  api.requests().filter((request) => request.url.pathname === "/api/v1/people");
const tagRequests = (api: ReturnType<typeof stubApi>) =>
  api.requests().filter((request) =>
    request.url.pathname === "/api/v1/people/tag-options"
  );
const heading = (selector: string) =>
  element(selector).querySelector("h2")?.textContent;

describe("PEOPLE-002 people directory island", () => {
  it("APR-008 applies saved display and sort order but preserves an explicit given-name URL", async () => {
    for (const query of ["", "?sort=given-name", "?sort=invalid"]) {
      const explicitSort = query === "?sort=given-name";
      markup("active", query);
      const api = stubApi({
        [PEOPLE]: page([person({
          familyName: "Lovelace",
          middleName: "Byron",
          nickname: "Enchantress",
        })]),
        [PREFERENCES]: savedPreferences({
          contactNameOrder: "family_given_nickname",
          contactSortOrder: "family_name_asc",
        }),
        [SESSION]: session,
        [TAGS]: noTags,
        [FACET]: noFacet,
      });
      const unmount = await mount();
      expect(element("#people-directory-list h2").textContent).toBe(
        "Lovelace Ada Byron “Enchantress”",
      );
      expect(listRequests(api)[0]?.url.searchParams.get("sort")).toBe(
        explicitSort ? "given-name" : "family-name",
      );
      expect(location.search).toBe(explicitSort ? "?sort=given-name" : "");
      expect(
        api.requests().find((request) =>
          request.url.pathname === "/api/v1/settings/preferences"
        )?.headers.get("X-Workspace-Id"),
      ).toBe(workspaceId);
      expect(region().getByLabelText("Sort by")).toHaveProperty(
        "value",
        explicitSort ? "given-name" : "family-name",
      );
      unmount();
    }
  });

  it("keeps loading visible, then renders active people with tags and canonical links", async () => {
    markup();
    const held = deferred<Response>();
    const api = stubApi({
      [PEOPLE]: held.promise,
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [FACET]: noFacet,
      [TAGS]: jsonResponse({
        options: [{
          id: "00000000-0000-4000-8000-000000000090",
          name: "Friends",
        }],
        status: "ready",
      }),
    });

    const mounted = mountPending(() => mountPeopleDirectory());
    await waitFor(() => expect(tagRequests(api)).toHaveLength(1));
    expect(element("#people-directory-state").hidden).toBe(false);
    expect(element("#people-directory-list").hidden).toBe(true);
    expect(region().getByRole("button", { name: "Find people" }))
      .toHaveProperty("disabled", true);
    await act(async () => {
      held.resolve(page([person({
        familyName: "Lovelace",
        isStarred: true,
        tagCount: 8,
        tags: [{
          id: "00000000-0000-4000-8000-000000000090",
          name: "Friends",
        }],
      })]));
      await mounted;
    });

    const [list] = listRequests(api);
    expect(list!.url.pathname + list!.url.search).toBe(
      "/api/v1/people?lifecycle=active&limit=20&sort=given-name",
    );
    expect(list?.headers.get("X-Workspace-Id")).toBe(workspaceId);
    expect(tagRequests(api)[0]?.url.search).toBe("");
    expect(element("#people-directory-state").hidden).toBe(true);
    const link = region().getByRole("link", { name: /Ada Lovelace/ });
    expect(link.getAttribute("href")).toBe(`/app/people/${personId}`);
    expect(link.textContent).toContain("Favorite");
    expect(link.textContent).toContain("Friends");
    expect(link.textContent).toContain("+7 more");
    expect(link.querySelectorAll(".directory-person-tags > li")).toHaveLength(
      2,
    );
    expect(
      within(link).getByRole("list").getAttribute("aria-label"),
    ).toBe("Tags for Ada Lovelace: 8 total");
    expect(element("#people-directory-announcement").textContent).toBe(
      "1 active person shown.",
    );
    expect(element("#people-tag-options-status").textContent).toBe(
      "1 tag option shown.",
    );
    expect(element("[data-people-directory]").dataset.island).toBe(
      "people-directory",
    );
    await expectNoAxeViolations(element("main"));
  });

  it("PEOPLE-007 draws each person with their avatar beside the name", async () => {
    markup();
    stubApi({
      [PEOPLE]: page([
        person({
          avatar: {
            color: "#1f6f5c",
            imageUrl: `/api/v1/people/${personId}/files/${personId}/content`,
          },
          familyName: "Lovelace",
        }),
      ]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    await mount();
    const link = region().getByRole("link", { name: /Ada Lovelace/ });
    const avatar = link.querySelector<HTMLElement>("[data-slot=avatar]")!;
    expect(avatar.getAttribute("aria-hidden")).toBe("true");
    expect(avatar.textContent).toBe("AL");
    expect(avatar.style.backgroundColor).toBe("#1f6f5c");
    expect(link.getAttribute("aria-label")).toBeNull();
    await expectNoAxeViolations(element("main"));
  });

  it("describes partial and archived people and a single hidden tag", async () => {
    markup("archived");
    stubApi({
      [PEOPLE]: page([
        person({
          isPartial: true,
          lifecycle: "archived",
          tagCount: 2,
          tags: [{ id: "t", name: "Work" }],
        }),
        person({ givenName: "Grace", id: crypto.randomUUID() }),
      ]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    await mount();
    const items = region().getAllByRole("link");
    expect(items[0]!.textContent).toContain(
      "Partial identity · Archived · read-only",
    );
    expect(
      element(".directory-person-tags-more").getAttribute("aria-label"),
    ).toBe("1 more tag not shown");
    expect(items[1]!.textContent).toContain("Open person workspace");
    expect(element("#people-directory-announcement").textContent).toBe(
      "2 archived people shown.",
    );
    expect(region().getByRole("list", { name: "Archived people" }))
      .toBeTruthy();
  });

  it("renders filtered empty and dependency-error states honestly", async () => {
    markup("active", "?search=Nobody");
    stubApi({
      [PEOPLE]: page([]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    const unmount = await mount();
    expect(heading("#people-directory-empty")).toBe(
      "No people match these filters",
    );
    expect(element("#people-directory-empty p").textContent).toBe(
      "Try a different name or tag.",
    );
    expect(region().getByRole("link", { name: "Add a person" })).toBeTruthy();
    expect(location.search).toBe("?search=Nobody");
    expect(region().getByLabelText("Search people")).toHaveProperty(
      "value",
      "Nobody",
    );
    expect(element("#people-directory-announcement").textContent).toBe(
      "No people found.",
    );
    unmount();

    markup("archived");
    stubApi({
      [PEOPLE]: problemResponse(503),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    await mount();
    expect(heading("#people-directory-error")).toBe(
      "People temporarily unavailable",
    );
    expect(element("#people-directory-error").hidden).toBe(false);
    expect(document.activeElement?.id).toBe("people-directory-error");
    expect(element("#people-directory-list").hidden).toBe(true);
  });

  it("keeps a search submitted before the page loaded off a native GET and runs it as the first load", async () => {
    markup();
    const held = deferred<Response>();
    const api = stubApi({
      [PEOPLE]: page([]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: held.promise,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    const mounted = mountPending(() => mountPeopleDirectory());
    const user = userEvent.setup();
    await user.type(region().getByLabelText("Search people"), "Ada");
    const early = new Event("submit", { bubbles: true, cancelable: true });
    element("form").dispatchEvent(early);
    expect(early.defaultPrevented).toBe(true);
    await act(async () => {
      held.resolve(session);
      await mounted;
    });
    expect(listRequests(api)).toHaveLength(1);
    expect(listRequests(api)[0]?.url.searchParams.get("search")).toBe("Ada");
    expect(location.search).toBe("?search=Ada");
  });

  it("adopts a search typed into the static form before the island took over", async () => {
    markup();
    const typed = element<HTMLInputElement>("#people-directory-search");
    typed.value = "Grace";
    typed.focus();
    const api = stubApi({
      [PEOPLE]: page([]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    await mount();
    const search = region().getByLabelText("Search people");
    expect(search).not.toBe(typed);
    expect(search).toHaveProperty("value", "Grace");
    expect(listRequests(api)[0]?.url.searchParams.get("search")).toBe("Grace");
  });

  it("adopts a tag search typed into the static form, and its focus, and sends it", async () => {
    markup();
    const typed = element<HTMLInputElement>("#people-tag-options-search");
    typed.value = "Frie";
    typed.focus();
    const api = stubApi({
      [PEOPLE]: page([]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    await mount();
    const field = region().getByLabelText("Search tag options");
    expect(field).not.toBe(typed);
    expect(field).toHaveProperty("value", "Frie");
    expect(document.activeElement).toBe(field);
    expect(tagRequests(api)[0]?.url.searchParams.get("search")).toBe("Frie");
  });

  it("distinguishes an archived empty list from lost workspace access", async () => {
    markup("archived");
    stubApi({
      [PEOPLE]: page([], { lifecycle: "archived" }),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    const unmount = await mount();
    expect(heading("#people-directory-empty")).toBe("No archived people");
    expect(element("#people-directory-empty p").textContent).toBe(
      "People you archive will appear here.",
    );
    expect(region().queryByRole("link", { name: "Add a person" })).toBeNull();
    unmount();

    markup();
    stubApi({
      [ENTRY]: problemResponse(409, { code: "entry_handoff_invalid" }),
      [SESSION]: problemResponse(401, { code: "authentication_required" }),
    });
    await mount();
    expect(heading("#people-directory-error")).toBe("People unavailable");
    expect(element("#people-directory-error p").textContent).toContain(
      "active workspace no longer permits",
    );
  });

  it("reads a refused directory as lost access and retries it", async () => {
    markup();
    stubApi({
      [PEOPLE]: [problemResponse(403), page([person()])],
      [PREFERENCES]: problemResponse(503),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    await mount();
    expect(heading("#people-directory-error")).toBe("People unavailable");
    await userEvent.setup().click(
      region().getByRole("button", { name: "Try again" }),
    );
    await waitFor(() =>
      expect(region().getByRole("link", { name: /Ada/ })).toBeTruthy()
    );
    expect(element("#people-directory-error").hidden).toBe(true);
  });

  it("retries a workspace that could not be resolved", async () => {
    markup();
    const api = stubApi({
      [PEOPLE]: page([person()]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: [problemResponse(503), session],
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    await mount();
    expect(heading("#people-directory-error")).toBe(
      "People temporarily unavailable",
    );
    expect(listRequests(api)).toHaveLength(0);
    await userEvent.setup().click(
      region().getByRole("button", { name: "Try again" }),
    );
    await waitFor(() => expect(listRequests(api)).toHaveLength(1));
  });

  it("recovers a stale load-more cursor from the current first page", async () => {
    markup();
    const api = stubApi({
      [PEOPLE]: [
        page([person()], { nextCursor: "first-cursor" }),
        problemResponse(409, { code: "stale_cursor", detail: "Changed" }),
        page([person()]),
      ],
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    await mount();
    const more = region().getByRole("button", { name: "Load more people" });
    await userEvent.setup().click(more);
    await waitFor(() => expect(listRequests(api)).toHaveLength(3));
    expect(listRequests(api)[1]?.url.searchParams.get("cursor")).toBe(
      "first-cursor",
    );
    await waitFor(() =>
      expect(element("#people-directory-announcement").textContent).toContain(
        "shown",
      )
    );
    expect(element("#people-directory-list").querySelectorAll(":scope > li"))
      .toHaveLength(1);
    expect(more.hidden).toBe(true);
  });

  it("appends the next page, keeping the list and the control while it loads", async () => {
    markup();
    const second = deferred<Response>();
    stubApi({
      [PEOPLE]: [
        page([person()], { nextCursor: "next" }),
        second.promise,
      ],
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: noTags,
      [FACET]: noFacet,
    });
    await mount();
    const more = region().getByRole("button", { name: "Load more people" });
    await userEvent.setup().click(more);
    expect(more.hidden).toBe(false);
    expect(more).toHaveProperty("disabled", true);
    expect(element("#people-directory-list").hidden).toBe(false);
    expect(element("#people-directory-state").hidden).toBe(true);
    await act(async () => {
      second.resolve(page([person({ givenName: "Grace", id: "g" })]));
      await second.promise;
    });
    await waitFor(() =>
      expect(element("#people-directory-announcement").textContent).toBe(
        "2 active people shown.",
      )
    );
  });

  it("searches, filters by tag, and sorts on submission, keeping the address", async () => {
    markup();
    const tagId = "00000000-0000-4000-8000-000000000090";
    const api = stubApi({
      [PEOPLE]: [page([person()]), page([person()]), page([])],
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [FACET]: noFacet,
      [TAGS]: jsonResponse({
        options: [{ id: tagId, name: "Friends" }],
        status: "ready",
      }),
    });
    await mount();
    const user = userEvent.setup();
    await user.type(region().getByLabelText("Search people"), " Ada ");
    await user.selectOptions(region().getByLabelText("Sort by"), "family-name");
    await user.selectOptions(region().getByLabelText("Tag"), tagId);
    await user.click(region().getByRole("button", { name: "Find people" }));
    await waitFor(() => expect(listRequests(api)).toHaveLength(2));
    const searched = listRequests(api)[1]!.url.searchParams;
    expect(searched.get("search")).toBe("Ada");
    expect(searched.get("sort")).toBe("family-name");
    expect(searched.get("tag")).toBe(tagId);
    await waitFor(() =>
      expect(location.search).toBe(
        `?search=Ada&tag=${tagId}&sort=family-name`,
      )
    );
    await user.clear(region().getByLabelText("Search people"));
    await user.selectOptions(region().getByLabelText("Tag"), "");
    await user.click(region().getByRole("button", { name: "Find people" }));
    await waitFor(() => expect(listRequests(api)).toHaveLength(3));
    expect(heading("#people-directory-empty")).toBe("No people yet");
  });

  it("keeps tag choices bounded while reaching later options by continuation and refinement", async () => {
    const selectedId = "00000000-0000-4000-8000-000000000190";
    const needleId = "00000000-0000-4000-8000-000000000191";
    markup("active", `?tag=${selectedId}`);
    const firstOptions = Array.from({ length: 20 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 200).padStart(12, "0")}`,
      name: `Tag ${String(index + 1).padStart(2, "0")}`,
    }));
    const selected = { id: selectedId, name: "Selected beyond first page" };
    const api = stubApi({
      [PEOPLE]: page([]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [FACET]: noFacet,
      [TAGS]: [
        jsonResponse({
          nextCursor: "tag-cursor",
          options: firstOptions,
          selected,
          status: "ready",
        }),
        jsonResponse({
          options: [
            firstOptions[0],
            { id: "00000000-0000-4000-8000-000000000220", name: "Tag 21" },
          ],
          selected,
          status: "ready",
        }),
        jsonResponse({
          options: [{ id: needleId, name: "Needle tag" }],
          selected,
          status: "ready",
        }),
      ],
    });
    await mount();

    const tag = region().getByLabelText<HTMLSelectElement>("Tag");
    expect(tag.value).toBe(selectedId);
    expect(tag.selectedOptions[0]?.textContent).toBe(
      "Selected beyond first page",
    );
    expect(tag.options).toHaveLength(22);
    expect(listRequests(api)[0]?.url.searchParams.get("tag")).toBe(selectedId);
    expect(tagRequests(api)[0]?.url.searchParams.get("selected")).toBe(
      selectedId,
    );
    expect(heading("#people-directory-empty")).toBe(
      "No people match these filters",
    );

    const user = userEvent.setup();
    await user.click(region().getByRole("button", { name: "Load more tags" }));
    await waitFor(() =>
      expect([...tag.options].some((option) => option.text === "Tag 21"))
        .toBe(true)
    );
    expect(tag.options).toHaveLength(23);
    expect(tagRequests(api)[1]?.url.searchParams.get("cursor")).toBe(
      "tag-cursor",
    );
    expect(element("#people-tag-options-status").textContent).toBe(
      "22 tag options shown.",
    );

    await user.type(
      region().getByLabelText("Search tag options"),
      "  Needle  ",
    );
    await user.click(region().getByRole("button", { name: "Search tags" }));
    await waitFor(() =>
      expect([...tag.options].some((option) => option.text === "Needle tag"))
        .toBe(true)
    );
    expect(tagRequests(api)[2]?.url.searchParams.get("search")).toBe("Needle");
    expect(tagRequests(api)[2]?.url.searchParams.has("cursor")).toBe(false);
    expect(tag.value).toBe(selectedId);
    expect(tag.options).toHaveLength(3);
  });

  it("names a chosen tag the first page does not reach, and reports tags it cannot load", async () => {
    const selectedId = "00000000-0000-4000-8000-000000000190";
    markup("active", `?tag=${selectedId}`);
    stubApi({
      [PEOPLE]: page([]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [FACET]: noFacet,
      [TAGS]: [
        jsonResponse({ options: [], status: "ready" }),
        problemResponse(503),
      ],
    });
    await mount();
    const tag = region().getByLabelText<HTMLSelectElement>("Tag");
    expect(tag.selectedOptions[0]?.textContent).toBe("Selected tag");
    await userEvent.setup().click(
      region().getByRole("button", { name: "Search tags" }),
    );
    await waitFor(() =>
      expect(element("#people-tag-options-status").textContent).toBe(
        "Tag options are temporarily unavailable.",
      )
    );
    expect(element<HTMLButtonElement>("#people-tag-options-more").hidden).toBe(
      true,
    );
  });

  it("does nothing when the directory markup is absent", async () => {
    drawShell("<main></main>");
    const api = stubApi();
    await mount();
    expect(api.fetch).not.toHaveBeenCalled();
  });
});

describe("PEOPLE-009 bulk directory actions", () => {
  const BULK = "POST /api/v1/people/bulk";
  const VCARD = "POST /api/v1/people/bulk/vcard";
  const friends = {
    id: "00000000-0000-4000-8000-000000000090",
    name: "Friends",
  };
  const family = { id: "00000000-0000-4000-8000-000000000091", name: "Family" };
  const ada = person({ familyName: "Lovelace" });
  const grace = person({
    familyName: "Hopper",
    givenName: "Grace",
    id: "00000000-0000-4000-8000-000000000102",
  });
  const alan = person({
    familyName: "Turing",
    givenName: "Alan",
    id: "00000000-0000-4000-8000-000000000103",
  });
  const tags = jsonResponse({ options: [friends, family], status: "ready" });
  const answer = (
    action: string,
    results: readonly Record<string, unknown>[],
  ) => {
    const summary = { done: 0, failed: 0, skipped: 0, unchanged: 0 };
    for (const item of results) {
      summary[item.outcome as keyof typeof summary] += 1;
    }
    return jsonResponse({ action, results, summary });
  };
  const bar = () => region().getByRole("toolbar", { name: "Bulk actions" });
  const bulkRequests = (api: ReturnType<typeof stubApi>) =>
    api.requests().filter((request) =>
      request.url.pathname.startsWith("/api/v1/people/bulk")
    );

  it("selects rows and the page without renaming the row links", async () => {
    markup();
    stubApi({
      [PEOPLE]: page([ada, grace, alan]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: tags,
      [FACET]: noFacet,
    });
    await mount();
    const user = userEvent.setup();
    expect(region().queryByRole("toolbar")).toBeNull();
    expect(
      region().getByRole("link", { name: /Ada Lovelace/ }).getAttribute(
        "aria-label",
      ),
    ).toBeNull();
    await user.click(
      region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
    );
    expect(within(bar()).getByText("1 selected")).toBeTruthy();
    const all = region().getByRole("checkbox", { name: "Select all 3 shown" });
    await user.click(all);
    expect(within(bar()).getByText("3 selected")).toBeTruthy();
    expect(all).toHaveProperty("checked", true);
    expect(
      region().getByRole("checkbox", { name: "Select Grace Hopper" }),
    ).toHaveProperty("checked", true);
    await expectNoAxeViolations(element("main"));
    await user.click(all);
    expect(region().queryByRole("toolbar")).toBeNull();
    await user.click(
      region().getByRole("checkbox", { name: "Select Alan Turing" }),
    );
    await user.click(within(bar()).getByRole("button", { name: "Clear" }));
    expect(region().queryByRole("toolbar")).toBeNull();
    expect(
      region().getByRole("checkbox", { name: "Select Alan Turing" }),
    ).toHaveProperty("checked", false);
  });

  it("adds a tag to the selection, reports each outcome, and refreshes once", async () => {
    markup();
    const held = deferred<Response>();
    const api = stubApi({
      [BULK]: held.promise,
      [PEOPLE]: [page([ada, grace, alan]), page([ada, grace, alan])],
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: tags,
      [FACET]: noFacet,
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      region().getByRole("checkbox", { name: "Select all 3 shown" }),
    );
    await user.click(within(bar()).getByRole("button", { name: "Add tag…" }));
    const picker = within(bar()).getByLabelText("Tag to add");
    // REL-066: the choice opens on its search, which comes first.
    expect(document.activeElement).toBe(
      within(bar()).getByLabelText("Search tags to add"),
    );
    await user.selectOptions(picker, family.id);
    await user.click(within(bar()).getByRole("button", { name: "Add tag" }));
    expect(bar().getAttribute("aria-busy")).toBe("true");
    expect(bar().hasAttribute("inert")).toBe(true);
    expect(bulkRequests(api)[0]?.body).toEqual({
      action: "tag",
      personIds: [personId, grace.id, alan.id],
      tagId: family.id,
    });
    expect(bulkRequests(api)[0]?.headers.get("X-Workspace-Id")).toBe(
      workspaceId,
    );
    await act(async () => {
      held.resolve(answer("tag", [
        { outcome: "done", personId },
        { outcome: "unchanged", personId: grace.id },
        {
          code: "archived_write_rejected",
          outcome: "failed",
          personId: alan.id,
        },
      ]));
      await held.promise;
    });
    const report = await waitFor(() => element("#people-bulk-result"));
    expect(report.textContent).toContain("Added “Family” to 1 person.");
    expect(report.textContent).toContain("1 done · 1 unchanged · 1 failed");
    expect(
      within(report).getByRole("list", { name: "People not changed" })
        .textContent,
    ).toBe("Alan Turing: Archived and read-only; restore first");
    await waitFor(() => expect(listRequests(api)).toHaveLength(2));
    expect(document.activeElement).toBe(report);
    expect(region().queryByRole("toolbar")).toBeNull();
    await waitFor(() =>
      expect(region().getByRole("link", { name: /Ada Lovelace/ })).toBeTruthy()
    );
    expect(element("#people-bulk-result")).toBe(report);
    await user.click(within(report).getByRole("button", { name: "Dismiss" }));
    expect(document.querySelector("#people-bulk-result")).toBeNull();
    // The selection went with the run, so focus returns to the first person
    // it was made of.
    expect(document.activeElement).toBe(
      region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
    );
    expect(bulkRequests(api)).toHaveLength(1);
  });

  it("removes a tag, and cancels a choice without a request", async () => {
    markup();
    const api = stubApi({
      [BULK]: answer("untag", [{ outcome: "done", personId }]),
      [PEOPLE]: [page([ada]), page([ada])],
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: tags,
      [FACET]: noFacet,
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
    );
    await user.click(
      within(bar()).getByRole("button", { name: "Remove tag…" }),
    );
    await user.click(within(bar()).getByRole("button", { name: "Cancel" }));
    expect(document.activeElement).toBe(
      within(bar()).getByRole("button", { name: "Remove tag…" }),
    );
    await user.click(
      within(bar()).getByRole("button", { name: "Remove tag…" }),
    );
    await user.click(within(bar()).getByRole("button", { name: "Remove tag" }));
    await waitFor(() =>
      expect(element("#people-bulk-result").textContent).toContain(
        "Removed “Friends” from 1 person.",
      )
    );
    expect(bulkRequests(api)[0]?.body).toEqual({
      action: "untag",
      personIds: [personId],
      tagId: friends.id,
    });
  });

  it("asks before archiving and archives on confirmation", async () => {
    markup();
    const api = stubApi({
      [BULK]: answer("archive", [
        { outcome: "done", personId },
        { code: "not_found", outcome: "failed", personId: grace.id },
      ]),
      [PEOPLE]: [page([ada, grace]), page([])],
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: tags,
      [FACET]: noFacet,
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      region().getByRole("checkbox", { name: "Select all 2 shown" }),
    );
    await user.click(within(bar()).getByRole("button", { name: "Archive" }));
    const dialog = await waitFor(() =>
      document.querySelector<HTMLElement>("[role=dialog]")!
    );
    expect(within(dialog).getByText("Archive 2 people?")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(document.querySelector("[role=dialog]")).toBeNull()
    );
    await user.click(within(bar()).getByRole("button", { name: "Archive" }));
    await waitFor(() =>
      expect(document.querySelector("[role=dialog]")).not.toBeNull()
    );
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(document.querySelector("[role=dialog]")).toBeNull()
    );
    expect(document.activeElement).toBe(
      within(bar()).getByRole("button", { name: "Archive" }),
    );
    expect(bulkRequests(api)).toHaveLength(0);
    await user.click(within(bar()).getByRole("button", { name: "Archive" }));
    const again = await waitFor(() =>
      document.querySelector<HTMLElement>("[role=dialog]")!
    );
    await user.click(
      within(again).getByRole("button", { name: "Archive 2 people" }),
    );
    await waitFor(() =>
      expect(element("#people-bulk-result").textContent).toContain(
        "Archived 1 person.",
      )
    );
    expect(bulkRequests(api)[0]?.body).toEqual({
      action: "archive",
      personIds: [personId, grace.id],
    });
    expect(element("#people-bulk-result").textContent).toContain(
      "Grace Hopper: No longer in this workspace",
    );
    await waitFor(() =>
      expect(element("#people-directory-empty").hidden).toBe(false)
    );
    await user.click(
      within(element("#people-bulk-result")).getByRole("button", {
        name: "Dismiss",
      }),
    );
    // Nobody is left to return to, so focus goes back to the search.
    expect(document.activeElement).toBe(
      region().getByLabelText("Search people"),
    );
  });

  it("restores from the archived view without asking", async () => {
    markup("archived");
    const api = stubApi({
      [BULK]: answer("restore", [{ outcome: "done", personId }]),
      [PEOPLE]: [
        page([person({ lifecycle: "archived" })], { lifecycle: "archived" }),
        page([{ ...grace, lifecycle: "archived" }], { lifecycle: "archived" }),
      ],
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: tags,
      [FACET]: noFacet,
    });
    await mount();
    const user = userEvent.setup();
    await user.click(region().getByRole("checkbox", { name: "Select Ada" }));
    expect(within(bar()).queryByRole("button", { name: "Archive" })).toBeNull();
    // An archived person is read-only, so tagging is not offered.
    expect(within(bar()).queryByRole("button", { name: "Add tag…" }))
      .toBeNull();
    expect(within(bar()).queryByRole("button", { name: "Remove tag…" }))
      .toBeNull();
    await user.click(within(bar()).getByRole("button", { name: "Restore" }));
    await waitFor(() =>
      expect(element("#people-bulk-result").textContent).toContain(
        "Restored 1 person.",
      )
    );
    expect(bulkRequests(api)[0]?.body).toEqual({
      action: "restore",
      personIds: [personId],
    });
    await waitFor(() =>
      expect(
        region().getByRole("checkbox", { name: "Select Grace Hopper" }),
      ).toBeTruthy()
    );
    // The run moved who carries which tag here, so the facet is read again
    // for the archived view (GAP-053).
    const facetReads = api.requests().filter((request) =>
      request.url.pathname === "/api/v1/people/tag-facet"
    );
    expect(facetReads.map((read) => read.url.searchParams.get("lifecycle")))
      .toEqual(["archived", "archived"]);
    await user.click(
      within(element("#people-bulk-result")).getByRole("button", {
        name: "Dismiss",
      }),
    );
    // Ada left the list, so focus goes to the page's selection box.
    expect(document.activeElement).toBe(
      region().getByRole("checkbox", { name: "Select all 1 shown" }),
    );
  });

  it("exports the selection as one vCard and says who was skipped", async () => {
    markup();
    const created: Blob[] = [];
    const saved: string[] = [];
    const createObjectURL = URL.createObjectURL;
    const revokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = (blob: Blob) => {
      created.push(blob);
      return "blob:selection";
    };
    const revoked: string[] = [];
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };
    const timers: (() => void)[] = [];
    const setTimeout = globalThis.setTimeout;
    globalThis.setTimeout =
      ((work: () => void, delay?: number) =>
        delay === 60_000
          ? (timers.push(work), 0)
          : setTimeout(work, delay)) as typeof globalThis.setTimeout;
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      saved.push(`${this.download} ${this.getAttribute("href")}`);
    };
    try {
      const api = stubApi({
        [PEOPLE]: page([ada, grace]),
        [PREFERENCES]: savedPreferences(),
        [SESSION]: session,
        [TAGS]: tags,
        [FACET]: noFacet,
        [VCARD]: new Response(
          "BEGIN:VCARD\r\nFN:Ada Lovelace\r\nEND:VCARD\r\n",
          {
            headers: {
              "content-disposition":
                "attachment; filename=\"kinship-people-1.vcf\"; filename*=UTF-8''kinship-people-1.vcf",
              "content-type": "text/vcard; charset=utf-8",
              "x-skipped-count": "1",
            },
          },
        ),
      });
      await mount();
      const user = userEvent.setup();
      await user.click(
        region().getByRole("checkbox", { name: "Select all 2 shown" }),
      );
      await user.click(
        within(bar()).getByRole("button", { name: "Export vCard" }),
      );
      await waitFor(() =>
        expect(element("#people-bulk-result").textContent).toContain(
          "Exported 1 person to a vCard.",
        )
      );
      expect(element("#people-bulk-result").textContent).toContain(
        "1 skipped: no longer in this workspace.",
      );
      expect(bulkRequests(api)[0]?.body).toEqual({
        personIds: [personId, grace.id],
      });
      expect(saved).toEqual(["kinship-people-1.vcf blob:selection"]);
      expect(await created[0]?.text()).toContain("FN:Ada Lovelace");
      expect(listRequests(api)).toHaveLength(1);
      expect(within(bar()).getByText("2 selected")).toBeTruthy();
      expect(revoked).toEqual([]);
      for (const work of timers) work();
      expect(revoked).toEqual(["blob:selection"]);
    } finally {
      globalThis.setTimeout = setTimeout;
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
      HTMLAnchorElement.prototype.click = click;
    }
  });

  it("reports an export that skipped nobody without a skipped line", async () => {
    markup();
    const createObjectURL = URL.createObjectURL;
    const click = HTMLAnchorElement.prototype.click;
    URL.createObjectURL = () => "blob:one";
    HTMLAnchorElement.prototype.click = () => undefined;
    try {
      stubApi({
        [PEOPLE]: page([ada]),
        [PREFERENCES]: savedPreferences(),
        [SESSION]: session,
        [TAGS]: noTags,
        [FACET]: noFacet,
        [VCARD]: new Response("BEGIN:VCARD\r\nEND:VCARD\r\n"),
      });
      await mount();
      const user = userEvent.setup();
      await user.click(
        region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
      );
      await user.click(within(bar()).getByRole("button", { name: "Add tag…" }));
      expect(within(bar()).getByRole("button", { name: "Add tag" }))
        .toHaveProperty("disabled", true);
      await user.click(within(bar()).getByRole("button", { name: "Cancel" }));
      await user.click(
        within(bar()).getByRole("button", { name: "Export vCard" }),
      );
      const report = await waitFor(() => element("#people-bulk-result"));
      await waitFor(() =>
        expect(report.textContent).toBe(
          "Exported 1 person to a vCard.Dismiss",
        )
      );
      await user.click(within(report).getByRole("button", { name: "Dismiss" }));
      // The selection is still there, so focus returns to its bar.
      expect(bar().contains(document.activeElement)).toBe(true);
    } finally {
      URL.createObjectURL = createObjectURL;
      HTMLAnchorElement.prototype.click = click;
    }
  });

  it("reports a refused or unanswered request and keeps the selection", async () => {
    markup();
    const api = stubApi({
      [BULK]: [
        problemResponse(400, {
          code: "profile_fact_reference_invalid",
          detail: "Select an active option from the current workspace.",
        }),
        () => Promise.reject(new Error("offline")),
      ],
      [PEOPLE]: page([ada]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: tags,
      [FACET]: noFacet,
      [VCARD]: problemResponse(404, { detail: "None of them." }),
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
    );
    await user.click(within(bar()).getByRole("button", { name: "Add tag…" }));
    await user.click(within(bar()).getByRole("button", { name: "Add tag" }));
    await waitFor(() =>
      expect(element("#people-bulk-result").textContent).toContain(
        "Nothing was changed.Select an active option from the current workspace.",
      )
    );
    expect(within(bar()).getByText("1 selected")).toBeTruthy();
    await user.click(within(bar()).getByRole("button", { name: "Archive" }));
    const dialog = await waitFor(() =>
      document.querySelector<HTMLElement>("[role=dialog]")!
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Archive 1 person" }),
    );
    await waitFor(() =>
      expect(element("#people-bulk-result").textContent).toContain(
        "The people service is temporarily unavailable. Try again.",
      )
    );
    await user.click(
      within(bar()).getByRole("button", { name: "Export vCard" }),
    );
    await waitFor(() =>
      expect(element("#people-bulk-result").textContent).toContain(
        "No vCard was exported.None of them.",
      )
    );
    expect(listRequests(api)).toHaveLength(1);
  });

  it("clears the selection when a new search runs", async () => {
    markup();
    stubApi({
      [PEOPLE]: [page([ada]), page([ada])],
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: tags,
      [FACET]: noFacet,
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
    );
    expect(bar()).toBeTruthy();
    await user.click(region().getByRole("button", { name: "Find people" }));
    await waitFor(() => expect(region().queryByRole("toolbar")).toBeNull());
    await waitFor(() =>
      expect(
        region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
      ).toHaveProperty("checked", false)
    );
  });

  it("says when the selection cap refuses more people", async () => {
    markup();
    const many = Array.from({ length: 101 }, (_, index) =>
      person({
        givenName: `Person ${index}`,
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      }));
    stubApi({
      [PEOPLE]: page(many),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [TAGS]: tags,
      [FACET]: noFacet,
    });
    await mount();
    await userEvent.setup().click(
      region().getByRole("checkbox", { name: "Select all 101 shown" }),
    );
    expect(within(bar()).getByText("100 selected")).toBeTruthy();
    expect(element("#people-selection-notice").textContent).toBe(
      "You can select up to 100 people at a time. The first 100 are selected.",
    );
  });

  describe("REL-066 the bar's own tag picker", () => {
    const tagId = (index: number) =>
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;

    it("reaches a tag beyond the first page by More tags and by its own search, and applies it", async () => {
      markup();
      const first = Array.from({ length: 20 }, (_, index) => ({
        id: tagId(300 + index),
        name: `Tag ${String(index + 1).padStart(2, "0")}`,
      }));
      const later = { id: tagId(400), name: "Tag 21" };
      const needle = { id: tagId(401), name: "Needle" };
      const api = stubApi({
        [BULK]: answer("tag", [{ outcome: "done", personId }]),
        [PEOPLE]: [page([ada]), page([ada])],
        [PREFERENCES]: savedPreferences(),
        [SESSION]: session,
        [FACET]: noFacet,
        [TAGS]: ({ url }) => {
          const query = url.searchParams;
          if (query.get("search") === "Needle") {
            return jsonResponse({ options: [needle], status: "ready" });
          }
          if (query.get("cursor") === "picker-next") {
            return jsonResponse({ options: [later], status: "ready" });
          }
          return jsonResponse({
            nextCursor: "picker-next",
            options: first,
            status: "ready",
          });
        },
      });
      await mount();
      const user = userEvent.setup();
      await user.click(
        region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
      );
      await user.click(within(bar()).getByRole("button", { name: "Add tag…" }));
      const picker = within(bar()).getByLabelText<HTMLSelectElement>(
        "Tag to add",
      );
      expect(document.activeElement).toBe(
        within(bar()).getByLabelText("Search tags to add"),
      );
      await waitFor(() => expect(picker.options.length).toBe(20));
      expect(element("#people-bulk-tag-status").textContent).toBe(
        "20 tag options shown.",
      );

      await user.click(
        within(bar()).getByRole("button", { name: "More tags" }),
      );
      await waitFor(() => expect(picker.options.length).toBe(21));
      expect(picker.options[20]?.text).toBe("Tag 21");
      const continued = tagRequests(api).at(-1)!;
      expect(continued.url.searchParams.get("cursor")).toBe("picker-next");
      expect(continued.url.searchParams.has("search")).toBe(false);
      expect(
        within(bar()).queryByRole("button", { name: "More tags" }),
      ).toBeNull();
      // The control went with the last page, so focus moves to the options.
      expect(document.activeElement).toBe(picker);

      await user.type(
        within(bar()).getByLabelText("Search tags to add"),
        "  Needle  {Enter}",
      );
      await waitFor(() => expect(picker.options.length).toBe(1));
      expect(picker.value).toBe(needle.id);
      expect(tagRequests(api).at(-1)?.url.searchParams.get("search")).toBe(
        "Needle",
      );
      expect(tagRequests(api).at(-1)?.url.searchParams.has("cursor")).toBe(
        false,
      );
      expect(element("#people-bulk-tag-status").textContent).toBe(
        "1 tag option shown.",
      );
      // The directory's own tag filter is left as it was.
      expect(
        region().getByLabelText<HTMLSelectElement>("Tag").options.length,
      ).toBe(21);

      await user.click(within(bar()).getByRole("button", { name: "Add tag" }));
      await waitFor(() =>
        expect(element("#people-bulk-result").textContent).toContain(
          "Added “Needle” to 1 person.",
        )
      );
      expect(bulkRequests(api)[0]?.body).toEqual({
        action: "tag",
        personIds: [personId],
        tagId: needle.id,
      });
    });

    it("lists tags regardless of the search typed into the tag filter", async () => {
      markup();
      const api = stubApi({
        [PEOPLE]: page([ada]),
        [PREFERENCES]: savedPreferences(),
        [SESSION]: session,
        [FACET]: noFacet,
        [TAGS]: ({ url }) =>
          jsonResponse({
            options: url.searchParams.get("search") === "Fri"
              ? [friends]
              : [friends, family],
            status: "ready",
          }),
      });
      await mount();
      const user = userEvent.setup();
      const filter = region().getByLabelText<HTMLSelectElement>("Tag");
      await user.type(region().getByLabelText("Search tag options"), "Fri");
      await user.click(region().getByRole("button", { name: "Search tags" }));
      await waitFor(() => expect(filter.options.length).toBe(2));

      await user.click(
        region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
      );
      await user.click(
        within(bar()).getByRole("button", { name: "Remove tag…" }),
      );
      const picker = within(bar()).getByLabelText<HTMLSelectElement>(
        "Tag to remove",
      );
      await waitFor(() => expect(picker.options.length).toBe(2));
      expect(tagRequests(api).at(-1)?.url.searchParams.has("search")).toBe(
        false,
      );

      // A filter search while the choice is open leaves the picker alone.
      await user.clear(region().getByLabelText("Search tag options"));
      await user.type(region().getByLabelText("Search tag options"), "Fri");
      await user.click(region().getByRole("button", { name: "Search tags" }));
      await waitFor(() =>
        expect(tagRequests(api).at(-1)?.url.searchParams.get("search")).toBe(
          "Fri",
        )
      );
      await waitFor(() =>
        expect(element("#people-tag-options-status").textContent).toBe(
          "1 tag option shown.",
        )
      );
      expect([...picker.options].map((option) => option.text)).toEqual([
        "Friends",
        "Family",
      ]);
    });

    it("says when it cannot read tag options and offers nothing to apply", async () => {
      markup();
      const api = stubApi({
        [PEOPLE]: page([ada]),
        [PREFERENCES]: savedPreferences(),
        [SESSION]: session,
        [FACET]: noFacet,
        [TAGS]: [noTags, problemResponse(503)],
      });
      await mount();
      const user = userEvent.setup();
      await user.click(
        region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
      );
      await user.click(within(bar()).getByRole("button", { name: "Add tag…" }));
      await waitFor(() =>
        expect(element("#people-bulk-tag-status").textContent).toBe(
          "Tag options are temporarily unavailable.",
        )
      );
      expect(
        within(bar()).getByRole("button", { name: "Add tag" }),
      ).toHaveProperty("disabled", true);
      await expectNoAxeViolations(element("main"));
      expect(bulkRequests(api)).toHaveLength(0);
    });

    it("keeps More tags to try again when a later page cannot be read", async () => {
      markup();
      stubApi({
        [PEOPLE]: page([ada]),
        [PREFERENCES]: savedPreferences(),
        [SESSION]: session,
        [FACET]: noFacet,
        [TAGS]: [
          noTags,
          jsonResponse({
            nextCursor: "picker-next",
            options: [friends],
            status: "ready",
          }),
          problemResponse(503),
          jsonResponse({ options: [family], status: "ready" }),
        ],
      });
      await mount();
      const user = userEvent.setup();
      await user.click(
        region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
      );
      await user.click(within(bar()).getByRole("button", { name: "Add tag…" }));
      const more = await waitFor(() =>
        within(bar()).getByRole("button", { name: "More tags" })
      );
      await user.click(more);
      await waitFor(() =>
        expect(element("#people-bulk-tag-status").textContent).toBe(
          "Tag options are temporarily unavailable.",
        )
      );
      const retry = within(bar()).getByRole("button", { name: "More tags" });
      expect(retry).toHaveProperty("disabled", false);
      expect(document.activeElement).toBe(retry);
      await user.click(retry);
      const picker = within(bar()).getByLabelText<HTMLSelectElement>(
        "Tag to add",
      );
      await waitFor(() => expect(picker.options.length).toBe(2));
      expect(document.activeElement).toBe(picker);
    });

    it("ignores the answer to a picker search a newer one replaced", async () => {
      markup();
      const stale = deferred<Response>();
      stubApi({
        [PEOPLE]: page([ada]),
        [PREFERENCES]: savedPreferences(),
        [SESSION]: session,
        [FACET]: noFacet,
        [TAGS]: ({ url }) => {
          const search = url.searchParams.get("search");
          if (search === "Fam") return stale.promise;
          return jsonResponse({
            options: search === "Fri" ? [friends] : [friends, family],
            status: "ready",
          });
        },
      });
      await mount();
      const user = userEvent.setup();
      await user.click(
        region().getByRole("checkbox", { name: "Select Ada Lovelace" }),
      );
      await user.click(within(bar()).getByRole("button", { name: "Add tag…" }));
      const picker = within(bar()).getByLabelText<HTMLSelectElement>(
        "Tag to add",
      );
      await waitFor(() => expect(picker.options.length).toBe(2));
      const field = within(bar()).getByLabelText("Search tags to add");
      await user.type(field, "Fam{Enter}");
      expect(element("#people-bulk-tag-status").textContent).toBe(
        "Loading tag options…",
      );
      await user.clear(field);
      await user.type(field, "Fri");
      await user.click(within(bar()).getByRole("button", { name: "Search" }));
      await waitFor(() => expect(picker.options.length).toBe(1));
      await act(async () => {
        stale.resolve(jsonResponse({ options: [family], status: "ready" }));
        await stale.promise;
      });
      expect([...picker.options].map((option) => option.text)).toEqual([
        "Friends",
      ]);
      expect(element("#people-bulk-tag-status").textContent).toBe(
        "1 tag option shown.",
      );
    });
  });
});

describe("PEOPLE-010 directory stars, orders, and tag facet", () => {
  const friends = "00000000-0000-4000-8000-000000000090";
  const family = "00000000-0000-4000-8000-000000000091";
  const facet = (truncated = false) =>
    jsonResponse({
      lifecycle: "active",
      status: "ready",
      tags: [
        { count: 3, id: friends, name: "Friends" },
        { count: 1, id: family, name: "Family" },
      ],
      truncated,
    });

  it("shows the view's tags with counts and filters by a chip at once", async () => {
    markup();
    const api = stubApi({
      [PEOPLE]: page([person()]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [FACET]: facet(true),
      [TAGS]: noTags,
    });
    await mount();
    const group = within(element("#people-tag-facet"));
    const list = group.getByRole("list", { name: "Tags in this view" });
    const chip = within(list).getByRole("button", {
      name: "Friends, 3 people",
    });
    expect(within(list).getByRole("button", { name: "Family, 1 person" }))
      .toBeTruthy();
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    expect(
      api.requests().find((request) =>
        request.url.pathname === "/api/v1/people/tag-facet"
      )?.url.searchParams.get("lifecycle"),
    ).toBe("active");
    await expectNoAxeViolations(element("[data-people-directory]"));
    const user = userEvent.setup();
    await user.click(chip);
    await waitFor(() => expect(listRequests(api)).toHaveLength(2));
    expect(listRequests(api)[1]!.url.searchParams.get("tag")).toBe(friends);
    await waitFor(() => expect(chip.getAttribute("aria-pressed")).toBe("true"));
    expect(
      (element("#people-directory-tag") as HTMLSelectElement).value,
      "the picker shows the facet's tag",
    ).toBe(friends);
    await waitFor(() => expect(location.search).toBe(`?tag=${friends}`));
    await user.click(chip);
    await waitFor(() => expect(listRequests(api)).toHaveLength(3));
    expect(listRequests(api)[2]!.url.searchParams.get("tag")).toBeNull();
    await user.click(group.getByRole("button", { name: "More tags…" }));
    expect(document.activeElement).toBe(
      element("#people-tag-options-search"),
    );
  });

  it("says when tag counts are unavailable or unused", async () => {
    for (
      const [answer, words] of [
        [
          problemResponse(503, { code: "tag_facet_unavailable" }),
          "Tag counts are temporarily unavailable.",
        ],
        [noFacet, "No tags are used in this view."],
      ] as const
    ) {
      markup();
      stubApi({
        [PEOPLE]: page([person()]),
        [PREFERENCES]: savedPreferences(),
        [SESSION]: session,
        [FACET]: answer,
        [TAGS]: noTags,
      });
      const unmount = await mount();
      expect(element("#people-tag-facet").textContent).toContain(words);
      unmount();
    }
  });

  it("asks for starred people, starred first, and the new orders on submission", async () => {
    markup("active", "?starredFirst=1");
    const api = stubApi({
      [PEOPLE]: [
        page([person({ isStarred: true })]),
        page([person({ isStarred: true })]),
      ],
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [FACET]: noFacet,
      [TAGS]: noTags,
    });
    await mount();
    const first = listRequests(api)[0]!.url.searchParams;
    expect(first.get("starredFirst"), "the address's choice is read").toBe(
      "true",
    );
    expect(first.get("starred")).toBeNull();
    expect(
      element("#people-directory-list .directory-person-star").getAttribute(
        "aria-hidden",
      ),
    ).toBe("true");
    expect(element("#people-directory-list").textContent).toContain(
      "Favorite",
    );
    const user = userEvent.setup();
    const sort = region().getByLabelText("Sort by");
    expect(
      within(sort).getAllByRole("option").map((option) => option.textContent),
    ).toEqual([
      "Given name",
      "Family name",
      "Recently added",
      "Last contacted",
      "Recently updated",
    ]);
    await user.selectOptions(sort, "last-contacted");
    await user.click(region().getByLabelText("Starred only"));
    await user.click(region().getByLabelText("Starred first"));
    await user.click(region().getByRole("button", { name: "Find people" }));
    await waitFor(() => expect(listRequests(api)).toHaveLength(2));
    const second = listRequests(api)[1]!.url.searchParams;
    expect(second.get("sort")).toBe("last-contacted");
    expect(second.get("starred")).toBe("true");
    expect(second.get("starredFirst")).toBeNull();
    await waitFor(() =>
      expect(location.search).toBe("?starred=1&sort=last-contacted")
    );
  });
});

describe("PEOPLE-010 tag facet under a newer tag read", () => {
  it("carries the facet over to a tag read that replaces the one counting", async () => {
    markup();
    const slow = deferred<Response>();
    const api = stubApi({
      [PEOPLE]: page([person()]),
      [PREFERENCES]: savedPreferences(),
      [SESSION]: session,
      [FACET]: [
        slow.promise,
        jsonResponse({
          lifecycle: "active",
          status: "ready",
          tags: [{
            count: 2,
            id: "00000000-0000-4000-8000-000000000090",
            name: "Friends",
          }],
          truncated: false,
        }),
      ],
      [TAGS]: noTags,
    });
    const settled = mountPending(() => mountPeopleDirectory());
    await waitFor(() =>
      expect(element("#people-directory-list").hidden).toBe(false)
    );
    expect(element("#people-tag-facet").textContent).toContain(
      "Counting tags…",
    );
    const user = userEvent.setup();
    await user.click(region().getByRole("button", { name: "Search tags" }));
    await waitFor(() =>
      expect(
        within(element("#people-tag-facet")).getByRole("button", {
          name: "Friends, 2 people",
        }),
      ).toBeTruthy()
    );
    await act(async () => {
      slow.resolve(
        jsonResponse({
          lifecycle: "active",
          status: "ready",
          tags: [],
          truncated: false,
        }),
      );
      await Promise.resolve();
    });
    expect(
      element("#people-tag-facet").textContent,
      "the superseded facet answer is dropped",
    ).toContain("Friends");
    expect(
      api.requests().filter((request) =>
        request.url.pathname === "/api/v1/people/tag-facet"
      ),
    ).toHaveLength(2);
    await settled;
  });
});
