import { describe, expect, it } from "vitest";
import type { ImportantDate } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { problemBody } from "../../../testing/api.ts";
import {
  collapsedDateIds,
  CONFIRM_DELETE,
  dateInput,
  datesReducer,
  type DatesState,
  dateTitle,
  formatBirthday,
  formatImportantDate,
  formProblem,
  initialDatesState,
  LIST_UNAVAILABLE,
  precisionComponents,
  problemMessage,
  SAVE_UNAVAILABLE,
  schedulingText,
  selectImportantDateSummaryIds,
  sortDates,
  summaryText,
} from "./dates.ts";

const personId = "00000000-0000-4000-8000-000000000100";
const dateId = "00000000-0000-4000-8000-000000000200";

function date(
  overrides: { [Key in keyof ImportantDate]?: ImportantDate[Key] | undefined } =
    {},
): ImportantDate {
  const value: Record<string, unknown> = {
    createdAt: "2026-08-15T12:00:00.000000Z",
    day: 29,
    id: dateId,
    isAgeBased: false,
    isYearApproximate: false,
    kind: "birthday",
    month: 2,
    personId,
    precision: "month_day",
    scheduling: "annual-reminder",
    updatedAt: "2026-08-15T12:00:00.000000Z",
    ...overrides,
  };
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) delete value[key];
  }
  return value as unknown as ImportantDate;
}

describe("PEOPLE-005 important-date presentation", () => {
  it("formats every precision without inventing components", () => {
    expect(formatImportantDate(date())).toBe("February 29 (year unknown)");
    expect(formatImportantDate(date({
      day: 20,
      isYearApproximate: true,
      month: 8,
      precision: "full",
      year: 1984,
    }))).toBe("August 20, about 1984");
    expect(formatImportantDate(date({
      day: undefined,
      month: 8,
      precision: "year_month",
      year: 1984,
    }))).toBe("August 1984");
    expect(formatImportantDate(date({
      day: undefined,
      month: undefined,
      precision: "year",
      year: 1984,
    }))).toBe("1984");
    expect(formatImportantDate(date({
      day: undefined,
      month: 8,
      precision: "month",
    }))).toBe("August (year unknown)");
    expect(formatImportantDate(date({ month: undefined, precision: "day" })))
      .toBe("Day 29 (month and year unknown)");
    expect(formatImportantDate(date({
      day: undefined,
      month: undefined,
      precision: "unknown",
    }))).toBe("Date unknown");
    expect(formatImportantDate(date({ month: undefined, precision: "month" })))
      .toBe("Unknown month (year unknown)");
    expect(formatImportantDate(date({ month: 13, precision: "month" })))
      .toBe(" (year unknown)");
  });

  it("names each kind and its scheduling outcome", () => {
    expect(dateTitle(date())).toBe("Birthday");
    expect(dateTitle(date({ kind: "deceased" }))).toBe("Date of death");
    expect(dateTitle(date({ kind: "first_met" }))).toBe("First meeting");
    expect(dateTitle(date({ kind: "custom", label: "Graduation" })))
      .toBe("Graduation");
    expect(dateTitle(date({ kind: "custom" }))).toBe("Custom date");
    expect(schedulingText(date())).toBe(
      "Annual reminder scheduled because month and day are known.",
    );
    expect(schedulingText(date({ scheduling: "not-schedulable" }))).toBe(
      "No reminder scheduled; month and day are not both known.",
    );
  });

  it("states an age only when it is asked for and the year is exact", () => {
    const now = new Date("2026-08-29T12:00:00.000Z");
    const birthday = date({
      day: 12,
      isAgeBased: true,
      month: 3,
      precision: "full",
      year: 1992,
    });
    expect(formatBirthday(birthday, now)).toBe("Age 34 · March 12, 1992");
    expect(formatBirthday({ ...birthday, isAgeBased: false }, now))
      .toBe("March 12, 1992");
    expect(formatBirthday({ ...birthday, isYearApproximate: true }, now))
      .toBe("March 12, about 1992");
    expect(formatBirthday(date({ isAgeBased: true }), now))
      .toBe("February 29 (year unknown)");
    // Before this year's birthday the age is a year less.
    expect(formatBirthday({ ...birthday, month: 9 }, now)).toBe(
      "Age 33 · September 12, 1992",
    );
    expect(formatBirthday({ ...birthday, day: 30, month: 8 }, now)).toBe(
      "Age 33 · August 30, 1992",
    );
    expect(formatBirthday({ ...birthday, year: 2030 }, now)).toBe(
      "March 12, 2030",
    );
  });

  it.each([
    {
      expected: [
        "00000000-0000-4000-8000-000000000201",
        "00000000-0000-4000-8000-000000000202",
      ],
      name: "birthday plus the soonest upcoming date",
      records: [
        date({ id: "00000000-0000-4000-8000-000000000201" }),
        date({
          day: 1,
          id: "00000000-0000-4000-8000-000000000202",
          kind: "custom",
          label: "Citizenship day",
          month: 9,
        }),
        date({
          day: 2,
          id: "00000000-0000-4000-8000-000000000203",
          kind: "custom",
          label: "Later date",
          month: 9,
        }),
      ],
    },
    {
      expected: ["00000000-0000-4000-8000-000000000204"],
      name: "birthday alone when it is also soonest",
      records: [
        date({
          day: 1,
          id: "00000000-0000-4000-8000-000000000204",
          month: 9,
        }),
        date({
          day: 2,
          id: "00000000-0000-4000-8000-000000000205",
          kind: "custom",
          label: "Later date",
          month: 9,
        }),
      ],
    },
    {
      expected: ["00000000-0000-4000-8000-000000000207"],
      name: "a known month and day instead of an unschedulable record",
      records: [
        date({
          day: undefined,
          id: "00000000-0000-4000-8000-000000000206",
          kind: "custom",
          label: "Unknown day",
          precision: "month",
          scheduling: "not-schedulable",
        }),
        date({
          day: 5,
          id: "00000000-0000-4000-8000-000000000207",
          kind: "custom",
          label: "Known date",
          month: 9,
        }),
      ],
    },
    {
      expected: ["00000000-0000-4000-8000-000000000208"],
      name: "displayed label and then id as deterministic tie breakers",
      records: [
        date({
          day: 1,
          id: "00000000-0000-4000-8000-000000000210",
          kind: "custom",
          label: "Beta",
          month: 9,
        }),
        date({
          day: 1,
          id: "00000000-0000-4000-8000-000000000209",
          kind: "custom",
          label: "Alpha",
          month: 9,
        }),
        date({
          day: 1,
          id: "00000000-0000-4000-8000-000000000208",
          kind: "custom",
          label: "Alpha",
          month: 9,
        }),
      ],
    },
    {
      expected: ["00000000-0000-4000-8000-000000000219"],
      name: "the earlier displayed label, whichever way the list is ordered",
      records: [
        date({
          day: 1,
          id: "00000000-0000-4000-8000-000000000219",
          kind: "custom",
          label: "Alpha",
          month: 9,
        }),
        date({
          day: 1,
          id: "00000000-0000-4000-8000-000000000220",
          kind: "custom",
          label: "Beta",
          month: 9,
        }),
        date({
          day: 1,
          id: "00000000-0000-4000-8000-000000000221",
          kind: "custom",
          label: "Gamma",
          month: 9,
        }),
      ],
    },
    {
      expected: ["00000000-0000-4000-8000-000000000215"],
      name: "February 29 to February 28 ahead of March in a non-leap year",
      now: new Date("2026-01-15T12:00:00.000Z"),
      records: [
        date({
          id: "00000000-0000-4000-8000-000000000215",
          kind: "custom",
          label: "Leap day",
        }),
        date({
          day: 1,
          id: "00000000-0000-4000-8000-000000000216",
          kind: "custom",
          label: "March date",
          month: 3,
        }),
      ],
    },
    {
      expected: ["00000000-0000-4000-8000-000000000218"],
      name: "next year's occurrence once this year's has passed",
      now: new Date("2026-12-15T12:00:00.000Z"),
      records: [
        date({
          day: 20,
          id: "00000000-0000-4000-8000-000000000217",
          kind: "custom",
          label: "March date",
          month: 3,
        }),
        date({
          day: 5,
          id: "00000000-0000-4000-8000-000000000218",
          kind: "custom",
          label: "January date",
          month: 1,
        }),
      ],
    },
  ])("selects $name", (testCase) => {
    const { expected, records } = testCase;
    expect(
      selectImportantDateSummaryIds(
        records,
        "now" in testCase ? testCase.now : new Date("2026-08-31T12:00:00.000Z"),
      ),
    ).toEqual(expected);
  });

  it("keeps a block of two in view and collapses the rest of a longer one", () => {
    const now = new Date("2026-08-31T12:00:00.000Z");
    const birthday = date({ id: "00000000-0000-4000-8000-000000000211" });
    const soon = date({
      day: 1,
      id: "00000000-0000-4000-8000-000000000212",
      kind: "custom",
      month: 9,
    });
    const later = date({
      day: 5,
      id: "00000000-0000-4000-8000-000000000213",
      kind: "custom",
      month: 10,
    });
    expect(collapsedDateIds([birthday, later], now).size).toBe(0);
    expect([...collapsedDateIds([birthday, soon, later], now)]).toEqual([
      later.id,
    ]);
  });

  it("sorts saved dates by year, month, day, kind, label, and id", () => {
    const ids = sortDates([
      date({ day: 2, id: "c", month: 1, year: 2000 }),
      date({ day: 1, id: "b", month: 1, year: 2000 }),
      date({ id: "e" }),
      date({ day: 1, id: "a", month: 1, year: 1999 }),
      date({ id: "d", kind: "custom", label: "B" }),
      date({ id: "f", kind: "custom", label: "A" }),
      date({ id: "g", kind: "custom", label: "A" }),
      date({ day: undefined, id: "h", month: undefined, precision: "unknown" }),
    ]).map((entry) => entry.id);
    expect(ids).toEqual(["a", "b", "c", "e", "f", "g", "d", "h"]);
  });

  it("words the block's summary for active and archived people", () => {
    expect(summaryText([], false)).toBe("No important dates recorded.");
    expect(summaryText([date()], false)).toBe("1 important date loaded.");
    expect(summaryText([date(), date({ id: "other" })], false)).toBe(
      "2 important dates loaded.",
    );
    expect(summaryText([], true)).toBe(
      "No important dates recorded. This archived person is read-only.",
    );
    expect(summaryText([date()], true)).toBe(
      "Important dates loaded. This archived person is read-only.",
    );
  });

  it("maps missing, forbidden, conflicting, and server failures without leaking details", () => {
    expect(problemMessage(undefined)).toBe(LIST_UNAVAILABLE);
    expect(problemMessage(problemBody(404))).toBe(
      "This person is no longer available.",
    );
    for (const status of [401, 403]) {
      expect(problemMessage(problemBody(status))).toBe(
        "Your active workspace no longer permits this action.",
      );
    }
    expect(
      problemMessage(problemBody(409, { detail: "Reload before deleting." })),
    ).toBe("Reload before deleting.");
    expect(problemMessage(problemBody(500))).toBe(LIST_UNAVAILABLE);
  });

  it("puts a refused save's first field error on its field", () => {
    expect(formProblem(undefined)).toEqual({ message: SAVE_UNAVAILABLE });
    expect(
      formProblem(problemBody(400, {
        errors: { day: "Enter a real calendar date." },
      })),
    ).toEqual({ field: "day", message: "Enter a real calendar date." });
    expect(
      formProblem(problemBody(400, {
        detail: "Use only declared components.",
        errors: { precision: "Unsupported." },
      })),
    ).toEqual({ message: "Unsupported." });
    expect(
      formProblem(
        problemBody(400, { detail: "Use only declared components." }),
      ),
    ).toEqual({ message: "Use only declared components." });
    expect(formProblem(problemBody(403))).toEqual({
      message: "Your active workspace no longer permits this action.",
    });
  });

  it("submits only the components the precision declares", () => {
    expect([...precisionComponents("full")]).toEqual(["year", "month", "day"]);
    expect([...precisionComponents("year_month")]).toEqual(["year", "month"]);
    expect([...precisionComponents("month_day")]).toEqual(["month", "day"]);
    expect([...precisionComponents("unknown")]).toEqual([]);
    expect([...precisionComponents("day")]).toEqual(["day"]);
    const values = {
      day: "29",
      isAgeBased: true,
      isYearApproximate: true,
      kind: "birthday" as const,
      label: "  Ignored  ",
      month: "2",
      notes: "  ",
      precision: "month_day" as const,
      year: "1984",
    };
    expect(dateInput(values)).toEqual({
      day: 29,
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      month: 2,
      precision: "month_day",
    });
    expect(dateInput({
      ...values,
      kind: "custom",
      notes: "  Updated note  ",
      precision: "year_month",
    })).toEqual({
      isAgeBased: true,
      isYearApproximate: true,
      kind: "custom",
      label: "Ignored",
      month: 2,
      notes: "Updated note",
      precision: "year_month",
      year: 1984,
    });
  });
});

describe("GAP-031 important-dates reducer", () => {
  const loaded = datesReducer(initialDatesState(false), {
    dates: [date()],
    type: "loaded",
  });

  it("starts loading and shows a first answer or its failure", () => {
    expect(initialDatesState(true)).toEqual({
      archived: true,
      dates: [],
      expanded: false,
      status: "loading",
    });
    expect(loaded).toMatchObject({ dates: [date()], status: "ready" });
    expect(
      datesReducer(initialDatesState(false), {
        message: "Nope",
        status: "forbidden",
        type: "failed",
      }),
    ).toMatchObject({ feedback: "Nope", status: "forbidden" });
  });

  it("opens, adjusts, refuses, and closes the editor", () => {
    const opened = datesReducer(loaded, { type: "open" });
    expect(opened.editor).toEqual({
      generation: 1,
      kind: "birthday",
      precision: "full",
    });
    expect(opened.focus).toEqual({ target: "field", tick: 1 });
    const editing = datesReducer(opened, { date: date(), type: "open" });
    expect(editing.editor).toMatchObject({
      date: date(),
      generation: 2,
      kind: "birthday",
      precision: "month_day",
    });
    const adjusted = datesReducer(
      datesReducer(editing, { kind: "custom", type: "kind" }),
      { precision: "year", type: "precision" },
    );
    expect(adjusted.editor).toMatchObject({
      kind: "custom",
      precision: "year",
    });
    const refused = datesReducer(adjusted, {
      problem: { field: "day", message: "Enter a real calendar date." },
      type: "save-failed",
    });
    expect(refused.editor?.problem?.field).toBe("day");
    expect(refused.focus?.target).toBe("form-state");
    expect(datesReducer(refused, { type: "close" }).editor).toBeUndefined();
    const cancelled = datesReducer(refused, { focus: true, type: "close" });
    expect(cancelled.editor).toBeUndefined();
    expect(cancelled.focus?.target).toBe("add");
  });

  it("ignores editor changes while no editor is open", () => {
    expect(datesReducer(loaded, { kind: "custom", type: "kind" })).toBe(loaded);
    expect(datesReducer(loaded, { precision: "year", type: "precision" }))
      .toBe(loaded);
    expect(
      datesReducer(loaded, { problem: { message: "x" }, type: "save-failed" }),
    ).toBe(loaded);
  });

  it("puts a saved date in order and a changed one in place", () => {
    const later = date({ day: 1, id: "later", month: 3 });
    const created = datesReducer(datesReducer(loaded, { type: "open" }), {
      date: later,
      type: "saved",
    });
    expect(created.dates.map((entry) => entry.id)).toEqual([dateId, "later"]);
    expect(created.editor).toBeUndefined();
    expect(created.focus?.target).toBe("state");
    const changed = datesReducer(created, {
      date: date({ day: 2, id: "later", month: 1 }),
      type: "saved",
    });
    expect(changed.dates.map((entry) => entry.id)).toEqual(["later", dateId]);
  });

  it("asks before deleting and recovers from a refusal", () => {
    const asked = datesReducer(loaded, { id: dateId, type: "confirm" });
    expect(asked).toMatchObject({
      confirming: dateId,
      feedback: CONFIRM_DELETE,
    });
    const deleting = datesReducer(asked, { id: dateId, type: "delete" });
    expect(deleting.deleting).toBe(dateId);
    const refused = datesReducer(deleting, {
      message: "Reload first.",
      type: "delete-failed",
    });
    expect(refused).toMatchObject({ feedback: "Reload first." });
    expect(refused.confirming).toBeUndefined();
    expect(refused.deleting).toBeUndefined();
    const deleted = datesReducer(deleting, { id: dateId, type: "deleted" });
    expect(deleted.dates).toEqual([]);
    expect(deleted.feedback).toBeUndefined();
  });

  it("becomes read-only on archive and redraws collapsed", () => {
    const expanded: DatesState = datesReducer(
      datesReducer(loaded, { type: "open" }),
      { type: "expand" },
    );
    expect(expanded.expanded).toBe(true);
    const archived = datesReducer(expanded, {
      archived: true,
      type: "lifecycle",
    });
    expect(archived).toMatchObject({ archived: true, expanded: false });
    expect(archived.editor).toBeUndefined();
    const restored = datesReducer(
      datesReducer(archived, { type: "open" }),
      { archived: false, type: "lifecycle" },
    );
    expect(restored.archived).toBe(false);
    expect(restored.editor).toBeDefined();
  });
});
