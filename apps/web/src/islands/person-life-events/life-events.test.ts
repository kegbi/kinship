import { describe, expect, it } from "vitest";
import type { PersonLifeEvent } from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  CONFIRM_REMOVE,
  editorOpeningDisabled,
  eventDate,
  eventTitle,
  formValues,
  initialLifeEventsState,
  lifeEventForm,
  lifeEventsReducer,
  type LifeEventsState,
  precisionComponents,
  problemMessage,
  rowControlsDisabled,
  sectionState,
  sortLifeEvents,
  statusLine,
  submittedLifeEvent,
} from "./life-events.ts";

const TYPE_ID = "7d0b0a3e-8f1c-4c4b-9c55-0d9e3c1f2a10";

function event(
  overrides: {
    [Key in keyof PersonLifeEvent]?: PersonLifeEvent[Key] | undefined;
  } = {},
): PersonLifeEvent {
  const value: Record<string, unknown> = {
    date: { month: 6, precision: "year_month", year: 2019 },
    id: "00000000-0000-4000-8000-0000000000e1",
    name: "Moved to Lisbon",
    updatedAt: "2026-09-27T10:00:00.000000Z",
    ...overrides,
  };
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) delete value[key];
  }
  return value as unknown as PersonLifeEvent;
}

function problem(status: number, detail = "x") {
  return {
    code: "refused",
    detail,
    status,
    title: "Refused",
    type: "about:blank",
  };
}

function ready(events: readonly PersonLifeEvent[] = [event()]) {
  return lifeEventsReducer(initialLifeEventsState(false, false), {
    events,
    type: "loaded",
    types: [{ id: TYPE_ID, name: "Relocation" }],
  });
}

describe("JOURNAL-002 life-event presentation", () => {
  it("names an event by what it has and dates it by its precision", () => {
    expect(eventTitle(event())).toBe("Moved to Lisbon");
    expect(eventTitle(event({ name: undefined, typeName: "Graduation" })))
      .toBe("Graduation");
    expect(eventTitle(event({ name: undefined }))).toBe("Life event");
    expect(eventDate(event())).toBe("June 2019");
    expect(eventDate(event({ date: { precision: "unknown" } }))).toBe(
      "Date unknown",
    );
    expect(
      eventDate(
        event({
          date: { happenedAt: "1852-11-27T12:00:00.000Z", precision: "full" },
        }),
      ),
    ).toBe("November 27, 1852");
  });

  it("orders events as the person's page reads them, newest first", () => {
    const undated = event({ date: { precision: "unknown" }, id: "a" });
    const older = event({ date: { precision: "year", year: 1990 }, id: "b" });
    const newer = event({ id: "c" });
    expect(sortLifeEvents([undated, older, newer]).map((item) => item.id))
      .toEqual(["c", "b", "a"]);
  });

  it("breaks date ties by the recorded instant, then revision, then id", () => {
    const date = { month: 6, precision: "year_month" as const, year: 2019 };
    const recorded = event({
      date: { ...date, happenedAt: "2019-06-02T00:00:00.000Z" },
      id: "a",
    });
    const plain = event({ date, id: "b" });
    const newer = event({ date, id: "c", updatedAt: "2026-09-28T00:00:00Z" });
    const sameAsPlain = event({ date, id: "d" });
    expect(
      sortLifeEvents([plain, recorded, sameAsPlain, newer]).map((item) =>
        item.id
      ),
    ).toEqual(["a", "c", "d", "b"]);
    expect(sortLifeEvents([recorded, plain]).map((item) => item.id)).toEqual(
      ["a", "b"],
    );
  });

  it("asks only for the components a precision declares", () => {
    expect([...precisionComponents("full")]).toEqual(["year", "month", "day"]);
    expect([...precisionComponents("month_day")]).toEqual(["month", "day"]);
    expect([...precisionComponents("unknown")]).toEqual([]);
    expect([...precisionComponents("month")]).toEqual(["month"]);
  });

  it("sends only filled fields and the precision's components", () => {
    expect(lifeEventForm.parse({
      day: "12",
      month: "6",
      name: "  Moved ",
      note: " ",
      precision: "year_month",
      typeId: "",
      year: "2019",
    })).toEqual({
      month: 6,
      name: "Moved",
      precision: "year_month",
      year: 2019,
    });
    expect(
      lifeEventForm.safeParse({
        day: "",
        month: "",
        name: "",
        note: "",
        precision: "sometime",
        typeId: "",
        year: "",
      }).success,
    ).toBe(false);
  });

  it("leaves anything but a field map to the schema", () => {
    expect(submittedLifeEvent(null)).toBeNull();
    expect(submittedLifeEvent({ name: "Moved", year: "2019" })).toEqual({
      name: "Moved",
    });
  });

  it("opens the editor with an event's own values", () => {
    expect(formValues(event({ typeId: TYPE_ID }))).toEqual({
      day: "",
      month: "6",
      name: "Moved to Lisbon",
      note: "",
      precision: "year_month",
      typeId: TYPE_ID,
      year: "2019",
    });
    expect(formValues(undefined).precision).toBe("full");
  });

  it("words a refusal by what the reader can do about it", () => {
    expect(problemMessage(undefined)).toBe(
      "Life events are temporarily unavailable. Other person sections remain available.",
    );
    expect(
      problemMessage(
        problem(409, "Refresh the life events before trying again."),
      ),
    ).toBe("Refresh the life events before trying again.");
    expect(problemMessage(problem(404))).toBe(
      "This person or life event is no longer available.",
    );
    expect(problemMessage(problem(403))).toBe(
      "Your active workspace no longer permits this change.",
    );
    expect(problemMessage(problem(503))).toBe(
      "Life events are temporarily unavailable. Other person sections remain available.",
    );
  });
});

describe("JOURNAL-002 life-event reducer", () => {
  it("reads to ready or empty and says how many", () => {
    const loaded = ready();
    expect(sectionState(loaded)).toBe("ready");
    expect(statusLine(loaded)).toBe("1 life event.");
    const two = ready([event(), event({ id: "b" })]);
    expect(statusLine(two)).toBe("2 life events.");
    const empty = ready([]);
    expect(sectionState(empty)).toBe("empty");
    expect(statusLine(empty)).toBe("No life events saved.");
    const archived = lifeEventsReducer(empty, {
      archived: true,
      type: "lifecycle",
    });
    expect(statusLine(archived)).toBe(
      "No life events saved. This archived person is read-only.",
    );
  });

  it("keeps a failure local and hides a turned-off section", () => {
    const failed = lifeEventsReducer(
      initialLifeEventsState(false, false),
      { detail: "Down", status: "error", type: "failed" },
    );
    expect(sectionState(failed)).toBe("error");
    expect(statusLine(failed)).toBe("Down");
    const retrying = lifeEventsReducer(failed, { type: "retry" });
    expect(sectionState(retrying)).toBe("loading");
    expect(statusLine(retrying)).toBe("Loading life events…");
    expect(statusLine({ ...failed, detail: undefined } as never)).toBe(
      "Life events are temporarily unavailable. Other person sections remain available.",
    );
    const hidden = lifeEventsReducer(failed, { type: "hidden" });
    expect(sectionState(hidden)).toBe("hidden");
    expect(sectionState(initialLifeEventsState(true, false))).toBe("hidden");
  });

  it("opens, saves, and closes one editor, focusing where the reader goes", () => {
    const opened = lifeEventsReducer(ready(), { type: "open" });
    expect(opened.editor?.event).toBeUndefined();
    expect(opened.focus?.target).toBe("field");
    const editing = lifeEventsReducer(opened, {
      event: event(),
      type: "open",
    });
    expect(editing.editor?.event?.id).toBe(event().id);
    expect(editing.editor!.generation).toBeGreaterThan(
      opened.editor!.generation,
    );
    const busy = lifeEventsReducer(editing, { type: "saving" });
    expect(busy.editor?.busy).toBe(true);
    const refused = lifeEventsReducer(busy, { type: "save-failed" });
    expect(refused.editor?.busy).toBe(false);
    expect(refused.focus?.target).toBe("form-state");
    const saved = lifeEventsReducer(
      lifeEventsReducer(refused, { type: "saving" }),
      {
        event: event({ name: "Moved to Porto" }),
        type: "saved",
      },
    );
    expect(saved.editor).toBeUndefined();
    expect(saved.events.map(eventTitle)).toEqual(["Moved to Porto"]);
    expect(saved.focus?.target).toBe("state");
    const added = lifeEventsReducer(saved, {
      event: event({ date: { precision: "year", year: 2024 }, id: "new" }),
      type: "saved",
    });
    expect(added.events.map((item) => item.id)).toEqual(["new", event().id]);
    const cancelled = lifeEventsReducer(
      lifeEventsReducer(added, { type: "open" }),
      { focus: true, type: "close" },
    );
    expect(cancelled.editor).toBeUndefined();
    expect(cancelled.focus?.target).toBe("add");
    const quietly = lifeEventsReducer(
      lifeEventsReducer(added, { type: "open" }),
      { type: "close" },
    );
    expect(quietly.editor).toBeUndefined();
    expect(quietly.focus?.target).toBe("field");
    expect(lifeEventsReducer(added, { type: "saving" })).toBe(added);
    expect(lifeEventsReducer(added, { type: "save-failed" })).toBe(added);
  });

  it("removes an event only on a confirming second press", () => {
    const loaded = ready();
    const confirming = lifeEventsReducer(loaded, {
      id: event().id,
      type: "confirm",
    });
    expect(confirming.confirming).toBe(event().id);
    expect(statusLine(confirming)).toBe(CONFIRM_REMOVE);
    expect(CONFIRM_REMOVE).toContain(
      "Reminders attached to this life event are deleted too.",
    );
    const removing = lifeEventsReducer(confirming, {
      id: event().id,
      type: "remove",
    });
    expect(removing.removing).toBe(event().id);
    const failed = lifeEventsReducer(removing, {
      message: "Refresh the life events before trying again.",
      type: "remove-failed",
    });
    expect(failed.removing).toBeUndefined();
    expect(failed.confirming).toBeUndefined();
    expect(statusLine(failed)).toBe(
      "Refresh the life events before trying again.",
    );
    const removed = lifeEventsReducer(removing, {
      id: event().id,
      type: "removed",
    });
    expect(removed.events).toEqual([]);
    expect(removed.focus?.target).toBe("state");
    expect(statusLine(removed)).toBe("No life events saved.");
  });

  it("keeps an in-flight removal across opening and saving the editor", () => {
    const removing = lifeEventsReducer(
      lifeEventsReducer(ready([event(), event({ id: "b" })]), {
        id: "b",
        type: "confirm",
      }),
      { id: "b", type: "remove" },
    );
    const opened = lifeEventsReducer(removing, {
      event: event(),
      type: "open",
    });
    expect(opened.removing).toBe("b");
    const saved = lifeEventsReducer(opened, { event: event(), type: "saved" });
    expect(saved.removing).toBe("b");
    expect(rowControlsDisabled(saved, "b")).toEqual({
      edit: true,
      remove: true,
    });
    const removed = lifeEventsReducer(saved, { id: "b", type: "removed" });
    expect(removed.removing).toBeUndefined();
  });

  it("closes the editor when the event it edits is removed", () => {
    const editing = lifeEventsReducer(
      lifeEventsReducer(ready([event(), event({ id: "b" })]), {
        event: event({ id: "b" }),
        type: "open",
      }),
      { id: "b", type: "remove" },
    );
    const removed = lifeEventsReducer(editing, { id: "b", type: "removed" });
    expect(removed.editor).toBeUndefined();
    const other = lifeEventsReducer(
      lifeEventsReducer(ready([event(), event({ id: "b" })]), {
        event: event(),
        type: "open",
      }),
      { id: "b", type: "removed" },
    );
    expect(other.editor?.event?.id).toBe(event().id);
  });

  it("locks every row's edit and remove controls while a save is in flight", () => {
    const opened = lifeEventsReducer(ready(), { type: "open" });
    expect(rowControlsDisabled(opened, event().id)).toEqual({
      edit: false,
      remove: false,
    });
    const busy = lifeEventsReducer(opened, { type: "saving" });
    expect(rowControlsDisabled(busy, event().id)).toEqual({
      edit: true,
      remove: true,
    });
  });

  it("REL-055 locks editing the event being removed and no other", () => {
    const removing = lifeEventsReducer(
      ready([event(), event({ id: "b" })]),
      { id: "b", type: "remove" },
    );
    expect(rowControlsDisabled(removing, "b").edit).toBe(true);
    expect(rowControlsDisabled(removing, event().id).edit).toBe(false);
  });

  it("REL-055 locks opening another editor until the save answers", () => {
    const opened = lifeEventsReducer(ready(), { type: "open" });
    expect(editorOpeningDisabled(opened)).toBe(false);
    const busy = lifeEventsReducer(opened, { type: "saving" });
    expect(editorOpeningDisabled(busy)).toBe(true);
    expect(
      editorOpeningDisabled(lifeEventsReducer(busy, { type: "save-failed" })),
    ).toBe(false);
    expect(
      editorOpeningDisabled(
        lifeEventsReducer(busy, { event: event(), type: "saved" }),
      ),
    ).toBe(false);
  });

  it("REL-055 a late save answer never closes an editor opened since", () => {
    const busy = lifeEventsReducer(
      lifeEventsReducer(ready(), { type: "open" }),
      { type: "saving" },
    );
    // The card fails and recovers while the save is in flight; a new editor
    // opens because the one that saves is gone.
    const reopened = lifeEventsReducer(
      lifeEventsReducer(
        lifeEventsReducer(
          lifeEventsReducer(busy, {
            detail: "x",
            status: "error",
            type: "failed",
          }),
          { type: "retry" },
        ),
        { events: [event()], type: "loaded", types: [] },
      ),
      { event: event(), type: "open" },
    );
    const late = lifeEventsReducer(reopened, {
      event: event({ id: "new", name: "Late" }),
      type: "saved",
    });
    expect(late.editor).toBe(reopened.editor);
    expect(late.focus).toBe(reopened.focus);
    expect(late.events.map((item) => item.id)).toContain("new");
    expect(lifeEventsReducer(reopened, { type: "save-failed" })).toBe(
      reopened,
    );
  });

  it("an archived person closes the editor and a restore reopens editing", () => {
    const editing: LifeEventsState = lifeEventsReducer(ready(), {
      type: "open",
    });
    const archived = lifeEventsReducer(editing, {
      archived: true,
      type: "lifecycle",
    });
    expect(archived.editor).toBeUndefined();
    expect(archived.archived).toBe(true);
    expect(
      lifeEventsReducer(archived, { archived: false, type: "lifecycle" })
        .archived,
    ).toBe(false);
  });
});
