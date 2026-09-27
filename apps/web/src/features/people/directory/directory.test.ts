import { describe, expect, it } from "vitest";
import type { PeopleDirectoryPerson } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  directoryInput,
  directoryLocation,
  directoryReducer,
  emptyCopy,
  errorCopy,
  initialDirectory,
  isSort,
  personDetails,
  personName,
} from "./directory.ts";

const person = (overrides: Partial<PeopleDirectoryPerson> = {}) =>
  ({
    givenName: "Ada",
    id: "p",
    isPartial: false,
    isStarred: false,
    lifecycle: "active",
    tagCount: 0,
    tags: [],
    ...overrides,
  }) as PeopleDirectoryPerson;

describe("PEOPLE-002 directory queries", () => {
  it("recognises the three sorts", () => {
    expect(isSort("given-name")).toBe(true);
    expect(isSort("family-name")).toBe(true);
    expect(isSort("recently-added")).toBe(true);
    expect(isSort("invalid")).toBe(false);
    expect(isSort(null)).toBe(false);
  });

  it("asks for one page of the lifecycle with only the filters given", () => {
    expect(directoryInput("active", {
      search: "  ",
      sort: "given-name",
      tagId: "",
    })).toEqual({ lifecycle: "active", limit: 20, sort: "given-name" });
    expect(directoryInput("archived", {
      search: " Ada ",
      sort: "family-name",
      tagId: "t",
    }, "next")).toEqual({
      cursor: "next",
      lifecycle: "archived",
      limit: 20,
      search: "Ada",
      sort: "family-name",
      tagId: "t",
    });
  });

  it("keeps the sort in the address only when it was chosen", () => {
    const query = { search: "", sort: "given-name", tagId: "" } as const;
    expect(directoryLocation("/app/people", "", query, "given-name")).toBe(
      "/app/people",
    );
    expect(
      directoryLocation("/app/people", "?sort=given-name", query, "given-name"),
    ).toBe("/app/people?sort=given-name");
    expect(
      directoryLocation("/app/people", "?sort=bogus", query, "family-name"),
    ).toBe("/app/people?sort=given-name");
    expect(directoryLocation("/app/people", "", {
      search: " Ada ",
      sort: "family-name",
      tagId: "t",
    }, "family-name")).toBe("/app/people?search=Ada&tag=t");
  });

  it("words people, empty results, and failures", () => {
    expect(personDetails(person())).toBe("Open person workspace");
    expect(
      personName(person({ familyName: "Lovelace" }), "family_given_nickname"),
    ).toBe("Lovelace Ada");
    expect(personDetails(person({ isStarred: true, isPartial: true }))).toBe(
      "Favorite · Partial identity",
    );
    expect(personDetails(person({ lifecycle: "archived" }))).toBe(
      "Archived · read-only",
    );
    expect(emptyCopy(true, "archived").heading).toBe(
      "No people match these filters",
    );
    expect(emptyCopy(false, "archived").heading).toBe("No archived people");
    expect(emptyCopy(false, "active")).toEqual({
      detail: "Add your first person when you are ready.",
      heading: "No people yet",
    });
    expect(errorCopy(true).heading).toBe("People unavailable");
    expect(errorCopy(false).heading).toBe("People temporarily unavailable");
  });
});

describe("PEOPLE-002 directory reducer", () => {
  const start = initialDirectory("");
  const ready = directoryReducer(
    directoryReducer(start, { append: false, type: "loading" }),
    {
      append: false,
      filtered: false,
      lifecycle: "active",
      nextCursor: "next",
      people: [person()],
      type: "loaded",
    },
  );

  it("starts resolving the workspace with its controls live", () => {
    expect(start).toMatchObject({ loading: false, status: "context" });
    expect(
      directoryReducer(start, {
        defaultSort: "family-name",
        nameOrder: "family_given_nickname",
        sort: "recently-added",
        type: "context",
      }),
    ).toMatchObject({
      defaultSort: "family-name",
      nameOrder: "family_given_nickname",
      sort: "recently-added",
    });
  });

  it("replaces the list for a new read and appends a continuation", () => {
    expect(ready).toMatchObject({
      announcement: "1 active person shown.",
      loading: false,
      nextCursor: "next",
      status: "ready",
    });
    const appending = directoryReducer(ready, {
      append: true,
      type: "loading",
    });
    expect(appending).toMatchObject({
      appending: true,
      loading: true,
      status: "ready",
    });
    const more = directoryReducer(appending, {
      append: true,
      filtered: false,
      lifecycle: "archived",
      nextCursor: undefined,
      people: [person({ id: "q" }), person({ id: "r" })],
      type: "loaded",
    });
    expect(more.people).toHaveLength(3);
    expect(more.announcement).toBe("3 archived people shown.");
    const none = directoryReducer(more, {
      append: false,
      filtered: true,
      lifecycle: "active",
      nextCursor: undefined,
      people: [],
      type: "loaded",
    });
    expect(none).toMatchObject({
      announcement: "No people found.",
      filtered: true,
      people: [],
    });
  });

  it("fails without offering a page and announces a changed list", () => {
    expect(directoryReducer(ready, { forbidden: true, type: "failed" }))
      .toMatchObject({
        forbidden: true,
        loading: false,
        nextCursor: undefined,
        status: "error",
      });
    expect(
      directoryReducer(ready, { announcement: "Changed", type: "announce" })
        .announcement,
    ).toBe("Changed");
    expect(directoryReducer(ready, { sort: "family-name", type: "sort" }).sort)
      .toBe("family-name");
  });

  it("pages tag options, keeping the chosen one", () => {
    const chosen = directoryReducer(initialDirectory("t"), {
      selected: "s",
      type: "tag",
    });
    expect(chosen.tag.selected).toBe("s");
    const loading = directoryReducer(chosen, {
      append: false,
      type: "tags-loading",
    });
    expect(loading.tag).toMatchObject({
      loading: true,
      status: "Loading tag options…",
    });
    const first = directoryReducer(loading, {
      append: false,
      page: {
        nextCursor: "c",
        options: [{ id: "s", name: "Chosen" }, { id: "a", name: "A" }],
        selected: { id: "s", name: "Chosen" },
      } as never,
      type: "tags-loaded",
    });
    expect(first.tag.options.map((option) => option.id)).toEqual(["s", "a"]);
    expect(first.tag).toMatchObject({
      cursor: "c",
      loading: false,
      status: "2 tag options shown.",
    });
    expect(
      directoryReducer(first, { append: true, type: "tags-loading" }).tag
        .status,
    ).toBe("Loading more tag options…");
    const more = directoryReducer(first, {
      append: true,
      page: {
        options: [{ id: "a", name: "A" }, { id: "b", name: "B" }],
      } as never,
      type: "tags-loaded",
    });
    expect(more.tag.options.map((option) => option.id)).toEqual([
      "s",
      "a",
      "b",
    ]);
    const all = directoryReducer(
      directoryReducer(more, { selected: "", type: "tag" }),
      {
        append: false,
        page: { options: [{ id: "b", name: "B" }] } as never,
        type: "tags-loaded",
      },
    );
    expect(all.tag.options.map((option) => option.id)).toEqual(["b"]);
    expect(all.tag.status).toBe("1 tag option shown.");
    const unnamed = directoryReducer(initialDirectory("x"), {
      append: false,
      page: { options: [] } as never,
      type: "tags-loaded",
    });
    expect(unnamed.tag.options).toEqual([{ id: "x", name: "Selected tag" }]);
    expect(directoryReducer(first, { type: "tags-failed" }).tag).toMatchObject({
      cursor: undefined,
      loading: false,
      status: "Tag options are temporarily unavailable.",
    });
  });
});
