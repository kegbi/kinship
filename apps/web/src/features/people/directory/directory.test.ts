import { describe, expect, it } from "vitest";
import type { PeopleDirectoryPerson } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  BULK_SELECTION_LIMIT,
  bulkProblemReport,
  bulkReport,
  directoryInput,
  directoryLocation,
  directoryReducer,
  emptyCopy,
  errorCopy,
  exportReport,
  facetLabel,
  initialDirectory,
  isSort,
  personDetails,
  personName,
  starredCriteria,
  tagChoices,
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

describe("PEOPLE-009 directory selection", () => {
  const people = (count: number, from = 0) =>
    Array.from(
      { length: count },
      (_, index) => person({ id: `p${from + index}` }),
    );
  const listed = (count: number) =>
    directoryReducer(initialDirectory(""), {
      append: false,
      filtered: false,
      lifecycle: "active",
      nextCursor: undefined,
      people: people(count),
      type: "loaded",
    });

  it("selects and deselects people one at a time", () => {
    const state = listed(3);
    expect(state.selection).toEqual([]);
    const one = directoryReducer(state, {
      personId: "p1",
      selected: true,
      type: "select",
    });
    const two = directoryReducer(one, {
      personId: "p0",
      selected: true,
      type: "select",
    });
    expect(two.selection).toEqual(["p1", "p0"]);
    expect(
      directoryReducer(two, { personId: "p0", selected: true, type: "select" })
        .selection,
    ).toEqual(["p1", "p0"]);
    expect(
      directoryReducer(two, { personId: "p1", selected: false, type: "select" })
        .selection,
    ).toEqual(["p0"]);
    expect(directoryReducer(two, { type: "clear-selection" }).selection)
      .toEqual([]);
  });

  it("selects the visible page and caps a selection at 100", () => {
    expect(BULK_SELECTION_LIMIT).toBe(100);
    const page = directoryReducer(listed(3), {
      selected: true,
      type: "select-page",
    });
    expect(page.selection).toEqual(["p0", "p1", "p2"]);
    expect(page.selectionNotice).toBe("");
    expect(
      directoryReducer(page, { selected: false, type: "select-page" })
        .selection,
    ).toEqual([]);

    const many = directoryReducer(listed(0), {
      append: true,
      filtered: false,
      lifecycle: "active",
      nextCursor: undefined,
      people: people(120),
      type: "loaded",
    });
    const capped = directoryReducer(many, {
      selected: true,
      type: "select-page",
    });
    expect(capped.selection).toHaveLength(100);
    expect(capped.selection.at(-1)).toBe("p99");
    expect(capped.selectionNotice).toBe(
      "You can select up to 100 people at a time. The first 100 are selected.",
    );
    const refused = directoryReducer(capped, {
      personId: "p110",
      selected: true,
      type: "select",
    });
    expect(refused.selection).toHaveLength(100);
    expect(refused.selectionNotice).toBe(
      "You can select up to 100 people at a time.",
    );
    const freed = directoryReducer(refused, {
      personId: "p0",
      selected: false,
      type: "select",
    });
    expect(freed.selection).toHaveLength(99);
    expect(freed.selectionNotice).toBe("");
  });

  it("clears the selection when the list, filter, or sort changes", () => {
    const selected = directoryReducer(listed(2), {
      selected: true,
      type: "select-page",
    });
    for (
      const action of [
        { append: false, type: "loading" },
        { sort: "family-name", type: "sort" },
        { selected: "t", type: "tag" },
      ] as const
    ) {
      const next = directoryReducer(
        { ...selected, selectionNotice: "Full" },
        action,
      );
      expect(next.selection).toEqual([]);
      expect(next.selectionNotice).toBe("");
    }
  });

  it("keeps selection while appending and ignores duplicate people", () => {
    const selected = directoryReducer(listed(2), {
      selected: true,
      type: "select-page",
    });
    const loading = directoryReducer(selected, {
      append: true,
      type: "loading",
    });
    expect(loading.selection).toEqual(["p0", "p1"]);
    const loaded = directoryReducer(loading, {
      append: true,
      filtered: false,
      lifecycle: "active",
      nextCursor: undefined,
      people: people(2, 1),
      type: "loaded",
    });
    expect(loaded.selection).toEqual(["p0", "p1"]);
    expect(loaded.people.map((person) => person.id)).toEqual([
      "p0",
      "p1",
      "p2",
    ]);
  });

  it("walks the bar through a choice, a run, and a report", () => {
    const selected = directoryReducer(listed(2), {
      selected: true,
      type: "select-page",
    });
    const choosing = directoryReducer(selected, {
      step: "tag",
      type: "bulk-step",
    });
    expect(choosing.bulk.step).toBe("tag");
    const running = directoryReducer(choosing, {
      kind: "tag",
      type: "bulk-start",
    });
    expect(running.bulk).toMatchObject({ running: "tag", step: "idle" });
    expect(running.bulk.report).toBeUndefined();
    const report = exportReport(2, 0);
    const finished = directoryReducer(running, {
      clearSelection: true,
      report,
      type: "bulk-finished",
    });
    expect(finished.bulk).toMatchObject({
      report,
      running: undefined,
      sequence: 1,
    });
    expect(finished.selection).toEqual([]);
    const kept = directoryReducer(running, {
      clearSelection: false,
      report,
      type: "bulk-finished",
    });
    expect(kept.selection).toEqual(["p0", "p1"]);
    expect(kept.bulk.sequence).toBe(1);
    // The refresh after a run keeps the report.
    const refreshed = directoryReducer(finished, {
      append: false,
      type: "loading",
    });
    expect(refreshed.bulk.report).toBe(report);
    expect(directoryReducer(refreshed, { type: "bulk-dismiss" }).bulk.report)
      .toBeUndefined();
    // A new list read closes an open choice.
    expect(
      directoryReducer(choosing, { append: false, type: "loading" }).bulk.step,
    ).toBe("idle");
  });
});

describe("PEOPLE-009 bulk reports", () => {
  const names = new Map([["a", "Ada Lovelace"], ["g", "Grace Hopper"]]);

  it("counts outcomes and names each failed person with a reason", () => {
    expect(bulkReport("archive", {
      results: [
        { outcome: "done", personId: "a" },
        { outcome: "unchanged", personId: "x" },
        { code: "not_found", outcome: "failed", personId: "g" },
      ],
      summary: { done: 1, failed: 1, skipped: 0, unchanged: 1 },
    }, names)).toEqual({
      counts: "1 done · 1 unchanged · 1 failed",
      failures: [{
        name: "Grace Hopper",
        reason: "No longer in this workspace",
      }],
      title: "Archived 1 person.",
      tone: "attention",
    });
    expect(bulkReport(
      "tag",
      {
        results: [
          { outcome: "done", personId: "a" },
          { outcome: "done", personId: "g" },
        ],
        summary: { done: 2, failed: 0, skipped: 0, unchanged: 0 },
      },
      names,
      "Friends",
    )).toEqual({
      counts: "2 done · 0 unchanged · 0 failed",
      failures: [],
      title: "Added “Friends” to 2 people.",
      tone: "done",
    });
    const reasons = bulkReport(
      "untag",
      {
        results: [
          "archived_write_rejected",
          "forbidden",
          "stale",
          "section_hidden",
          "tag_unavailable",
          "unavailable",
        ].map((code, index) => ({
          code: code as "stale",
          outcome: "failed" as const,
          personId: index === 0 ? "a" : `u${index}`,
        })).concat([
          { outcome: "failed", personId: "u9" } as never,
          { outcome: "skipped", personId: "g" } as never,
        ]),
        summary: { done: 0, failed: 7, skipped: 1, unchanged: 0 },
      },
      names,
      "Friends",
    );
    expect(reasons.title).toBe("Removed “Friends” from 0 people.");
    expect(reasons.counts).toBe(
      "0 done · 0 unchanged · 7 failed · 1 skipped",
    );
    expect(reasons.failures).toEqual([
      { name: "Ada Lovelace", reason: "Archived and read-only; restore first" },
      {
        name: "Unknown person",
        reason: "Your access to this workspace changed",
      },
      { name: "Unknown person", reason: "Changed elsewhere; try again" },
      {
        name: "Unknown person",
        reason: "Tags are turned off in this workspace",
      },
      { name: "Unknown person", reason: "The tag is no longer available" },
      { name: "Unknown person", reason: "Could not be changed right now" },
      { name: "Unknown person", reason: "Could not be changed right now" },
      { name: "Grace Hopper", reason: "Not attempted after access changed" },
    ]);
    expect(
      bulkReport("restore", {
        results: [{ outcome: "done", personId: "a" }],
        summary: { done: 1, failed: 0, skipped: 0, unchanged: 0 },
      }, names).title,
    ).toBe("Restored 1 person.");
  });

  it("words an export and a refused request", () => {
    expect(exportReport(2, 0)).toEqual({
      counts: "",
      failures: [],
      title: "Exported 2 people to a vCard.",
      tone: "done",
    });
    expect(exportReport(1, 3)).toEqual({
      counts: "3 skipped: no longer in this workspace.",
      failures: [],
      title: "Exported 1 person to a vCard.",
      tone: "attention",
    });
    expect(bulkProblemReport("archive", "Refused.")).toEqual({
      counts: "Refused.",
      failures: [],
      title: "Nothing was changed.",
      tone: "attention",
    });
    expect(bulkProblemReport("export", undefined)).toEqual({
      counts: "The people service is temporarily unavailable. Try again.",
      failures: [],
      title: "No vCard was exported.",
      tone: "attention",
    });
  });
});

describe("PEOPLE-010 directory stars, orders, and tag facet", () => {
  it("recognises the two new orders", () => {
    expect(isSort("last-contacted")).toBe(true);
    expect(isSort("recently-updated")).toBe(true);
  });

  it("asks for starred people and starred-first only when chosen", () => {
    expect(directoryInput("active", {
      search: "",
      sort: "last-contacted",
      starred: true,
      starredFirst: true,
      tagId: "",
    })).toEqual({
      lifecycle: "active",
      limit: 20,
      sort: "last-contacted",
      starred: true,
      starredFirst: true,
    });
    expect(directoryInput("active", {
      search: "",
      sort: "given-name",
      starred: false,
      starredFirst: false,
      tagId: "",
    })).toEqual({ lifecycle: "active", limit: 20, sort: "given-name" });
  });

  it("keeps the starred choices in the address", () => {
    expect(directoryLocation("/app/people", "", {
      search: "",
      sort: "recently-updated",
      starred: true,
      starredFirst: true,
      tagId: "t",
    }, "given-name")).toBe(
      "/app/people?tag=t&starred=1&starredFirst=1&sort=recently-updated",
    );
    expect(starredCriteria("?starred=1&starredFirst=1")).toEqual({
      starred: true,
      starredFirst: true,
    });
    expect(starredCriteria("?starred=yes")).toEqual({
      starred: false,
      starredFirst: false,
    });
  });

  it("starts from the address's starred choices and clears a selection on change", () => {
    const start = initialDirectory("", { starred: true, starredFirst: false });
    expect(start).toMatchObject({ starred: true, starredFirst: false });
    const selected = directoryReducer(
      directoryReducer(start, {
        append: false,
        filtered: true,
        lifecycle: "active",
        nextCursor: undefined,
        people: [person()],
        type: "loaded",
      }),
      { personId: "p", selected: true, type: "select" },
    );
    expect(selected.selection).toEqual(["p"]);
    const unstarred = directoryReducer(selected, {
      starred: false,
      type: "starred",
    });
    expect(unstarred).toMatchObject({ selection: [], starred: false });
    const first = directoryReducer(selected, {
      starredFirst: true,
      type: "starred-first",
    });
    expect(first).toMatchObject({ selection: [], starredFirst: true });
    expect(initialDirectory("")).toMatchObject({
      starred: false,
      starredFirst: false,
    });
  });

  it("holds the tag facet's counts, its bound, and its failure", () => {
    const start = initialDirectory("");
    expect(start.facet).toEqual({
      status: "loading",
      tags: [],
      truncated: false,
    });
    const loaded = directoryReducer(start, {
      facet: {
        lifecycle: "active",
        status: "ready",
        tags: [{ count: 2, id: "f", name: "Friends" }],
        truncated: true,
      },
      type: "facet-loaded",
    });
    expect(loaded.facet).toEqual({
      status: "ready",
      tags: [{ count: 2, id: "f", name: "Friends" }],
      truncated: true,
    });
    expect(
      directoryReducer(loaded, { type: "facet-failed" }).facet,
    ).toEqual({ status: "unavailable", tags: [], truncated: false });
  });

  it("chooses a facet tag the picker has not loaded yet", () => {
    const chosen = directoryReducer(initialDirectory(""), {
      name: "Friends",
      selected: "f",
      type: "tag",
    });
    expect(chosen.tag.selected).toBe("f");
    expect(chosen.tag.options).toEqual([{ id: "f", name: "Friends" }]);
    const again = directoryReducer(chosen, {
      name: "Friends",
      selected: "f",
      type: "tag",
    });
    expect(again.tag.options, "a loaded tag is not repeated").toHaveLength(1);
  });

  it("FEQ-11 offers the facet's tags until a page of options is read", () => {
    const facet = directoryReducer(initialDirectory(""), {
      facet: {
        lifecycle: "active",
        status: "ready",
        tags: [
          { count: 2, id: "f", name: "Friends" },
          { count: 1, id: "w", name: "Work" },
        ],
        truncated: true,
      },
      type: "facet-loaded",
    });
    expect(facet.tag.loaded).toBe(false);
    expect(tagChoices(facet)).toEqual([
      { id: "f", name: "Friends" },
      { id: "w", name: "Work" },
    ]);
    const chosen = directoryReducer(facet, {
      name: "Beyond the facet",
      selected: "b",
      type: "tag",
    });
    expect(tagChoices(chosen).map((choice) => choice.id)).toEqual([
      "f",
      "w",
      "b",
    ]);
    const failed = directoryReducer(
      directoryReducer(chosen, { append: false, type: "tags-loading" }),
      { type: "tags-failed" },
    );
    expect(failed.tag.loaded, "a failed first read is read again").toBe(false);
    const loaded = directoryReducer(chosen, {
      append: false,
      page: { options: [{ id: "x", name: "Other" }], status: "ready" },
      type: "tags-loaded",
    });
    expect(loaded.tag.loaded).toBe(true);
    expect(tagChoices(loaded)).toEqual(loaded.tag.options);
    expect(tagChoices(loaded).map((choice) => choice.id)).toEqual(["b", "x"]);
  });

  it("FEQ-11 names a chosen tag the options page does not mark from what is known", () => {
    const facet = directoryReducer(initialDirectory(""), {
      facet: {
        lifecycle: "active",
        status: "ready",
        tags: [{ count: 2, id: "f", name: "Friends" }],
        truncated: false,
      },
      type: "facet-loaded",
    });
    const chosen = directoryReducer(facet, { selected: "f", type: "tag" });
    const answered = (options: readonly { id: string; name: string }[]) =>
      directoryReducer(chosen, {
        append: false,
        page: { options, status: "ready" },
        type: "tags-loaded",
      }).tag.options;
    expect(answered([{ id: "w", name: "Work" }])).toEqual([
      { id: "f", name: "Friends" },
      { id: "w", name: "Work" },
    ]);
    expect(answered([{ id: "w", name: "Work" }, { id: "f", name: "Pals" }]))
      .toEqual([{ id: "f", name: "Pals" }, { id: "w", name: "Work" }]);
  });

  it("FEQ-11 trusts a page's chosen tag only while it is still the choice", () => {
    const facet = directoryReducer(initialDirectory("a"), {
      facet: {
        lifecycle: "active",
        status: "ready",
        tags: [
          { count: 2, id: "a", name: "Alpha" },
          { count: 1, id: "b", name: "Beta" },
        ],
        truncated: false,
      },
      type: "facet-loaded",
    });
    const page = {
      options: [{ id: "w", name: "Work" }],
      selected: { id: "a", name: "Alpha" },
      status: "ready" as const,
    };
    const answer = (selected: string) =>
      directoryReducer(
        directoryReducer(facet, { selected, type: "tag" }),
        { append: false, page, type: "tags-loaded" },
      );
    const still = answer("a");
    expect(tagChoices(still)).toEqual([
      { id: "a", name: "Alpha" },
      { id: "w", name: "Work" },
    ]);
    const moved = answer("b");
    expect(moved.tag.selected).toBe("b");
    expect(tagChoices(moved)).toEqual([
      { id: "b", name: "Beta" },
      { id: "w", name: "Work" },
    ]);
  });

  it("words a facet chip and the star on a row", () => {
    expect(facetLabel({ count: 1, id: "f", name: "Friends" })).toBe(
      "Friends, 1 person",
    );
    expect(facetLabel({ count: 3, id: "f", name: "Friends" })).toBe(
      "Friends, 3 people",
    );
    expect(personDetails(person({ isStarred: true }))).toBe("Favorite");
  });
});
