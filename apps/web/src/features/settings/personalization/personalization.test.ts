import { describe, expect, it } from "vitest";
import type { PersonalizationEntry } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  dirtyLine,
  draftRules,
  entryCapabilities,
  entryDetail,
  entryReadOnly,
  FINISH_DRAFT,
  historyValue,
  initialPersonalization,
  isDirty,
  PERSONALIZATION_SECTIONS,
  type PersonalizationAction,
  personalizationHistoryState,
  personalizationReducer,
  REFRESH_FAILED,
  resolvePersonalizationSection,
} from "./personalization.ts";

const entry = (overrides: Partial<PersonalizationEntry> = {}) =>
  ({
    canDelete: true,
    id: "00000000-0000-4000-8000-000000000001",
    isActive: true,
    isDefault: false,
    name: "Friends",
    referenceCount: 1,
    sortOrder: 0,
    updatedAt: "2026-08-17T10:00:00.000Z",
    ...overrides,
  }) as PersonalizationEntry;
const reduce = (...actions: PersonalizationAction[]) =>
  actions.reduce(personalizationReducer, initialPersonalization);
const loaded = (section: "tags" | "reminder-rules", cleanMessage?: string) =>
  ({
    cleanMessage,
    focus: false,
    rendered: { canCreate: true, entries: [entry()], section },
    type: "loaded",
  }) as const;

describe("WORKSPACE-003 personalization deep links", () => {
  it("accepts exactly the cataloged section ids", () => {
    expect(PERSONALIZATION_SECTIONS).toHaveLength(11);
    for (const { id } of PERSONALIZATION_SECTIONS) {
      expect(resolvePersonalizationSection(`?section=${id}`)).toBe(id);
    }
    expect(resolvePersonalizationSection("?section=uncataloged-route")).toBe(
      "profile-modules",
    );
    expect(resolvePersonalizationSection("")).toBe("profile-modules");
  });

  it("reads only well-formed personalization history entries", () => {
    expect(
      personalizationHistoryState({
        personalization: { index: 2, section: "tags" },
      }),
    ).toEqual({ index: 2, section: "tags" });
    for (
      const invalid of [
        null,
        "tags",
        {},
        { personalization: null },
        { personalization: { index: -1, section: "tags" } },
        { personalization: { index: 1.5, section: "tags" } },
        { personalization: { index: 10_001, section: "tags" } },
        { personalization: { index: 1, section: "unknown" } },
      ]
    ) {
      expect(personalizationHistoryState(invalid)).toBeUndefined();
    }
    expect(historyValue({ other: 1 }, 3, "tags")).toEqual({
      other: 1,
      personalization: { index: 3, section: "tags" },
    });
    expect(historyValue(null, 0, "tags")).toEqual({
      personalization: { index: 0, section: "tags" },
    });
  });
});

describe("WORKSPACE-003 personalization state", () => {
  it("loads sections, restarting the create form only for a new section", () => {
    const loading = reduce({ type: "ready" }, {
      section: "reminder-rules",
      type: "loading",
    });
    expect(loading).toMatchObject({
      loading: true,
      phase: "ready",
      status: "Loading reminder rules…",
    });
    const first = personalizationReducer(loading, loaded("tags"));
    expect(first).toMatchObject({
      baselined: true,
      createKey: 1,
      generation: 1,
      loading: false,
      status: "",
    });
    const again = personalizationReducer(
      first,
      loaded("tags", "Changes discarded."),
    );
    expect(again).toMatchObject({ createKey: 1, generation: 2 });
    expect(dirtyLine(again).text).toBe("Changes discarded.");
    const moved = personalizationReducer(again, {
      ...loaded("reminder-rules"),
      focus: true,
      rendered: { canCreate: false, entries: [], section: "reminder-rules" },
    });
    expect(moved).toMatchObject({
      createKey: 2,
      headingFocus: 1,
      status: "No shared options are available.",
    });
    expect(
      personalizationReducer(first, {
        ...loaded("tags"),
        rendered: { canCreate: true, entries: [], section: "tags" },
      }).status,
    ).toBe("No options yet. Create the first option for this workspace.");
    expect(reduce({ type: "no-session" }).status).toBe(
      "Your session could not be confirmed.",
    );
  });

  it("tracks drafts only once a baseline exists", () => {
    expect(reduce({ dirtyForms: ["create"], type: "edited" })).toBe(
      initialPersonalization,
    );
    const ready = reduce(loaded("tags", "Changes discarded."));
    expect(
      dirtyLine(
        personalizationReducer(ready, { dirtyForms: [], type: "edited" }),
      )
        .text,
    ).toBe("Changes discarded.");
    const one = personalizationReducer(ready, {
      dirtyForms: ["a"],
      type: "edited",
    });
    expect(one.active).toBe("a");
    expect(dirtyLine(one)).toEqual({
      state: "dirty",
      text: "Unsaved changes.",
    });
    const two = personalizationReducer(one, {
      dirtyForms: ["b", "a"],
      type: "edited",
    });
    expect(two.active).toBe("a");
    expect(draftRules(two, "a")).toEqual({
      actionsBlocked: true,
      revertShown: true,
      saveBlocked: true,
    });
    expect(draftRules(two, "b")).toEqual({
      actionsBlocked: true,
      revertShown: false,
      saveBlocked: true,
    });
    expect(draftRules(one, "a").saveBlocked).toBe(false);
    const moved = personalizationReducer(two, {
      dirtyForms: ["b"],
      type: "edited",
    });
    expect(moved.active).toBe("b");
    const reverted = personalizationReducer(moved, {
      dirtyForms: [],
      type: "edited",
    });
    expect(dirtyLine(reverted)).toEqual({
      state: "saved",
      text: "All changes saved.",
    });
    expect(isDirty(reverted)).toBe(false);
    expect(draftRules(reverted, "b")).toEqual({
      actionsBlocked: false,
      revertShown: false,
      saveBlocked: false,
    });
    expect(
      dirtyLine(
        personalizationReducer(one, { message: FINISH_DRAFT, type: "note" }),
      )
        .text,
    ).toBe(FINISH_DRAFT);
    expect(personalizationReducer(one, { message: "Gone.", type: "baseline" }))
      .toMatchObject({ active: undefined, dirtyForms: [], dirtyNote: "Gone." });
  });

  it("words failed reads, refreshes, and changes", () => {
    const initialFailure = reduce({
      focus: true,
      message: "Down.",
      retry: {
        cleanMessage: undefined,
        focus: true,
        kind: "section",
        section: "tags",
      },
      type: "load-failed",
    });
    expect(initialFailure).toMatchObject({
      baselined: false,
      status: "Down. ",
      statusFocus: 1,
    });
    const ready = personalizationReducer(
      reduce(loaded("tags")),
      { dirtyForms: ["a"], type: "edited" },
    );
    const kept = personalizationReducer(ready, {
      focus: false,
      message: "Down.",
      retry: undefined,
      type: "load-failed",
    });
    expect(kept).toMatchObject({ dirtyForms: ["a"], status: "Down." });
    const refresh = personalizationReducer(ready, { type: "refresh-failed" });
    expect(refresh).toMatchObject({
      retry: { kind: "refresh" },
      status: REFRESH_FAILED,
    });
    expect(personalizationReducer(refresh, { type: "retrying" }).retrying)
      .toBe(true);
    expect(
      personalizationReducer(refresh, {
        focus: true,
        message: "Saved.",
        type: "status",
      }),
    ).toMatchObject({ retry: undefined, status: "Saved.", statusFocus: 2 });
    expect(personalizationReducer(ready, { message: "x", type: "status" }))
      .toMatchObject({ statusFocus: 0 });
    expect(
      personalizationReducer(ready, { mutating: true, type: "mutating" })
        .mutating,
    ).toBe(true);
    expect(personalizationReducer(ready, { type: "reset-create" }).createKey)
      .toBe(ready.createKey + 1);
  });

  it("describes each row and what it may do", () => {
    expect(entryCapabilities(entry(), "gender-options")).toEqual({
      delete: true,
      disable: true,
      editValue: false,
      rename: true,
      reorder: true,
      replace: true,
      setDefault: true,
    });
    expect(entryCapabilities(entry(), "tags").setDefault).toBe(false);
    const declared = { ...entryCapabilities(entry(), "tags"), rename: false };
    expect(entryCapabilities(entry({ capabilities: declared }), "tags"))
      .toBe(declared);
    expect(entryReadOnly(entry())).toBe(false);
    expect(entryReadOnly(entry({ id: "tags-shared" }))).toBe(true);
    expect(entryReadOnly(entry({ readOnly: false, id: "shared" }))).toBe(false);
    expect(entryDetail(entry())).toBe("1 reference · Enabled");
    expect(
      entryDetail(
        entry({ isActive: false, isDefault: true, referenceCount: 2 }),
      ),
    )
      .toBe("2 references · Disabled · Default");
  });
});
