// @vitest-environment happy-dom
import { act, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import { jsonResponse, stubApi } from "../../../testing/api.ts";
import { chooseOptions } from "../../../testing/render.tsx";
import {
  anyRoute,
  block,
  fact,
  factRead,
  factSaved,
  mountFacts,
  nextRevision,
  revision,
  shell,
  tagsBlock,
} from "./facts.test-helper.ts";
import { mountTags } from "./tags.tsx";

const tagId = "00000000-0000-4000-8000-000000000499";

let summary: CapturedProfileSummary;
beforeEach(() => {
  summary = captureProfileSummary();
});
afterEach(() => summary.stop());

const section = () => within(block("tags"));
const stateLine = () =>
  block("tags").querySelector("[data-profile-fact-state]")!;
const assigned = () =>
  section().getByLabelText<HTMLSelectElement>("Assigned tags");
const tags = (ids: readonly string[]) => fact("tags", { tagIds: ids });
const TAG_OPTIONS = "GET /api/v1/people/tag-options";

describe("GAP-029 tags island", () => {
  it("keeps the hero's preview slot and edits beside it", async () => {
    stubApi({ [anyRoute]: factRead([tags([])]) });
    shell(tagsBlock());
    await mountFacts(mountTags);
    const root = block("tags");
    expect(root.firstElementChild?.hasAttribute("data-person-tags-slot"))
      .toBe(true);
    expect(root.querySelector("#person-profile-tags")).not.toBeNull();
    expect(root.dataset.island).toBe("person-fact-tags");
    expect(root.dataset.sectionState).toBe("ready");
    const edit = section().getByRole("button", { name: "Edit tags" });
    expect(edit.hasAttribute("data-profile-fact-add")).toBe(true);
    expect(root.querySelectorAll("[data-profile-fact-add]")).toHaveLength(1);
    expect(root.querySelector("[data-profile-fact-list]")).toBeNull();
    expect(section().queryByRole("button", { name: /Delete|Clear/ }))
      .toBeNull();
  });

  it("APR-006 refreshes the tag preview and assigned count after local edits", async () => {
    let saved = false;
    const api = stubApi({
      [TAG_OPTIONS]: jsonResponse({
        options: [{ id: tagId, name: "Friend" }],
        status: "ready",
      }),
      "PUT /api/v1/*": () => {
        saved = true;
        return factSaved({ ...tags([tagId]), updatedAt: nextRevision });
      },
      "GET /api/v1/*": () =>
        factRead([tags(saved ? [tagId] : [])], {
          options: saved ? [{ id: tagId, name: "Friend" }] : [],
        }),
    });
    shell(tagsBlock());
    await mountFacts(mountTags);
    expect(stateLine().textContent).toBe("No tags saved.");
    expect(summary.tags()).toBe("No tags saved");
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Edit tags" }));
    await waitFor(() => expect(assigned().options).toHaveLength(1));
    chooseOptions(assigned(), [tagId]);
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() => expect(summary.tags()).toBe("Friend"));
    expect(stateLine().textContent).toBe("1 tag saved. Profile fact saved.");
    expect(api.bodies()).toEqual([{
      expectedPersonUpdatedAt: revision,
      expectedUpdatedAt: revision,
      id: tags([]).id,
      section: "tags",
      tagIds: [tagId],
    }]);
  });

  it.each([0, 1, 12])(
    "APR-006 counts %i assigned tags instead of the singleton record",
    async (count) => {
      const options = Array.from({ length: count }, (_, index) => ({
        id: `00000000-0000-4000-8300-${String(index).padStart(12, "0")}`,
        name: `Tag ${index}`,
      }));
      stubApi({
        [anyRoute]: factRead([tags(options.map((option) => option.id))], {
          options,
        }),
      });
      shell(tagsBlock());
      await mountFacts(mountTags);
      expect(stateLine().textContent).toBe(
        count
          ? `${count} tag${count === 1 ? "" : "s"} saved.`
          : "No tags saved.",
      );
      expect(summary.tags()).toContain(count === 0 ? "No tags saved" : "Tag 0");
      if (count > 8) expect(summary.tags()).toContain("+4 more");
    },
  );

  it("APR-006 keeps missing tag names distinct from empty assignments", async () => {
    stubApi({ [anyRoute]: factRead([tags(["unresolved"])]) });
    shell(tagsBlock());
    await mountFacts(mountTags);
    expect(summary.tags()).toBe("Unavailable tag");
    expect(stateLine().textContent).toBe("1 tag saved.");
    await userEvent.setup().click(
      section().getByRole("button", { name: "Edit tags" }),
    );
    await waitFor(() =>
      expect(stateLine().textContent).toBe(
        "Current tag assignments could not be verified. No assignments can be changed.",
      )
    );
    expect(block("tags").querySelector("form")!.hidden).toBe(true);
  });

  it("preserves more than one tag page and fails closed when a search fails", async () => {
    const ids = Array.from(
      { length: 75 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    );
    let failOptions = false;
    let tagOptionCalls = 0;
    const api = stubApi({
      [TAG_OPTIONS]: () => {
        tagOptionCalls++;
        if (failOptions) return jsonResponse({ status: 503 }, 503);
        return jsonResponse({
          nextCursor: "next-tags",
          options: ids.slice(0, 20).map((id, index) => ({
            id,
            name: `Tag ${index + 1}`,
          })),
          status: "ready",
        });
      },
      [anyRoute]: factRead([tags(ids)], {
        options: ids.map((id, index) => ({ id, name: `Tag ${index + 1}` })),
      }),
    });
    shell(tagsBlock());
    await mountFacts(mountTags);
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Edit tags" }));
    await waitFor(() => expect(assigned().selectedOptions).toHaveLength(75));
    expect(assigned().options).toHaveLength(75);
    expect(tagOptionCalls).toBe(1);
    failOptions = true;
    await user.click(section().getByRole("button", { name: "Search tags" }));
    await waitFor(() =>
      expect(stateLine().textContent).toBe(
        "Tag options are temporarily unavailable. No assignments can be changed.",
      )
    );
    expect(
      section().getByRole<HTMLButtonElement>("button", {
        name: "Save profile fact",
      }).disabled,
    ).toBe(true);
    expect(section().queryByRole("button", { name: "Load more tags" }))
      .toBeNull();
    act(() => block("tags").querySelector("form")!.requestSubmit());
    expect(api.calls().some((call) => /^(PUT|POST)/.test(call))).toBe(false);
  });

  it("keeps tag selections durable across independent searches and continuation", async () => {
    const currentId = "00000000-0000-4000-8000-000000000401";
    const alphaId = "00000000-0000-4000-8000-000000000402";
    const betaId = "00000000-0000-4000-8000-000000000403";
    const api = stubApi({
      [TAG_OPTIONS]: ({ url }) => {
        const search = url.searchParams.get("search");
        const cursor = url.searchParams.get("cursor");
        return jsonResponse({
          ...(search === "alpha" && cursor
            ? { options: [{ id: alphaId, name: "Alpha" }] }
            : search === "alpha"
            ? {
              nextCursor: "alpha-next",
              options: [{ id: alphaId, name: "Alpha" }],
            }
            : search === "beta"
            ? { options: [{ id: betaId, name: "Beta" }] }
            : { options: [{ id: currentId, name: "Current" }] }),
          status: "ready",
        });
      },
      "PUT /api/v1/*": ({ body }) =>
        factSaved(tags((body as { tagIds: string[] }).tagIds)),
      "GET /api/v1/*": factRead([tags([currentId])], {
        options: [{ id: currentId, name: "Current" }],
      }),
    });
    shell(tagsBlock());
    await mountFacts(mountTags);
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Edit tags" }));
    await waitFor(() =>
      expect([...assigned().selectedOptions].map((option) => option.value))
        .toEqual([currentId])
    );
    const search = section().getByLabelText("Search tags");
    await user.type(search, "alpha");
    await user.click(section().getByRole("button", { name: "Search tags" }));
    await waitFor(() =>
      expect(within(assigned()).getByRole("option", { name: "Alpha" }))
        .toBeTruthy()
    );
    chooseOptions(assigned(), [alphaId]);
    await user.click(section().getByRole("button", { name: "Load more tags" }));
    await waitFor(() =>
      expect(section().queryByRole("button", { name: "Load more tags" }))
        .toBeNull()
    );
    await user.clear(search);
    await user.type(search, "beta");
    await user.click(section().getByRole("button", { name: "Search tags" }));
    await waitFor(() =>
      expect(within(assigned()).getByRole("option", { name: "Beta" }))
        .toBeTruthy()
    );
    expect([...assigned().selectedOptions].map((option) => option.value))
      .toEqual([currentId, alphaId]);
    chooseOptions(assigned(), [betaId]);
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() =>
      expect(api.bodies()[0]).toMatchObject({
        tagIds: [currentId, alphaId, betaId],
      })
    );
  });

  it("refuses more than 500 tags before sending them", async () => {
    const all = Array.from({ length: 501 }, (_, index) => ({
      id: `00000000-0000-4000-8200-${String(index + 1).padStart(12, "0")}`,
      name: `Tag ${index + 1}`,
    }));
    const api = stubApi({
      [TAG_OPTIONS]: jsonResponse({ options: all, status: "ready" }),
      [anyRoute]: factRead([]),
    });
    shell(tagsBlock());
    await mountFacts(mountTags);
    const user = userEvent.setup();
    await user.click(section().getByRole("button", { name: "Edit tags" }));
    await waitFor(() => expect(assigned().options).toHaveLength(501));
    chooseOptions(assigned(), all.map((tag) => tag.id));
    await user.click(
      section().getByRole("button", { name: "Save profile fact" }),
    );
    await waitFor(() =>
      expect(block("tags").textContent).toContain(
        "Choose no more than 500 tags.",
      )
    );
    expect(api.calls().some((call) => /^(PUT|POST)/.test(call))).toBe(false);
  });

  it("purges its tags while the module is off and reads them again when it is back", async () => {
    let status: "hidden" | "ready" = "ready";
    stubApi({
      [TAG_OPTIONS]: jsonResponse({
        options: [{ id: tagId, name: "Confidential friend" }],
        status: "ready",
      }),
      [anyRoute]: () =>
        factRead(status === "ready" ? [tags([tagId])] : [], {
          options: status === "ready"
            ? [{ id: tagId, name: "Confidential friend" }]
            : [],
          status,
        }),
    });
    shell(tagsBlock());
    await mountFacts(mountTags);
    await userEvent.setup().click(
      section().getByRole("button", { name: "Edit tags" }),
    );
    await waitFor(() =>
      expect(block("tags").textContent).toContain("Confidential friend")
    );
    status = "hidden";
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: false },
        }),
      );
    });
    await waitFor(() =>
      expect(block("tags").dataset.sectionState).toBe("hidden")
    );
    expect(block("tags").hidden).toBe(true);
    expect(summary.tags()).toBeUndefined();
    expect(block("tags").textContent).not.toContain("Confidential friend");
    expect(block("tags").innerHTML).not.toContain(tagId);
    status = "ready";
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: false },
        }),
      );
    });
    await waitFor(() => expect(summary.tags()).toBe("Confidential friend"));
    expect(block("tags").hidden).toBe(false);
  });
});
