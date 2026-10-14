import { describe, expect, it } from "vitest";
import {
  concealed,
  DUPLICATE_NOTICE,
  editorVisible,
  FORBIDDEN,
  groupRelationships,
  initialRelationshipsState,
  lifecycleChange,
  LIST_UNAVAILABLE,
  normalizeRevision,
  PEOPLE_UNAVAILABLE,
  personName,
  READ_ONLY,
  relatedName,
  relationshipsReducer,
  type RelationshipsState,
  relationshipsView,
  type Row,
  rowType,
  selectedTypeIds,
  summaryRowIds,
  typeChoices,
  TYPES_UNAVAILABLE,
  writesReady,
} from "./relationships.ts";

const personId = "00000000-0000-4000-8000-000000000100";
const typeId = "00000000-0000-4000-8000-000000000200";
const updatedAt = "2026-08-16T12:00:00.000000Z";

function row(
  id: string,
  label = "parent",
  relationshipTypeId = typeId,
): Row {
  const name = `Person ${id}`;
  return {
    createdAt: updatedAt,
    display: {
      label,
      name,
      personId: id,
      relationshipId: id,
    },
    forwardLabel: label,
    fromPersonId: personId,
    id,
    relationshipTypeArchived: false,
    relationshipTypeId,
    reverseLabel: "child",
    status: "active",
    toPersonId: id,
    updatedAt,
  };
}

const parent = {
  archived: false,
  forwardLabel: "parent",
  id: typeId,
  reverseLabel: "child",
};

const reduce = (
  state: RelationshipsState,
  ...actions: Parameters<typeof relationshipsReducer>[1][]
) => actions.reduce(relationshipsReducer, state);

const typesReady = {
  cursor: undefined,
  options: [parent],
  selected: [],
  status: "ready" as const,
  type: "types-loaded" as const,
};

const listReady = (rows: readonly Row[] = [], nextCursor?: string) => ({
  cursor: undefined,
  page: {
    relationships: rows,
    status: "ready" as const,
    ...(nextCursor ? { nextCursor } : {}),
  },
  type: "list-loaded" as const,
});

const ready = (rows: readonly Row[] = []) =>
  reduce(initialRelationshipsState(false), typesReady, listReady(rows));

describe("RELATIONSHIP-001 relationship presentation", () => {
  it("groups by type and direction and keeps five rows in view", () => {
    const rows = [
      row("a"),
      row("b", "colleague", "t2"),
      row("c"),
      row("d", "child"),
      row("e", "friend", "t3"),
      row("f"),
    ];
    expect(
      groupRelationships(rows).map((group) => [group.label, group.rows.length]),
    ).toEqual([["parent", 3], ["colleague", 1], ["child", 1], ["friend", 1]]);
    expect([...summaryRowIds(rows)]).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("names related people, directory people, and type choices", () => {
    expect(relatedName(row("a"))).toBe("Person a");
    const unnamed = row("a");
    const { name: _name, ...display } = unnamed.display;
    expect(relatedName({ ...unnamed, display })).toBe("Related person");
    expect(personName({ familyName: "Lovelace", givenName: "Ada" })).toBe(
      "Ada Lovelace",
    );
    expect(personName({ givenName: "", nickname: "Mystery" })).toBe("Mystery");
    expect(personName({ givenName: "" })).toBe("Unnamed person");
    const archived = { ...parent, archived: true, id: "old" };
    expect(typeChoices([parent], [archived], rowType(row("x")))).toEqual([
      { archived: false, id: typeId, label: "parent / child" },
      { archived: true, id: "old", label: "parent / child (archived)" },
    ]);
    expect(selectedTypeIds("", [row("a"), row("b", "x", "t2"), row("c")]))
      .toEqual([typeId, "t2"]);
    expect(selectedTypeIds("chosen", [])).toEqual(["chosen"]);
  });

  it("accepts only well-formed, newer lifecycle news for its person", () => {
    expect(normalizeRevision("2026-08-16T12:03:00Z")).toBe(
      "2026-08-16T12:03:00.000000Z",
    );
    expect(normalizeRevision("2026-08-16T12:03:00.12Z")).toBe(
      "2026-08-16T12:03:00.120000Z",
    );
    expect(normalizeRevision("not-a-revision")).toBeUndefined();
    expect(normalizeRevision("2026-08-16T12:03:00+01:00")).toBeUndefined();
    expect(normalizeRevision(7)).toBeUndefined();
    const detail = {
      archived: true,
      personId,
      personUpdatedAt: "2026-08-16T12:03:00.000000Z",
      state: "archived",
    };
    expect(lifecycleChange(detail, personId, updatedAt)).toEqual({
      archived: true,
      revision: "2026-08-16T12:03:00.000000Z",
    });
    expect(lifecycleChange(detail, personId, "")).toBeDefined();
    expect(lifecycleChange(detail, "other", updatedAt)).toBeUndefined();
    expect(
      lifecycleChange(detail, personId, "2026-08-16T12:03:00.000000Z"),
    ).toBeUndefined();
    expect(lifecycleChange({ ...detail, state: "deleted" }, personId, ""))
      .toBeUndefined();
    expect(lifecycleChange({ ...detail, archived: false }, personId, ""))
      .toBeUndefined();
    expect(
      lifecycleChange({ ...detail, personUpdatedAt: "x" }, personId, ""),
    ).toBeUndefined();
    expect(lifecycleChange(undefined, personId, "")).toBeUndefined();
    expect(
      lifecycleChange(
        {
          archived: false,
          personId,
          personUpdatedAt: "2026-08-16T12:04:00Z",
          state: "active",
        },
        personId,
        updatedAt,
      )?.archived,
    ).toBe(false);
  });
});

describe("GAP-031 relationships view", () => {
  it("loads, then shows a ready summary a rail may collapse", () => {
    const start = initialRelationshipsState(false);
    expect(relationshipsView(start)).toMatchObject({
      kind: "loading",
      sectionState: "loading",
      text: "Loading relationships…",
      writesReady: false,
    });
    expect(relationshipsView(ready())).toMatchObject({
      kind: "ready",
      summary: true,
      text: "",
      writesReady: true,
    });
    expect(relationshipsView(ready([row("a")])).text).toBe("1 relationship.");
    expect(relationshipsView(ready([row("a"), row("b")])).text).toBe(
      "2 relationships.",
    );
  });

  it("orders hidden, list failures, read-only, type outages, and searches", () => {
    const hidden = reduce(ready([row("a")]), {
      cursor: undefined,
      page: { relationships: [row("a")], status: "hidden" },
      type: "list-loaded",
    });
    expect(concealed(hidden)).toBe(true);
    expect(hidden.rows).toEqual([]);
    expect(relationshipsView(hidden)).toMatchObject({
      announce: "main",
      kind: "hidden",
      sectionState: "hidden",
    });
    const forbidden = reduce(ready(), { status: 403, type: "list-failed" });
    expect(relationshipsView(forbidden)).toMatchObject({
      announce: "state",
      kind: "forbidden",
      text: FORBIDDEN,
    });
    expect(
      relationshipsView(reduce(ready(), { status: 401, type: "list-failed" }))
        .kind,
    ).toBe("forbidden");
    expect(
      relationshipsView(reduce(ready(), { status: 500, type: "list-failed" })),
    ).toMatchObject({ kind: "error", text: LIST_UNAVAILABLE });
    const archived = reduce(initialRelationshipsState(true), typesReady, {
      cursor: undefined,
      page: { relationships: [row("a")], status: "archived" },
      type: "list-loaded",
    });
    expect(relationshipsView(archived)).toMatchObject({
      kind: "read-only",
      sectionState: "read-only",
      text: READ_ONLY,
      writesReady: false,
    });
    const outage = reduce(initialRelationshipsState(false), {
      detail: undefined,
      type: "types-failed",
    }, listReady([row("a")]));
    expect(relationshipsView(outage)).toMatchObject({
      kind: "types-error",
      sectionState: "error",
      text: TYPES_UNAVAILABLE,
    });
    const opened = reduce(ready(), { type: "open" });
    const searching = reduce(opened, { type: "people-loading" });
    expect(relationshipsView(searching)).toMatchObject({
      kind: "searching",
      peopleLocked: true,
      text: "Searching people…",
      writesReady: true,
    });
    expect(
      relationshipsView(reduce(searching, { type: "people-failed" })),
    ).toMatchObject({
      kind: "search-error",
      peopleLocked: true,
      text: PEOPLE_UNAVAILABLE,
    });
  });
});

describe("GAP-031 relationships reducer", () => {
  it("pages relationships, closing the editor while a page loads", () => {
    const opened = reduce(ready([row("a")]), { type: "open" });
    expect(editorVisible(opened)).toBe(true);
    const loading = reduce(opened, {
      previous: [undefined],
      type: "list-loading",
    });
    expect(loading).toMatchObject({
      editorOpen: false,
      list: "loading",
      previous: [undefined],
    });
    const next = reduce(loading, {
      cursor: "page-2",
      page: {
        nextCursor: "page-3",
        relationships: [row("b")],
        status: "ready",
      },
      type: "list-loaded",
    });
    expect(next).toMatchObject({
      cursor: "page-2",
      editorOpen: false,
      nextCursor: "page-3",
    });
  });

  it("announces a write's outcome only once the block is writable again", () => {
    const saved = reduce(ready(), {
      ...listReady([row("a")]),
      notice: "Relationship saved on both person workspaces.",
    });
    expect(saved.notice).toBe("Relationship saved on both person workspaces.");
    expect(saved.focus?.target).toBe("state");
    const archived = reduce(ready(), {
      cursor: undefined,
      notice: "Relationship saved on both person workspaces.",
      page: { relationships: [row("a")], status: "archived" },
      type: "list-loaded",
    });
    expect(archived.notice).toBeUndefined();
    expect(archived.focus).toBeUndefined();
    expect(reduce(saved, { type: "list-loading" }).notice).toBeUndefined();
  });

  it("reserves an open editor through a type read and restores it on success", () => {
    const opened = reduce(ready(), { type: "open" });
    const loading = reduce(opened, {
      previous: [undefined],
      search: "tail",
      type: "types-loading",
    });
    expect(loading).toMatchObject({
      editorOpen: true,
      reserved: true,
      typePrevious: [undefined],
      typeSearch: "tail",
    });
    expect(editorVisible(loading)).toBe(false);
    const again = reduce(loading, { type: "types-loading" });
    expect(again.reserved).toBe(true);
    const restored = reduce(again, {
      ...typesReady,
      cursor: "types-2",
      focus: "type",
      nextCursor: "types-3",
    });
    expect(restored).toMatchObject({
      reserved: false,
      typeCursor: "types-2",
      typeNextCursor: "types-3",
    });
    expect(editorVisible(restored)).toBe(true);
    expect(restored.focus?.target).toBe("type");
    const failed = reduce(loading, {
      detail: "Type lookup failed",
      type: "types-failed",
    });
    expect(failed).toMatchObject({
      editorOpen: false,
      reserved: false,
      typeProblem: "Type lookup failed",
    });
    const closed = reduce(ready(), { type: "types-loading" });
    expect(closed.reserved).toBe(false);
    expect(
      reduce(closed, { ...typesReady, focus: "type" }).focus,
    ).toBeDefined();
    const hidden = reduce(loading, { ...typesReady, status: "hidden" });
    expect(concealed(hidden)).toBe(true);
    expect(hidden.editorOpen).toBe(false);
  });

  it("offers found people only to an editor still waiting for them", () => {
    const opened = reduce(ready(), { type: "open" }, {
      targetId: "someone",
      type: "choose",
      typeId,
    });
    const found = reduce(opened, { type: "people-query", query: "Grace" }, {
      people: [{ id: "p", name: "Grace" }],
      type: "people-found",
    });
    expect(found).toMatchObject({
      candidates: [{ id: "p", name: "Grace" }],
      people: "idle",
      targetId: "",
      typeId,
    });
    expect(found.focus?.target).toBe(opened.focus?.target);
    expect(reduce(opened, { type: "people-failed" })).toBe(opened);
    const closedWhileSearching = reduce(
      opened,
      { type: "people-loading" },
      { type: "close" },
    );
    expect(closedWhileSearching.people).toBe("idle");
    const unseen = reduce(ready(), { type: "people-loading" }, {
      people: [{ id: "p", name: "Grace" }],
      type: "people-found",
    });
    expect(unseen.candidates).toEqual([]);
    expect(unseen.people).toBe("idle");
    const failed = reduce(opened, { type: "people-loading" }, {
      type: "people-failed",
    });
    expect(failed).toMatchObject({ candidates: [], people: "error" });
  });

  it("keeps a possible duplicate until it is dismissed or the editor closes", () => {
    const draft = {
      familyName: "",
      givenName: "Grace",
      relationshipTypeId: typeId,
    };
    const duplicate = reduce(ready(), { type: "open" }, {
      draft,
      type: "duplicate",
    });
    expect(duplicate).toMatchObject({
      duplicate: draft,
      notice: DUPLICATE_NOTICE,
    });
    expect(duplicate.focus?.target).toBe("select-existing");
    expect(reduce(duplicate, { type: "dismiss-duplicate" }).duplicate)
      .toBeUndefined();
    const cancelled = reduce(duplicate, { focus: true, type: "close" });
    expect(cancelled).toMatchObject({
      editorOpen: false,
      targetId: "",
      typeId: "",
    });
    expect(cancelled.duplicate).toBeUndefined();
    expect(cancelled.focus?.target).toBe("add");
    expect(reduce(duplicate, { target: "state", type: "focus" }).focus?.target)
      .toBe("state");
    expect(
      reduce(duplicate, { notice: "Nope", type: "notice" }).focus?.target,
    ).toBe("select-existing");
  });

  it("follows the lifecycle: archive shows the rows read-only, restore reads again", () => {
    const busy = reduce(
      ready([row("a")]),
      {
        ...listReady([row("a")], "next"),
      },
      { type: "open" },
      { targetId: "t", type: "choose" },
    );
    const archived = reduce(busy, { archived: true, type: "lifecycle" });
    expect(archived).toMatchObject({
      editorOpen: false,
      list: "ready",
      personStatus: "archived",
      previous: [],
      targetId: "",
      typeOptions: [],
      types: "loading",
    });
    expect(archived.nextCursor).toBeUndefined();
    expect(archived.rows).toHaveLength(1);
    expect(relationshipsView(archived).kind).toBe("read-only");
    const restored = reduce(archived, { archived: false, type: "lifecycle" });
    expect(restored).toMatchObject({ list: "loading", personStatus: "ready" });
    expect(writesReady(restored)).toBe(false);
    expect(reduce(restored, { type: "expand" }).expanded).toBe(true);
  });
});
