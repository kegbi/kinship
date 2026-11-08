// @vitest-environment happy-dom
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  onTestFinished,
  vi,
} from "vitest";
import { buttonVariants } from "@/components/ui/variants.ts";
import {
  registerRailEditors,
  requestRailEditorOpen,
} from "../../../lib/rail-editors.ts";
import { mountUnsavedChangesGuard } from "../../../lib/unsaved-changes.ts";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  type ApiRoutes,
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import {
  ids,
  personProfile,
  profileSummary,
  sectionProps,
} from "../../../testing/fixtures.ts";
import {
  adoptMount,
  drawShell,
  element,
  mountSection,
} from "../../../testing/render.tsx";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import {
  mountPersonRelationships,
  PERSON_RELATIONSHIPS_ISLAND,
} from "./person-relationships.tsx";

const { person: personId } = ids;
const targetId = "00000000-0000-4000-8000-000000000101";
const typeId = "00000000-0000-4000-8000-000000000200";
const relationshipId = "00000000-0000-4000-8000-000000000300";
const updatedAt = "2026-08-16T12:00:00.000000Z";

const TYPES = "GET /api/v1/relationship-types";
const LIST = "GET /api/v1/people/:personId/relationships";
const CREATE = "POST /api/v1/people/:personId/relationships";
const RELATED = "POST /api/v1/people/:personId/relationships/related-person";
const UPDATE = "PATCH /api/v1/people/:personId/relationships/:relationshipId";
const UNLINK = "DELETE /api/v1/people/:personId/relationships/:relationshipId";
const PEOPLE = "GET /api/v1/people";

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

const parentType = {
  archived: false,
  forwardLabel: "parent",
  id: typeId,
  reverseLabel: "child",
};

const types = (
  options: readonly object[] = [],
  extra: Record<string, unknown> = {},
) => jsonResponse({ options, selected: [], status: "ready", ...extra });
const listed = (
  relationships: readonly object[] = [],
  status = "ready",
  extra: Record<string, unknown> = {},
) => jsonResponse({ relationships, status, ...extra });
const people = (...found: readonly object[]) =>
  jsonResponse({
    lifecycle: "active",
    people: found.map((person) => ({
      isPartial: false,
      isStarred: false,
      lifecycle: "active",
      tagCount: 0,
      tags: [],
      ...person,
    })),
    status: "ready",
  });
const changed = (status = "updated") =>
  jsonResponse({
    affectedPersonIds: [personId, targetId],
    forward: relationship.display,
    inverse: relationship.display,
    relationship,
    status,
  });
const deleted = () =>
  jsonResponse({
    affectedPersonIds: [personId, targetId],
    relationshipId,
    status: "deleted",
  });

/** The block as `RelationshipsSection.astro` draws it before it hydrates. */
function shell(): void {
  drawShell(`
    <main id="main-content" tabindex="-1">
      <section id="profile-section-relationships" class="profile-section-card profile-rail-block" data-profile-section="relationships" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-relationships-heading">
        <header class="profile-section-heading">
          <h3 id="profile-section-relationships-heading">Relationships</h3>
          <span class="contents" data-rail-count-slot><span class="profile-rail-count" data-profile-rail-count hidden></span></span>
          <button id="relationship-add" class="profile-rail-add" type="button" aria-label="Add relationship" hidden><span aria-hidden="true">+</span></button>
        </header>
        <p id="relationships-state" data-rail-editor-feedback class="section-state" tabindex="-1"><span class="sr-only">Loading relationships…</span></p>
        <ul id="relationships-list" class="profile-fact-list" aria-label="Saved relationships" tabindex="-1"></ul>
        <form method="post" id="relationship-form" class="profile-fact-form" hidden novalidate></form>
      </section>
    </main>`);
}

function props(
  options: {
    readonly archived?: boolean;
    readonly hidden?: boolean;
    readonly person?: string;
    /** How many relationships the profile summary counted. */
    readonly counted?: number;
  } = {},
) {
  return sectionProps({
    archived: options.archived ?? false,
    initial: personProfile({
      person: {
        profileSections: options.hidden
          ? [{ id: "relationships", status: "hidden" }]
          : [],
        updatedAt,
      },
      ...(options.counted === undefined ? {} : {
        summary: profileSummary({
          sectionCounts: [{
            count: options.counted,
            id: "relationships",
            status: "ready",
          }],
        }),
      }),
    }),
    personId: options.person ?? personId,
  });
}

function mount(options: Parameters<typeof props>[0] = {}) {
  return mountSection(
    mountPersonRelationships,
    props(options),
    element("main"),
  );
}

/** Mounts without waiting, outside `act`, for a test holding a read back. */
function mountLater(options: Parameters<typeof props>[0] = {}) {
  let unmount!: () => void;
  const settled = mountPersonRelationships(element("main"), props(options))
    .then((done) => {
      unmount = adoptMount(done);
    });
  return { settled, unmount: () => unmount() };
}

const section = () => element("#profile-section-relationships");
const block = () => within(section());
const state = () => element("#relationships-state");
const form = () => element<HTMLFormElement>("#relationship-form");
const add = () => element<HTMLButtonElement>("#relationship-add");
const list = () => element<HTMLUListElement>("#relationships-list");
const typeSelect = () => element<HTMLSelectElement>("#relationship-type");
const targetInput = () => element<HTMLInputElement>("#relationship-target");
const searchInput = () => byId<HTMLInputElement>("relationship-person-search");
const searchFor = (value = "Person") =>
  fireEvent.change(searchInput(), { target: { value } });
const peopleResults = () =>
  within(form()).queryByRole("listbox")?.textContent ?? "";
const choosePerson = (name: string) =>
  fireEvent.click(within(form()).getByRole("option", { name }));
const givenName = () =>
  within(form()).getByLabelText<HTMLInputElement>("New person given name");
const byId = <T extends HTMLElement = HTMLButtonElement>(id: string) =>
  element<T>(`#${id}`);
const rowButton = (name: string) =>
  block().getByRole<HTMLButtonElement>("button", { name });
const writes = (api: ReturnType<typeof stubApi>) =>
  api.requests().filter((request) => request.method !== "GET");
const reads = (api: ReturnType<typeof stubApi>, path: string) =>
  api.requests().filter((request) =>
    request.method === "GET" && request.url.pathname === path
  );

function lifecycle(detail: Record<string, unknown>): void {
  act(() => {
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", { detail }),
    );
  });
}

const archive = (at = "2026-08-16T12:01:00.000000Z") =>
  lifecycle({
    archived: true,
    personId,
    personUpdatedAt: at,
    state: "archived",
  });
const restore = (at = "2026-08-16T12:02:00.000000Z") =>
  lifecycle({
    archived: false,
    personId,
    personUpdatedAt: at,
    state: "active",
  });

/**
 * A foreign rail editor as another block's markup draws it. happy-dom hands
 * `closest("form")` a different object than a script-created form element
 * itself, so the page's guard recognises only parsed forms; this one is.
 */
function foreignEditor(): HTMLFormElement {
  document.body.insertAdjacentHTML(
    "beforeend",
    '<form id="foreign"><input name="draft"></form>',
  );
  return element("#foreign input").closest("form")!;
}

/**
 * Stands in for the page's guard on the island's own form, which happy-dom
 * cannot match to the events inside it (see `foreignEditor`): records the
 * forms each discard request offers, declining when `decline` says so.
 */
function discardRequests(decline: () => boolean): HTMLFormElement[][] {
  const offered: HTMLFormElement[][] = [];
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ forms: HTMLFormElement[] }>).detail;
    offered.push([...detail.forms]);
    if (decline()) event.preventDefault();
  };
  document.addEventListener("kinship:form-discard-request", listener);
  onTestFinished(() =>
    document.removeEventListener("kinship:form-discard-request", listener)
  );
  return offered;
}

/** Opens the editor and chooses the parent type. */
function openWithType(): void {
  fireEvent.click(add());
  fireEvent.change(typeSelect(), { target: { value: typeId } });
}

/**
 * The block's reads, with `extra` first: `stubApi` answers from the first
 * route that fits, so a route with a query must come before its plain one.
 */
function routes(extra: ApiRoutes = {}): ApiRoutes {
  const defaults: ApiRoutes = {
    [TYPES]: types([parentType]),
    [LIST]: listed(),
  };
  return {
    ...extra,
    ...Object.fromEntries(
      Object.entries(defaults).filter(([key]) => !(key in extra)),
    ),
  };
}

// The rail's counts are the rail island's: this block publishes them.
let summary: CapturedProfileSummary;
beforeEach(() => {
  summary = captureProfileSummary();
});
afterEach(() => {
  summary.stop();
  vi.unstubAllGlobals();
});

describe("RELATIONSHIP-001 relationships island", () => {
  it("renders over the shell, keeping its heading and marking itself ready", async () => {
    shell();
    stubApi(routes({ [LIST]: listed([relationship]) }));
    await mount();
    expect(section().dataset.island).toBe(PERSON_RELATIONSHIPS_ISLAND);
    expect(section().hasAttribute("data-island-ready")).toBe(true);
    expect(section().firstElementChild?.localName).toBe("header");
    expect(section().lastElementChild).toBe(form());
    expect(document.querySelectorAll("#relationship-add")).toHaveLength(1);
    expect(add().closest("header")).not.toBeNull();
    expect(add().hidden).toBe(false);
    expect(section().dataset.sectionState).toBe("ready");
    expect(state().textContent).toBe("1 relationship.");
    expect(state().dataset.railSummary).toBe("true");
    expect(summary.railCount("relationships")).toBe("1");
    expect(summary.railEmpty("relationships")).toBe(false);
    await expectNoAxeViolations(section());
  });

  it("FEQ-04 shows a block the summary counted empty without reading it, and loads the types when the editor opens", async () => {
    shell();
    const api = stubApi(routes({
      [CREATE]: changed("created"),
      [LIST]: listed([relationship]),
    }));
    await mount({ counted: 0 });
    expect(api.calls()).toEqual([]);
    expect(section().dataset.sectionState).toBe("ready");
    expect(summary.railCount("relationships")).toBe("0");
    expect(summary.railEmpty("relationships")).toBe(true);
    expect(add().hidden).toBe(false);
    fireEvent.click(add());
    await waitFor(() => expect(form().hidden).toBe(false));
    expect(api.calls()).toEqual(["GET /api/v1/relationship-types"]);
    await waitFor(() => expect(document.activeElement).toBe(searchInput()));
    expect([...typeSelect().options].map((option) => option.value))
      .toContain(typeId);
  });

  it("FEQ-04 keeps a failed type read in the block's state after the editor asked for it", async () => {
    shell();
    stubApi(routes({ [TYPES]: unreachable }));
    await mount({ counted: 0 });
    fireEvent.click(add());
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Relationship types are temporarily unavailable.",
      )
    );
    expect(form().hidden).toBe(true);
  });

  it.each(["clean", "declined", "accepted"])(
    "APR-002 gates incoming and outgoing local-editor switches when %s",
    async (decision) => {
      shell();
      stubApi(routes());
      await mount();
      mountUnsavedChangesGuard({
        confirmMessage: "Discard?",
        root: document.body,
      });
      const confirm = vi.fn(() => decision === "accepted");
      vi.stubGlobal("confirm", confirm);
      const foreign = foreignEditor();
      registerRailEditors([foreign], () => {
        foreign.hidden = true;
        foreign.reset();
      });
      const foreignField = foreign.querySelector("input")!;
      foreignField.focus();
      if (decision !== "clean") {
        fireEvent.input(foreignField, { target: { value: "Foreign draft" } });
      }
      add().focus();
      fireEvent.click(add());
      if (decision === "declined") {
        expect(form().hidden).toBe(true);
        expect(foreign.hidden).toBe(false);
        expect(foreignField.value).toBe("Foreign draft");
        expect(document.activeElement).toBe(foreignField);
        confirm.mockReturnValue(true);
        fireEvent.click(add());
      }
      expect(form().hidden).toBe(false);
      expect(foreign.hidden).toBe(true);
      expect(document.activeElement).toBe(
        within(form()).getByLabelText("Search people"),
      );
      const field = givenName();
      field.focus();
      if (decision !== "clean") {
        fireEvent.input(field, { target: { value: "Related draft" } });
      }
      const offered = discardRequests(() => decision === "declined");
      add().focus();
      act(() => {
        expect(requestRailEditorOpen(foreign)).toBe(decision !== "declined");
      });
      expect(offered.at(-1)).toContain(form());
      if (decision === "declined") {
        expect(form().hidden).toBe(false);
        expect(field.value).toBe("Related draft");
        fireEvent.click(byId("relationship-cancel"));
        expect(document.activeElement).toBe(add());
      }
      expect(form().hidden).toBe(true);
      expect(field.value).toBe("");
    },
  );

  it.each(["existing", "new"])(
    "APR-002 retains a pending %s relationship draft when another editor is requested",
    async (kind) => {
      shell();
      const pending = deferred<Response>();
      stubApi(routes({
        [CREATE]: () => pending.promise,
        [PEOPLE]: people({ givenName: "Grace", id: targetId }),
        [RELATED]: () => pending.promise,
      }));
      await mount();
      openWithType();
      if (kind === "existing") {
        searchFor();
        await waitFor(() => expect(peopleResults()).toContain("Grace"));
        choosePerson("Grace");
      } else {
        fireEvent.input(givenName(), { target: { value: "Grace" } });
      }
      fireEvent.submit(form());
      await waitFor(() => expect(form().inert).toBe(true));
      expect(requestRailEditorOpen(document.createElement("form"))).toBe(false);
      expect(form().hidden).toBe(false);
      await act(async () => {
        pending.resolve(problemResponse(503, { detail: "Try again" }));
        await pending.promise;
      });
      await waitFor(() => expect(form().inert).toBe(false));
      expect(form().hidden).toBe(false);
      expect(givenName().value).toBe(kind === "new" ? "Grace" : "");
      expect(targetInput().value).toBe(kind === "existing" ? targetId : "");
      expect(state().textContent).toBe("Try again");
      expect(document.activeElement).toBe(state());
    },
  );

  it("resets on a foreign rail editor without restoring focus", async () => {
    shell();
    stubApi(routes());
    await mount();
    fireEvent.click(add());
    const draft = givenName();
    draft.value = "Unsaved draft";
    const reset = vi.fn();
    form().addEventListener("reset", reset);
    const restoreFocus = vi.spyOn(add(), "focus");
    const foreign = document.createElement("form");
    const foreignControl = document.createElement("input");
    foreign.append(foreignControl);
    document.body.append(foreign);
    foreignControl.focus();

    act(() => {
      requestRailEditorOpen(foreign);
    });

    expect(form().hidden).toBe(true);
    expect(draft.value).toBe("");
    expect(reset).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(foreignControl);
  });

  it("groups relationship types and expands rows beyond the five-row summary", async () => {
    shell();
    const colleague = "00000000-0000-4000-8000-000000000201";
    const friend = "00000000-0000-4000-8000-000000000202";
    const neighbor = "00000000-0000-4000-8000-000000000203";
    const records = [
      [typeId, "parent", "Ada"],
      [colleague, "colleague", "Grace"],
      [typeId, "parent", "Charles"],
      [colleague, "colleague", "Alan"],
      [friend, "friend", "Dorothy"],
      [typeId, "parent", "Mary"],
      [colleague, "colleague", "Katherine"],
      [neighbor, "neighbor", "Emmy"],
    ].map(([relationshipTypeId, label, name], index) => {
      const id = `00000000-0000-4000-8000-${
        String(index + 400).padStart(12, "0")
      }`;
      return {
        ...relationship,
        display: { label, name, personId: id, relationshipId: id },
        id,
        relationshipTypeId,
        toPersonId: id,
      };
    });
    stubApi(routes({ [LIST]: listed(records) }));
    await mount();

    const groups = list().querySelectorAll<HTMLLIElement>(
      ":scope > [data-relationship-group]",
    );
    expect([...groups].map((group) => group.firstElementChild?.textContent))
      .toEqual(["parent (3)", "colleague (3)", "friend (1)", "neighbor (1)"]);
    expect(groups[3]?.hidden).toBe(true);
    expect([...list().children].every((child) => child.tagName === "LI"))
      .toBe(true);
    const rows = [
      ...list().querySelectorAll<HTMLLIElement>("[data-relationship-id]"),
    ];
    expect(rows).toHaveLength(8);
    expect(rows.filter((row) => row.hidden)).toHaveLength(3);
    expect(rows.find((row) => row.textContent?.includes("Dorothy"))?.hidden)
      .toBe(false);
    expect(rows.find((row) => row.textContent?.includes("Mary"))?.hidden)
      .toBe(true);
    const expander = block().getByRole("button", {
      name: "+ 3 more relationships",
    });
    expect(expander.closest("li")?.className).toBe(
      "relationship-summary-expander",
    );
    expect(expander.hasAttribute("aria-label")).toBe(false);
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(expander);
    expect(
      [...list().querySelectorAll<HTMLLIElement>("[data-relationship-id]")]
        .filter((row) => row.hidden),
    ).toHaveLength(0);
    expect(groups[3]?.hidden).toBe(false);
    expect(expander.getAttribute("aria-expanded")).toBe("true");
    expect(expander.textContent).toBe("Show fewer relationships");
  });

  it("separates opposite directional labels for one relationship type", async () => {
    shell();
    const inverseId = "00000000-0000-4000-8000-000000000401";
    stubApi(routes({
      [LIST]: listed([relationship, {
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
      }]),
    }));
    await mount();
    expect(
      [
        ...list().querySelectorAll(
          ":scope > [data-relationship-group] > :first-child",
        ),
      ]
        .map((label) => label.textContent),
    ).toEqual(["parent (1)", "child (1)"]);
  });

  it("keeps the empty relationship list as one direct list item", async () => {
    shell();
    stubApi(routes());
    await mount();
    expect(list().children).toHaveLength(1);
    expect(list().firstElementChild?.tagName).toBe("LI");
    expect(list().textContent).toBe("No relationships saved.");
    // An empty summary leaves the line empty, so the rail can collapse it.
    expect(state().childNodes).toHaveLength(0);
    expect(state().nextElementSibling).toBe(list());
    expect(summary.railEmpty("relationships")).toBe(true);
    expect(summary.railCount("relationships")).toBe("0");
  });

  it("keeps grouped relationship editor failures in the section state", async () => {
    shell();
    const conflict = (detail: string) =>
      problemResponse(409, { code: "relationship_conflict", detail });
    stubApi(routes({
      [LIST]: listed([relationship]),
      [UNLINK]: [conflict("Unlink conflicted."), unreachable],
      [UPDATE]: [conflict("Update conflicted."), unreachable],
    }));
    await mount();
    const save = rowButton("Save relationship with Ada Lovelace");
    fireEvent.click(save);
    await waitFor(() => expect(state().textContent).toBe("Update conflicted."));
    expect(document.activeElement).toBe(state());
    fireEvent.click(save);
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Relationship change is temporarily unavailable.",
      )
    );
    const unlink = rowButton("Unlink Ada Lovelace");
    fireEvent.click(unlink);
    await waitFor(() => expect(state().textContent).toBe("Unlink conflicted."));
    fireEvent.click(unlink);
    await waitFor(() =>
      expect(state().textContent).toBe("Unlink is temporarily unavailable.")
    );
    expect(state().hasAttribute("data-rail-summary")).toBe(false);
  });

  it("loads bounded continuation pages without replacing the profile DOM", async () => {
    shell();
    const api = stubApi(routes({
      [`${LIST}?cursor=next-page`]: listed(),
      [LIST]: listed([], "ready", { nextCursor: "next-page" }),
    }));
    await mount();
    const next = byId("relationships-load-more");
    expect(next.hidden).toBe(false);
    const heading = section().querySelector("header");
    fireEvent.click(next);
    expect(next.disabled).toBe(true);
    await waitFor(() => expect(next.hidden).toBe(true));
    const continuation = reads(api, `/api/v1/people/${personId}/relationships`)
      .at(-1)!.url;
    expect(continuation.searchParams.get("cursor")).toBe("next-page");
    expect(continuation.searchParams.get("limit")).toBe("20");
    expect(section().querySelector("header")).toBe(heading);
  });

  it("keeps three relationship pages to one fixed DOM window and one batched display projection", async () => {
    shell();
    const page = (start: number) =>
      Array.from({ length: 20 }, (_, offset) => {
        const id = `00000000-0000-4000-8000-${
          String(start + offset).padStart(12, "0")
        }`;
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
    const api = stubApi({
      [TYPES]: types(),
      [`${LIST}?cursor=page-2`]: listed(page(21), "ready", {
        nextCursor: "page-3",
      }),
      [`${LIST}?cursor=page-3`]: listed(page(41)),
      [LIST]: listed(page(1), "ready", { nextCursor: "page-2" }),
    });
    await mount();
    const next = byId("relationships-load-more");
    fireEvent.click(next);
    await waitFor(() => expect(list().textContent).toContain("Person 21"));
    fireEvent.click(next);
    await waitFor(() => expect(list().textContent).toContain("Person 41"));
    expect(document.activeElement).toBe(list());
    expect(list().querySelectorAll("[data-relationship-id]")).toHaveLength(20);
    const previous = byId("relationships-previous");
    expect(previous.hidden).toBe(false);
    fireEvent.click(previous);
    await waitFor(() => expect(list().textContent).toContain("Person 21"));
    expect(document.activeElement).toBe(list());
    fireEvent.click(previous);
    await waitFor(() =>
      expect(within(list()).getAllByRole("link")[0]?.textContent).toBe(
        "Person 1",
      )
    );
    expect(previous.hidden).toBe(true);
    expect(document.activeElement).toBe(list());
    expect(reads(api, "/api/v1/people")).toHaveLength(0);
  });

  it("pages type search while preserving active and archived current descriptors", async () => {
    shell();
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
    const api = stubApi({
      [TYPES]: ({ url }) => {
        const selected = (url.searchParams.get("selected") ?? "").split(",");
        const hydrated = [parentType, tail, historical].filter((type) =>
          selected.includes(type.id)
        );
        const cursor = url.searchParams.get("cursor");
        if (cursor === "type-page-2") {
          return types([tail], {
            nextCursor: "type-page-3",
            selected: hydrated,
          });
        }
        if (cursor === "type-page-3") return types([], { selected: hydrated });
        return types([parentType], {
          nextCursor: "type-page-2",
          selected: hydrated,
        });
      },
      [LIST]: listed([{
        ...relationship,
        forwardLabel: tail.forwardLabel,
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
      }]),
    });
    await mount();
    const [activeEditor, archivedEditor] = [
      ...list().querySelectorAll<HTMLSelectElement>("select"),
    ];
    expect(activeEditor!.value).toBe(tailTypeId);
    expect(activeEditor!.selectedOptions[0]?.disabled).toBe(false);
    expect(archivedEditor!.value).toBe(archivedTypeId);
    expect(archivedEditor!.selectedOptions[0]?.disabled).toBe(true);
    expect(
      rowButton("Save relationship with Archived connection").hasAttribute(
        "disabled",
      ),
    ).toBe(true);
    const typeQueries = () =>
      reads(api, "/api/v1/relationship-types").map((request) =>
        request.url.searchParams
      );
    const typeNext = byId("relationship-types-next");
    openWithType();
    fireEvent.click(typeNext);
    await waitFor(() =>
      expect(typeQueries().at(-1)?.get("cursor")).toBe("type-page-2")
    );
    await waitFor(() =>
      expect(typeSelect().textContent).toContain("Tail active")
    );
    expect(typeSelect().value).toBe(typeId);
    fireEvent.click(typeNext);
    await waitFor(() =>
      expect(typeQueries().at(-1)?.get("cursor")).toBe("type-page-3")
    );
    expect(typeQueries().at(-1)?.get("selected")).toContain(archivedTypeId);
    expect(typeQueries().at(-1)?.get("selected")).toContain(tailTypeId);

    const typePrevious = byId("relationship-types-previous");
    await waitFor(() => expect(typePrevious.hidden).toBe(false));
    fireEvent.click(typePrevious);
    await waitFor(() =>
      expect(typeQueries().at(-1)?.get("cursor")).toBe("type-page-2")
    );
    await waitFor(() => expect(typeNext.hidden).toBe(false));
    fireEvent.click(typePrevious);
    await waitFor(() =>
      expect(typeQueries().at(-1)?.has("cursor")).toBe(false)
    );
    await waitFor(() =>
      expect(typeSelect().textContent).toContain("parent / child")
    );
    await waitFor(() => expect(typePrevious.hidden).toBe(true));
    expect(document.activeElement).toBe(typeSelect());

    const typeSearch = byId<HTMLInputElement>("relationship-type-search");
    typeSearch.value = "  tail  ";
    fireEvent.click(byId("relationship-type-search-button"));
    await waitFor(() =>
      expect(typeQueries().at(-1)?.get("search")).toBe("tail")
    );
    expect(typeQueries().at(-1)?.has("cursor")).toBe(false);
    await waitFor(() => expect(typePrevious.hidden).toBe(true));
    await waitFor(() => expect(list().querySelector("select")).not.toBeNull());
    const refreshed = list().querySelector<HTMLSelectElement>("select")!;
    expect(refreshed.selectedOptions[0]?.disabled).toBe(false);
    expect(
      rowButton("Save relationship with Ada Lovelace").hasAttribute("disabled"),
    ).toBe(false);

    fireEvent.change(typeSelect(), { target: { value: archivedTypeId } });
    fireEvent.input(givenName(), { target: { value: "No orphan" } });
    fireEvent.submit(form());
    expect(state().textContent).toBe("Choose an active relationship type.");
    expect(writes(api)).toHaveLength(0);
  });

  it.each([
    ["search", "ready"],
    ["search", "error"],
    ["next", "ready"],
    ["next", "error"],
  ])(
    "APR-002 reserves the relationship editor during type %s and unlocks on %s",
    async (action, outcome) => {
      shell();
      const pending = deferred<Response>();
      stubApi({
        [TYPES]: [
          types([], { nextCursor: "next-types" }),
          pending.promise,
        ],
        [LIST]: listed(),
      });
      await mount();
      mountUnsavedChangesGuard({
        confirmMessage: "Discard?",
        root: document.body,
      });
      const confirm = vi.fn(() => false);
      vi.stubGlobal("confirm", confirm);
      fireEvent.click(add());
      const draft = givenName();
      draft.focus();
      fireEvent.input(draft, {
        target: { value: "Keep this relationship draft" },
      });
      document.body.insertAdjacentHTML(
        "beforeend",
        '<button id="foreign-add">Open fact</button><form id="foreign" hidden><input name="value"></form>',
      );
      const foreign = element("#foreign input").closest("form")!;
      const openForeign = element<HTMLButtonElement>("#foreign-add");
      registerRailEditors([foreign], () => {
        foreign.hidden = true;
        foreign.reset();
      });
      openForeign.onclick = () => {
        if (!requestRailEditorOpen(foreign)) return;
        foreign.hidden = false;
        foreign.querySelector("input")!.focus();
      };
      const trigger = byId(
        action === "search"
          ? "relationship-type-search-button"
          : "relationship-types-next",
      );
      trigger.focus();
      fireEvent.click(trigger);
      expect(form().hidden).toBe(true);
      expect(form().inert).toBe(true);
      openForeign.focus();
      act(() => openForeign.click());
      expect(foreign.hidden).toBe(true);
      expect(form().inert).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
      await act(async () => {
        pending.resolve(
          outcome === "ready"
            ? types([parentType])
            : problemResponse(503, { detail: "Type lookup failed" }),
        );
        await pending.promise;
      });
      await waitFor(() => expect(form().inert).toBe(false));
      expect(draft.value).toBe("Keep this relationship draft");
      expect(foreign.hidden).toBe(true);
      expect(form().hidden).toBe(outcome === "error");
      if (outcome === "ready") {
        expect(document.activeElement).toBe(typeSelect());
        let decline = true;
        const offered = discardRequests(() => decline);
        act(() => openForeign.click());
        expect(offered.at(-1)).toContain(form());
        expect(foreign.hidden).toBe(true);
        expect(form().hidden).toBe(false);
        decline = false;
      } else {
        expect(state().textContent).toBe("Type lookup failed");
      }
      act(() => openForeign.click());
      expect(foreign.hidden).toBe(false);
      expect(form().hidden).toBe(true);
      expect(document.activeElement).toBe(foreign.querySelector("input"));
    },
  );

  it("APR-002 starts no second type read while one holds the editor", async () => {
    shell();
    const pending = deferred<Response>();
    const api = stubApi({
      [TYPES]: [types([], { nextCursor: "next-types" }), pending.promise],
      [LIST]: listed(),
    });
    await mount();
    fireEvent.click(add());
    const next = byId("relationship-types-next");
    fireEvent.click(next);
    expect(next.disabled).toBe(true);
    fireEvent.click(next);
    expect(reads(api, "/api/v1/relationship-types")).toHaveLength(2);
    expect(byId("relationships-load-more").disabled).toBe(true);
    expect(form().hidden).toBe(true);
    expect(form().inert).toBe(true);
    expect(requestRailEditorOpen(document.createElement("form"))).toBe(false);
    await act(async () => {
      pending.resolve(types());
      await pending.promise;
    });
    await waitFor(() => expect(form().inert).toBe(false));
    expect(form().hidden).toBe(false);
  });

  it("APR-002 leaves other editors available during an initial type load", async () => {
    shell();
    const pending = deferred<Response>();
    stubApi({ [TYPES]: () => pending.promise, [LIST]: listed() });
    const mounted = mountLater();
    expect(form().inert).toBe(false);
    expect(requestRailEditorOpen(document.createElement("form"))).toBe(true);
    await act(async () => {
      pending.resolve(types());
      await mounted.settled;
    });
    expect(form().inert).toBe(false);
    expect(form().hidden).toBe(true);
  });

  it.each(["archive", "remount"])(
    "APR-002 releases an obsolete type-load lock on %s",
    async (action) => {
      shell();
      const pending = deferred<Response>();
      stubApi({
        [TYPES]: [
          types([], { nextCursor: "next-types" }),
          pending.promise,
          types(),
        ],
        [LIST]: listed(),
      });
      const unmount = await mount();
      fireEvent.click(add());
      fireEvent.click(byId("relationship-types-next"));
      expect(form().inert).toBe(true);
      if (action === "archive") archive();
      else {
        unmount();
        // The island took the shell over; a new mount starts from a new shell.
        shell();
        await mount({ hidden: false });
      }
      expect(form().inert).toBe(false);
      expect(form().hidden).toBe(true);
      expect(requestRailEditorOpen(document.createElement("form"))).toBe(true);
      await act(async () => {
        pending.resolve(types([parentType]));
        await pending.promise;
      });
      expect(form().inert).toBe(false);
      expect(form().hidden).toBe(true);
      expect(typeSelect().textContent).not.toContain("parent / child");
    },
  );

  it("restores an open relationship draft after a successful type page load", async () => {
    shell();
    const page = deferred<Response>();
    stubApi({
      [TYPES]: [types([], { nextCursor: "next-types" }), page.promise],
      [LIST]: listed(),
    });
    await mount();
    fireEvent.click(add());
    const draft = givenName();
    draft.value = "Retained draft";
    fireEvent.click(byId("relationship-types-next"));
    expect(form().hidden).toBe(true);
    expect(draft.disabled).toBe(true);
    expect(draft.value).toBe("Retained draft");
    await act(async () => {
      page.resolve(types([{
        archived: false,
        forwardLabel: "mentor",
        id: typeId,
        reverseLabel: "protege",
      }]));
      await page.promise;
    });
    await waitFor(() => expect(form().hidden).toBe(false));
    expect(draft.disabled).toBe(false);
    expect(draft.value).toBe("Retained draft");
    expect(typeSelect().textContent).toContain("mentor / protege");
    expect(document.activeElement).toBe(typeSelect());
  });

  it("supports keyboard-local cancel, bounded search, validation, and missing markup", async () => {
    drawShell('<main id="main-content"></main>');
    const idle = stubApi();
    await mount();
    expect(idle.fetch).not.toHaveBeenCalled();
    shell();
    const api = stubApi(routes({
      [PEOPLE]: people({ givenName: "", id: targetId, nickname: "Mystery" }, {
        givenName: "",
        id: "00000000-0000-4000-8000-000000000102",
      }),
    }));
    await mount();
    fireEvent.click(add());
    fireEvent.click(byId("relationship-cancel"));
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(add());
    fireEvent.click(add());
    fireEvent.submit(form());
    expect(state().textContent).toBe(
      "Choose or create another person and select a relationship type.",
    );
    expect(document.activeElement).toBe(state());
    searchInput().focus();
    searchFor("Mystery");
    await waitFor(() => expect(peopleResults()).toContain("Mystery"));
    expect(peopleResults()).toContain("Unnamed person");
    expect(document.activeElement).toBe(searchInput());
    expect(
      Object.fromEntries(reads(api, "/api/v1/people")[0]!.url.searchParams),
    )
      .toEqual({ excludePersonId: personId, limit: "20", search: "Mystery" });
  });

  it("finds people while typing and selects a result directly without navigation", async () => {
    shell();
    const api = stubApi(routes({
      [PEOPLE]: people({
        givenName: "Charles",
        familyName: "Babbage",
        id: targetId,
      }),
    }));
    await mount();
    fireEvent.click(add());
    const search = within(form()).getByLabelText<HTMLInputElement>(
      "Search people",
    );
    search.focus();
    fireEvent.change(search, { target: { value: "Charles" } });
    expect(reads(api, "/api/v1/people")).toHaveLength(0);
    const result = await within(form()).findByRole("option", {
      name: "Charles Babbage",
    });
    expect(document.activeElement).toBe(search);
    expect(within(form()).queryByRole("button", { name: "Search people" }))
      .toBeNull();
    fireEvent.click(result);
    expect(search.value).toBe("Charles Babbage");
    expect(new FormData(form()).get("targetPersonId")).toBe(targetId);
    expect(writes(api)).toHaveLength(0);
  });

  it("selects by keyboard, clears a selection when edited, and resets the picker on close", async () => {
    shell();
    const api = stubApi(routes({
      [PEOPLE]: [people({ givenName: "Grace", id: targetId }), people()],
    }));
    await mount();
    openWithType();
    searchInput().focus();
    searchFor("Gra");
    await within(form()).findByRole("option", { name: "Grace" });
    await expectNoAxeViolations(section());
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(targetInput().value).toBe(targetId);
    expect(searchInput().value).toBe("Grace");
    expect(byId("relationship-people-status").textContent).toBe(
      "Selected: Grace",
    );
    expect(writes(api)).toHaveLength(0);
    fireEvent.change(typeSelect(), { target: { value: typeId } });
    expect(targetInput().value).toBe(targetId);
    searchFor("Nobody");
    expect(targetInput().value).toBe("");
    await waitFor(() =>
      expect(byId("relationship-people-status").textContent).toContain(
        "No matching people",
      )
    );
    await expectNoAxeViolations(section());
    searchFor("");
    expect(byId("relationship-people-status").textContent).toContain(
      "Type a name",
    );
    fireEvent.click(byId("relationship-cancel"));
    fireEvent.click(add());
    expect(searchInput().value).toBe("");
    expect(targetInput().value).toBe("");
    expect(peopleResults()).toBe("");
    expect(reads(api, "/api/v1/people")).toHaveLength(2);
  });

  it("debounces rapid edits and retires a pending answer before the next debounce", async () => {
    shell();
    const pending = deferred<Response>();
    const api = stubApi(
      routes({ [PEOPLE]: [() => pending.promise, people()] }),
    );
    await mount();
    fireEvent.click(add());
    searchFor("A");
    searchFor("Al");
    searchFor("Alice");
    await waitFor(() => expect(reads(api, "/api/v1/people")).toHaveLength(1));
    expect(reads(api, "/api/v1/people")[0]!.url.searchParams.get("search"))
      .toBe("Alice");
    searchFor("Bob");
    await act(async () => {
      pending.resolve(people({ givenName: "Alice", id: targetId }));
      await pending.promise;
    });
    expect(peopleResults()).not.toContain("Alice");
    await waitFor(() => expect(reads(api, "/api/v1/people")).toHaveLength(2));
    await waitFor(() =>
      expect(byId("relationship-people-status").textContent).toContain(
        "No matching people",
      )
    );
    searchFor("Canceled query");
    fireEvent.click(byId("relationship-cancel"));
    fireEvent.click(add());
    expect(searchInput().value).toBe("");
  });

  it("keeps only the latest existing-person search response", async () => {
    shell();
    const older = deferred<Response>();
    const newer = deferred<Response>();
    const api = stubApi(
      routes({ [PEOPLE]: [() => older.promise, () => newer.promise] }),
    );
    await mount();
    fireEvent.click(add());
    const submit = within(form()).getByRole<HTMLButtonElement>("button", {
      name: "Save relationship",
    });
    searchFor("Private Alice");
    await waitFor(() => expect(reads(api, "/api/v1/people")).toHaveLength(1));
    expect(searchInput().disabled).toBe(false);
    expect(submit.disabled).toBe(true);
    expect(givenName().disabled).toBe(true);
    expect(state().textContent).toBe("Searching people…");
    expect(section().dataset.sectionState).toBe("loading");
    searchFor("Bob");
    await waitFor(() => expect(reads(api, "/api/v1/people")).toHaveLength(2));
    await act(async () => {
      newer.resolve(people({ givenName: "Bob", id: targetId }));
      await newer.promise;
    });
    await waitFor(() => expect(peopleResults()).toContain("Bob"));
    await act(async () => {
      older.resolve(people({
        givenName: "Private Alice",
        id: "00000000-0000-4000-8000-000000000199",
      }));
      await older.promise;
    });
    expect(peopleResults()).toContain("Bob");
    expect(peopleResults()).not.toContain("Private Alice");
    expect(searchInput().disabled).toBe(false);
    expect(submit.disabled).toBe(false);
  });

  it("says so when a people search fails, keeping the typed search", async () => {
    shell();
    stubApi(
      routes({
        [PEOPLE]: [unreachable, people({ givenName: "Charles", id: targetId })],
      }),
    );
    await mount();
    fireEvent.click(add());
    const search = byId<HTMLInputElement>("relationship-person-search");
    search.focus();
    searchFor("Charles");
    await waitFor(() =>
      expect(state().textContent).toBe(
        "People search is temporarily unavailable. Try again.",
      )
    );
    expect(document.activeElement).toBe(search);
    expect(section().dataset.sectionState).toBe("error");
    expect(searchInput().disabled).toBe(false);
    expect(search.value).toBe("Charles");
    searchFor("Charle");
    await waitFor(() => expect(peopleResults()).toContain("Charles"));
    expect(section().dataset.sectionState).toBe("ready");
  });

  it("does not repopulate people after an authoritative hidden response", async () => {
    shell();
    const pending = deferred<Response>();
    const api = stubApi(routes({
      [LIST]: [listed([relationship]), listed([], "hidden")],
      [PEOPLE]: () => pending.promise,
      [UPDATE]: changed(),
    }));
    await mount();
    fireEvent.click(add());
    searchFor();
    await waitFor(() => expect(reads(api, "/api/v1/people")).toHaveLength(1));
    fireEvent.click(rowButton("Save relationship with Ada Lovelace"));
    await waitFor(() => expect(section().hidden).toBe(true));
    expect(document.activeElement).toBe(element("#main-content"));
    await act(async () => {
      pending.resolve(people({
        givenName: "Hidden identity",
        id: "00000000-0000-4000-8000-000000000198",
      }));
      await pending.promise;
    });
    expect(peopleResults()).not.toContain("Hidden identity");
    expect(section().hidden).toBe(true);
    expect(summary.railCount("relationships")).toBeUndefined();
    expect(summary.railEmpty("relationships")).toBe(false);
  });

  it("does not let a prior mount's people search reach a fresh editor", async () => {
    shell();
    const pending = deferred<Response>();
    const api = stubApi(routes({ [PEOPLE]: () => pending.promise }));
    const unmount = await mount();
    fireEvent.click(add());
    searchFor();
    await waitFor(() => expect(reads(api, "/api/v1/people")).toHaveLength(1));
    unmount();
    // The island took the shell over; a new mount starts from a new shell.
    shell();
    await mount();
    await act(async () => {
      pending.resolve(people({
        givenName: "Prior mount identity",
        id: "00000000-0000-4000-8000-000000000197",
      }));
      await pending.promise;
    });
    expect(peopleResults()).not.toContain("Prior mount identity");
  });

  it("renders inverse-aware people and locally refreshes create, update, and unlink", async () => {
    shell();
    const api = stubApi(routes({
      [LIST]: [listed([relationship]), listed([relationship]), listed()],
      [UNLINK]: deleted(),
      [UPDATE]: changed(),
    }));
    await mount();
    expect(list().textContent).toContain("parent: Ada Lovelace");
    expect(
      within(list()).getByRole("link", { name: "Ada Lovelace" }).getAttribute(
        "href",
      ),
    ).toBe(`/app/people/${targetId}`);
    const save = rowButton("Save relationship with Ada Lovelace");
    expect(save.className).toBe(buttonVariants());
    fireEvent.change(
      block().getByLabelText("Relationship type for Ada Lovelace"),
      { target: { value: typeId } },
    );
    fireEvent.click(save);
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Relationship updated on both person workspaces.",
      )
    );
    expect(document.activeElement).toBe(state());
    expect(api.bodies()[0]).toEqual({
      expectedUpdatedAt: updatedAt,
      relationshipTypeId: typeId,
    });
    const unlink = rowButton("Unlink Ada Lovelace");
    expect(unlink.className).toBe(buttonVariants({
      className: "profile-rail-remove",
      variant: "destructive",
    }));
    fireEvent.click(unlink);
    await waitFor(() =>
      expect(state().textContent).toBe(
        "People unlinked. Neither person was deleted.",
      )
    );
    expect(list().querySelector(`[data-relationship-id="${relationshipId}"]`))
      .toBeNull();
    expect(list().textContent).toBe("No relationships saved.");
    // The rail hears the count from a passive effect, which can commit after
    // the state line the wait above saw (REL-071).
    await waitFor(() => {
      expect(summary.railCount("relationships")).toBe("0");
      expect(summary.railEmpty("relationships")).toBe(true);
    });
    expect(document.activeElement).toBe(state());
    const unlinks = api.requests().filter((request) =>
      request.method === "DELETE"
    );
    expect(unlinks.map((request) => request.url.pathname)).toEqual([
      `/api/v1/people/${personId}/relationships/${relationshipId}`,
    ]);
    expect(api.requests().map((request) => request.method)).toContain("PATCH");
  });

  it("keeps the current mount authoritative across an unlink settling after a remount", async () => {
    shell();
    const deletion = deferred<Response>();
    stubApi(routes({
      [LIST]: [listed([relationship]), listed(), listed()],
      [UNLINK]: () => deletion.promise,
    }));
    const unmount = await mount();
    fireEvent.click(rowButton("Unlink Ada Lovelace"));
    unmount();
    // The island took the shell over; a new mount starts from a new shell.
    shell();
    await mount();
    add().focus();
    await act(async () => {
      deletion.resolve(deleted());
      await deletion.promise;
    });
    expect(list().textContent).toBe("No relationships saved.");
    expect(state().textContent).toBe("");
    expect(document.activeElement).toBe(add());
  });

  it("creates a related person and relationship through the atomic coordinator", async () => {
    shell();
    const api = stubApi(routes({
      [LIST]: [listed(), listed([relationship])],
      [RELATED]: jsonResponse({
        affectedPersonIds: [personId, targetId],
        inverse: { label: "child", personId, relationshipId },
        person: { givenName: "Grace", id: targetId, isPartial: false },
        relationship,
        status: "created",
      }, 201),
    }));
    await mount();
    openWithType();
    fireEvent.input(givenName(), { target: { value: "Grace" } });
    fireEvent.input(
      within(form()).getByLabelText("New person family name"),
      { target: { value: " Hopper " } },
    );
    fireEvent.submit(form());
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Related person and relationship saved together on both person workspaces.",
      )
    );
    expect(writes(api)[0]?.url.pathname).toBe(
      `/api/v1/people/${personId}/relationships/related-person`,
    );
    expect(writes(api)[0]?.body).toEqual({
      person: { familyName: "Hopper", givenName: "Grace", isPartial: false },
      relationshipTypeId: typeId,
    });
    expect(form().hidden).toBe(true);
    expect(list().textContent).toContain("parent: Ada Lovelace");
  });

  it("creates a relationship with an existing person, or says it already exists", async () => {
    shell();
    const api = stubApi(routes({
      [CREATE]: [
        changed("created"),
        changed("existing"),
        unreachable,
      ],
      [LIST]: listed([relationship]),
      [PEOPLE]: people({
        familyName: "Babbage",
        givenName: "Charles",
        id: targetId,
      }),
    }));
    await mount();
    for (
      const notice of [
        "Relationship saved on both person workspaces.",
        "That relationship already exists.",
        "Relationship creation is temporarily unavailable.",
      ]
    ) {
      openWithType();
      searchFor();
      await waitFor(() => expect(peopleResults()).toContain("Charles Babbage"));
      choosePerson("Charles Babbage");
      fireEvent.submit(form());
      await waitFor(() => expect(state().textContent).toBe(notice));
      expect(document.activeElement).toBe(state());
      if (form().hidden === false) break;
    }
    expect(writes(api)[0]?.body).toEqual({
      relationshipTypeId: typeId,
      targetPersonId: targetId,
    });
    expect(writes(api)).toHaveLength(3);
    expect(form().hidden).toBe(false);
  });

  it("preserves a possible-duplicate draft and requires an explicit choice before override", async () => {
    shell();
    const duplicate = problemResponse(409, {
      code: "related_person_possible_duplicate",
      detail:
        "Choose the existing person or explicitly confirm creating another.",
    });
    const api = stubApi(routes({
      [LIST]: [listed(), listed([relationship])],
      [PEOPLE]: people({ givenName: "Grace", id: targetId }),
      [RELATED]: [
        duplicate,
        duplicate,
        jsonResponse({
          affectedPersonIds: [personId, targetId],
          inverse: { label: "child", personId, relationshipId },
          person: { givenName: "Grace", id: targetId, isPartial: false },
          relationship,
          status: "created",
        }, 201),
      ],
    }));
    await mount();
    openWithType();
    fireEvent.input(givenName(), { target: { value: "Grace" } });
    fireEvent.submit(form());
    const choices = element("#relationship-duplicate-choices");
    await waitFor(() => expect(choices.hidden).toBe(false));
    expect(
      block().getByRole("group", { name: "Possible duplicate person choices" }),
    ).toBe(choices);
    expect(state().textContent).toBe(
      "A person with this name may already exist. Select the existing person or explicitly create another.",
    );
    expect(givenName().value).toBe("Grace");
    expect(document.activeElement).toBe(byId("relationship-select-existing"));
    expect(
      (writes(api)[0]?.body as { person: Record<string, unknown> }).person
        .duplicateOverride,
    ).toBeUndefined();
    fireEvent.click(byId("relationship-select-existing"));
    expect(choices.hidden).toBe(true);
    await waitFor(() => expect(peopleResults()).toContain("Grace"));
    expect(document.activeElement).toBe(searchInput());
    expect(peopleResults()).toContain("Grace");
    expect(reads(api, "/api/v1/people")[0]?.url.searchParams.get("search"))
      .toBe("Grace");
    fireEvent.submit(form());
    await waitFor(() => expect(choices.hidden).toBe(false));
    fireEvent.click(byId("relationship-create-anyway"));
    await waitFor(() => expect(writes(api)).toHaveLength(3));
    expect(
      (writes(api)[2]?.body as { person: Record<string, unknown> }).person
        .duplicateOverride,
    ).toBe(true);
    await waitFor(() => expect(list().textContent).toContain("Ada Lovelace"));
  });

  it("says so when a related person cannot be created", async () => {
    shell();
    stubApi(routes({ [RELATED]: unreachable }));
    await mount();
    openWithType();
    fireEvent.input(givenName(), { target: { value: "Draft person" } });
    fireEvent.submit(form());
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Related person creation is temporarily unavailable.",
      )
    );
    expect(document.activeElement).toBe(state());
    expect(givenName().value).toBe("Draft person");
    fireEvent.change(typeSelect(), { target: { value: "" } });
    fireEvent.submit(form());
    expect(state().textContent).toBe("Choose an active relationship type.");
  });

  it("keeps hidden, archived, forbidden, and error states honest", async () => {
    shell();
    const idle = stubApi();
    await mount({ hidden: true });
    expect(section().hidden).toBe(true);
    expect(section().dataset.sectionState).toBe("hidden");
    expect(idle.fetch).not.toHaveBeenCalled();
    expect(summary.railCount("relationships")).toBeUndefined();
    expect(document.activeElement).toBe(element("#main-content"));

    shell();
    stubApi(routes({ [LIST]: listed([], "archived") }));
    await mount({ archived: true });
    expect(section().dataset.sectionState).toBe("read-only");
    expect(state().textContent).toBe(
      "Relationships are read-only because this person is archived.",
    );
    expect(add().hidden).toBe(true);
    expect(summary.railEmpty("relationships")).toBe(false);

    shell();
    stubApi(routes({ [LIST]: problemResponse(403) }));
    await mount();
    expect(section().dataset.sectionState).toBe("forbidden");
    expect(state().textContent).toBe(
      "Your active workspace no longer permits this action.",
    );

    shell();
    stubApi(routes({ [LIST]: problemResponse(500) }));
    await mount();
    expect(section().dataset.sectionState).toBe("error");
    expect(state().textContent).toBe(
      "This relationship section is temporarily unavailable. Try again.",
    );
    expect(section().textContent).not.toContain("Private failure details");
  });

  it("hydrates an archived related person without making the active profile read-only", async () => {
    shell();
    stubApi(routes({
      [LIST]: listed([{
        ...relationship,
        display: { ...relationship.display, name: undefined },
      }]),
    }));
    await mount();
    expect(list().textContent).toContain("Related person");
    expect(within(list()).queryByRole("link")).toBeNull();
    expect(section().dataset.sectionState).toBe("ready");
  });

  it("purges an authoritative hidden response and restores only after a fresh ready reload", async () => {
    shell();
    stubApi(routes({
      [LIST]: [listed([relationship]), listed([], "hidden")],
      [UPDATE]: changed(),
    }));
    const unmount = await mount();
    fireEvent.click(add());
    fireEvent.input(givenName(), { target: { value: "Sensitive draft" } });
    fireEvent.click(rowButton("Save relationship with Ada Lovelace"));
    await waitFor(() => expect(section().hidden).toBe(true));
    expect(section().dataset.sectionState).toBe("hidden");
    expect(list().children).toHaveLength(0);
    expect(givenName().value).toBe("");
    expect(add().hidden).toBe(true);
    expect(typeSelect().options).toHaveLength(1);
    expect(document.activeElement).toBe(element("#main-content"));

    unmount();

    // The island took the shell over; a new mount starts from a new shell.

    shell();
    stubApi(routes({ [LIST]: listed([relationship]) }));
    await mount();
    expect(section().hidden).toBe(false);
    expect(section().dataset.sectionState).toBe("ready");
    expect(list().querySelector("select")).not.toBeNull();
    expect(add().hidden).toBe(false);
  });

  it("honors authoritative archived read-only state and reenables writes only after ready reload", async () => {
    shell();
    stubApi(routes({
      [LIST]: [listed([relationship]), listed([relationship], "archived")],
      [UPDATE]: changed(),
    }));
    const unmount = await mount();
    fireEvent.click(add());
    fireEvent.click(rowButton("Save relationship with Ada Lovelace"));
    await waitFor(() =>
      expect(section().dataset.sectionState).toBe("read-only")
    );
    expect(section().textContent).toContain("parent: Ada Lovelace");
    expect(state().textContent).toContain("read-only");
    expect(section().textContent).not.toContain("Unlink Ada Lovelace");
    expect(list().querySelector("select")).toBeNull();
    expect(add().hidden).toBe(true);
    expect(
      [...form().elements].every((control) =>
        "disabled" in control && control.disabled === true
      ),
    ).toBe(true);
    expect(document.activeElement).toBe(state());

    unmount();

    // The island took the shell over; a new mount starts from a new shell.

    shell();
    stubApi(routes({ [LIST]: listed([relationship]) }));
    await mount();
    expect(section().dataset.sectionState).toBe("ready");
    expect(section().textContent).toContain("Unlink Ada Lovelace");
    expect(add().hidden).toBe(false);
  });

  it("keeps a relationship-type outage authoritative over a successful list read", async () => {
    shell();
    stubApi({
      [TYPES]: problemResponse(503, {
        code: "relationship_types_unavailable",
        detail: "Relationship types are temporarily unavailable.",
      }),
      [LIST]: listed([relationship]),
    });
    await mount();
    expect(section().dataset.sectionState).toBe("error");
    expect(state().textContent).toBe(
      "Relationship types are temporarily unavailable.",
    );
    expect(section().textContent).toContain("parent: Ada Lovelace");
    expect(section().textContent).not.toContain("Unlink Ada Lovelace");
    expect(add().hidden).toBe(true);
    expect(typeSelect().disabled).toBe(true);
    expect(document.activeElement).toBe(state());
    expect(summary.railEmpty("relationships")).toBe(false);
  });

  it("conceals the block when a next page answers hidden, dropping the draft", async () => {
    shell();
    stubApi(routes({
      [`${LIST}?cursor=next-page`]: listed([], "hidden"),
      [LIST]: listed([relationship], "ready", { nextCursor: "next-page" }),
    }));
    await mount();
    givenName().value = "Sensitive draft";
    fireEvent.click(byId("relationships-load-more"));
    await waitFor(() => expect(section().hidden).toBe(true));
    expect(list().children).toHaveLength(0);
    expect(givenName().value).toBe("");
    expect(byId("relationships-load-more").hidden).toBe(true);
    expect(byId("relationships-previous").hidden).toBe(true);
  });

  it("keeps a type page outage in the section without reserving the form", async () => {
    shell();
    stubApi({
      [TYPES]: [
        types([], { nextCursor: "next-types" }),
        problemResponse(503, {
          code: "relationship_types_unavailable",
          detail: "Relationship types are temporarily unavailable.",
        }),
      ],
      [LIST]: listed([relationship]),
    });
    await mount();
    fireEvent.click(add());
    fireEvent.click(byId("relationship-types-next"));
    await waitFor(() => expect(section().dataset.sectionState).toBe("error"));
    expect(form().inert).toBe(false);
    expect(form().hidden).toBe(true);
    expect(state().textContent).toBe(
      "Relationship types are temporarily unavailable.",
    );
  });

  it("conceals the block when a type page answers hidden", async () => {
    shell();
    stubApi({
      [TYPES]: [
        types([], { nextCursor: "next-types" }),
        jsonResponse({ options: [], selected: [], status: "hidden" }),
      ],
      [LIST]: listed([relationship]),
    });
    await mount();
    fireEvent.click(add());
    fireEvent.click(byId("relationship-types-next"));
    await waitFor(() => expect(section().hidden).toBe(true));
    expect(form().inert).toBe(false);
    expect(form().hidden).toBe(true);
    expect(list().children).toHaveLength(0);
  });

  it("archives immediately and suppresses pending type reads and people searches", async () => {
    shell();
    const found = deferred<Response>();
    const typePage = deferred<Response>();
    const api = stubApi({
      [TYPES]: [types([parentType]), () => typePage.promise],
      [LIST]: listed([relationship], "ready", {
        nextCursor: "next-relationships",
      }),
      [PEOPLE]: () => found.promise,
    });
    await mount();
    fireEvent.click(add());
    givenName().value = "Sensitive draft";
    searchFor();
    await waitFor(() => expect(reads(api, "/api/v1/people")).toHaveLength(1));
    fireEvent.click(byId("relationship-type-search-button"));

    archive();
    expect(section().dataset.sectionState).toBe("read-only");
    expect(section().textContent).toContain("parent: Ada Lovelace");
    expect(section().textContent).not.toContain("Unlink Ada Lovelace");
    expect(form().hidden).toBe(true);
    expect(givenName().value).toBe("");
    expect(add().hidden).toBe(true);
    expect(byId("relationships-load-more").hidden).toBe(true);

    await act(async () => {
      found.resolve(people({
        givenName: "Private identity",
        id: "00000000-0000-4000-8000-000000000999",
      }));
      typePage.resolve(types([{
        archived: false,
        forwardLabel: "private type",
        id: "00000000-0000-4000-8000-000000000998",
        reverseLabel: "private inverse",
      }]));
      await Promise.all([found.promise, typePage.promise]);
    });
    expect(section().dataset.sectionState).toBe("read-only");
    expect(section().textContent).not.toContain("Private identity");
    expect(section().textContent).not.toContain("private type");
    expect(section().innerHTML).not.toContain(
      "00000000-0000-4000-8000-000000000999",
    );
  });

  it("restores only after fresh relationship and type responses and ignores a stale archive", async () => {
    shell();
    const freshTypes = deferred<Response>();
    const freshList = deferred<Response>();
    stubApi({
      [TYPES]: [types(), () => freshTypes.promise],
      [LIST]: [listed([relationship]), () => freshList.promise],
    });
    await mount();
    archive();
    restore();
    expect(section().dataset.sectionState).toBe("loading");
    expect(add().hidden).toBe(true);
    expect(section().textContent).not.toContain("Unlink Ada Lovelace");
    await act(async () => {
      freshList.resolve(listed([relationship]));
      await freshList.promise;
    });
    expect(section().dataset.sectionState).toBe("loading");
    await act(async () => {
      freshTypes.resolve(types([parentType]));
      await freshTypes.promise;
    });
    await waitFor(() => expect(section().dataset.sectionState).toBe("ready"));
    expect(section().textContent).toContain("Unlink Ada Lovelace");
    expect(add().hidden).toBe(false);

    archive();
    expect(section().dataset.sectionState).toBe("ready");
    expect(section().textContent).toContain("Unlink Ada Lovelace");
  });

  it("ignores malformed and other-person lifecycle events", async () => {
    shell();
    const api = stubApi(routes());
    await mount({ person: targetId });
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
        {
          archived: false,
          personId: targetId,
          personUpdatedAt: "2026-08-16T12:03:00.000000Z",
          state: "archived",
        },
      ]
    ) lifecycle(detail);
    expect(section().dataset.sectionState).toBe("ready");
    expect(api.calls()).toHaveLength(2);
    lifecycle({
      archived: true,
      personId: targetId,
      personUpdatedAt: "2026-08-16T12:03:00.000000Z",
      state: "archived",
    });
    expect(section().dataset.sectionState).toBe("read-only");
  });

  it("drops a read a lifecycle change retired, and refuses a save while searching", async () => {
    shell();
    const firstTypes = deferred<Response>();
    const page = deferred<Response>();
    stubApi({
      [TYPES]: [
        () => firstTypes.promise,
        types([parentType]),
        types([parentType]),
      ],
      [`${LIST}?cursor=next-page`]: () => page.promise,
      [LIST]: listed([relationship], "ready", { nextCursor: "next-page" }),
      [PEOPLE]: () => new Promise<Response>(() => undefined),
    });
    const mounted = mountLater();
    archive();
    expect(section().dataset.sectionState).toBe("read-only");
    await act(async () => {
      firstTypes.resolve(types([parentType]));
      await mounted.settled;
    });
    expect(section().dataset.sectionState).toBe("read-only");
    restore();
    await waitFor(() => expect(section().dataset.sectionState).toBe("ready"));

    fireEvent.click(byId("relationships-load-more"));
    archive("2026-08-16T12:03:00.000000Z");
    await act(async () => {
      page.resolve(listed([], "hidden"));
      await page.promise;
    });
    expect(section().hidden).toBe(false);
    expect(section().dataset.sectionState).toBe("read-only");
    expect(document.activeElement).not.toBe(list());

    restore("2026-08-16T12:04:00.000000Z");
    await waitFor(() => expect(section().dataset.sectionState).toBe("ready"));
    fireEvent.click(add());
    searchFor();
    add().focus();
    fireEvent.submit(form());
    expect(document.activeElement).toBe(state());
    expect(state().textContent).toBe("Searching people…");
    // Without a possible duplicate, neither of its choices does anything.
    fireEvent.click(byId("relationship-select-existing"));
    fireEvent.click(byId("relationship-create-anyway"));
    expect(state().textContent).toBe("Searching people…");
  });

  it("works without the shell's heading or a known person revision", async () => {
    drawShell(`
      <main id="main-content" tabindex="-1">
        <section id="profile-section-relationships" class="profile-rail-block" data-profile-section="relationships">
          <form id="relationship-form" hidden></form>
        </section>
      </main>`);
    stubApi(routes({ [LIST]: listed([relationship]) }));
    await mountSection(
      mountPersonRelationships,
      sectionProps(),
      element("main"),
    );
    expect(section().dataset.sectionState).toBe("ready");
    expect(document.querySelector("#relationship-add")).toBeNull();
    lifecycle({
      archived: true,
      personId,
      personUpdatedAt: "2000-01-01T00:00:00Z",
      state: "archived",
    });
    expect(section().dataset.sectionState).toBe("read-only");
  });

  it("REL-039 announces its state without scrolling the page under a pending click", async () => {
    shell();
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    stubApi(routes({ [LIST]: listed([relationship], "archived") }));
    await mount({ archived: true });
    expect(section().dataset.sectionState).toBe("read-only");
    const onState = focus.mock.contexts.flatMap((context, index) =>
      context === state() ? [focus.mock.calls[index]![0]] : []
    );
    expect(onState.length).toBeGreaterThan(0);
    expect(onState).toEqual(onState.map(() => ({ preventScroll: true })));
    focus.mockRestore();
  });
});

describe("AUD-Q3 relationships from the person read", () => {
  const preloaded = (entry: unknown) =>
    sectionProps({
      initial: {
        ...personProfile({ person: { updatedAt } }),
        rail: { relationships: entry },
      } as ReturnType<typeof personProfile> & { readonly rail: never },
    });
  const mountWith = (entry: unknown) =>
    mountSection(mountPersonRelationships, preloaded(entry), element("main"));

  it("shows the relationships and types that came with the person read without reading them", async () => {
    shell();
    const api = stubApi({ [LIST]: unreachable, [TYPES]: unreachable });
    await mountWith({
      status: "ready",
      value: {
        list: { relationships: [relationship], status: "ready" },
        types: { options: [parentType], selected: [], status: "ready" },
      },
    });
    expect(section().dataset.sectionState).toBe("ready");
    expect(block().getAllByText("Ada Lovelace")).not.toHaveLength(0);
    expect(api.calls()).toEqual([]);
  });

  it("hides a hidden rail section", async () => {
    shell();
    const api = stubApi({ [LIST]: unreachable, [TYPES]: unreachable });
    await mountWith({ status: "hidden" });
    expect(section().hidden).toBe(true);
    expect(api.calls()).toEqual([]);
  });

  it("shows an unavailable rail section as its own error without reading", async () => {
    shell();
    const api = stubApi({ [LIST]: unreachable, [TYPES]: unreachable });
    await mountWith({ status: "unavailable" });
    expect(section().dataset.sectionState).toBe("error");
    expect(state().textContent).toContain(
      "This relationship section is temporarily unavailable.",
    );
    expect(api.calls()).toEqual([]);
  });
});
