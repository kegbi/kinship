// @vitest-environment happy-dom
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { PersonLifeEvent } from "../../../../../packages/contracts/generated/auth-client.ts";
import { SECTION_HIDDEN_EVENT } from "../../features/person/sections.ts";
import { expectNoAxeViolations } from "../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../testing/api.ts";
import {
  ids,
  personProfile,
  profileSummary,
  sectionProps,
} from "../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSection,
} from "../../testing/render.tsx";
import { mountPersonLifeEvents } from "./mount.tsx";

const { person: personId, workspace: workspaceId } = ids;
const LIFE_EVENTS = "GET /api/v1/people/:personId/life-events";
const CREATE = "POST /api/v1/people/:personId/life-events";
const UPDATE = "PATCH /api/v1/people/:personId/life-events/:lifeEventId";
const DELETE = "DELETE /api/v1/people/:personId/life-events/:lifeEventId";
const TYPE_ID = "7d0b0a3e-8f1c-4c4b-9c55-0d9e3c1f2a10";
const EVENT_ID = "00000000-0000-4000-8000-000000000200";
const REVISION = "2026-09-27T10:00:00.000000Z";

/** The card as the static shell draws it before the island hydrates. */
function markup(): HTMLElement {
  drawShell(`
    <main>
      <section id="profile-section-life-events" class="profile-section-card life-events-card" data-profile-section="life-events" data-person-life-events data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-life-events-heading">
        <header class="profile-section-heading"><div class="profile-section-title"><h3 id="profile-section-life-events-heading">Life events</h3><span data-life-event-badge>Loading</span></div></header>
        <p data-life-event-state class="section-state">Loading life events…</p>
        <ol data-life-event-list hidden>Retained private event</ol>
      </section>
    </main>`);
  return element("[data-person-life-events]");
}

function lifeEvent(
  overrides: {
    [Key in keyof PersonLifeEvent]?: PersonLifeEvent[Key] | undefined;
  } = {},
): PersonLifeEvent {
  const value: Record<string, unknown> = {
    date: { month: 12, precision: "year_month", year: 1843 },
    id: EVENT_ID,
    name: "Published Notes",
    note: "The first published computer algorithm.",
    typeName: "Career",
    updatedAt: REVISION,
    ...overrides,
  };
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined) delete value[key];
  }
  return value as unknown as PersonLifeEvent;
}

const listed = (events: readonly PersonLifeEvent[]) =>
  jsonResponse({
    events,
    status: "ready",
    types: [{ id: TYPE_ID, name: "Relocation" }],
  });

const props = (hidden = false, archived = false, counted?: number) =>
  sectionProps({
    archived,
    initial: personProfile({
      person: {
        profileSections: hidden
          ? [{ id: "life-events", status: "hidden" }]
          : [],
      },
      ...(counted === undefined ? {} : {
        summary: profileSummary({
          sectionCounts: [{
            count: counted,
            id: "life-events",
            status: "ready",
          }],
        }),
      }),
    }),
  });

const mount = (hidden = false, archived = false, counted?: number) =>
  mountSection(mountPersonLifeEvents, props(hidden, archived, counted));

const card = () => within(element("[data-person-life-events]"));
const stateLine = () =>
  document.querySelector("[data-life-event-state]")?.textContent;
const badge = () =>
  document.querySelector("[data-life-event-badge]")?.textContent;
const add = () => element<HTMLButtonElement>("[data-life-event-add]");
const form = () => element<HTMLFormElement>("[data-life-event-form]");
const editorOpen = () =>
  document.querySelector("[data-life-event-form]") !== null;

describe("complete person life-event history island", () => {
  it("[PEOPLE-003] lists loaded life events while the card stays ready", async () => {
    const root = markup();
    const api = stubApi({
      [LIFE_EVENTS]: listed([
        lifeEvent(),
        lifeEvent({
          date: { happenedAt: "1852-11-27T12:00:00.000Z", precision: "full" },
          id: "00000000-0000-4000-8000-000000000201",
          name: undefined,
          note: undefined,
          typeName: "Milestone",
        }),
      ]),
    });

    await mount();

    expect(root.dataset.island).toBe("person-life-events");
    expect(root.hasAttribute("data-island-ready")).toBe(true);
    expect(root.dataset.sectionState).toBe("ready");
    expect(stateLine()).toBe("2 life events.");
    expect(badge()).toBe("Ready");
    expect(
      card().getByRole("heading", { level: 3, name: "Life events" }).id,
    ).toBe("profile-section-life-events-heading");
    const rows = within(card().getByRole("list", { name: "Saved life events" }))
      .getAllByRole("listitem");
    expect(rows.map((row) => row.querySelector("strong")?.textContent))
      .toEqual(["Published Notes", "Milestone"]);
    expect(rows[0]?.textContent).toContain("December 1843");
    expect(rows[1]?.textContent).toContain("November 27, 1852");
    expect(root.textContent).not.toContain("Retained private event");
    expect(add().hidden).toBe(false);
    expect(api.fetch).toHaveBeenCalledWith(
      `/api/v1/people/${personId}/life-events`,
      {
        cache: "no-store",
        headers: expect.objectContaining({ "X-Workspace-Id": workspaceId }),
      },
    );
    await expectNoAxeViolations(root);
  });

  it("FEQ-04 shows a card the summary counted empty without reading it, and reads its types when the editor opens", async () => {
    const root = markup();
    const api = stubApi({ [LIFE_EVENTS]: listed([]) });
    await mount(false, false, 0);
    expect(api.calls()).toEqual([]);
    expect(root.dataset.sectionState).toBe("empty");
    expect(add().disabled).toBe(false);
    fireEvent.click(add());
    // The field takes focus inside the click (REL-051); the types follow.
    expect(document.activeElement).toBe(
      card().getByRole("textbox", { name: "Name" }),
    );
    await waitFor(() =>
      expect(
        [
          ...card().getByRole<HTMLSelectElement>("combobox", { name: "Type" })
            .options,
        ].map((option) => option.value),
      ).toContain(TYPE_ID)
    );
    expect(editorOpen()).toBe(true);
    expect(api.calls()).toEqual([`GET /api/v1/people/${personId}/life-events`]);
  });

  it("FEQ-04 keeps the opened editor and its draft when the types it waits for fail to load", async () => {
    markup();
    const api = stubApi({ [LIFE_EVENTS]: [unreachable, listed([])] });
    await mount(false, false, 0);
    fireEvent.click(add());
    const name = card().getByRole<HTMLInputElement>("textbox", {
      name: "Name",
    });
    fireEvent.change(name, { target: { value: "Moved to London" } });
    await waitFor(() =>
      expect(stateLine()).toBe(
        "Life event types could not be loaded. You can save without a type.",
      )
    );
    expect(editorOpen()).toBe(true);
    expect(name.value).toBe("Moved to London");
    expect(element("[data-person-life-events]").dataset.sectionState).toBe(
      "empty",
    );
    // The next opening asks for the types again.
    fireEvent.click(card().getByRole("button", { name: "Cancel" }));
    fireEvent.click(add());
    await waitFor(() =>
      expect(
        [
          ...card().getByRole<HTMLSelectElement>("combobox", { name: "Type" })
            .options,
        ].map((option) => option.value),
      ).toContain(TYPE_ID)
    );
    expect(api.calls()).toHaveLength(2);
  });

  it("counts a single event in the singular", async () => {
    markup();
    stubApi({
      [LIFE_EVENTS]: listed([lifeEvent({ date: { precision: "unknown" } })]),
    });
    await mount();
    expect(stateLine()).toBe("1 life event.");
  });

  it("keeps failure local and retries to an honest empty state", async () => {
    const root = markup();
    stubApi({
      [LIFE_EVENTS]: [
        jsonResponse({
          detail: "History query failed.",
          status: 503,
          title: "Unavailable",
          type: "about:blank",
        }, 503),
        listed([]),
      ],
    });

    await mount();
    expect(root.dataset.sectionState).toBe("error");
    expect(stateLine()).toBe("History query failed.");
    expect(badge()).toBe("Unavailable");
    expect(add().hidden).toBe(true);
    const retry = card().getByRole("button", { name: "Retry life events" });
    await userEvent.setup().click(retry);
    await waitFor(() => expect(root.dataset.sectionState).toBe("empty"));
    expect(stateLine()).toBe("No life events saved.");
    expect(badge()).toBe("Empty");
  });

  it("says so when the server cannot be reached", async () => {
    const root = markup();
    stubApi({ [LIFE_EVENTS]: unreachable });
    await mount();
    expect(root.dataset.sectionState).toBe("error");
    expect(stateLine()).toBe(
      "Life events are temporarily unavailable. Other person sections remain available.",
    );
  });

  it("hides disabled history without reading retained data", async () => {
    const root = markup();
    const api = stubApi();

    await mount(true);

    expect(root.hidden).toBe(true);
    expect(root.dataset.sectionState).toBe("hidden");
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("conceals history and tells navigation when the endpoint observes a newly disabled module", async () => {
    const root = markup();
    const hidden = vi.fn();
    document.addEventListener(SECTION_HIDDEN_EVENT, hidden);
    stubApi({
      [LIFE_EVENTS]: jsonResponse({ events: [], status: "hidden", types: [] }),
    });

    await mount();
    document.removeEventListener(SECTION_HIDDEN_EVENT, hidden);

    expect(root.hidden).toBe(true);
    expect(root.dataset.sectionState).toBe("hidden");
    expect(root.textContent).not.toContain("Retained private event");
    expect(hidden).toHaveBeenCalledTimes(1);
    expect((hidden.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
      sectionId: "life-events",
    });
  });

  it("keeps forbidden and missing history non-retryable and tolerates a missing surface", async () => {
    for (
      const [status, state, label] of [
        [403, "forbidden", "Forbidden"],
        [404, "not-found", "Unavailable"],
      ] as const
    ) {
      const root = markup();
      stubApi({
        [LIFE_EVENTS]: jsonResponse({
          detail: "Membership no longer permits this view.",
          status,
          title: "Refused",
          type: "about:blank",
        }, status),
      });
      const unmount = await mount();
      expect(root.dataset.sectionState).toBe(state);
      expect(badge()).toBe(label);
      expect(
        root.querySelector<HTMLButtonElement>("[data-life-event-retry]")
          ?.hidden,
      ).toBe(true);
      unmount();
    }
    document.body.innerHTML = "<main></main>";
    const unmount = await mountPersonLifeEvents(document.body, props());
    expect(unmount).toBeTypeOf("function");
    unmount();
  });
});

describe("JOURNAL-002 maintaining a person's life events", () => {
  it("records an event with only its precision's components and refreshes the timeline", async () => {
    markup();
    const created = lifeEvent({
      date: { month: 6, precision: "year_month", year: 2019 },
      id: "00000000-0000-4000-8000-000000000202",
      name: "Moved to Lisbon",
      note: undefined,
      typeId: TYPE_ID,
      typeName: "Relocation",
    });
    const api = stubApi({
      [LIFE_EVENTS]: listed([lifeEvent()]),
      [CREATE]: jsonResponse({ event: created, status: "created" }, 201),
    });
    const timeline = vi.fn();
    document.addEventListener("person-timeline-changed", timeline);
    try {
      await mount();
      const user = userEvent.setup();
      await user.click(add());
      const fields = within(form());
      expect(document.activeElement).toBe(fields.getByLabelText("Name"));
      await user.type(fields.getByLabelText("Name"), " Moved to Lisbon ");
      await user.selectOptions(fields.getByLabelText("Type"), TYPE_ID);
      await user.selectOptions(
        fields.getByLabelText("Known components"),
        "year_month",
      );
      expect(fields.getByLabelText("Day").closest("label")?.hidden).toBe(true);
      await user.type(fields.getByLabelText("Year"), "2019");
      await user.selectOptions(fields.getByLabelText("Month"), "6");
      await user.click(
        fields.getByRole("button", { name: "Save life event" }),
      );
      await waitFor(() => expect(editorOpen()).toBe(false));
      expect(api.bodies().at(-1)).toEqual({
        month: 6,
        name: "Moved to Lisbon",
        precision: "year_month",
        typeId: TYPE_ID,
        year: 2019,
      });
      const titles = [
        ...document.querySelectorAll("[data-life-event-list] strong"),
      ].map((title) => title.textContent);
      expect(titles).toEqual(["Moved to Lisbon", "Published Notes"]);
      expect(stateLine()).toBe("2 life events.");
      expect(document.activeElement?.id).toBe("life-events-state");
      expect(timeline).toHaveBeenCalledTimes(1);
      expect((timeline.mock.calls[0]?.[0] as CustomEvent).detail).toEqual({
        personIds: [personId],
      });
    } finally {
      document.removeEventListener("person-timeline-changed", timeline);
    }
  });

  it("edits an event at its revision and shows a refused save on its field", async () => {
    markup();
    const api = stubApi({
      [LIFE_EVENTS]: listed([lifeEvent({ typeId: TYPE_ID })]),
      [UPDATE]: [
        problemResponse(400, {
          code: "validation_failed",
          detail:
            "Review the name, type, precision, and known date components.",
          errors: { year: "Enter year for year precision." },
        }),
        jsonResponse({
          event: lifeEvent({
            date: { precision: "year", year: 1844 },
            name: "Published the Notes",
            updatedAt: "2026-09-27T11:00:00.000000Z",
          }),
          status: "updated",
        }),
      ],
    });
    await mount();
    const user = userEvent.setup();
    await user.click(card().getByRole("button", { name: /^Edit / }));
    const fields = within(form());
    expect(fields.getByLabelText<HTMLInputElement>("Name").value).toBe(
      "Published Notes",
    );
    expect(fields.getByLabelText<HTMLSelectElement>("Type").value).toBe(
      TYPE_ID,
    );
    await user.selectOptions(fields.getByLabelText("Known components"), "year");
    await user.clear(fields.getByLabelText("Year"));
    await user.click(fields.getByRole("button", { name: "Save life event" }));
    await waitFor(() =>
      expect(form().textContent).toContain("Enter year for year precision.")
    );
    // The refusal sits inside the field's label, after its name.
    expect(fields.getByLabelText(/^Year/).getAttribute("aria-invalid")).toBe(
      "true",
    );
    expect(element("#life-event-form-state").textContent).toBe(
      "Review the name, type, precision, and known date components.",
    );
    expect(document.activeElement?.id).toBe("life-event-form-state");
    expect(api.bodies()[0]).toEqual({
      expectedUpdatedAt: REVISION,
      name: "Published Notes",
      note: "The first published computer algorithm.",
      precision: "year",
      typeId: TYPE_ID,
    });

    await user.type(fields.getByLabelText(/^Year/), "1844");
    await user.clear(fields.getByLabelText("Name"));
    await user.type(fields.getByLabelText("Name"), "Published the Notes");
    await user.click(fields.getByRole("button", { name: "Save life event" }));
    await waitFor(() => expect(editorOpen()).toBe(false));
    expect(api.bodies()[1]).toMatchObject({
      expectedUpdatedAt: REVISION,
      name: "Published the Notes",
      precision: "year",
      year: 1844,
    });
    expect(card().getByRole("list").textContent).toContain("1844");
  });

  it("marks the form busy while a save is in flight and says so when unreachable", async () => {
    markup();
    let release: (response: Response) => void = () => undefined;
    stubApi({
      [LIFE_EVENTS]: listed([]),
      [CREATE]: [
        () => new Promise<Response>((resolve) => release = resolve),
        unreachable,
      ],
    });
    await mount();
    const user = userEvent.setup();
    await user.click(add());
    await user.type(within(form()).getByLabelText("Name"), "Moved");
    fireEvent.submit(form());
    await waitFor(() => expect(form().getAttribute("aria-busy")).toBe("true"));
    expect(
      within(form()).getByRole<HTMLButtonElement>("button", {
        name: "Save life event",
      }).disabled,
    ).toBe(true);
    await act(async () => {
      release(
        problemResponse(403, {
          code: "life_events_forbidden",
          detail: "No longer permitted.",
        }),
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(form().hasAttribute("aria-busy")).toBe(false));
    expect(element("#life-event-form-state").textContent).toBe(
      "No longer permitted.",
    );
    fireEvent.submit(form());
    await waitFor(() =>
      expect(element("#life-event-form-state").textContent).toBe(
        "Life events are temporarily unavailable. Other person sections remain available.",
      )
    );
  });

  it("REL-055 disables Add life event while a save is in flight", async () => {
    markup();
    const release: ((response: Response) => void)[] = [];
    const pending = () =>
      new Promise<Response>((resolve) => release.push(resolve));
    stubApi({ [LIFE_EVENTS]: listed([]), [CREATE]: [pending, pending] });
    await mount();
    const user = userEvent.setup();
    await user.click(add());
    await user.type(within(form()).getByLabelText("Name"), "Moved");
    fireEvent.submit(form());
    await waitFor(() => expect(form().getAttribute("aria-busy")).toBe("true"));
    expect(add().disabled).toBe(true);
    expect(add().textContent).toBe("Add life event");
    await act(async () => {
      release[0]?.(problemResponse(503, { detail: "Try again." }));
      await Promise.resolve();
    });
    await waitFor(() => expect(form().hasAttribute("aria-busy")).toBe(false));
    expect(add().disabled).toBe(false);

    fireEvent.submit(form());
    await waitFor(() => expect(add().disabled).toBe(true));
    await act(async () => {
      release[1]?.(
        jsonResponse(
          { event: lifeEvent({ name: "Moved" }), status: "created" },
          201,
        ),
      );
      await Promise.resolve();
    });
    await waitFor(() => expect(editorOpen()).toBe(false));
    expect(add().disabled).toBe(false);
  });

  it("REL-051 focuses the first field while the opening click is still handled", async () => {
    markup();
    stubApi({ [LIFE_EVENTS]: listed([lifeEvent()]) });
    await mount();
    let focused: Element | null = null;
    const noted = () => focused = document.activeElement;
    document.addEventListener("click", noted);
    try {
      act(() => add().click());
      expect(focused).toBe(within(form()).getByLabelText("Name"));
      act(() => within(form()).getByRole("button", { name: "Cancel" }).click());
      expect(editorOpen()).toBe(false);
      expect(document.activeElement).toBe(add());
      focused = null;
      act(() =>
        card().getByRole<HTMLButtonElement>("button", { name: /^Edit / })
          .click()
      );
      expect(focused).toBe(within(form()).getByLabelText("Name"));
    } finally {
      document.removeEventListener("click", noted);
    }
  });

  it("asks the unsaved-changes guard before another editor replaces a draft", async () => {
    markup();
    stubApi({ [LIFE_EVENTS]: listed([lifeEvent()]) });
    await mount();
    const offered: number[] = [];
    const decline = (event: Event) => {
      offered.push(
        (event as CustomEvent<{ forms: unknown[] }>).detail.forms.length,
      );
      event.preventDefault();
    };
    document.addEventListener("kinship:form-discard-request", decline);
    try {
      act(() => add().click());
      act(() =>
        card().getByRole<HTMLButtonElement>("button", { name: /^Edit / })
          .click()
      );
      expect(offered).toEqual([1]);
      expect(form().textContent).toContain("New life event");
    } finally {
      document.removeEventListener("kinship:form-discard-request", decline);
    }
  });

  it("removes an event only on a confirming press and keeps a refusal local", async () => {
    markup();
    const api = stubApi({
      [LIFE_EVENTS]: listed([lifeEvent()]),
      [DELETE]: [
        problemResponse(409, {
          code: "life_event_stale",
          detail: "Refresh the life events before trying again.",
        }),
        jsonResponse({ lifeEventId: EVENT_ID, status: "deleted" }),
      ],
    });
    const timeline = vi.fn();
    document.addEventListener("person-timeline-changed", timeline);
    try {
      await mount();
      const user = userEvent.setup();
      await user.click(card().getByRole("button", { name: /^Remove / }));
      expect(stateLine()).toBe(
        "Press the remove button again to confirm. Reminders attached to this life event are deleted too.",
      );
      expect(api.bodies()).toHaveLength(0);
      await user.click(
        card().getByRole("button", {
          name: "Confirm remove Published Notes",
        }),
      );
      await waitFor(() =>
        expect(stateLine()).toBe(
          "Refresh the life events before trying again.",
        )
      );
      expect(timeline).not.toHaveBeenCalled();
      await user.click(card().getByRole("button", { name: /^Remove / }));
      await user.click(
        card().getByRole("button", {
          name: "Confirm remove Published Notes",
        }),
      );
      await waitFor(() => expect(stateLine()).toBe("No life events saved."));
      expect(api.bodies().at(-1)).toEqual({ expectedUpdatedAt: REVISION });
      expect(element("[data-person-life-events]").dataset.sectionState).toBe(
        "empty",
      );
      expect(timeline).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener("person-timeline-changed", timeline);
    }
  });

  it("keeps an archived person's events read-only and follows a restore", async () => {
    markup();
    stubApi({ [LIFE_EVENTS]: listed([lifeEvent()]) });
    await mount(false, true);
    expect(stateLine()).toBe(
      "1 life event. This archived person is read-only.",
    );
    expect(add().hidden).toBe(true);
    expect(card().queryByRole("button", { name: /^Edit / })).toBeNull();
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: false, personId },
        }),
      );
    });
    expect(add().hidden).toBe(false);
    act(() => add().click());
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: true, personId: "someone-else" },
        }),
      );
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", { detail: {} }),
      );
    });
    expect(editorOpen()).toBe(true);
    await expectNoAxeViolations(element("[data-person-life-events]"));
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-lifecycle-changed", {
          detail: { archived: true, personId },
        }),
      );
    });
    expect(editorOpen()).toBe(false);
    expect(add().hidden).toBe(true);
  });

  it("offers a retired type only on the event that already carries it", async () => {
    markup();
    const retired = "7d0b0a3e-8f1c-4c4b-9c55-0d9e3c1f2a99";
    stubApi({
      [LIFE_EVENTS]: listed([
        lifeEvent({ typeId: retired, typeName: "Old type" }),
        lifeEvent({
          id: "00000000-0000-4000-8000-000000000203",
          name: "Unnamed type",
          typeId: retired,
          typeName: undefined,
        }),
      ]),
    });
    await mount();
    const user = userEvent.setup();
    await user.click(
      card().getByRole("button", { name: "Edit Unnamed type" }),
    );
    expect(
      [...within(form()).getByLabelText<HTMLSelectElement>("Type").options]
        .map((option) => option.textContent),
    ).toContain("Type (archived)");
    await user.click(within(form()).getByRole("button", { name: "Cancel" }));
    await user.click(
      card().getByRole("button", { name: "Edit Published Notes" }),
    );
    const options = [
      ...within(form()).getByLabelText<HTMLSelectElement>("Type").options,
    ].map((option) => option.textContent);
    expect(options).toEqual(["No type", "Relocation", "Old type (archived)"]);
    await user.click(within(form()).getByRole("button", { name: "Cancel" }));
    await user.click(add());
    expect(
      [...within(form()).getByLabelText<HTMLSelectElement>("Type").options]
        .map((option) => option.textContent),
    ).toEqual(["No type", "Relocation"]);
  });
});

describe("REL-076 a late save across an archive and restore", () => {
  /**
   * Submits A, archives and restores the person (A's editor closes), then
   * opens and submits B; answers `release[0]` for A and `release[1]` for B.
   */
  async function saveAcrossArchive() {
    markup();
    const release: ((response: Response) => void)[] = [];
    const pending = () =>
      new Promise<Response>((resolve) => release.push(resolve));
    stubApi({ [LIFE_EVENTS]: listed([]), [CREATE]: [pending, pending] });
    await mount();
    const lifecycle = (archived: boolean) =>
      act(() => {
        document.dispatchEvent(
          new CustomEvent("person-lifecycle-changed", {
            detail: { archived, personId },
          }),
        );
      });
    const user = userEvent.setup();
    for (const [index, name] of ["First", "Second"].entries()) {
      await user.click(add());
      await user.type(within(form()).getByLabelText("Name"), name);
      fireEvent.submit(form());
      await waitFor(() => expect(release).toHaveLength(index + 1));
      if (index === 0) {
        lifecycle(true);
        expect(editorOpen()).toBe(false);
        lifecycle(false);
      }
    }
    await waitFor(() => expect(form().getAttribute("aria-busy")).toBe("true"));
    return async (index: number, response: Response) => {
      await act(async () => {
        release[index]?.(response);
        await Promise.resolve();
      });
    };
  }

  it("A's late refusal leaves B saving, and B's own refusal shows in B", async () => {
    const answer = await saveAcrossArchive();
    await answer(0, problemResponse(503, { detail: "Try again." }));
    expect(form().getAttribute("aria-busy")).toBe("true");
    expect(add().disabled).toBe(true);

    await answer(
      1,
      problemResponse(409, {
        code: "life_event_conflict",
        detail: "Second was refused.",
      }),
    );
    await waitFor(() =>
      expect(element("#life-event-form-state").textContent).toBe(
        "Second was refused.",
      )
    );
    expect(form().hasAttribute("aria-busy")).toBe(false);
    expect(add().disabled).toBe(false);
  });

  it("A's late save lists A and leaves B open and saving", async () => {
    const answer = await saveAcrossArchive();
    await answer(
      0,
      jsonResponse(
        { event: lifeEvent({ name: "First" }), status: "created" },
        201,
      ),
    );
    await waitFor(() => expect(stateLine()).toBe("1 life event."));
    expect(editorOpen()).toBe(true);
    expect(form().getAttribute("aria-busy")).toBe("true");
    expect(add().disabled).toBe(true);
  });
});

describe("REL-079 person life events status line", () => {
  // Mounted during the initial fan-out, the line waits for the workspace's
  // promotion (UXD-003B); mounted after it, the line is its own live region
  // from the first commit.
  it.each([false, true])(
    "owns its live region from its first commit only once states are live (%s)",
    async (live) => {
      markup();
      const answer = deferred<Response>();
      stubApi({ [LIFE_EVENTS]: answer.promise });
      const settled = mountPending(() =>
        mountPersonLifeEvents(document.body, {
          ...props(),
          statesLive: () => live,
        })
      );
      const line = element("[data-life-event-state]");
      expect(line.getAttribute("role")).toBe(live ? "status" : null);
      expect(line.getAttribute("aria-live")).toBe(live ? "polite" : null);
      await act(async () => {
        answer.resolve(listed([]));
        await settled;
      });
      expect(line.isConnected).toBe(true);
      expect(line.textContent).toBe("No life events saved.");
    },
  );
});
