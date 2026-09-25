// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { registerRailEditors, requestRailEditorOpen } from "./rail-editors.ts";
import { mountUnsavedChangesGuard } from "./unsaved-changes.ts";
import { mountRelationships } from "./relationships.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const targetId = "00000000-0000-4000-8000-000000000101";
const typeId = "00000000-0000-4000-8000-000000000200";
const relationshipId = "00000000-0000-4000-8000-000000000300";
const updatedAt = "2026-08-16T12:00:00.000000Z";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "content-type": status >= 400
        ? "application/problem+json"
        : "application/json",
    },
    status,
  });
}

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((complete) => resolve = complete);
  return { promise, resolve };
}

function markup() {
  document.body.innerHTML =
    `<main id="main-content" tabindex="-1"><section id="profile-section-relationships" data-profile-section="relationships" data-section-state="loading">
    <span data-profile-rail-count hidden></span><p id="relationships-state" role="status" aria-live="polite" tabindex="-1"></p>
    <ul id="relationships-list" tabindex="-1"></ul><button id="relationships-previous" hidden>Previous relationships</button><button id="relationships-load-more" hidden>Next relationships</button><button id="relationship-add" hidden>Add relationship</button>
    <form id="relationship-form" hidden>
      <input id="relationship-person-search"><button id="relationship-person-search-button" type="button">Search people</button>
      <select id="relationship-target" name="targetPersonId"></select>
      <input name="newGivenName"><input name="newFamilyName">
      <input id="relationship-type-search"><button id="relationship-type-search-button" type="button">Search relationship types</button>
      <select id="relationship-type" name="relationshipTypeId"></select>
      <button id="relationship-types-previous" type="button" hidden>Previous relationship types</button><button id="relationship-types-next" type="button" hidden>Next relationship types</button>
      <div id="relationship-duplicate-choices" hidden><button id="relationship-select-existing" type="button">Select existing person</button><button id="relationship-create-anyway" type="button">Create anyway</button></div>
      <button type="submit">Save relationship</button><button id="relationship-cancel" type="button">Cancel</button>
    </form></section></main>`;
}

const relationship = {
  createdAt: updatedAt,
  display: {
    label: "parent",
    name: "Ada Lovelace",
    personId: targetId,
    relationshipId,
  },
  forwardLabel: "parent",
  fromPersonId: personId,
  id: relationshipId,
  relationshipTypeId: typeId,
  relationshipTypeArchived: false,
  reverseLabel: "child",
  status: "active",
  toPersonId: targetId,
  updatedAt,
};

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("relationship profile section", () => {
  it.each(["clean", "declined", "accepted"])(
    "APR-002 gates incoming and outgoing local-editor switches when %s",
    async (decision) => {
      markup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValueOnce(
          response({ options: [], status: "ready" }),
        ).mockResolvedValueOnce(
          response({ relationships: [], status: "ready" }),
        ),
      );
      await mountRelationships(personId, workspaceId, false);
      mountUnsavedChangesGuard({
        confirmMessage: "Discard?",
        root: document.body,
      });
      const confirm = vi.fn(() => decision === "accepted");
      vi.stubGlobal("confirm", confirm);
      const add = document.querySelector<HTMLButtonElement>(
        "#relationship-add",
      )!;
      const form = document.querySelector<HTMLFormElement>(
        "#relationship-form",
      )!;
      const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[name="newGivenName"]',
      )!;
      document.body.insertAdjacentHTML(
        "beforeend",
        '<form id="foreign"><input name="draft"></form>',
      );
      const foreign = document.querySelector<HTMLInputElement>(
        "#foreign input",
      )!.closest<HTMLFormElement>("form")!;
      registerRailEditors([foreign], () => {
        foreign.hidden = true;
        foreign.reset();
      });
      const foreignField = foreign.querySelector("input")!;
      foreignField.focus();
      if (decision !== "clean") {
        foreignField.value = "Foreign draft";
        foreignField.dispatchEvent(new Event("input", { bubbles: true }));
      }
      add.focus();
      add.click();
      if (decision === "declined") {
        expect(form.hidden).toBe(true);
        expect(foreign.hidden).toBe(false);
        expect(foreignField.value).toBe("Foreign draft");
        expect(document.activeElement).toBe(foreignField);
        confirm.mockReturnValue(true);
        add.click();
      }
      expect(form.hidden).toBe(false);
      expect(foreign.hidden).toBe(true);
      field.focus();
      if (decision !== "clean") {
        field.value = "Related draft";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      confirm.mockClear().mockReturnValue(decision === "accepted");
      add.focus();
      expect(requestRailEditorOpen(foreign)).toBe(decision !== "declined");
      expect(confirm).toHaveBeenCalledTimes(decision === "clean" ? 0 : 1);
      if (decision === "declined") {
        expect(form.hidden).toBe(false);
        expect(field.value).toBe("Related draft");
        expect(document.activeElement).toBe(field);
        form.querySelector<HTMLButtonElement>("#relationship-cancel")!.click();
        expect(document.activeElement).toBe(add);
        expect(confirm).toHaveBeenCalledOnce();
      }
      expect(form.hidden).toBe(true);
      expect(field.value).toBe("");
    },
  );

  it.each(["existing", "new"])(
    "APR-002 retains a pending %s relationship draft when another editor is requested",
    async (kind) => {
      markup();
      const pending = deferredResponse();
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(
            response({
              options: [{
                id: typeId,
                forwardLabel: "parent",
                reverseLabel: "child",
              }],
              status: "ready",
            }),
          )
          .mockResolvedValueOnce(
            response({ relationships: [], status: "ready" }),
          )
          .mockReturnValueOnce(pending.promise),
      );
      await mountRelationships(personId, workspaceId, false);
      mountUnsavedChangesGuard({
        root: document.body,
        confirmMessage: "Discard?",
      });
      document.querySelector<HTMLButtonElement>("#relationship-add")!.click();
      const form = document.querySelector<HTMLFormElement>(
        "#relationship-form",
      )!;
      const field = form.elements.namedItem("newGivenName") as HTMLInputElement;
      field.focus();
      field.value = kind === "new" ? "Grace" : "";
      if (kind === "existing") {
        const target = document.querySelector<HTMLSelectElement>(
          "#relationship-target",
        )!;
        const option = document.createElement("option");
        option.value = targetId;
        option.textContent = "Grace";
        target.append(option);
        target.value = targetId;
      }
      document.querySelector<HTMLSelectElement>("#relationship-type")!.value =
        typeId;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      form.requestSubmit();
      expect(form.inert).toBe(true);
      expect(requestRailEditorOpen(document.createElement("form"))).toBe(false);
      expect(form.hidden).toBe(false);
      pending.resolve(
        response({
          detail: "Try again",
          status: 503,
          title: "Unavailable",
          type: "about:blank",
        }, 503),
      );
      await vi.waitFor(() => expect(form.inert).toBe(false));
      expect(form.hidden).toBe(false);
      expect(field.value).toBe(kind === "new" ? "Grace" : "");
      expect(
        globalThis.dispatchEvent(
          new Event("beforeunload", { cancelable: true }),
        ),
      ).toBe(false);
    },
  );

  it("resets on a foreign rail editor without restoring focus", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({ relationships: [], status: "ready" }),
        ),
    );
    await mountRelationships(personId, workspaceId, false);
    const add = document.querySelector<HTMLButtonElement>("#relationship-add")!;
    const form = document.querySelector<HTMLFormElement>(
      "#relationship-form",
    )!;
    add.click();
    const draft = form.elements.namedItem("newGivenName") as HTMLInputElement;
    draft.value = "Unsaved draft";
    const reset = vi.fn();
    form.addEventListener("reset", reset);
    const restoreFocus = vi.spyOn(add, "focus");
    const foreign = document.createElement("form");
    const foreignControl = document.createElement("input");
    foreign.append(foreignControl);
    document.body.append(foreign);
    foreignControl.focus();

    requestRailEditorOpen(foreign);

    expect(form.hidden).toBe(true);
    expect(draft.value).toBe("");
    expect(reset).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(foreignControl);
  });

  it("groups relationship types and expands rows beyond the five-row summary", async () => {
    markup();
    const colleagueTypeId = "00000000-0000-4000-8000-000000000201";
    const friendTypeId = "00000000-0000-4000-8000-000000000202";
    const neighborTypeId = "00000000-0000-4000-8000-000000000203";
    const records = [
      [typeId, "parent", "Ada"],
      [colleagueTypeId, "colleague", "Grace"],
      [typeId, "parent", "Charles"],
      [colleagueTypeId, "colleague", "Alan"],
      [friendTypeId, "friend", "Dorothy"],
      [typeId, "parent", "Mary"],
      [colleagueTypeId, "colleague", "Katherine"],
      [neighborTypeId, "neighbor", "Emmy"],
    ].map(([relationshipTypeId, label, name], index) => {
      const suffix = String(index + 400).padStart(12, "0");
      const id = `00000000-0000-4000-8000-${suffix}`;
      return {
        ...relationship,
        display: { label, name, personId: id, relationshipId: id },
        id,
        relationshipTypeId,
        toPersonId: id,
      };
    });
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({ relationships: records, status: "ready" }),
        ),
    );

    await mountRelationships(personId, workspaceId, false);

    const groups = document.querySelectorAll<HTMLLIElement>(
      "#relationships-list > [data-relationship-group]",
    );
    expect(groups).toHaveLength(4);
    expect(groups[0]?.firstElementChild?.textContent).toBe("parent (3)");
    expect(groups[1]?.firstElementChild?.textContent).toBe("colleague (3)");
    expect(groups[2]?.firstElementChild?.textContent).toBe("friend (1)");
    expect(groups[3]?.firstElementChild?.textContent).toBe("neighbor (1)");
    expect(groups[3]?.hidden).toBe(true);
    expect(
      [...document.querySelector("#relationships-list")!.children].every(
        (child) => child.tagName === "LI",
      ),
    ).toBe(true);
    const rows = document.querySelectorAll<HTMLLIElement>(
      "#relationships-list [data-relationship-id]",
    );
    expect(rows).toHaveLength(8);
    expect([...rows].filter((row) => row.hidden)).toHaveLength(3);
    expect(
      [...rows].find((row) => row.textContent?.includes("Dorothy"))?.hidden,
    ).toBe(false);
    expect(
      [...rows].find((row) => row.textContent?.includes("Mary"))?.hidden,
    ).toBe(true);
    const expander = document.querySelector<HTMLButtonElement>(
      ".relationship-summary-expander button",
    )!;
    expect(expander.hasAttribute("aria-label")).toBe(false);
    expect(expander.firstChild?.textContent).toBe("+ 3 more");
    expect(expander.querySelector(".sr-only")?.textContent).toBe(
      " relationships",
    );
    expect(expander.textContent).toBe("+ 3 more relationships");
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expander.click();
    expect([...rows].filter((row) => row.hidden)).toHaveLength(0);
    expect(groups[3]?.hidden).toBe(false);
    expect(expander.getAttribute("aria-expanded")).toBe("true");
    expect(expander.firstChild?.textContent).toBe("Show fewer");
    expect(expander.textContent).toBe("Show fewer relationships");
  });

  it("separates opposite directional labels for one relationship type", async () => {
    markup();
    const inverseId = "00000000-0000-4000-8000-000000000401";
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(response({
          relationships: [relationship, {
            ...relationship,
            display: {
              label: "child",
              name: "Mary Lovelace",
              personId: inverseId,
              relationshipId: inverseId,
            },
            fromPersonId: inverseId,
            id: inverseId,
            toPersonId: personId,
          }],
          status: "ready",
        })),
    );

    await mountRelationships(personId, workspaceId, false);

    const labels = [...document.querySelectorAll(
      "#relationships-list > [data-relationship-group] > :first-child",
    )].map((label) => label.textContent);
    expect(labels).toEqual(["parent (1)", "child (1)"]);
  });

  it("keeps the empty relationship list as one direct list item", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({ relationships: [], status: "ready" }),
        ),
    );

    await mountRelationships(personId, workspaceId, false);

    const list = document.querySelector("#relationships-list")!;
    expect(list.children).toHaveLength(1);
    expect(list.firstElementChild?.tagName).toBe("LI");
    expect(list.firstElementChild?.textContent).toBe(
      "No relationships saved.",
    );
  });

  it("keeps grouped relationship editor failures in the section state", async () => {
    markup();
    const problem = (detail: string) => ({
      code: "relationship_conflict",
      detail,
      status: 409,
      title: "Relationship conflict",
      type: "about:blank",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ options: [], status: "ready" }))
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockResolvedValueOnce(response(problem("Update conflicted."), 409))
      .mockRejectedValueOnce(new Error("update unavailable"))
      .mockResolvedValueOnce(response(problem("Unlink conflicted."), 409))
      .mockRejectedValueOnce(new Error("unlink unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await mountRelationships(personId, workspaceId, false);
    const state = document.querySelector("#relationships-state")!;
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) =>
        button.textContent === "Save relationship with Ada Lovelace"
      )!;
    save.click();
    await vi.waitFor(() =>
      expect(state.textContent).toBe("Update conflicted.")
    );
    save.click();
    await vi.waitFor(() =>
      expect(state.textContent).toBe(
        "Relationship change is temporarily unavailable.",
      )
    );

    const unlink = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent === "Unlink Ada Lovelace")!;
    unlink.click();
    await vi.waitFor(() =>
      expect(state.textContent).toBe("Unlink conflicted.")
    );
    unlink.click();
    await vi.waitFor(() =>
      expect(state.textContent).toBe("Unlink is temporarily unavailable.")
    );
  });

  it("loads bounded continuation pages without replacing the profile DOM", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ options: [], status: "ready" }))
      .mockResolvedValueOnce(response({
        nextCursor: "next-page",
        relationships: [],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    await mountRelationships(personId, workspaceId, false);
    const loadMore = document.querySelector(
      "#relationships-load-more",
    ) as HTMLButtonElement;
    expect(loadMore.hidden).toBe(false);
    loadMore.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const continuation = new URL(
      String(fetchMock.mock.calls[2]?.[0]),
      "http://localhost",
    );
    expect(continuation.searchParams.get("cursor")).toBe("next-page");
    expect(continuation.searchParams.get("limit")).toBe("20");
    await vi.waitFor(() => expect(loadMore.hidden).toBe(true));
  });

  it("keeps three relationship pages to one fixed DOM window and one batched display projection", async () => {
    markup();
    const page = (start: number) =>
      Array.from({ length: 20 }, (_, offset) => {
        const suffix = String(start + offset).padStart(12, "0");
        const id = `00000000-0000-4000-8000-${suffix}`;
        return {
          ...relationship,
          display: {
            label: "parent",
            name: `Person ${start + offset}`,
            personId: id,
            relationshipId: id,
          },
          id,
          toPersonId: id,
        };
      });
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/relationship-types") {
        return response({ options: [], selected: [], status: "ready" });
      }
      if (url.pathname.endsWith(`/${personId}/relationships`)) {
        const cursor = url.searchParams.get("cursor");
        if (!cursor) {
          return response({
            nextCursor: "page-2",
            relationships: page(1),
            status: "ready",
          });
        }
        if (cursor === "page-2") {
          return response({
            nextCursor: "page-3",
            relationships: page(21),
            status: "ready",
          });
        }
        return response({ relationships: page(41), status: "ready" });
      }
      throw new Error(`unexpected per-person hydration ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountRelationships(personId, workspaceId, false);
    const next = document.querySelector(
      "#relationships-load-more",
    ) as HTMLButtonElement;
    next.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#relationships-list")?.textContent)
        .toContain("Person 21")
    );
    next.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#relationships-list")?.textContent)
        .toContain("Person 41")
    );
    expect(document.activeElement).toBe(
      document.querySelector("#relationships-list"),
    );
    expect(
      document.querySelectorAll("#relationships-list [data-relationship-id]"),
    ).toHaveLength(20);
    const previous = document.querySelector(
      "#relationships-previous",
    ) as HTMLButtonElement;
    expect(previous.hidden).toBe(false);
    previous.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#relationships-list")?.textContent)
        .toContain("Person 21")
    );
    expect(document.activeElement).toBe(
      document.querySelector("#relationships-list"),
    );
    previous.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#relationships-list")?.textContent)
        .toContain("Person 1")
    );
    expect(previous.hidden).toBe(true);
    expect(document.activeElement).toBe(
      document.querySelector("#relationships-list"),
    );
    expect(
      fetchMock.mock.calls.filter(([input]) =>
        new URL(String(input), "http://localhost").pathname ===
          "/api/v1/people"
      ),
    ).toHaveLength(0);
  });

  it("pages type search while preserving active and archived current descriptors", async () => {
    markup();
    const tailTypeId = "00000000-0000-4000-8000-000000000298";
    const archivedTypeId = "00000000-0000-4000-8000-000000000299";
    const tail = {
      archived: false,
      forwardLabel: "Tail active",
      id: tailTypeId,
      reverseLabel: "Tail inverse",
    };
    const historical = {
      archived: true,
      forwardLabel: "Historical",
      id: archivedTypeId,
      reverseLabel: "Historical inverse",
    };
    const parent = {
      archived: false,
      forwardLabel: "parent",
      id: typeId,
      reverseLabel: "child",
    };
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url = new URL(String(input), "http://localhost");
      if (url.pathname === "/api/v1/relationship-types") {
        const cursor = url.searchParams.get("cursor");
        const selected = (url.searchParams.get("selected") ?? "").split(",");
        const hydrated = [parent, tail, historical].filter((type) =>
          selected.includes(type.id)
        );
        if (cursor === "type-page-2") {
          return response({
            nextCursor: "type-page-3",
            options: [tail],
            selected: hydrated,
            status: "ready",
          });
        }
        if (cursor === "type-page-3") {
          return response({ options: [], selected: hydrated, status: "ready" });
        }
        return response({
          nextCursor: "type-page-2",
          options: [parent],
          selected: hydrated,
          status: "ready",
        });
      }
      if (url.pathname.endsWith(`/${personId}/relationships`)) {
        return response({
          relationships: [{
            ...relationship,
            forwardLabel: tail.forwardLabel,
            relationshipTypeArchived: false,
            relationshipTypeId: tail.id,
            reverseLabel: tail.reverseLabel,
          }, {
            ...relationship,
            display: {
              ...relationship.display,
              name: "Archived connection",
              relationshipId: "00000000-0000-4000-8000-000000000399",
            },
            forwardLabel: historical.forwardLabel,
            id: "00000000-0000-4000-8000-000000000399",
            relationshipTypeArchived: true,
            relationshipTypeId: historical.id,
            reverseLabel: historical.reverseLabel,
          }],
          status: "ready",
        });
      }
      throw new Error(`unexpected request ${url.pathname}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await mountRelationships(personId, workspaceId, false);
    const [activeEditor, archivedEditor] = [
      ...document.querySelectorAll<HTMLSelectElement>(
        "#relationships-list select",
      ),
    ];
    expect(activeEditor).toBeDefined();
    expect(archivedEditor).toBeDefined();
    expect(activeEditor!.value).toBe(tailTypeId);
    expect(activeEditor!.selectedOptions[0]?.disabled).toBe(false);
    expect(archivedEditor!.value).toBe(archivedTypeId);
    expect(archivedEditor!.selectedOptions[0]?.disabled).toBe(true);
    (document.querySelector("#relationship-type") as HTMLSelectElement).value =
      typeId;
    (document.querySelector("#relationship-types-next") as HTMLButtonElement)
      .click();
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          new URL(String(input), "http://localhost").searchParams.get(
            "cursor",
          ) === "type-page-2"
        ),
      ).toBe(true)
    );
    expect(
      (document.querySelector("#relationship-type") as HTMLSelectElement)
        .value,
    ).toBe(typeId);
    await vi.waitFor(() =>
      expect(
        (document.querySelector("#relationship-type") as HTMLSelectElement)
          .textContent,
      ).toContain("Tail active")
    );
    (document.querySelector("#relationship-types-next") as HTMLButtonElement)
      .click();
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.some(([input]) =>
          new URL(String(input), "http://localhost").searchParams.get(
            "cursor",
          ) === "type-page-3"
        ),
      ).toBe(true)
    );
    const selectedQueries = fetchMock.mock.calls.map(([input]) =>
      new URL(String(input), "http://localhost").searchParams.get("selected")
    ).filter(Boolean);
    expect(selectedQueries.at(-1)).toContain(archivedTypeId);
    expect(selectedQueries.at(-1)).toContain(tailTypeId);

    const typePrevious = document.querySelector(
      "#relationship-types-previous",
    ) as HTMLButtonElement;
    await vi.waitFor(() => expect(typePrevious.hidden).toBe(false));
    const pageTwoRequestsBefore =
      fetchMock.mock.calls.filter(([input]) =>
        new URL(String(input), "http://localhost").searchParams.get(
          "cursor",
        ) ===
          "type-page-2"
      ).length;
    typePrevious.click();
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([input]) =>
          new URL(String(input), "http://localhost").searchParams.get(
            "cursor",
          ) === "type-page-2"
        ),
      ).toHaveLength(pageTwoRequestsBefore + 1)
    );
    await vi.waitFor(() =>
      expect(
        (document.querySelector(
          "#relationship-types-next",
        ) as HTMLButtonElement).hidden,
      ).toBe(false)
    );
    const firstPageRequestsBefore = fetchMock.mock.calls.filter(([input]) => {
      const url = new URL(String(input), "http://localhost");
      return url.pathname === "/api/v1/relationship-types" &&
        !url.searchParams.has("cursor");
    }).length;
    typePrevious.click();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.filter(([input]) => {
        const url = new URL(String(input), "http://localhost");
        return url.pathname === "/api/v1/relationship-types" &&
          !url.searchParams.has("cursor");
      })).toHaveLength(firstPageRequestsBefore + 1)
    );
    await vi.waitFor(() =>
      expect(
        (document.querySelector("#relationship-type") as HTMLSelectElement)
          .textContent,
      ).toContain("parent / child")
    );
    await vi.waitFor(() => expect(typePrevious.hidden).toBe(true));
    expect(document.activeElement).toBe(
      document.querySelector("#relationship-type"),
    );

    const typeSearch = document.querySelector(
      "#relationship-type-search",
    ) as HTMLInputElement;
    const typeSearchButton = document.querySelector(
      "#relationship-type-search-button",
    ) as HTMLButtonElement;
    await vi.waitFor(() => expect(typeSearchButton.disabled).toBe(false));
    typeSearch.value = "  tail  ";
    typeSearchButton.click();
    await vi.waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => {
        const url = new URL(String(input), "http://localhost");
        return url.pathname === "/api/v1/relationship-types" &&
          url.searchParams.get("search") === "tail" &&
          !url.searchParams.has("cursor");
      })).toBe(true)
    );
    await vi.waitFor(() => expect(typePrevious.hidden).toBe(true));
    await vi.waitFor(() =>
      expect(document.querySelector("#relationships-list select")).not
        .toBeNull()
    );

    const refreshedActiveEditor = document.querySelector(
      "#relationships-list select",
    ) as HTMLSelectElement;
    const refreshedSave = refreshedActiveEditor
      .nextElementSibling as HTMLButtonElement;
    expect(refreshedActiveEditor.selectedOptions[0]?.disabled).toBe(false);
    refreshedActiveEditor.dispatchEvent(new Event("change"));
    expect(refreshedSave.disabled).toBe(false);

    const typeSelect = document.querySelector(
      "#relationship-type",
    ) as HTMLSelectElement;
    typeSelect.value = archivedTypeId;
    (document.querySelector(
      '[name="newGivenName"]',
    ) as HTMLInputElement).value = "No orphan";
    (document.querySelector("#relationship-form") as HTMLFormElement)
      .requestSubmit();
    expect(document.querySelector("#relationships-state")?.textContent)
      .toBe("Choose an active relationship type.");
    expect(
      fetchMock.mock.calls.some(([input]) =>
        new URL(String(input), "http://localhost").pathname.endsWith(
          "/relationships/related-person",
        )
      ),
    ).toBe(false);
  });

  it.each([
    ["search", "ready"],
    ["search", "error"],
    ["next", "ready"],
    ["next", "error"],
  ])(
    "APR-002 reserves the relationship editor during type %s and unlocks on %s",
    async (action, outcome) => {
      markup();
      const pending = deferredResponse();
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(
            response({
              nextCursor: "next-types",
              options: [],
              status: "ready",
            }),
          )
          .mockResolvedValueOnce(
            response({ relationships: [], status: "ready" }),
          )
          .mockReturnValueOnce(pending.promise),
      );
      await mountRelationships(personId, workspaceId, false);
      mountUnsavedChangesGuard({
        root: document.body,
        confirmMessage: "Discard?",
      });
      const confirm = vi.fn(() => false);
      vi.stubGlobal("confirm", confirm);
      document.querySelector<HTMLButtonElement>("#relationship-add")!.click();
      const form = document.querySelector<HTMLFormElement>(
        "#relationship-form",
      )!;
      const draft = form.querySelector<HTMLInputElement>(
        '[name="newGivenName"]',
      )!;
      draft.focus();
      draft.value = "Keep this relationship draft";
      draft.dispatchEvent(new Event("input", { bubbles: true }));
      document.body.insertAdjacentHTML(
        "beforeend",
        '<button id="foreign-add">Open fact</button><form id="foreign" hidden><input name="value"></form>',
      );
      const foreign = document.querySelector<HTMLFormElement>("#foreign")!;
      const openForeign = document.querySelector<HTMLButtonElement>(
        "#foreign-add",
      )!;
      registerRailEditors([foreign], () => {
        foreign.hidden = true;
        foreign.reset();
      });
      openForeign.onclick = () => {
        if (!requestRailEditorOpen(foreign)) return;
        foreign.hidden = false;
        foreign.querySelector("input")!.focus();
      };
      const trigger = document.querySelector<HTMLButtonElement>(
        action === "search"
          ? "#relationship-type-search-button"
          : "#relationship-types-next",
      )!;
      trigger.focus();
      trigger.click();
      expect(form.hidden).toBe(true);
      openForeign.focus();
      openForeign.click();
      expect(foreign.hidden).toBe(true);
      expect(form.inert).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
      pending.resolve(
        outcome === "ready"
          ? response({
            options: [{
              id: typeId,
              forwardLabel: "parent",
              reverseLabel: "child",
            }],
            status: "ready",
          })
          : response({
            detail: "Type lookup failed",
            status: 503,
            title: "Unavailable",
            type: "about:blank",
          }, 503),
      );
      await vi.waitFor(() => expect(form.inert).toBe(false));
      expect(draft.value).toBe("Keep this relationship draft");
      expect(foreign.hidden).toBe(true);
      expect(form.hidden).toBe(outcome === "error");
      expect(
        globalThis.dispatchEvent(
          new Event("beforeunload", { cancelable: true }),
        ),
      ).toBe(false);
      if (outcome === "ready") {
        expect(document.activeElement).toBe(
          form.querySelector("#relationship-type"),
        );
        openForeign.click();
        expect(confirm).toHaveBeenCalledOnce();
        expect(foreign.hidden).toBe(true);
        expect(form.hidden).toBe(false);
        confirm.mockReturnValue(true);
      } else {
        expect(document.querySelector("#relationships-state")?.textContent)
          .toBe("Type lookup failed");
      }
      openForeign.click();
      expect(foreign.hidden).toBe(false);
      expect(form.hidden).toBe(true);
      expect(document.activeElement).toBe(foreign.querySelector("input"));
    },
  );

  it("APR-002 keeps the latest type lookup reserved when an older response finishes", async () => {
    markup();
    const older = deferredResponse();
    const newer = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          response({ nextCursor: "next-types", options: [], status: "ready" }),
        )
        .mockResolvedValueOnce(response({ relationships: [], status: "ready" }))
        .mockReturnValueOnce(older.promise)
        .mockReturnValueOnce(newer.promise),
    );
    await mountRelationships(personId, workspaceId, false);
    document.querySelector<HTMLButtonElement>("#relationship-add")!.click();
    const form = document.querySelector<HTMLFormElement>("#relationship-form")!;
    const next = document.querySelector<HTMLButtonElement>(
      "#relationship-types-next",
    )!;
    const loadNext = next.onclick as () => Promise<void>;
    const olderLoad = loadNext();
    const newerLoad = loadNext();
    older.resolve(response({ options: [], status: "ready" }));
    await olderLoad;
    expect(form.hidden).toBe(true);
    expect(form.inert).toBe(true);
    expect(requestRailEditorOpen(document.createElement("form"))).toBe(false);
    newer.resolve(response({ options: [], status: "ready" }));
    await newerLoad;
    expect(form.inert).toBe(false);
    expect(form.hidden).toBe(false);
  });

  it("APR-002 leaves other editors available during an initial type load", async () => {
    markup();
    const pending = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce(
          response({ relationships: [], status: "ready" }),
        ),
    );
    const mounting = mountRelationships(personId, workspaceId, false);
    const form = document.querySelector<HTMLFormElement>("#relationship-form")!;
    const foreign = document.createElement("form");
    expect(form.inert).toBe(false);
    expect(requestRailEditorOpen(foreign)).toBe(true);
    pending.resolve(response({ options: [], status: "ready" }));
    await mounting;
    expect(form.inert).toBe(false);
    expect(form.hidden).toBe(true);
  });

  it.each(["archive", "remount"])(
    "APR-002 releases an obsolete type-load lock on %s",
    async (action) => {
      markup();
      const pending = deferredResponse();
      vi.stubGlobal(
        "fetch",
        vi.fn()
          .mockResolvedValueOnce(
            response({
              nextCursor: "next-types",
              options: [],
              status: "ready",
            }),
          )
          .mockResolvedValueOnce(
            response({ relationships: [], status: "ready" }),
          )
          .mockReturnValueOnce(pending.promise),
      );
      await mountRelationships(personId, workspaceId, false, false, updatedAt);
      document.querySelector<HTMLButtonElement>("#relationship-add")!.click();
      const form = document.querySelector<HTMLFormElement>(
        "#relationship-form",
      )!;
      const next = document.querySelector<HTMLButtonElement>(
        "#relationship-types-next",
      )!;
      const loading = (next.onclick as () => Promise<void>)();
      expect(form.inert).toBe(true);
      if (action === "archive") {
        document.dispatchEvent(
          new CustomEvent("person-lifecycle-changed", {
            detail: {
              archived: true,
              personId,
              personUpdatedAt: "2026-08-16T12:01:00.000000Z",
              state: "archived",
            },
          }),
        );
      } else {
        await mountRelationships(personId, workspaceId, false, true);
      }
      expect(form.inert).toBe(false);
      expect(form.hidden).toBe(true);
      expect(requestRailEditorOpen(document.createElement("form"))).toBe(true);
      pending.resolve(response({ options: [], status: "ready" }));
      await loading;
      expect(form.inert).toBe(false);
      expect(form.hidden).toBe(true);
    },
  );

  it("restores an open relationship draft after a successful type page load", async () => {
    markup();
    const page = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        nextCursor: "next-types",
        options: [],
        selected: [],
        status: "ready",
      }))
      .mockResolvedValueOnce(
        response({ relationships: [], status: "ready" }),
      )
      .mockReturnValueOnce(page.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    const form = document.querySelector(
      "#relationship-form",
    ) as HTMLFormElement;
    const draft = form.querySelector(
      '[name="newGivenName"]',
    ) as HTMLInputElement;
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    draft.value = "Retained draft";
    (document.querySelector(
      "#relationship-types-next",
    ) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(form.hidden).toBe(true);
    expect(draft.disabled).toBe(true);
    expect(draft.value).toBe("Retained draft");
    page.resolve(response({
      options: [{
        archived: false,
        forwardLabel: "mentor",
        id: typeId,
        reverseLabel: "protege",
      }],
      selected: [],
      status: "ready",
    }));
    await vi.waitFor(() => expect(form.hidden).toBe(false));
    expect(draft.disabled).toBe(false);
    expect(draft.value).toBe("Retained draft");
    const type = document.querySelector(
      "#relationship-type",
    ) as HTMLSelectElement;
    expect(type.textContent).toContain("mentor / protege");
    expect(document.activeElement).toBe(type);
  });

  it("supports keyboard-local cancel, bounded search, validation, and missing markup", async () => {
    await mountRelationships(personId, workspaceId, false);
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ options: [], status: "ready" }))
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }))
      .mockResolvedValueOnce(
        response({
          lifecycle: "active",
          people: [{
            givenName: "",
            id: targetId,
            isPartial: true,
            isStarred: false,
            lifecycle: "active",
            nickname: "Mystery",
            tagCount: 0,
            tags: [],
          }, {
            givenName: "",
            id: "00000000-0000-4000-8000-000000000102",
            isPartial: true,
            isStarred: false,
            lifecycle: "active",
            tagCount: 0,
            tags: [],
          }],
          status: "ready",
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    const add = document.querySelector(
      "#relationship-add",
    ) as HTMLButtonElement;
    add.click();
    (document.querySelector("#relationship-cancel") as HTMLButtonElement)
      .click();
    expect(
      (document.querySelector("#relationship-form") as HTMLFormElement).hidden,
    ).toBe(true);
    add.click();
    (document.querySelector("#relationship-form") as HTMLFormElement)
      .dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    expect(document.querySelector("#relationships-state")?.textContent)
      .toContain("Choose or create");
    (document.querySelector("#relationship-person-search") as HTMLInputElement)
      .value = "Mystery";
    (document.querySelector(
      "#relationship-person-search-button",
    ) as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(
        (document.querySelector("#relationship-target") as HTMLSelectElement)
          .textContent,
      ).toContain("Mystery")
    );
    expect(
      (document.querySelector("#relationship-target") as HTMLSelectElement)
        .textContent,
    ).toContain("Unnamed person");
  });

  it("keeps only the latest existing-person search response", async () => {
    markup();
    const older = deferredResponse();
    const newer = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ options: [], status: "ready" }))
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }))
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    const search = document.querySelector(
      "#relationship-person-search",
    ) as HTMLInputElement;
    const searchButton = document.querySelector(
      "#relationship-person-search-button",
    ) as HTMLButtonElement;
    const target = document.querySelector(
      "#relationship-target",
    ) as HTMLSelectElement;
    const submit = document.querySelector(
      '#relationship-form button[type="submit"]',
    ) as HTMLButtonElement;
    search.value = "Private Alice";
    searchButton.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(target.disabled).toBe(true);
    expect(submit.disabled).toBe(true);
    expect(document.querySelector("#relationships-state")?.textContent)
      .toContain("Searching people");
    search.value = "Bob";
    searchButton.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    newer.resolve(response({
      lifecycle: "active",
      people: [{
        givenName: "Bob",
        id: targetId,
        isPartial: false,
        isStarred: false,
        lifecycle: "active",
        tagCount: 0,
        tags: [],
      }],
      status: "ready",
    }));
    await vi.waitFor(() => expect(target.textContent).toContain("Bob"));
    older.resolve(response({
      lifecycle: "active",
      people: [{
        givenName: "Private Alice",
        id: "00000000-0000-4000-8000-000000000199",
        isPartial: false,
        isStarred: false,
        lifecycle: "active",
        tagCount: 0,
        tags: [],
      }],
      status: "ready",
    }));
    await older.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(target.textContent).toContain("Bob");
    expect(target.textContent).not.toContain("Private Alice");
    expect([...target.options].map((item) => item.value)).not.toContain(
      "00000000-0000-4000-8000-000000000199",
    );
    expect(target.disabled).toBe(false);
    expect(submit.disabled).toBe(false);
  });

  it("does not repopulate people after an authoritative hidden response", async () => {
    markup();
    const pending = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        options: [{
          archived: false,
          forwardLabel: "parent",
          id: typeId,
          reverseLabel: "child",
        }],
        status: "ready",
      }))
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce(response({
        affectedPersonIds: [personId, targetId],
        forward: relationship.display,
        inverse: relationship.display,
        relationship,
        status: "updated",
      }))
      .mockResolvedValueOnce(response({ relationships: [], status: "hidden" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    (document.querySelector(
      "#relationship-person-search-button",
    ) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) =>
        item.textContent === "Save relationship with Ada Lovelace"
      )!.click();
    const section = document.querySelector(
      "#profile-section-relationships",
    ) as HTMLElement;
    await vi.waitFor(() => expect(section.hidden).toBe(true));
    pending.resolve(response({
      lifecycle: "active",
      people: [{
        givenName: "Hidden identity",
        id: "00000000-0000-4000-8000-000000000198",
        isPartial: false,
        isStarred: false,
        lifecycle: "active",
        tagCount: 0,
        tags: [],
      }],
      status: "ready",
    }));
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const target = document.querySelector(
      "#relationship-target",
    ) as HTMLSelectElement;
    expect(target.textContent).not.toContain("Hidden identity");
    expect([...target.options].map((item) => item.value)).not.toContain(
      "00000000-0000-4000-8000-000000000198",
    );
    expect(section.hidden).toBe(true);
  });

  it("does not let a prior mount people search mutate a fresh editor", async () => {
    markup();
    const pending = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({ relationships: [], status: "ready" }),
        )
        .mockReturnValueOnce(pending.promise),
    );
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    (document.querySelector(
      "#relationship-person-search-button",
    ) as HTMLButtonElement).click();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({ relationships: [], status: "ready" }),
        ),
    );
    await mountRelationships(personId, workspaceId, false);
    pending.resolve(response({
      lifecycle: "active",
      people: [{
        givenName: "Prior mount identity",
        id: "00000000-0000-4000-8000-000000000197",
        isPartial: false,
        isStarred: false,
        lifecycle: "active",
        tagCount: 0,
        tags: [],
      }],
      status: "ready",
    }));
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    const target = document.querySelector(
      "#relationship-target",
    ) as HTMLSelectElement;
    expect(target.textContent).not.toContain("Prior mount identity");
    expect([...target.options].map((item) => item.value)).not.toContain(
      "00000000-0000-4000-8000-000000000197",
    );
  });

  it("renders inverse-aware people and locally refreshes create, update, and unlink", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({
          options: [{
            forwardLabel: "parent",
            id: typeId,
            reverseLabel: "child",
          }],
          status: "ready",
        }),
      )
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockResolvedValueOnce(
        response({
          affectedPersonIds: [personId, targetId],
          inverse: { label: "child", personId, relationshipId },
          relationship,
          status: "updated",
        }),
      )
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockResolvedValueOnce(
        response({
          affectedPersonIds: [personId, targetId],
          relationshipId,
          status: "deleted",
        }),
      )
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    expect(document.querySelector("#relationships-list")?.textContent)
      .toContain("parent: Ada Lovelace");
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) =>
        item.textContent === "Save relationship with Ada Lovelace"
      )!;
    expect(save.classList.contains("button-primary")).toBe(true);
    save.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#relationships-state")?.textContent)
        .toContain("updated")
    );
    const unlink = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent === "Unlink Ada Lovelace")!;
    expect(unlink.classList.contains("button-danger")).toBe(true);
    unlink.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#relationships-state")?.textContent)
        .toContain("Neither person was deleted")
    );
    expect(
      document.querySelector(
        `#relationships-list [data-relationship-id="${relationshipId}"]`,
      ),
    ).toBeNull();
    expect(document.querySelector("#relationships-list")?.textContent).toBe(
      "No relationships saved.",
    );
    expect(document.querySelector("#relationships-state")?.textContent).toBe(
      "People unlinked. Neither person was deleted.",
    );
    expect(document.querySelector("[data-profile-rail-count]")?.textContent)
      .toBe("0");
    expect(
      document.querySelector("#profile-section-relationships")?.getAttribute(
        "data-rail-empty",
      ),
    ).toBe("true");
    expect(document.activeElement).toBe(
      document.querySelector("#relationships-state"),
    );
    expect(
      document.querySelector("#relationships-state")?.getAttribute(
        "aria-live",
      ),
    ).toBe("polite");
    const deletes = fetchMock.mock.calls.filter((call) =>
      (call[1] as RequestInit | undefined)?.method === "DELETE"
    );
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0]?.[0])).toContain(
      `/api/v1/people/${personId}/relationships/${relationshipId}`,
    );
    expect(
      fetchMock.mock.calls.map((call) =>
        (call[1] as RequestInit | undefined)?.method ?? "GET"
      ),
    ).toContain("PATCH");
    expect(
      fetchMock.mock.calls.map((call) =>
        (call[1] as RequestInit | undefined)?.method ?? "GET"
      ),
    ).toContain("DELETE");
  });

  it("keeps the current remount authoritative across unlink settlement windows", async () => {
    markup();
    const deletion = deferredResponse();
    const currentList = deferredResponse();
    const staleList = deferredResponse();
    const types = () => response({ options: [], status: "ready" });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(types())
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockReturnValueOnce(deletion.promise)
      .mockResolvedValueOnce(types())
      .mockReturnValueOnce(currentList.promise)
      .mockReturnValueOnce(staleList.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    const unlink = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent === "Unlink Ada Lovelace")!;
    const unlinking = (unlink.onclick as () => Promise<void>)();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));

    const remount = mountRelationships(personId, workspaceId, false);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    currentList.resolve(response({ relationships: [], status: "ready" }));
    await remount;
    const add = document.querySelector(
      "#relationship-add",
    ) as HTMLButtonElement;
    add.focus();

    deletion.resolve(response({
      affectedPersonIds: [personId, targetId],
      relationshipId,
      status: "deleted",
    }));
    staleList.resolve(response({ relationships: [], status: "ready" }));
    await unlinking;

    expect(fetchMock).toHaveBeenCalledTimes(5);
    expect(document.querySelector("#relationships-list")?.textContent).toBe(
      "No relationships saved.",
    );
    expect(document.querySelector("#relationships-state")?.textContent).toBe(
      "",
    );
    expect(document.activeElement).toBe(add);

    fetchMock.mockReset()
      .mockResolvedValueOnce(types())
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockResolvedValueOnce(response({ status: "deleted" }))
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }))
      .mockResolvedValueOnce(types())
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }));
    await mountRelationships(personId, workspaceId, false);
    const list = document.querySelector(
      "#relationships-list",
    ) as HTMLUListElement;
    const replaceChildren = list.replaceChildren.bind(list);
    let renders = 0;
    let postRefreshRemount: Promise<void> | undefined;
    list.replaceChildren = (...nodes) => {
      replaceChildren(...nodes);
      if (++renders === 2) {
        postRefreshRemount = mountRelationships(personId, workspaceId, false);
      }
    };
    const state = document.querySelector("#relationships-state") as HTMLElement;
    const focus = vi.spyOn(state, "focus");
    const secondUnlink = [...document.querySelectorAll<HTMLButtonElement>(
      "button",
    )].find((item) => item.textContent === "Unlink Ada Lovelace")!;
    await (secondUnlink.onclick as () => Promise<void>)();
    await postRefreshRemount;

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(state);
  });

  it("creates a related person and relationship through the atomic coordinator", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({
          options: [{
            forwardLabel: "parent",
            id: typeId,
            reverseLabel: "child",
          }],
          status: "ready",
        }),
      )
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }))
      .mockResolvedValueOnce(
        response({
          person: { givenName: "Grace", id: targetId, isPartial: false },
          affectedPersonIds: [personId, targetId],
          inverse: { label: "child", personId, relationshipId },
          relationship,
          status: "created",
        }, 201),
      )
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    (document.querySelector('[name="newGivenName"]') as HTMLInputElement)
      .value = "Grace";
    (document.querySelector("#relationship-type") as HTMLSelectElement).value =
      typeId;
    (document.querySelector("#relationship-form") as HTMLFormElement)
      .dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(
      new URL(String(fetchMock.mock.calls[2]?.[0]), "http://localhost")
        .pathname,
    ).toBe(`/api/v1/people/${personId}/relationships/related-person`);
  });

  it("preserves a possible-duplicate draft and requires an explicit choice before override", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        options: [{
          forwardLabel: "parent",
          id: typeId,
          reverseLabel: "child",
        }],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }))
      .mockResolvedValueOnce(response({
        code: "related_person_possible_duplicate",
        detail:
          "Choose the existing person or explicitly confirm creating another.",
        status: 409,
        title: "Possible duplicate person",
        type: "about:blank",
      }, 409))
      .mockResolvedValueOnce(response({
        lifecycle: "active",
        people: [{
          givenName: "Grace",
          id: targetId,
          isPartial: false,
          isStarred: false,
          lifecycle: "active",
          tagCount: 0,
          tags: [],
        }],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        code: "related_person_possible_duplicate",
        detail:
          "Choose the existing person or explicitly confirm creating another.",
        status: 409,
        title: "Possible duplicate person",
        type: "about:blank",
      }, 409))
      .mockResolvedValueOnce(response({
        affectedPersonIds: [personId, targetId],
        inverse: { label: "child", personId, relationshipId },
        person: { givenName: "Grace", id: targetId, isPartial: false },
        relationship,
        status: "created",
      }, 201))
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    const givenName = document.querySelector(
      '[name="newGivenName"]',
    ) as HTMLInputElement;
    givenName.value = "Grace";
    (document.querySelector("#relationship-type") as HTMLSelectElement).value =
      typeId;
    (document.querySelector("#relationship-form") as HTMLFormElement)
      .requestSubmit();
    const choices = document.querySelector(
      "#relationship-duplicate-choices",
    ) as HTMLElement;
    await vi.waitFor(() => expect(choices.hidden).toBe(false));
    expect(givenName.value).toBe("Grace");
    expect(document.activeElement).toBe(
      document.querySelector("#relationship-select-existing"),
    );
    expect(choices.textContent).toContain("Select existing person");
    expect(choices.textContent).toContain("Create anyway");
    const firstBody = JSON.parse(
      String((fetchMock.mock.calls[2]?.[1] as RequestInit).body),
    );
    expect(firstBody.person.duplicateOverride).toBeUndefined();
    (document.querySelector(
      "#relationship-select-existing",
    ) as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.activeElement).toBe(
        document.querySelector("#relationship-target"),
      )
    );
    expect(document.querySelector("#relationship-target")?.textContent)
      .toContain("Grace");
    (document.querySelector("#relationship-form") as HTMLFormElement)
      .requestSubmit();
    await vi.waitFor(() => expect(choices.hidden).toBe(false));
    (document.querySelector(
      "#relationship-create-anyway",
    ) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    const overrideBody = JSON.parse(
      String((fetchMock.mock.calls[5]?.[1] as RequestInit).body),
    );
    expect(overrideBody.person.duplicateOverride).toBe(true);
  });

  it("keeps hidden, archived, forbidden, and error states honest", async () => {
    markup();
    await mountRelationships(personId, workspaceId, false, true);
    expect(
      (document.querySelector("#profile-section-relationships") as HTMLElement)
        .hidden,
    ).toBe(true);
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({ relationships: [], status: "archived" }),
        ),
    );
    await mountRelationships(personId, workspaceId, true);
    expect(
      document.querySelector("#profile-section-relationships")?.getAttribute(
        "data-section-state",
      ),
    ).toBe("read-only");
    expect(
      (document.querySelector("#relationship-add") as HTMLButtonElement).hidden,
    ).toBe(true);
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({
            code: "relationships_forbidden",
            detail: "Private",
            status: 403,
            title: "Forbidden",
            type: "about:blank",
          }, 403),
        ),
    );
    await mountRelationships(personId, workspaceId, false);
    expect(
      document.querySelector("#profile-section-relationships")?.getAttribute(
        "data-section-state",
      ),
    ).toBe("forbidden");
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(response({
          code: "relationships_unavailable",
          detail: "Unavailable",
          status: 500,
          title: "Unavailable",
          type: "about:blank",
        }, 500)),
    );
    await mountRelationships(personId, workspaceId, false);
    expect(
      document.querySelector("#profile-section-relationships")?.getAttribute(
        "data-section-state",
      ),
    ).toBe("error");
    expect(document.querySelector("#relationships-state")?.textContent).toBe(
      "This relationship section is temporarily unavailable. Try again.",
    );
  });

  it("hydrates an archived related person without making the active profile read-only", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          response({
            options: [{
              forwardLabel: "parent",
              id: typeId,
              reverseLabel: "child",
            }],
            status: "ready",
          }),
        )
        .mockResolvedValueOnce(
          response({
            relationships: [{
              ...relationship,
              display: { ...relationship.display, name: undefined },
            }],
            status: "ready",
          }),
        ),
    );
    await mountRelationships(personId, workspaceId, false);
    expect(document.querySelector("#relationships-list")?.textContent)
      .toContain("Related person");
    expect(
      document.querySelector("#profile-section-relationships")?.getAttribute(
        "data-section-state",
      ),
    ).toBe("ready");
  });

  it("purges an authoritative hidden response and restores only after a fresh ready reload", async () => {
    markup();
    const readyTypes = response({
      options: [{
        archived: false,
        forwardLabel: "parent",
        id: typeId,
        reverseLabel: "child",
      }],
      status: "ready",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(readyTypes)
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockResolvedValueOnce(response({
        affectedPersonIds: [personId, targetId],
        forward: relationship.display,
        inverse: relationship.display,
        relationship,
        status: "updated",
      }))
      .mockResolvedValueOnce(
        response({ relationships: [], status: "hidden" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    (document.querySelector('[name="newGivenName"]') as HTMLInputElement)
      .value = "Sensitive draft";
    const save = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) =>
        item.textContent === "Save relationship with Ada Lovelace"
      )!;
    save.click();
    const section = document.querySelector(
      "#profile-section-relationships",
    ) as HTMLElement;
    await vi.waitFor(() => expect(section.hidden).toBe(true));
    expect(document.querySelector("#relationships-list")?.children)
      .toHaveLength(
        0,
      );
    expect(
      (document.querySelector('[name="newGivenName"]') as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      (document.querySelector("#relationship-add") as HTMLButtonElement).hidden,
    )
      .toBe(true);
    expect(
      (document.querySelector("#relationship-type") as HTMLSelectElement)
        .options,
    ).toHaveLength(1);
    expect(document.activeElement).toBe(
      document.querySelector("#main-content"),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          options: [{
            archived: false,
            forwardLabel: "parent",
            id: typeId,
            reverseLabel: "child",
          }],
          status: "ready",
        }))
        .mockResolvedValueOnce(
          response({ relationships: [relationship], status: "ready" }),
        ),
    );
    await mountRelationships(personId, workspaceId, false);
    expect(section.hidden).toBe(false);
    expect(section.dataset.sectionState).toBe("ready");
    await vi.waitFor(() =>
      expect(
        document.querySelector("#relationships-list select"),
      ).not.toBeNull()
    );
    expect(
      (document.querySelector("#relationship-add") as HTMLButtonElement).hidden,
    )
      .toBe(false);
  });

  it("honors authoritative archived read-only state and reenables writes only after ready reload", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        options: [{
          archived: false,
          forwardLabel: "parent",
          id: typeId,
          reverseLabel: "child",
        }],
        status: "ready",
      }))
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockResolvedValueOnce(response({
        affectedPersonIds: [personId, targetId],
        forward: relationship.display,
        inverse: relationship.display,
        relationship,
        status: "updated",
      }))
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "archived" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) =>
        item.textContent === "Save relationship with Ada Lovelace"
      )!.click();
    const section = document.querySelector(
      "#profile-section-relationships",
    ) as HTMLElement;
    await vi.waitFor(() =>
      expect(section.dataset.sectionState).toBe("read-only")
    );
    expect(section.textContent).toContain("parent: Ada Lovelace");
    expect(section.textContent).toContain("read-only");
    expect(section.textContent).not.toContain("Unlink Ada Lovelace");
    expect(
      document.querySelector("#relationships-list select"),
    ).toBeNull();
    expect(
      (document.querySelector("#relationship-add") as HTMLButtonElement).hidden,
    )
      .toBe(true);
    expect(
      [
        ...(document.querySelector("#relationship-form") as HTMLFormElement)
          .elements,
      ].every((control) => "disabled" in control && control.disabled === true),
    ).toBe(true);
    expect(document.activeElement).toBe(
      document.querySelector("#relationships-state"),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          options: [{
            archived: false,
            forwardLabel: "parent",
            id: typeId,
            reverseLabel: "child",
          }],
          status: "ready",
        }))
        .mockResolvedValueOnce(
          response({ relationships: [relationship], status: "ready" }),
        ),
    );
    await mountRelationships(personId, workspaceId, false);
    expect(section.dataset.sectionState).toBe("ready");
    expect(section.textContent).toContain("Unlink Ada Lovelace");
    expect(
      (document.querySelector("#relationship-add") as HTMLButtonElement).hidden,
    )
      .toBe(false);
  });

  it("keeps a relationship-type outage authoritative over a successful list read", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          code: "relationship_types_unavailable",
          detail: "Relationship types are temporarily unavailable.",
          status: 503,
          title: "Relationship types unavailable",
          type: "about:blank",
        }, 503))
        .mockResolvedValueOnce(
          response({ relationships: [relationship], status: "ready" }),
        ),
    );
    await mountRelationships(personId, workspaceId, false);
    const section = document.querySelector(
      "#profile-section-relationships",
    ) as HTMLElement;
    expect(section.dataset.sectionState).toBe("error");
    expect(document.querySelector("#relationships-state")?.textContent)
      .toContain("Relationship types are temporarily unavailable.");
    expect(section.textContent).toContain("parent: Ada Lovelace");
    expect(section.textContent).not.toContain("Unlink Ada Lovelace");
    expect(
      (document.querySelector("#relationship-add") as HTMLButtonElement).hidden,
    )
      .toBe(true);
    expect(
      (document.querySelector("#relationship-type") as HTMLSelectElement)
        .disabled,
    )
      .toBe(true);
    expect(document.activeElement).toBe(
      document.querySelector("#relationships-state"),
    );
  });

  it("suppresses an older pagination response after a newer hidden response", async () => {
    markup();
    const older = deferredResponse();
    const newer = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ options: [], status: "ready" }))
      .mockResolvedValueOnce(response({
        nextCursor: "next-page",
        relationships: [relationship],
        status: "ready",
      }))
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector('[name="newGivenName"]') as HTMLInputElement)
      .value = "Sensitive draft";
    const next = document.querySelector(
      "#relationships-load-more",
    ) as HTMLButtonElement;
    const loadNext = next.onclick as () => void;
    loadNext();
    loadNext();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    newer.resolve(response({ relationships: [], status: "hidden" }));
    await vi.waitFor(() =>
      expect(
        (document.querySelector(
          "#profile-section-relationships",
        ) as HTMLElement).hidden,
      ).toBe(true)
    );
    older.resolve(response({ relationships: [relationship], status: "ready" }));
    await older.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(
      (document.querySelector(
        "#profile-section-relationships",
      ) as HTMLElement).hidden,
    ).toBe(true);
    expect(document.querySelector("#relationships-list")?.children)
      .toHaveLength(0);
    expect(
      (document.querySelector('[name="newGivenName"]') as HTMLInputElement)
        .value,
    ).toBe("");

    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({ relationships: [relationship], status: "ready" }),
        ),
    );
    await mountRelationships(personId, workspaceId, false);
    expect(
      (document.querySelector(
        "#profile-section-relationships",
      ) as HTMLElement).dataset.sectionState,
    ).toBe("ready");
  });

  it("suppresses an older type page after a newer type outage", async () => {
    markup();
    const older = deferredResponse();
    const newer = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        nextCursor: "next-types",
        options: [],
        status: "ready",
      }))
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    const next = document.querySelector(
      "#relationship-types-next",
    ) as HTMLButtonElement;
    const loadNext = next.onclick as () => void;
    loadNext();
    loadNext();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    newer.resolve(response({
      code: "relationship_types_unavailable",
      detail: "Relationship types are temporarily unavailable.",
      status: 503,
      title: "Relationship types unavailable",
      type: "about:blank",
    }, 503));
    await vi.waitFor(() =>
      expect(
        (document.querySelector(
          "#profile-section-relationships",
        ) as HTMLElement).dataset.sectionState,
      ).toBe("error")
    );
    expect(document.querySelector<HTMLFormElement>("#relationship-form")!.inert)
      .toBe(false);
    older.resolve(response({ options: [], status: "ready" }));
    await older.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector<HTMLFormElement>("#relationship-form")!.inert)
      .toBe(false);
    expect(
      (document.querySelector(
        "#profile-section-relationships",
      ) as HTMLElement).dataset.sectionState,
    ).toBe("error");
    expect(document.querySelector("#relationships-state")?.textContent)
      .toContain("Relationship types are temporarily unavailable.");
    expect(
      (document.querySelector("#relationship-form") as HTMLFormElement).hidden,
    ).toBe(true);
  });

  it("suppresses an older type page after a newer hidden response", async () => {
    markup();
    const older = deferredResponse();
    const newer = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        nextCursor: "next-types",
        options: [],
        status: "ready",
      }))
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    const next = document.querySelector(
      "#relationship-types-next",
    ) as HTMLButtonElement;
    const loadNext = next.onclick as () => void;
    loadNext();
    loadNext();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    newer.resolve(response({ options: [], selected: [], status: "hidden" }));
    await vi.waitFor(() =>
      expect(
        (document.querySelector(
          "#profile-section-relationships",
        ) as HTMLElement).hidden,
      ).toBe(true)
    );
    expect(document.querySelector<HTMLFormElement>("#relationship-form")!.inert)
      .toBe(false);
    older.resolve(response({ options: [], status: "ready" }));
    await older.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.querySelector<HTMLFormElement>("#relationship-form")!.inert)
      .toBe(false);
    expect(
      (document.querySelector(
        "#profile-section-relationships",
      ) as HTMLElement).hidden,
    ).toBe(true);
    expect(document.querySelector("#relationships-list")?.children)
      .toHaveLength(0);
    expect(
      (document.querySelector("#relationship-form") as HTMLFormElement).hidden,
    ).toBe(true);
  });

  it("archives immediately and suppresses pending list, type, and people searches", async () => {
    markup();
    const people = deferredResponse();
    const types = deferredResponse();
    const relationships = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        nextCursor: "next-types",
        options: [{
          archived: false,
          forwardLabel: "parent",
          id: typeId,
          reverseLabel: "child",
        }],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        nextCursor: "next-relationships",
        relationships: [relationship],
        status: "ready",
      }))
      .mockReturnValueOnce(people.promise)
      .mockReturnValueOnce(types.promise)
      .mockReturnValueOnce(relationships.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false, false, updatedAt);
    (document.querySelector("#relationship-add") as HTMLButtonElement).click();
    (document.querySelector('[name="newGivenName"]') as HTMLInputElement)
      .value = "Sensitive draft";
    (document.querySelector(
      "#relationship-person-search-button",
    ) as HTMLButtonElement).click();
    (document.querySelector(
      "#relationship-type-search-button",
    ) as HTMLButtonElement).click();
    const next = document.querySelector(
      "#relationships-load-more",
    ) as HTMLButtonElement;
    (next.onclick as () => void)();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          archived: true,
          personId,
          personUpdatedAt: "2026-08-16T12:01:00.000000Z",
          state: "archived",
        },
      }),
    );
    const section = document.querySelector(
      "#profile-section-relationships",
    ) as HTMLElement;
    expect(section.dataset.sectionState).toBe("read-only");
    expect(section.textContent).toContain("parent: Ada Lovelace");
    expect(section.textContent).not.toContain("Unlink Ada Lovelace");
    expect(
      (document.querySelector("#relationship-form") as HTMLFormElement).hidden,
    ).toBe(true);
    expect(
      (document.querySelector('[name="newGivenName"]') as HTMLInputElement)
        .value,
    ).toBe("");
    expect(
      (document.querySelector("#relationship-add") as HTMLButtonElement).hidden,
    ).toBe(true);

    people.resolve(response({
      lifecycle: "active",
      people: [{
        givenName: "Private identity",
        id: "00000000-0000-4000-8000-000000000999",
        lifecycle: "active",
      }],
    }));
    types.resolve(response({
      options: [{
        archived: false,
        forwardLabel: "private type",
        id: "00000000-0000-4000-8000-000000000998",
        reverseLabel: "private inverse",
      }],
      status: "ready",
    }));
    relationships.resolve(response({
      relationships: [{
        ...relationship,
        display: { ...relationship.display, name: "Private relationship" },
      }],
      status: "ready",
    }));
    await Promise.all([people.promise, types.promise, relationships.promise]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(section.dataset.sectionState).toBe("read-only");
    expect(section.textContent).not.toContain("Private identity");
    expect(section.textContent).not.toContain("Private type");
    expect(section.textContent).not.toContain("Private relationship");
    expect(section.innerHTML).not.toContain(
      "00000000-0000-4000-8000-000000000999",
    );
  });

  it("restores only after fresh relationship and type responses and ignores a stale archive", async () => {
    markup();
    const freshTypes = deferredResponse();
    const freshRelationships = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ options: [], status: "ready" }))
      .mockResolvedValueOnce(
        response({ relationships: [relationship], status: "ready" }),
      )
      .mockReturnValueOnce(freshTypes.promise)
      .mockReturnValueOnce(freshRelationships.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false, false, updatedAt);
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          archived: true,
          personId,
          personUpdatedAt: "2026-08-16T12:01:00.000000Z",
          state: "archived",
        },
      }),
    );
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          archived: false,
          personId,
          personUpdatedAt: "2026-08-16T12:02:00.000000Z",
          state: "active",
        },
      }),
    );
    const section = document.querySelector(
      "#profile-section-relationships",
    ) as HTMLElement;
    expect(section.dataset.sectionState).toBe("loading");
    expect(
      (document.querySelector("#relationship-add") as HTMLButtonElement).hidden,
    ).toBe(true);
    expect(section.textContent).not.toContain("Unlink Ada Lovelace");
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    freshRelationships.resolve(
      response({ relationships: [relationship], status: "ready" }),
    );
    await freshRelationships.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(section.dataset.sectionState).toBe("loading");
    freshTypes.resolve(response({
      options: [{
        archived: false,
        forwardLabel: "parent",
        id: typeId,
        reverseLabel: "child",
      }],
      status: "ready",
    }));
    await vi.waitFor(() => expect(section.dataset.sectionState).toBe("ready"));
    expect(section.textContent).toContain("Unlink Ada Lovelace");
    expect(
      (document.querySelector("#relationship-add") as HTMLButtonElement).hidden,
    ).toBe(false);

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          archived: true,
          personId,
          personUpdatedAt: "2026-08-16T12:01:00.000000Z",
          state: "archived",
        },
      }),
    );
    expect(section.dataset.sectionState).toBe("ready");
    expect(section.textContent).toContain("Unlink Ada Lovelace");
  });

  it("ignores malformed and other-person lifecycle events after a duplicate mount", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ options: [], status: "ready" }))
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }))
      .mockResolvedValueOnce(response({ options: [], status: "ready" }))
      .mockResolvedValueOnce(response({ relationships: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mountRelationships(personId, workspaceId, false, false, updatedAt);
    await mountRelationships(targetId, workspaceId, false, false, updatedAt);
    const section = document.querySelector(
      "#profile-section-relationships",
    ) as HTMLElement;

    for (
      const detail of [
        {
          archived: true,
          personId,
          personUpdatedAt: "2026-08-16T12:03:00Z",
          state: "archived",
        },
        {
          archived: true,
          personId: targetId,
          personUpdatedAt: "not-a-revision",
          state: "archived",
        },
        {
          archived: true,
          personId: targetId,
          personUpdatedAt: "2026-08-16T12:03:00.000000Z",
          state: "deleted",
        },
      ]
    ) {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", { detail }),
      );
    }
    expect(section.dataset.sectionState).toBe("ready");
    expect(fetchMock).toHaveBeenCalledTimes(4);

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: {
          archived: true,
          personId: targetId,
          personUpdatedAt: "2026-08-16T12:03:00.000000Z",
          state: "archived",
        },
      }),
    );
    expect(section.dataset.sectionState).toBe("read-only");
  });

  it("REL-039 announces its state without scrolling the page under a pending click", async () => {
    markup();
    const state = document.querySelector("#relationships-state") as HTMLElement;
    const focus = vi.spyOn(state, "focus");
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ options: [], status: "ready" }))
        .mockResolvedValueOnce(
          response({ relationships: [relationship], status: "archived" }),
        ),
    );
    await mountRelationships(personId, workspaceId, true);
    expect(
      (document.querySelector("#profile-section-relationships") as HTMLElement)
        .dataset.sectionState,
    ).toBe("read-only");
    expect(focus).toHaveBeenCalled();
    expect(focus.mock.calls.map(([options]) => options)).toEqual(
      focus.mock.calls.map(() => ({ preventScroll: true })),
    );
  });
});
