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
import type { ImportantDate } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { ids, personProfile, sectionProps } from "../../../testing/fixtures.ts";
import { drawShell, element, mountSection } from "../../../testing/render.tsx";
import {
  registerRailEditors,
  requestRailEditorOpen,
} from "../../../lib/rail-editors.ts";
import { mountUnsavedChangesGuard } from "../../../lib/unsaved-changes.ts";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import { requestImportantDate } from "../profile-summary.ts";
import {
  IMPORTANT_DATES_ISLAND,
  mountImportantDates,
} from "./important-dates.tsx";

const { person: personId } = ids;
const dateId = "00000000-0000-4000-8000-000000000200";
const listRoute = "GET /api/v1/people/:personId/dates";

/** The block as `ImportantDatesSection.astro` draws it before it hydrates. */
function shell(): HTMLElement {
  drawShell(`
    <main id="main-content">
      <section id="profile-section-important-dates" class="profile-section-card profile-rail-block" data-profile-section="important-dates" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-important-dates-heading">
        <header class="profile-section-heading">
          <h3 id="profile-section-important-dates-heading">Important dates</h3>
          <span class="contents" data-rail-count-slot><span class="profile-rail-count" data-profile-rail-count hidden></span></span>
          <button id="important-date-add" class="profile-rail-add" type="button" aria-label="Add important date" hidden><span aria-hidden="true">+</span></button>
        </header>
        <p id="important-dates-state" class="section-state" tabindex="-1"><span class="sr-only">Loading important dates…</span></p>
        <ul id="important-dates-list" class="important-dates-list" aria-label="Saved important dates"></ul>
        <form method="post" id="important-date-form" class="important-date-form" hidden novalidate></form>
      </section>
    </main>`);
  return element("#profile-section-important-dates");
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

const listed = (
  dates: readonly ImportantDate[],
  status: "ready" | "archived" = "ready",
) => jsonResponse({ dates, status });

function mount(archived = false) {
  return mountSection(
    mountImportantDates,
    sectionProps({ archived }),
  );
}

const block = () => within(element("#profile-section-important-dates"));
const stateLine = () => element("#important-dates-state");
const form = () => element<HTMLFormElement>("#important-date-form");
/** The add control, which renders hidden while the block is read-only. */
const add = () => element<HTMLButtonElement>("#important-date-add");

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

// The rail's counts are the rail island's: this block publishes them.
let summary: CapturedProfileSummary;
beforeEach(() => {
  summary = captureProfileSummary();
});
afterEach(() => {
  summary.stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("PEOPLE-005 important-date island", () => {
  it.each(["clean", "declined", "accepted"])(
    "APR-002 gates incoming and outgoing local-editor switches when %s",
    async (decision) => {
      shell();
      stubApi({ [listRoute]: listed([]) });
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
        expect(
          globalThis.dispatchEvent(
            new Event("beforeunload", { cancelable: true }),
          ),
        ).toBe(false);
      }
      const opener = add();
      opener.focus();
      fireEvent.click(opener);
      if (decision === "declined") {
        expect(confirm).toHaveBeenCalledOnce();
        expect(form().hidden).toBe(true);
        expect(foreign.hidden).toBe(false);
        expect(foreignField.value).toBe("Foreign draft");
        expect(document.activeElement).toBe(foreignField);
        confirm.mockReturnValue(true);
        fireEvent.click(opener);
      }
      expect(form().hidden).toBe(false);
      expect(foreign.hidden).toBe(true);
      const notes = within(form()).getByLabelText<HTMLTextAreaElement>(
        "Notes (optional)",
      );
      notes.focus();
      if (decision !== "clean") {
        fireEvent.input(notes, { target: { value: "Date draft" } });
      }
      const offered = discardRequests(() => decision === "declined");
      opener.focus();
      act(() => {
        expect(requestRailEditorOpen(foreign)).toBe(decision !== "declined");
      });
      expect(offered.at(-1)).toContain(form());
      if (decision === "declined") {
        expect(form().hidden).toBe(false);
        expect(notes.value).toBe("Date draft");
        fireEvent.click(within(form()).getByRole("button", { name: "Cancel" }));
        expect(document.activeElement).toBe(opener);
      }
      expect(form().hidden).toBe(true);
      expect(within(form()).queryByLabelText("Notes (optional)")).toBeNull();
    },
  );

  it("collapses dates outside the birthday and next-upcoming summary", async () => {
    shell();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-31T12:00:00.000Z"));
    stubApi({
      [listRoute]: listed([
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
      ]),
    });
    await mount();
    const list = within(
      block().getByRole("list", {
        name: "Saved important dates",
      }),
    );
    expect(list.getAllByRole("listitem")).toHaveLength(2);
    const expander = block().getByRole("button", {
      name: "Show all (2) important dates",
    });
    expect(expander.hasAttribute("aria-label")).toBe(false);
    expect(expander.getAttribute("aria-expanded")).toBe("false");
    expect(expander.className).toBe(buttonVariants({
      className: "profile-rail-summary-control profile-rail-expander",
      variant: "outline",
    }));

    fireEvent.click(expander);

    expect(list.getAllByRole("listitem")).toHaveLength(4);
    expect(expander.getAttribute("aria-expanded")).toBe("true");
    expect(expander.textContent).toBe("Show fewer important dates");
  });

  it("loads an honest empty state and submits only selected components", async () => {
    const section = shell();
    const api = stubApi({
      [listRoute]: listed([]),
      "POST /api/v1/people/:personId/dates": jsonResponse({
        date: date(),
        status: "created",
      }, 201),
    });
    await mount();
    expect(section.dataset.island).toBe(IMPORTANT_DATES_ISLAND);
    expect(section.hasAttribute("data-island-ready")).toBe(true);
    expect(section.dataset.sectionState).toBe("ready");
    expect(stateLine().textContent).toBe("No important dates recorded.");
    expect(stateLine().dataset.railSummary).toBe("true");
    // The shell's heading stays, with the rail's count slot and the add control.
    expect(section.firstElementChild?.localName).toBe("header");
    expect(section.querySelector("header [data-rail-count-slot]")).not
      .toBeNull();
    expect(section.querySelectorAll("#important-date-add")).toHaveLength(1);
    expect(summary.railEmpty("important-dates")).toBe(true);
    expect(summary.railCount("important-dates")).toBe("0");
    await expectNoAxeViolations(section);
    const user = userEvent.setup();
    await user.click(add());
    expect(document.activeElement).toBe(
      within(form()).getByLabelText("Date type"),
    );
    await user.selectOptions(
      within(form()).getByLabelText("Known components"),
      "month_day",
    );
    expect(
      within(form()).getByLabelText<HTMLInputElement>("Year").disabled,
    ).toBe(true);
    await user.selectOptions(within(form()).getByLabelText("Month"), "2");
    await user.type(within(form()).getByLabelText("Day"), "29");
    await user.click(within(form()).getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(api.bodies()).toHaveLength(1));
    expect(api.bodies()[0]).toMatchObject({
      day: 29,
      month: 2,
      precision: "month_day",
    });
    expect(api.bodies()[0]).not.toHaveProperty("year");
    await waitFor(() =>
      expect(block().getByRole("list").textContent).toContain(
        "February 29 (year unknown)",
      )
    );
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(stateLine());
    expect(summary.railCount("important-dates")).toBe("1");
    expect(summary.railEmpty("important-dates")).toBe(false);
    expect(summary.vital("birthday")).toBe("February 29 (year unknown)");
  });

  it("REL-051 focuses the first field while the opening click is still handled", async () => {
    shell();
    stubApi({ [listRoute]: listed([date()]) });
    await mount();
    // Firefox shows a script focus ring only while it handles the keyboard
    // input that asked for it, so the field takes focus inside that click.
    let focused: Element | null = null;
    const record = () => focused = document.activeElement;
    document.addEventListener("click", record);
    try {
      act(() => add().click());
      expect(focused).toBe(within(form()).getByLabelText("Date type"));
      act(() => element<HTMLButtonElement>("#important-date-cancel").click());
      focused = null;
      act(() =>
        block().getByRole<HTMLButtonElement>("button", { name: /^Edit / })
          .click()
      );
      expect(focused).toBe(within(form()).getByLabelText("Date type"));
    } finally {
      document.removeEventListener("click", record);
    }
  });

  it("keeps a precision's hidden components out of what it sends", async () => {
    shell();
    const api = stubApi({
      [listRoute]: listed([]),
      "POST /api/v1/people/:personId/dates": jsonResponse({
        date: date({ precision: "year", year: 1984 }),
        status: "created",
      }, 201),
    });
    await mount();
    const user = userEvent.setup();
    await user.click(add());
    const fields = within(form());
    await user.type(fields.getByLabelText("Year"), "1990");
    await user.selectOptions(fields.getByLabelText("Month"), "4");
    await user.click(fields.getByLabelText("The stated year is approximate"));
    await user.click(fields.getByLabelText("Show age when the year is known"));
    await user.selectOptions(fields.getByLabelText("Date type"), "custom");
    expect(fields.getByLabelText("Custom label")).toBeTruthy();
    expect(
      fields.getByLabelText<HTMLInputElement>("Custom label").required,
    ).toBe(true);
    await user.type(fields.getByLabelText("Custom label"), "Graduation");
    await user.selectOptions(fields.getByLabelText("Date type"), "birthday");
    expect(
      element("#important-date-label-row").hidden,
    ).toBe(true);
    await user.selectOptions(fields.getByLabelText("Known components"), "day");
    expect(element("#important-date-approximate-row").hidden).toBe(true);
    expect(fields.getByLabelText<HTMLInputElement>("Year").value).toBe("");
    expect(fields.getByLabelText<HTMLInputElement>("Month").value).toBe("");
    await user.selectOptions(fields.getByLabelText("Known components"), "year");
    expect(fields.getByLabelText<HTMLInputElement>("Year").value).toBe("");
    expect(
      fields.getByLabelText<HTMLInputElement>(
        "The stated year is approximate",
      ).checked,
    ).toBe(false);
    await user.type(fields.getByLabelText("Year"), "1984");
    await user.click(fields.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(api.bodies()).toHaveLength(1));
    expect(api.bodies()[0]).toEqual({
      isAgeBased: false,
      isYearApproximate: false,
      kind: "birthday",
      precision: "year",
      year: 1984,
    });
  });

  it("refuses to send a form its own fields reject", async () => {
    shell();
    const api = stubApi({ [listRoute]: listed([]) });
    await mount();
    fireEvent.click(add());
    fireEvent.submit(form());
    fireEvent.submit(form());
    expect(api.calls()).toEqual([`GET /api/v1/people/${personId}/dates`]);
    expect(form().hidden).toBe(false);
  });

  it("resets on a foreign rail editor without restoring focus", async () => {
    shell();
    stubApi({ [listRoute]: listed([]) });
    await mount();
    const opener = add();
    fireEvent.click(opener);
    const year = within(form()).getByLabelText<HTMLInputElement>("Year");
    year.value = "1984";
    const reset = vi.fn();
    form().addEventListener("reset", reset);
    const restoreFocus = vi.spyOn(opener, "focus");
    const foreign = document.createElement("form");
    const foreignControl = document.createElement("input");
    foreign.append(foreignControl);
    document.body.append(foreign);
    foreignControl.focus();

    act(() => {
      requestRailEditorOpen(foreign);
    });

    expect(form().hidden).toBe(true);
    expect(year.value).toBe("");
    expect(reset).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(foreignControl);
  });

  it("publishes exact birthday age and first-meeting values to the hero", async () => {
    shell();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-29T12:00:00.000Z"));
    stubApi({
      [listRoute]: listed([
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
      ]),
    });
    await mount();
    expect(summary.vital("birthday")).toBe("Age 34 · March 12, 1992");
    expect(summary.vital("first-meeting")).toBe("June 5, 2010");
    expect(block().queryByRole("button", { name: /^Show all/ })).toBeNull();
  });

  it("publishes a birthday without age when age display is not enabled", async () => {
    shell();
    stubApi({
      [listRoute]: listed([
        date({ day: 12, month: 3, precision: "full", year: 1992 }),
      ]),
    });
    await mount();
    expect(summary.vital("birthday")).toBe("March 12, 1992");
    expect(summary.vital("first-meeting")).toBe("Not recorded");
  });

  it("collapses an empty archived important-dates block", async () => {
    shell();
    stubApi({ [listRoute]: listed([], "archived") });
    await mount(true);
    expect(summary.railEmpty("important-dates")).toBe(true);
    expect(stateLine().textContent).toBe(
      "No important dates recorded. This archived person is read-only.",
    );
    expect(stateLine().hasAttribute("data-rail-summary")).toBe(false);
  });

  it("keeps archived dates readable and maps forbidden loading honestly", async () => {
    const section = shell();
    stubApi({ [listRoute]: listed([date()], "archived") });
    await mount(true);
    expect(add().hidden).toBe(true);
    expect(section.dataset.sectionState).toBe("ready");
    expect(stateLine().textContent).toBe(
      "Important dates loaded. This archived person is read-only.",
    );
    expect(block().queryByRole("button", { name: /Edit|Delete/ })).toBeNull();
  });

  it.each(
    [
      [
        problemResponse(403),
        "forbidden",
        "Your active workspace no longer permits this action.",
      ],
      [
        problemResponse(401),
        "forbidden",
        "Your active workspace no longer permits this action.",
      ],
      [problemResponse(404), "error", "This person is no longer available."],
      [
        problemResponse(500),
        "error",
        "Important dates are temporarily unavailable. Try again.",
      ],
      [
        unreachable,
        "error",
        "Important dates are temporarily unavailable. Try again.",
      ],
    ] as const,
  )(
    "maps a failed read (%#) to %s without leaking details",
    async (failure, expectedState, message) => {
      const section = shell();
      stubApi({ [listRoute]: failure });
      await mount();
      expect(section.dataset.sectionState).toBe(expectedState);
      expect(stateLine().textContent).toBe(message);
      expect(section.textContent).not.toContain("Private failure details");
      expect(add().hidden).toBe(true);
      expect(summary.railCount("important-dates")).toBeUndefined();
      expect(summary.railEmpty("important-dates")).toBe(false);
    },
  );

  it("resolves at once without its block", async () => {
    drawShell("<main></main>");
    const api = stubApi();
    await mount();
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("becomes read-only immediately when the person lifecycle changes", async () => {
    const section = shell();
    stubApi({ [listRoute]: listed([date()]) });
    await mount();
    fireEvent.click(add());
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: "not-a-boolean" },
        }),
      );
    });
    expect(form().hidden).toBe(false);
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: true },
        }),
      );
    });
    expect(add().hidden).toBe(true);
    expect(form().hidden).toBe(true);
    expect(section.dataset.sectionState).toBe("ready");
    expect(stateLine().textContent).toBe(
      "Important dates loaded. This archived person is read-only.",
    );
    expect(block().getByRole("list").textContent).not.toContain("Edit");
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: false },
        }),
      );
    });
    expect(add().hidden).toBe(false);
    expect(
      block().getByRole("button", { name: "Edit Birthday" }),
    ).toBeTruthy();
  });

  it("edits optional custom data and renders every kind and scheduling outcome", async () => {
    shell();
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
      ...existing[0],
      label: "Graduation",
      notes: "Updated note",
    });
    const api = stubApi({
      [listRoute]: listed(existing),
      "PATCH /api/v1/people/:personId/dates/:dateId": jsonResponse({
        date: updated,
        status: "updated",
      }),
    });
    await mount();
    expect(stateLine().textContent).toBe("3 important dates loaded.");
    const list = block().getByRole("list");
    for (
      const text of [
        "Custom date",
        "Date of death",
        "First meeting",
        "No reminder scheduled",
        "Annual reminder scheduled",
      ]
    ) expect(list.textContent).toContain(text);
    // The custom date sits outside the collapsed block's summary.
    fireEvent.click(block().getByRole("button", { name: /^Show all/ }));
    const edit = block().getByRole("button", { name: "Edit Custom date" });
    expect(edit.className).toBe(buttonVariants({ variant: "outline" }));
    expect(
      block().getByRole("button", { name: "Delete Custom date" }).className,
    ).toBe(buttonVariants({
      className: "profile-rail-remove",
      variant: "destructive",
    }));

    const user = userEvent.setup();
    await user.click(edit);
    const fields = within(form());
    expect(fields.getByLabelText<HTMLSelectElement>("Date type").value).toBe(
      "custom",
    );
    expect(fields.getByLabelText<HTMLInputElement>("Year").value).toBe("1984");
    expect(
      fields.getByLabelText<HTMLInputElement>("The stated year is approximate")
        .checked,
    ).toBe(true);
    const label = fields.getByLabelText<HTMLInputElement>("Custom label");
    expect(label.required).toBe(true);
    await user.type(label, "  Graduation  ");
    const notes = fields.getByLabelText("Notes (optional)");
    await user.clear(notes);
    await user.type(notes, "  Updated note  ");
    expect(
      globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);
    await user.click(fields.getByRole("button", { name: "Save date" }));

    await waitFor(() => expect(api.bodies()).toHaveLength(1));
    expect(api.requests()[1]?.params.dateId).toBe(customId);
    expect(api.bodies()[0]).toMatchObject({
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
    await waitFor(() =>
      expect(block().getByRole("list").textContent).toContain("Graduation")
    );
    expect(
      globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(true);

    await user.click(add());
    await user.click(within(form()).getByRole("button", { name: "Cancel" }));
    expect(form().hidden).toBe(true);
    expect(document.activeElement).toBe(add());
  });

  it("requires two-step deletion and recovers from a stale version", async () => {
    shell();
    const api = stubApi({
      [listRoute]: listed([date({ kind: "deceased" })]),
      "DELETE /api/v1/people/:personId/dates/:dateId": [
        problemResponse(409, {
          code: "people_stale_version",
          detail: "Reload before deleting this date.",
        }),
        unreachable,
        jsonResponse({ dateId, status: "deleted" }),
      ],
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      block().getByRole("button", { name: "Delete Date of death" }),
    );
    expect(stateLine().textContent).toBe(
      "Press the delete button again to confirm.",
    );
    expect(stateLine().hasAttribute("data-rail-summary")).toBe(false);
    await user.click(
      block().getByRole("button", { name: "Confirm delete Date of death" }),
    );
    await waitFor(() =>
      expect(stateLine().textContent).toBe("Reload before deleting this date.")
    );

    await user.click(
      block().getByRole("button", { name: "Delete Date of death" }),
    );
    await user.click(
      block().getByRole("button", { name: "Confirm delete Date of death" }),
    );
    await waitFor(() =>
      expect(stateLine().textContent).toBe(
        "Important date deletion is temporarily unavailable.",
      )
    );

    await user.click(
      block().getByRole("button", { name: "Delete Date of death" }),
    );
    const confirm = block().getByRole("button", {
      name: "Confirm delete Date of death",
    });
    await user.click(confirm);
    await waitFor(() =>
      expect(stateLine().textContent).toBe("No important dates recorded.")
    );
    expect(api.bodies().at(-1)).toEqual({
      expectedUpdatedAt: "2026-08-15T12:00:00.000000Z",
    });
    expect(summary.railCount("important-dates")).toBe("0");
    expect(summary.railEmpty("important-dates")).toBe(true);
  });

  it("surfaces real-calendar 400 errors in a focused form summary", async () => {
    shell();
    const calendarProblem = problemResponse(400, {
      code: "validation_failed",
      detail: "Use only the components declared by the selected precision.",
      errors: { day: "Enter a real calendar date." },
      title: "Invalid important date",
    });
    const api = stubApi({
      [listRoute]: listed([]),
      "POST /api/v1/people/:personId/dates": [
        calendarProblem,
        calendarProblem,
        unreachable,
      ],
    });
    await mount();
    const user = userEvent.setup();
    await user.click(add());
    const fields = within(form());
    const day = fields.getByLabelText<HTMLInputElement>("Day");
    const formState = element("#important-date-form-state");
    await user.type(fields.getByLabelText("Year"), "2023");
    await user.selectOptions(fields.getByLabelText("Month"), "4");
    await user.type(day, "31");
    await user.click(fields.getByRole("button", { name: "Save date" }));
    await waitFor(() =>
      expect(formState.textContent).toBe("Enter a real calendar date.")
    );
    expect(document.activeElement).toBe(formState);
    expect(day.getAttribute("aria-invalid")).toBe("true");
    expect(day.getAttribute("aria-describedby")).toBe(
      "important-date-form-state",
    );
    expect(formState.textContent).not.toContain("temporarily unavailable");

    await user.selectOptions(fields.getByLabelText("Month"), "2");
    await user.clear(day);
    await user.type(day, "29");
    await user.click(fields.getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(api.bodies()).toHaveLength(2));
    await waitFor(() => expect(document.activeElement).toBe(formState));
    expect(formState.textContent).toBe("Enter a real calendar date.");

    await user.click(fields.getByRole("button", { name: "Save date" }));
    await waitFor(() =>
      expect(formState.textContent).toBe(
        "Important date saving is temporarily unavailable.",
      )
    );
    expect(day.hasAttribute("aria-invalid")).toBe(false);
    expect(form().hidden).toBe(false);
  });
});

describe("GAP-047 the date of death", () => {
  it("publishes the date of death to the hero", async () => {
    shell();
    stubApi({
      [listRoute]: listed([
        date({ day: 27, kind: "deceased", month: 11, precision: "month_day" }),
      ]),
    });
    await mount();
    expect(summary.vital("deceased")).toBe("November 27 (year unknown)");
  });

  it("opens a date-of-death editor when the hero asks for one", async () => {
    shell();
    stubApi({ [listRoute]: listed([]) });
    await mount();
    let opened = false;
    act(() => {
      opened = requestImportantDate("deceased");
    });
    expect(opened).toBe(true);
    expect(form().hidden).toBe(false);
    expect(within(form()).getByLabelText<HTMLSelectElement>("Date type").value)
      .toBe("deceased");
    expect(form().contains(document.activeElement)).toBe(true);
  });

  it("edits the date of death already recorded instead of adding another", async () => {
    shell();
    stubApi({
      [listRoute]: listed([
        date({ day: 27, kind: "deceased", month: 11, precision: "month_day" }),
      ]),
    });
    await mount();
    act(() => requestImportantDate("deceased"));
    expect(form().hidden).toBe(false);
    expect(
      within(form()).getByLabelText<HTMLInputElement>("Day").value,
    ).toBe("27");
  });

  it("ignores a request for any other kind of date", async () => {
    shell();
    stubApi({ [listRoute]: listed([]) });
    await mount();
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-important-date-requested", {
          detail: { kind: "birthday" },
        }),
      );
      document.dispatchEvent(
        new CustomEvent("person-important-date-requested"),
      );
    });
    expect(form().hidden).toBe(true);
  });

  it("reports a request it could not take: loading, failed, or declined", async () => {
    shell();
    const held = deferred<Response>();
    stubApi({ [listRoute]: held.promise });
    const mounting = mount();
    expect(requestImportantDate("deceased")).toBe(false);
    held.resolve(problemResponse(503, { detail: "Dates unavailable." }));
    await mounting;
    let opened = true;
    act(() => {
      opened = requestImportantDate("deceased");
    });
    expect(opened).toBe(false);
    expect(form().hidden).toBe(true);
  });

  it("reports a request declined at the unsaved-changes prompt", async () => {
    shell();
    stubApi({ [listRoute]: listed([]) });
    await mount();
    discardRequests(() => true);
    const foreign = foreignEditor();
    registerRailEditors([foreign], () => undefined);
    fireEvent.input(foreign.querySelector("input")!, {
      target: { value: "Foreign draft" },
    });
    let opened = true;
    act(() => {
      opened = requestImportantDate("deceased");
    });
    expect(opened).toBe(false);
    expect(form().hidden).toBe(true);
  });

  it("ignores the request while the person is archived", async () => {
    shell();
    stubApi({ [listRoute]: listed([], "archived") });
    await mount(true);
    act(() => requestImportantDate("deceased"));
    expect(form().hidden).toBe(true);
  });
});

describe("AUD-Q3 important dates from the person read", () => {
  const preloaded = (entry: unknown) =>
    sectionProps({
      initial: { ...personProfile(), rail: { "important-dates": entry } } as
        & ReturnType<typeof personProfile>
        & { readonly rail: never },
    });

  it("shows the dates that came with the person read without reading them", async () => {
    const root = shell();
    const api = stubApi({ [listRoute]: unreachable });
    await mountSection(
      mountImportantDates,
      preloaded({
        status: "ready",
        value: { dates: [date()], status: "ready" },
      }),
    );
    expect(root.dataset.sectionState).toBe("ready");
    expect(block().getAllByText("Birthday")).not.toHaveLength(0);
    expect(summary.railCount("important-dates")).toBe("1");
    expect(api.calls()).toEqual([]);
  });

  it.each(
    [
      [
        "forbidden",
        "forbidden",
        "Your active workspace no longer permits this action.",
      ],
      [
        "unavailable",
        "error",
        "Important dates are temporarily unavailable. Try again.",
      ],
    ] as const,
  )(
    "shows a %s rail section as its own %s state",
    async (status, state, message) => {
      const root = shell();
      const api = stubApi({ [listRoute]: unreachable });
      await mountSection(mountImportantDates, preloaded({ status }));
      expect(root.dataset.sectionState).toBe(state);
      expect(stateLine().textContent).toContain(message);
      expect(api.calls()).toEqual([]);
    },
  );
});
