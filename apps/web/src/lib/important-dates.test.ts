// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatImportantDate,
  mountImportantDates,
  selectImportantDateSummaryIds,
} from "./important-dates.ts";
import { registerRailEditors, requestRailEditorOpen } from "./rail-editors.ts";
import { mountUnsavedChangesGuard } from "./unsaved-changes.ts";
import type { ImportantDate } from "../../../../packages/contracts/generated/auth-client.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const dateId = "00000000-0000-4000-8000-000000000200";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function markup(): void {
  document.body.innerHTML = `
    <a data-person-vital-value="birthday">Not recorded</a>
    <a data-person-vital-value="first-meeting">Not recorded</a>
    <section id="profile-section-important-dates" data-profile-section="important-dates" data-section-state="loading">
      <span data-profile-rail-count hidden></span>
      <p id="important-dates-state" tabindex="-1"></p>
      <ul id="important-dates-list"></ul>
      <button id="important-date-add" hidden>Add important date</button>
      <form id="important-date-form" hidden>
        <input id="important-date-version" name="expectedUpdatedAt" type="hidden">
        <select id="important-date-kind" name="kind">
          <option value="birthday">Birthday</option><option value="first_met">First meeting</option>
          <option value="deceased">Date of death</option><option value="custom">Custom</option>
        </select>
        <label id="important-date-label-row" hidden><input id="important-date-label" name="label"></label>
        <select id="important-date-precision" name="precision">
          <option value="full">Full</option><option value="year_month">Year month</option>
          <option value="month_day">Month day</option><option value="year">Year</option>
          <option value="month">Month</option><option value="day">Day</option>
          <option value="unknown">Unknown</option>
        </select>
        <label data-date-component="year"><input id="important-date-year" name="year"></label>
        <label data-date-component="month"><select id="important-date-month" name="month"><option value=""></option><option value="2">2</option><option value="4">4</option><option value="8">8</option></select></label>
        <label data-date-component="day"><input id="important-date-day" name="day"></label>
        <label id="important-date-approximate-row"><input id="important-date-approximate" name="isYearApproximate" type="checkbox"></label>
        <input id="important-date-age" name="isAgeBased" type="checkbox">
        <textarea id="important-date-notes" name="notes"></textarea>
        <p id="important-date-form-state" role="alert" tabindex="-1"></p>
        <button type="submit">Save date</button><button id="important-date-cancel" type="button">Cancel</button>
      </form>
    </section>`;
}

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

function button(label: string): HTMLButtonElement {
  const match = [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => candidate.textContent === label);
  if (!match) throw new Error(`Missing button: ${label}`);
  return match;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PEOPLE-005 important-date presentation", () => {
  it.each(["clean", "declined", "accepted"])(
    "APR-002 gates incoming and outgoing local-editor switches when %s",
    async (decision) => {
      markup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response({ dates: [], status: "ready" })),
      );
      await mountImportantDates(personId, workspaceId, false);
      mountUnsavedChangesGuard({
        confirmMessage: "Discard?",
        root: document.body,
      });
      const confirm = vi.fn(() => decision === "accepted");
      vi.stubGlobal("confirm", confirm);
      const add = document.querySelector<HTMLButtonElement>(
        "#important-date-add",
      )!;
      const form = document.querySelector<HTMLFormElement>(
        "#important-date-form",
      )!;
      const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        "#important-date-notes",
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
        expect(
          globalThis.dispatchEvent(
            new Event("beforeunload", { cancelable: true }),
          ),
        ).toBe(false);
      }
      add.focus();
      add.click();
      if (decision === "declined") {
        expect(confirm).toHaveBeenCalledOnce();
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
        field.value = "Date draft";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      confirm.mockClear().mockReturnValue(decision === "accepted");
      add.focus();
      expect(requestRailEditorOpen(foreign)).toBe(decision !== "declined");
      expect(confirm).toHaveBeenCalledTimes(decision === "clean" ? 0 : 1);
      if (decision === "declined") {
        expect(form.hidden).toBe(false);
        expect(field.value).toBe("Date draft");
        expect(document.activeElement).toBe(field);
        form.querySelector<HTMLButtonElement>("#important-date-cancel")!
          .click();
        expect(document.activeElement).toBe(add);
        expect(confirm).toHaveBeenCalledOnce();
      }
      expect(form.hidden).toBe(true);
      expect(field.value).toBe("");
    },
  );

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
  ])("selects $name", (testCase) => {
    const { expected, records } = testCase;
    expect(
      selectImportantDateSummaryIds(
        records,
        "now" in testCase ? testCase.now : new Date("2026-08-31T12:00:00.000Z"),
      ),
    ).toEqual(expected);
  });

  it("collapses dates outside the birthday and next-upcoming summary", async () => {
    markup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({
        dates: [
          date({ id: "00000000-0000-4000-8000-000000000211" }),
          date({
            day: 1,
            id: "00000000-0000-4000-8000-000000000212",
            kind: "custom",
            label: "Citizenship day",
            month: 9,
          }),
          date({
            day: 5,
            id: "00000000-0000-4000-8000-000000000213",
            kind: "custom",
            label: "Autumn date",
            month: 10,
          }),
          date({
            day: undefined,
            id: "00000000-0000-4000-8000-000000000214",
            kind: "first_met",
            month: 4,
            precision: "year_month",
            scheduling: "not-schedulable",
            year: 2012,
          }),
        ],
        status: "ready",
      })),
    );

    await mountImportantDates(personId, workspaceId, false);

    const items = [
      ...document.querySelectorAll<HTMLLIElement>(
        "#important-dates-list > li",
      ),
    ];
    expect(items.filter((item) => item.hidden)).toHaveLength(2);
    const expander = document.querySelector<HTMLButtonElement>(
      "[data-important-dates-expander]",
    )!;
    expect(expander.hasAttribute("aria-label")).toBe(false);
    expect(expander.firstChild?.textContent).toBe("Show all (2)");
    expect(expander.textContent).toContain(expander.firstChild?.textContent);
    expect(expander.getAttribute("aria-expanded")).toBe("false");

    expander.click();

    expect(items.every((item) => !item.hidden)).toBe(true);
    expect(expander.getAttribute("aria-expanded")).toBe("true");
    expect(expander.firstChild?.textContent).toBe("Show fewer");
  });

  it("loads an honest empty state and submits only selected components", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ dates: [], status: "ready" }))
      .mockResolvedValueOnce(
        response({ date: date(), status: "created" }, 201),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountImportantDates(personId, workspaceId, false);
    expect(document.querySelector("#important-dates-state")?.textContent)
      .toBe("No important dates recorded.");
    expect(
      document.querySelector("#profile-section-important-dates")?.getAttribute(
        "data-rail-empty",
      ),
    ).toBe("true");
    expect(document.querySelector("[data-profile-rail-count]")?.textContent)
      .toBe("0");
    (document.querySelector("#important-date-add") as HTMLButtonElement)
      .click();
    const precision = document.querySelector(
      "#important-date-precision",
    ) as HTMLSelectElement;
    precision.value = "month_day";
    precision.dispatchEvent(new Event("change"));
    (document.querySelector("#important-date-month") as HTMLSelectElement)
      .value = "2";
    (document.querySelector("#important-date-day") as HTMLInputElement)
      .value = "29";
    (document.querySelector("#important-date-form") as HTMLFormElement)
      .dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    const body = JSON.parse(`${request.body}`) as Record<string, unknown>;
    expect(body).toMatchObject({ month: 2, day: 29, precision: "month_day" });
    expect(body).not.toHaveProperty("year");
    await vi.waitFor(() =>
      expect(document.querySelector("#important-dates-list")?.textContent)
        .toContain("February 29 (year unknown)")
    );
    expect(document.querySelector("[data-profile-rail-count]")?.textContent)
      .toBe("1");
    expect(
      document.querySelector("#profile-section-important-dates")?.hasAttribute(
        "data-rail-empty",
      ),
    ).toBe(false);
    expect(
      document.querySelector('[data-person-vital-value="birthday"]')
        ?.textContent,
    ).toBe("February 29 (year unknown)");
  });

  it("resets on a foreign rail editor without restoring focus", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ dates: [], status: "ready" })),
    );
    await mountImportantDates(personId, workspaceId, false);
    const add = document.querySelector<HTMLButtonElement>(
      "#important-date-add",
    )!;
    const form = document.querySelector<HTMLFormElement>(
      "#important-date-form",
    )!;
    add.click();
    const year = document.querySelector<HTMLInputElement>(
      "#important-date-year",
    )!;
    year.value = "1984";
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
    expect(year.value).toBe("");
    expect(reset).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(foreignControl);
  });

  it("publishes exact birthday age and first-meeting values to the hero", async () => {
    markup();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-29T12:00:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({
        dates: [
          date({
            day: 12,
            isAgeBased: true,
            month: 3,
            precision: "full",
            year: 1992,
          }),
          date({
            day: 5,
            id: "00000000-0000-4000-8000-000000000204",
            kind: "first_met",
            month: 6,
            precision: "full",
            year: 2010,
          }),
        ],
        status: "ready",
      })),
    );

    await mountImportantDates(personId, workspaceId, false);

    expect(
      document.querySelector('[data-person-vital-value="birthday"]')
        ?.textContent,
    ).toBe("Age 34 · March 12, 1992");
    expect(
      document.querySelector('[data-person-vital-value="first-meeting"]')
        ?.textContent,
    ).toBe("June 5, 2010");
    expect(document.querySelector("[data-important-dates-expander]"))
      .toBeNull();
  });

  it("publishes a birthday without age when age display is not enabled", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({
        dates: [
          date({
            day: 12,
            isAgeBased: false,
            month: 3,
            precision: "full",
            year: 1992,
          }),
        ],
        status: "ready",
      })),
    );

    await mountImportantDates(personId, workspaceId, false);

    expect(
      document.querySelector('[data-person-vital-value="birthday"]')
        ?.textContent,
    ).toBe("March 12, 1992");
  });

  it("collapses an empty archived important-dates block", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        response({ dates: [], status: "archived" }),
      ),
    );

    await mountImportantDates(personId, workspaceId, true);

    expect(
      document.querySelector<HTMLElement>(
        "#profile-section-important-dates",
      )?.dataset.railEmpty,
    ).toBe("true");
    expect(document.querySelector("#important-dates-state")?.textContent)
      .toBe("No important dates recorded. This archived person is read-only.");
  });

  it("keeps archived dates readable and maps forbidden loading honestly", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        response({ dates: [date()], status: "archived" }),
      ),
    );
    await mountImportantDates(personId, workspaceId, true);
    expect(
      (document.querySelector("#important-date-add") as HTMLButtonElement)
        .hidden,
    )
      .toBe(true);
    expect(
      document.querySelector("#profile-section-important-dates")?.getAttribute(
        "data-section-state",
      ),
    ).toBe("ready");
    expect(document.querySelector("#important-dates-state")?.textContent)
      .toBe("Important dates loaded. This archived person is read-only.");

    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(response({
        code: "people_forbidden",
        detail: "Private detail",
        status: 403,
        title: "Forbidden",
        type: "https://kinship.test/problems/people_forbidden",
      }, 403)),
    );
    await mountImportantDates(personId, workspaceId, false);
    expect(
      document.querySelector("#profile-section-important-dates")?.getAttribute(
        "data-section-state",
      ),
    )
      .toBe("forbidden");
    expect(document.querySelector("#important-dates-state")?.textContent)
      .not.toContain("Private detail");
  });

  it("becomes read-only immediately when the person lifecycle changes", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(
        response({ dates: [date()], status: "ready" }),
      ),
    );
    await mountImportantDates(personId, workspaceId, false);
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: true },
      }),
    );
    expect(
      (document.querySelector("#important-date-add") as HTMLButtonElement)
        .hidden,
    ).toBe(true);
    expect(
      document.querySelector("#profile-section-important-dates")?.getAttribute(
        "data-section-state",
      ),
    ).toBe("ready");
    expect(document.querySelector("#important-dates-state")?.textContent)
      .toBe("Important dates loaded. This archived person is read-only.");
    expect(document.querySelector("#important-dates-list")?.textContent)
      .not.toContain("Edit Birthday");
  });

  it("edits optional custom data and renders every kind and scheduling outcome", async () => {
    markup();
    mountUnsavedChangesGuard({
      confirmMessage: "Discard?",
      root: document.body,
    });
    const customId = "00000000-0000-4000-8000-000000000201";
    const existing = [
      date({
        day: undefined,
        id: customId,
        isAgeBased: true,
        isYearApproximate: true,
        kind: "custom",
        label: undefined,
        month: 8,
        notes: "Original note",
        precision: "year_month",
        scheduling: "not-schedulable",
        year: 1984,
      }),
      date({
        day: undefined,
        id: "00000000-0000-4000-8000-000000000202",
        kind: "deceased",
        month: undefined,
        precision: "unknown",
        scheduling: "not-schedulable",
      }),
      date({
        day: 20,
        id: "00000000-0000-4000-8000-000000000203",
        kind: "first_met",
        month: 8,
        precision: "full",
        year: 1984,
      }),
    ];
    const updated = date({
      day: undefined,
      id: customId,
      isAgeBased: true,
      isYearApproximate: true,
      kind: "custom",
      label: "Graduation",
      month: 8,
      notes: "Updated note",
      precision: "year_month",
      scheduling: "not-schedulable",
      year: 1984,
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ dates: existing, status: "ready" }))
      .mockResolvedValueOnce(response({ date: updated, status: "updated" }));
    vi.stubGlobal("fetch", fetchMock);

    await mountImportantDates(personId, workspaceId, false);
    expect(document.querySelector("#important-dates-state")?.textContent)
      .toBe("3 important dates loaded.");
    expect(document.querySelector("#important-dates-list")?.textContent)
      .toContain("Custom date");
    expect(document.querySelector("#important-dates-list")?.textContent)
      .toContain("Date of death");
    expect(document.querySelector("#important-dates-list")?.textContent)
      .toContain("First meeting");
    expect(document.querySelector("#important-dates-list")?.textContent)
      .toContain("No reminder scheduled");
    expect(button("Edit Custom date").classList.contains("button-secondary"))
      .toBe(true);
    expect(button("Delete Custom date").classList.contains("button-danger"))
      .toBe(true);

    button("Edit Custom date").click();
    await Promise.resolve();
    const kind = document.querySelector(
      "#important-date-kind",
    ) as HTMLSelectElement;
    kind.value = "custom";
    kind.dispatchEvent(new Event("change"));
    expect(
      (document.querySelector("#important-date-label") as HTMLInputElement)
        .required,
    ).toBe(true);
    (document.querySelector("#important-date-label") as HTMLInputElement)
      .value = "  Graduation  ";
    (document.querySelector("#important-date-notes") as HTMLTextAreaElement)
      .value = "  Updated note  ";
    document.querySelector("#important-date-notes")!.dispatchEvent(
      new Event("input", { bubbles: true }),
    );
    expect(
      globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);
    (document.querySelector("#important-date-form") as HTMLFormElement)
      .dispatchEvent(
        new SubmitEvent("submit", { bubbles: true, cancelable: true }),
      );

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const request = fetchMock.mock.calls[1]?.[1] as RequestInit;
    expect(JSON.parse(`${request.body}`)).toMatchObject({
      expectedUpdatedAt: existing[0]?.updatedAt,
      isAgeBased: true,
      isYearApproximate: true,
      kind: "custom",
      label: "Graduation",
      month: 8,
      notes: "Updated note",
      precision: "year_month",
      year: 1984,
    });
    await vi.waitFor(() =>
      expect(document.querySelector("#important-dates-list")?.textContent)
        .toContain("Graduation")
    );
    expect(
      globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(true);

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: "not-a-boolean" },
      }),
    );
    expect(
      (document.querySelector("#important-date-add") as HTMLButtonElement)
        .hidden,
    ).toBe(false);
    button("Add important date").click();
    button("Cancel").click();
    expect(
      (document.querySelector("#important-date-form") as HTMLFormElement)
        .hidden,
    ).toBe(true);
  });

  it("requires two-step deletion and recovers from a stale version", async () => {
    markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ dates: [date({ kind: "deceased" })], status: "ready" }),
      )
      .mockResolvedValueOnce(response({
        code: "people_stale_version",
        detail: "Reload before deleting this date.",
        status: 409,
        title: "Conflict",
        type: "https://kinship.test/problems/people_stale_version",
      }, 409))
      .mockResolvedValueOnce(response({ dateId, status: "deleted" }));
    vi.stubGlobal("fetch", fetchMock);

    await mountImportantDates(personId, workspaceId, false);
    button("Delete Date of death").click();
    expect(document.querySelector("#important-dates-state")?.textContent)
      .toBe("Press the delete button again to confirm.");
    button("Confirm delete Date of death").click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(document.querySelector("#important-dates-state")?.textContent)
        .toBe("Reload before deleting this date.")
    );

    button("Delete Date of death").click();
    button("Confirm delete Date of death").click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await vi.waitFor(() =>
      expect(document.querySelector("#important-dates-state")?.textContent)
        .toBe("No important dates recorded.")
    );
    expect(document.querySelector("[data-profile-rail-count]")?.textContent)
      .toBe("0");
    expect(
      document.querySelector("#profile-section-important-dates")?.getAttribute(
        "data-rail-empty",
      ),
    ).toBe("true");
  });

  it("maps missing, server, and network failures without leaking details", async () => {
    for (
      const [failure, expectedState, expectedMessage] of [
        [
          response({ detail: "Private missing detail", status: 404 }, 404),
          "error",
          "This person is no longer available.",
        ],
        [
          response({ detail: "Private server detail", status: 500 }, 500),
          "error",
          "Important dates are temporarily unavailable. Try again.",
        ],
      ] as const
    ) {
      markup();
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(failure));
      await mountImportantDates(personId, workspaceId, false);
      expect(
        document.querySelector("#profile-section-important-dates")
          ?.getAttribute("data-section-state"),
      ).toBe(expectedState);
      expect(document.querySelector("#important-dates-state")?.textContent)
        .toBe(expectedMessage);
    }

    markup();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValueOnce(new Error("offline")));
    await mountImportantDates(personId, workspaceId, false);
    expect(document.querySelector("#important-dates-state")?.textContent)
      .toBe("Important dates are temporarily unavailable. Try again.");

    document.body.innerHTML = "";
    await expect(mountImportantDates(personId, workspaceId, false))
      .resolves.toBeUndefined();
  });

  it("surfaces real-calendar 400 errors in a focused form summary", async () => {
    markup();
    const calendarProblem = () =>
      response({
        code: "validation_failed",
        detail: "Use only the components declared by the selected precision.",
        errors: { day: "Enter a real calendar date." },
        status: 400,
        title: "Invalid important date",
        type: "https://kinship.test/problems/validation_failed",
      }, 400);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ dates: [], status: "ready" }))
      .mockResolvedValueOnce(calendarProblem())
      .mockResolvedValueOnce(calendarProblem());
    vi.stubGlobal("fetch", fetchMock);
    await mountImportantDates(personId, workspaceId, false);
    button("Add important date").click();

    const year = document.querySelector(
      "#important-date-year",
    ) as HTMLInputElement;
    const month = document.querySelector(
      "#important-date-month",
    ) as HTMLSelectElement;
    const day = document.querySelector(
      "#important-date-day",
    ) as HTMLInputElement;
    const form = document.querySelector(
      "#important-date-form",
    ) as HTMLFormElement;
    const summary = document.querySelector(
      "#important-date-form-state",
    ) as HTMLElement;
    year.value = "2023";
    month.value = "4";
    day.value = "31";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await vi.waitFor(() =>
      expect(summary.textContent).toBe("Enter a real calendar date.")
    );
    expect(document.activeElement).toBe(summary);
    expect(summary.textContent).not.toContain("temporarily unavailable");

    month.value = "2";
    day.value = "29";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    await vi.waitFor(() =>
      expect(summary.textContent).toBe("Enter a real calendar date.")
    );
    expect(document.activeElement).toBe(summary);
  });
});
