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
const ENTRY = "POST /api/v1/application-entry";

const session = jsonResponse(workspaceSession());
const savedPreferences = (overrides = {}) =>
  jsonResponse({ preferences: preferences(overrides), status: "ready" });
const noTags = jsonResponse({ options: [], status: "ready" });
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
