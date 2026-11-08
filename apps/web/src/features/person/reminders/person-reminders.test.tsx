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
import { readApplicationStylesheet } from "../../../lib/application-stylesheet.test-helper.ts";
import {
  registerRailEditors,
  requestRailEditorOpen,
} from "../../../lib/rail-editors.ts";
import { formatInstant } from "../../../lib/time-presentation.ts";
import { mountUnsavedChangesGuard } from "../../../lib/unsaved-changes.ts";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import {
  ids,
  personProfile,
  preferences,
  sectionProps,
} from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSection,
} from "../../../testing/render.tsx";
import {
  type CapturedProfileSummary,
  captureProfileSummary,
} from "../profile-summary.test-helper.ts";
import {
  mountPersonReminders,
  PERSON_REMINDERS_ISLAND,
} from "./person-reminders.tsx";

const applicationCss = readApplicationStylesheet("person");
const { person: personId } = ids;
const reminderId = "00000000-0000-4000-8000-000000000900";
const utc = { effectiveTimezone: "UTC", locale: "en" };

const LIST = "GET /api/v1/people/:personId/reminders";
const SUMMARY = "GET /api/v1/people/:personId?include=summary";
const DISABLE = "PUT /api/v1/reminders/:reminderId/active";
const CREATE_REMINDER = "POST /api/v1/reminders";
const CREATE_CADENCE = "POST /api/v1/stay-in-touch-cadences";

/** The two sections as the shell draws them before the island hydrates. */
function shell(): void {
  drawShell(`
    <main id="person-profile-ready">
      <section id="profile-section-reminders" class="profile-section-card" data-profile-section="reminders" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-reminders-heading">
        <header class="profile-section-heading">
          <div class="profile-section-title"><h3 id="profile-section-reminders-heading">Reminders</h3></div>
          <button data-reminder-add class="profile-section-cta" type="button" hidden>Add reminder</button>
        </header>
        <p data-reminder-state class="section-state"><span class="sr-only">Loading reminders…</span></p>
        <ul id="person-reminder-list" data-reminder-list></ul>
        <button data-load-more="reminders" type="button" hidden>Load more reminders</button>
        <form method="post" data-reminder-form hidden novalidate></form>
      </section>
      <section id="profile-section-stay-in-touch" class="profile-section-card profile-rail-block" data-profile-section="stay-in-touch" data-section-state="loading" tabindex="-1" aria-labelledby="profile-section-stay-in-touch-heading">
        <header class="profile-section-heading">
          <h3 id="profile-section-stay-in-touch-heading">Stay in touch</h3>
          <span class="contents" data-rail-count-slot><span class="profile-rail-count" data-profile-rail-count hidden></span></span>
          <button data-cadence-add class="profile-rail-add" type="button" aria-label="Add stay-in-touch cadence" hidden><span aria-hidden="true">+</span></button>
        </header>
        <p data-cadence-state data-rail-editor-feedback class="section-state" tabindex="-1"><span class="sr-only">Loading stay-in-touch cadence…</span></p>
        <ul data-cadence-list></ul>
        <form method="post" data-cadence-form hidden novalidate></form>
      </section>
    </main>`);
}

const reminder = {
  anchorOn: "2026-08-20",
  createdAt: "2026-08-18T10:00:00.000Z",
  id: reminderId,
  isActive: true,
  nextOccurrence: {
    attemptCount: 0,
    deliverAt: "2026-08-20T07:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000901",
    occursOn: "2026-08-20",
    status: "pending",
  },
  personId,
  recurrenceInterval: 1,
  recurrenceUnit: "month",
  sendTime: "09:00:00",
  title: "Call Ada",
  updatedAt: "2026-08-18T10:00:00.000Z",
};

function cadence(overrides: Record<string, unknown> = {}) {
  return {
    id: "cadence",
    intervalCount: 1,
    intervalUnit: "month",
    isActive: true,
    nextDueAt: "2026-09-18T10:00:00.000Z",
    personId,
    updatedAt: "2026-08-18T10:00:00.000Z",
    ...overrides,
  };
}

const listed = (
  reminders: readonly object[] = [],
  cadences: readonly object[] = [],
  extra: Record<string, unknown> = {},
) => jsonResponse({ cadences, reminders, status: "ready", ...extra });

const summaryOf = (nextReminderAt?: string) =>
  jsonResponse({
    dueInformation: {
      detail: "",
      openTaskCount: 0,
      status: "ready",
      ...(nextReminderAt ? { nextReminderAt } : {}),
    },
  });

function mount(archived = false) {
  return mountSection(
    mountPersonReminders,
    sectionProps({ archived, preferences: preferences() }),
    element("#person-profile-ready"),
  );
}

const reminders = () => element("#profile-section-reminders");
const stay = () => element("#profile-section-stay-in-touch");
const reminderForm = () => element<HTMLFormElement>("[data-reminder-form]");
const cadenceForm = () => element<HTMLFormElement>("[data-cadence-form]");
const reminderAdd = () => element<HTMLButtonElement>("[data-reminder-add]");
const cadenceAdd = () => element<HTMLButtonElement>("[data-cadence-add]");
const reminderState = () => element("[data-reminder-state]");
const cadenceState = () => element("[data-cadence-state]");
const submitOf = (form: HTMLFormElement) =>
  within(form).getByRole<HTMLButtonElement>("button", {
    hidden: true,
    name: /^Save/,
  });
const disableButtons = () =>
  within(element("[data-reminder-list]")).queryAllByRole<HTMLButtonElement>(
    "button",
    { name: "Disable reminder" },
  );
const nextReminderAt = "2026-09-21T07:00:00.000000Z";

function lifecycle(detail: Record<string, unknown>): void {
  act(() => {
    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", { detail }),
    );
  });
}

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

// The rail's counts and the hero's vitals are those islands': this one
// publishes them.
let summary: CapturedProfileSummary;
beforeEach(() => {
  summary = captureProfileSummary();
});
afterEach(() => {
  summary.stop();
  vi.unstubAllGlobals();
});

describe("PLANNING-002 person reminders island", () => {
  it("renders both sections over the shell, keeping their headings", async () => {
    shell();
    stubApi({ [LIST]: listed([reminder], [cadence()]) });
    await mount();
    expect(reminders().dataset.island).toBe(PERSON_REMINDERS_ISLAND);
    expect(reminders().hasAttribute("data-island-ready")).toBe(true);
    for (const section of [reminders(), stay()]) {
      expect(section.firstElementChild?.localName).toBe("header");
      expect(section.dataset.sectionState).toBe("ready");
      expect(section.hasAttribute("aria-busy")).toBe(false);
    }
    expect(stay().querySelector("header [data-rail-count-slot]")).not
      .toBeNull();
    expect(document.querySelectorAll("[data-reminder-add]")).toHaveLength(1);
    expect(document.querySelectorAll("[data-cadence-add]")).toHaveLength(1);
    expect(stay().lastElementChild).toBe(cadenceForm());
    expect(reminderState().textContent).toBe("1 reminder.");
    expect(cadenceState().textContent).toBe("Stay-in-touch cadence is active.");
    await expectNoAxeViolations(element("#person-profile-ready"));
  });

  it.each(["success", "failure"])(
    "APR-006 serializes reminder actions through a delayed %s summary",
    async (outcome) => {
      shell();
      const delayedSummary = deferred<Response>();
      const remainingId = "00000000-0000-4000-8000-000000000902";
      const disabledIds = new Set<string>();
      const api = stubApi({
        [DISABLE]: ({ params }) => {
          disabledIds.add(params.reminderId!);
          return jsonResponse({ status: "saved" });
        },
        [CREATE_REMINDER]: jsonResponse({ status: "created" }, 201),
        [CREATE_CADENCE]: jsonResponse({ status: "created" }, 201),
        [SUMMARY]: [delayedSummary.promise, summaryOf()],
        [LIST]: () =>
          listed([reminderId, remainingId].map((id) => ({
            ...reminder,
            id,
            isActive: !disabledIds.has(id),
          }))),
      });
      const writes = () =>
        api.requests().filter((request) => request.method !== "GET").length;
      await mount();
      const [first, second] = disableButtons();
      fireEvent.click(first!);
      await waitFor(() =>
        expect(api.calls().filter((call) => call.includes("summary")))
          .toHaveLength(1)
      );
      // Even programmatic submits and clicks cannot start a second write
      // while the first one's authoritative summary is unresolved.
      fireEvent.click(second!);
      fireEvent.submit(reminderForm());
      fireEvent.submit(cadenceForm());
      expect(writes()).toBe(1);
      expect(disableButtons().every((button) => button.disabled)).toBe(true);
      expect(submitOf(reminderForm()).disabled).toBe(true);
      expect(submitOf(cadenceForm()).disabled).toBe(true);
      expect(reminders().getAttribute("aria-busy")).toBe("true");
      expect(stay().getAttribute("aria-busy")).toBe("true");
      expect(summary.vital("next-reminder")).toBe("Refreshing…");
      delayedSummary.resolve(
        outcome === "failure"
          ? problemResponse(503)
          : summaryOf(nextReminderAt),
      );
      await waitFor(() =>
        expect(submitOf(reminderForm()).disabled).toBe(false)
      );
      expect(summary.vital("next-reminder")).toBe(
        outcome === "failure"
          ? "Unavailable"
          : formatInstant(nextReminderAt, utc),
      );
      fireEvent.click(disableButtons()[0]!);
      await waitFor(() =>
        expect(summary.vital("next-reminder")).toBe("Not recorded")
      );
      await waitFor(() =>
        expect(reminders().hasAttribute("aria-busy")).toBe(false)
      );
      expect(writes()).toBe(2);
      expect(disableButtons()).toHaveLength(0);
    },
  );

  it.each(
    [
      { kind: "reminder", archived: false },
      { kind: "cadence", archived: false },
      { kind: "reminder", archived: true },
      { kind: "cadence", archived: true },
    ] as const,
  )(
    "APR-006 serializes a pending $kind save with archived=$archived and preserves adjacent drafts",
    async ({ kind, archived }) => {
      shell();
      const pendingSave = deferred<Response>();
      const api = stubApi({
        [CREATE_REMINDER]: () => pendingSave.promise,
        [CREATE_CADENCE]: () => pendingSave.promise,
        [DISABLE]: () => pendingSave.promise,
        [SUMMARY]: summaryOf(),
        [LIST]: listed([reminder]),
      });
      await mount();
      const form = kind === "reminder" ? reminderForm() : cadenceForm();
      const otherForm = kind === "reminder" ? cadenceForm() : reminderForm();
      fireEvent.click(kind === "reminder" ? cadenceAdd() : reminderAdd());
      expect(otherForm.hidden).toBe(false);
      const draft = otherForm.querySelector("input")!;
      const text = kind === "reminder" ? "7" : "Adjacent draft";
      fireEvent.input(draft, { target: { value: text } });
      fireEvent.submit(form);
      fireEvent.submit(otherForm);
      fireEvent.click(disableButtons()[0]!);
      expect(
        api.requests().filter((request) => request.method !== "GET"),
      ).toHaveLength(1);
      expect(submitOf(otherForm).disabled).toBe(true);
      expect(reminderAdd().disabled).toBe(true);
      expect(cadenceAdd().disabled).toBe(true);
      if (archived) lifecycle({ archived: true, personId });
      await act(async () => {
        pendingSave.resolve(problemResponse(503));
        await pendingSave.promise;
      });
      await waitFor(() =>
        expect(
          (kind === "cadence" ? stay() : reminders()).hasAttribute("aria-busy"),
        ).toBe(false)
      );
      expect(submitOf(form).disabled).toBe(archived);
      expect(submitOf(otherForm).disabled).toBe(archived);
      expect(otherForm.hidden).toBe(false);
      expect(draft.value).toBe(text);
      if (archived) expect(disableButtons()).toHaveLength(0);
      else expect(disableButtons()[0]!.disabled).toBe(false);
    },
  );

  it("APR-006 identifies a full reminder preview without claiming a known total", async () => {
    shell();
    stubApi({
      [LIST]: listed(
        Array.from({ length: 50 }, (_, index) => ({
          ...reminder,
          id: `reminder-${index}`,
        })),
        [],
        { nextCursor: "reminder-cursor" },
      ),
    });
    await mount();
    expect(reminderState().textContent).toBe("Showing first 50 reminders.");
    expect(
      element<HTMLButtonElement>('[data-load-more="reminders"]').hidden,
    ).toBe(false);
    expect(summary.vital("stay-in-touch")).toBe("Not set");
  });

  it("GAP-023 appends the next reminder page and retires the control", async () => {
    shell();
    const api = stubApi({
      [`${LIST}?cursor=reminder-cursor`]: listed([
        { ...reminder, id: "reminder-2", title: "Second page" },
      ]),
      [LIST]: listed(
        [{ ...reminder, id: "reminder-1", title: "First page" }],
        [],
        { nextCursor: "reminder-cursor" },
      ),
    });
    await mount();
    const more = element<HTMLButtonElement>('[data-load-more="reminders"]');
    expect(more.hidden).toBe(false);
    expect(more.getAttribute("aria-controls")).toBe("person-reminder-list");
    fireEvent.click(more);
    await waitFor(() =>
      expect(element("[data-reminder-list]").textContent).toContain(
        "Second page",
      )
    );
    expect(api.calls().at(-1)).toContain("cursor=reminder-cursor");
    expect(element("[data-reminder-list]").textContent).toContain("First page");
    expect(reminderState().textContent).toBe("2 reminders.");
    expect(more.hidden).toBe(true);
  });

  it.each([true, false])(
    "APR-006 shows an active cadence or unset hero when active=%s",
    async (isActive) => {
      shell();
      stubApi({
        [LIST]: listed([], [
          cadence({ intervalCount: 2, intervalUnit: "week", isActive }),
        ]),
      });
      await mount();
      expect(summary.vital("stay-in-touch")).toBe(
        isActive ? "Every 2 weeks" : "Not set",
      );
      expect(cadenceState().textContent).toBe(
        isActive
          ? "Stay-in-touch cadence is active."
          : "No stay-in-touch cadence yet.",
      );
      expect(stay().dataset.sectionState).toBe(isActive ? "ready" : "empty");
    },
  );

  it("APR-006 refreshes cadence and authoritative next reminder after local writes", async () => {
    shell();
    let created = false;
    let disabled = false;
    let cadenceSaved = false;
    let summaryReads = 0;
    stubApi({
      [SUMMARY]: () => {
        summaryReads += 1;
        return summaryOf(created && !disabled ? nextReminderAt : undefined);
      },
      [CREATE_CADENCE]: () => {
        cadenceSaved = true;
        return jsonResponse({ status: "created" }, 201);
      },
      [CREATE_REMINDER]: () => {
        created = true;
        return jsonResponse({ status: "created" }, 201);
      },
      [DISABLE]: () => {
        disabled = true;
        return jsonResponse({ status: "saved" });
      },
      [LIST]: () =>
        listed(
          // This preview holds an older occurrence: the hero uses the summary.
          created ? [{ ...reminder, isActive: !disabled }] : [],
          cadenceSaved
            ? [cadence({ nextDueAt: "2026-10-05T07:00:00.000000Z" })]
            : [],
        ),
    });
    await mount();
    expect(summary.vital("stay-in-touch")).toBe("Not set");
    expect(summaryReads).toBe(0);
    fireEvent.submit(reminderForm());
    await waitFor(() =>
      expect(summary.vital("next-reminder")).toBe(
        formatInstant(nextReminderAt, utc),
      )
    );
    expect(summary.vital("stay-in-touch")).toBe("Not set");
    await waitFor(() => expect(disableButtons()[0]?.disabled).toBe(false));
    fireEvent.click(disableButtons()[0]!);
    await waitFor(() =>
      expect(summary.vital("next-reminder")).toBe("Not recorded")
    );
    await waitFor(() => expect(submitOf(cadenceForm()).disabled).toBe(false));
    fireEvent.submit(cadenceForm());
    await waitFor(() =>
      expect(summary.vital("stay-in-touch")).toBe("Every 1 month")
    );
    expect(summaryReads).toBe(3);
    expect(summary.railCount("stay-in-touch")).toBe("1");
  });

  it("APR-006 clears an obsolete next reminder when its post-save summary read fails", async () => {
    shell();
    stubApi({
      [SUMMARY]: problemResponse(503),
      [CREATE_REMINDER]: jsonResponse({ status: "created" }, 201),
      [LIST]: listed([reminder]),
    });
    await mount();
    fireEvent.submit(reminderForm());
    await waitFor(() =>
      expect(summary.vital("next-reminder")).toBe("Unavailable")
    );
    await waitFor(() =>
      expect(reminderState().textContent).toBe("1 reminder.")
    );
  });

  it.each(["clean", "declined", "accepted"])(
    "APR-002 gates incoming and outgoing local-editor switches when %s",
    async (decision) => {
      shell();
      stubApi({ [LIST]: listed() });
      await mount();
      mountUnsavedChangesGuard({
        confirmMessage: "Discard?",
        root: document.body,
      });
      const confirm = vi.fn(() => decision === "accepted");
      vi.stubGlobal("confirm", confirm);
      const form = cadenceForm();
      const field = within(form).getByLabelText<HTMLInputElement>(
        "Reconnect every",
      );
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
      const add = cadenceAdd();
      add.focus();
      fireEvent.click(add);
      if (decision === "declined") {
        expect(form.hidden).toBe(true);
        expect(foreign.hidden).toBe(false);
        expect(foreignField.value).toBe("Foreign draft");
        expect(document.activeElement).toBe(foreignField);
        confirm.mockReturnValue(true);
        fireEvent.click(add);
      }
      expect(form.hidden).toBe(false);
      expect(foreign.hidden).toBe(true);
      field.focus();
      if (decision !== "clean") {
        fireEvent.input(field, { target: { value: "4" } });
      }
      const offered = discardRequests(() => decision === "declined");
      add.focus();
      act(() => {
        expect(requestRailEditorOpen(foreign)).toBe(decision !== "declined");
      });
      expect(offered.at(-1)).toContain(form);
      if (decision === "declined") {
        expect(form.hidden).toBe(false);
        expect(field.value).toBe("4");
        fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
        expect(document.activeElement).toBe(add);
      }
      expect(form.hidden).toBe(true);
      expect(field.value).toBe("1");
    },
  );

  it("uses the shared add-form pattern for reminders and cadence", async () => {
    shell();
    stubApi({ [LIST]: listed() });
    await mount();
    for (const kind of ["reminder", "cadence"] as const) {
      const add = kind === "reminder" ? reminderAdd() : cadenceAdd();
      const form = kind === "reminder" ? reminderForm() : cadenceForm();
      const firstControl = form.querySelector("input")!;
      const initialValue = firstControl.defaultValue;
      const reset = vi.fn();
      form.addEventListener("reset", reset);

      expect(add.hidden).toBe(false);
      expect(form.hidden).toBe(true);
      fireEvent.click(add);
      expect(form.hidden).toBe(false);
      expect(document.activeElement).toBe(firstControl);

      fireEvent.input(firstControl, { target: { value: "draft" } });
      fireEvent.click(within(form).getByRole("button", { name: "Cancel" }));
      expect(form.hidden).toBe(true);
      expect(firstControl.value).toBe(initialValue);
      expect(reset).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(add);
    }
    expect(reminderAdd().className).toBe(
      buttonVariants({ className: "profile-section-cta" }),
    );
  });

  it("closes only the rail cadence on a foreign editor without restoring focus", async () => {
    shell();
    stubApi({ [LIST]: listed() });
    await mount();
    fireEvent.click(reminderAdd());
    const add = cadenceAdd();
    fireEvent.click(add);
    const count = within(cadenceForm()).getByLabelText<HTMLInputElement>(
      "Reconnect every",
    );
    count.value = "4";
    const reset = vi.fn();
    cadenceForm().addEventListener("reset", reset);
    const restoreFocus = vi.spyOn(add, "focus");
    const foreign = document.createElement("form");
    const foreignControl = document.createElement("input");
    foreign.append(foreignControl);
    document.body.append(foreign);
    foreignControl.focus();

    act(() => {
      requestRailEditorOpen(foreign);
    });

    expect(reminderForm().hidden).toBe(false);
    expect(cadenceForm().hidden).toBe(true);
    expect(count.value).toBe("1");
    expect(reset).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(foreignControl);
  });

  it("hides each editor after its save succeeds", async () => {
    shell();
    const api = stubApi({
      [CREATE_REMINDER]: jsonResponse({ reminder, status: "created" }, 201),
      [CREATE_CADENCE]: jsonResponse({
        cadence: cadence({ intervalUnit: "day" }),
        status: "created",
      }, 201),
      [SUMMARY]: summaryOf(),
      [LIST]: listed(),
    });
    await mount();
    fireEvent.click(reminderAdd());
    fireEvent.submit(reminderForm());
    await waitFor(() => {
      expect(api.calls()).toHaveLength(4);
      expect(reminderForm().hidden).toBe(true);
    });
    await waitFor(() => expect(cadenceAdd().disabled).toBe(false));
    fireEvent.click(cadenceAdd());
    fireEvent.submit(cadenceForm());
    await waitFor(() => {
      expect(api.calls()).toHaveLength(7);
      expect(cadenceForm().hidden).toBe(true);
    });
  });

  it("shows a muted busy reminder row before save and removes it on failure", async () => {
    shell();
    const failedSave = deferred<Response>();
    const successfulSave = deferred<Response>();
    const refresh = deferred<Response>();
    const api = stubApi({
      [CREATE_REMINDER]: [failedSave.promise, successfulSave.promise],
      [SUMMARY]: summaryOf(),
      [LIST]: [listed(), refresh.promise],
    });
    await mount();
    const user = userEvent.setup();
    await user.click(reminderAdd());
    const fields = within(reminderForm());
    await user.type(fields.getByLabelText("Title"), "Call Ada");
    fireEvent.input(fields.getByLabelText("First date"), {
      target: { value: "2026-08-20" },
    });
    const submit = submitOf(reminderForm());
    const list = element("[data-reminder-list]");

    fireEvent.submit(reminderForm());

    const failedRow = list.querySelector<HTMLLIElement>("[aria-busy=true]")!;
    expect(failedRow.textContent).toBe(
      "Call AdaSaving for 2026-08-20 at 09:00…",
    );
    expect(failedRow.classList).toContain("optimistic-save");
    expect(submit.disabled).toBe(true);
    expect(reminderState().textContent).toBe("Saving reminder…");
    expect(applicationCss).toMatch(
      /\.optimistic-save\s*\{[^}]*color:\s*var\(--ink-3\)/s,
    );
    expect(applicationCss).not.toMatch(
      /\.optimistic-save\s*\{[^}]*opacity\s*:/s,
    );

    await act(async () => {
      failedSave.resolve(problemResponse(503));
      await failedSave.promise;
    });
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(failedRow.isConnected).toBe(false);
    expect(list.querySelector("[aria-busy=true]")).toBeNull();
    expect(reminderForm().hidden).toBe(false);
    expect(reminderState().textContent).toBe(
      "Reminder could not be saved. Review the calendar fields.",
    );

    fireEvent.submit(reminderForm());
    const successfulRow = list.querySelector<HTMLLIElement>(
      "[aria-busy=true]",
    )!;
    expect(successfulRow.textContent).toContain("Call Ada");
    expect(submit.disabled).toBe(true);
    await act(async () => {
      successfulSave.resolve(
        jsonResponse({ reminder, status: "created" }, 201),
      );
      await successfulSave.promise;
    });
    await waitFor(() => expect(api.calls()).toHaveLength(5));
    expect(successfulRow.isConnected).toBe(true);

    await act(async () => {
      refresh.resolve(listed([reminder]));
      await refresh.promise;
    });
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(successfulRow.isConnected).toBe(false);
    expect(list.querySelector("[aria-busy=true]")).toBeNull();
    expect(list.textContent).toContain("Call Ada");
    const [first, second] = api.bodies() as { requestId: string }[];
    expect(first).toMatchObject({
      anchorOn: "2026-08-20",
      personId,
      recurrenceInterval: 1,
      recurrenceUnit: "none",
      sendTime: "09:00",
      title: "Call Ada",
    });
    expect(second!.requestId).toBe(first!.requestId);
  });

  it("shows a muted busy cadence row before save and removes it on failure", async () => {
    shell();
    mountUnsavedChangesGuard({
      confirmMessage: "Discard?",
      root: document.body,
    });
    const failedSave = deferred<Response>();
    const successfulSave = deferred<Response>();
    const refresh = deferred<Response>();
    const api = stubApi({
      [CREATE_CADENCE]: [failedSave.promise, successfulSave.promise],
      [SUMMARY]: summaryOf(),
      [LIST]: [listed(), refresh.promise],
    });
    await mount();
    fireEvent.click(cadenceAdd());
    const saved = vi.fn();
    cadenceForm().addEventListener("kinship:form-saved", saved);
    const submit = submitOf(cadenceForm());
    const list = element("[data-cadence-list]");
    const intervalCount = within(cadenceForm()).getByLabelText(
      "Reconnect every",
    );
    intervalCount.focus();
    fireEvent.input(intervalCount, { target: { value: "2" } });
    fireEvent.change(within(cadenceForm()).getByLabelText("Calendar unit"), {
      target: { value: "month" },
    });

    fireEvent.submit(cadenceForm());

    const failedRow = list.querySelector<HTMLLIElement>("[aria-busy=true]")!;
    expect(failedRow.textContent).toBe(
      "Every 2 monthsSaving stay-in-touch cadence…",
    );
    expect(failedRow.classList).toContain("optimistic-save");
    expect(submit.disabled).toBe(true);
    expect(cadenceForm().hasAttribute("inert")).toBe(true);
    expect(
      globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);

    await act(async () => {
      failedSave.resolve(problemResponse(503));
      await failedSave.promise;
    });
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(failedRow.isConnected).toBe(false);
    expect(list.querySelector("[aria-busy=true]")).toBeNull();
    expect(cadenceForm().hidden).toBe(false);
    expect(cadenceForm().hasAttribute("inert")).toBe(false);
    expect(cadenceState().textContent).toBe("Cadence could not be saved.");
    expect(document.activeElement).toBe(cadenceState());
    expect(
      globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);

    fireEvent.submit(cadenceForm());
    const successfulRow = list.querySelector<HTMLLIElement>(
      "[aria-busy=true]",
    )!;
    expect(successfulRow.textContent).toContain("Every 2 months");
    expect(submit.disabled).toBe(true);
    await act(async () => {
      successfulSave.resolve(jsonResponse({
        cadence: cadence(),
        status: "created",
      }, 201));
      await successfulSave.promise;
    });
    await waitFor(() => expect(api.calls()).toHaveLength(5));
    // The saved draft is the page guard's new baseline. (happy-dom hands the
    // guard a different object for a script-created form than the form's own
    // events carry, so the event itself is what is checked.)
    expect(saved).toHaveBeenCalledOnce();
    expect(successfulRow.isConnected).toBe(true);

    await act(async () => {
      refresh.resolve(listed([], [cadence()]));
      await refresh.promise;
    });
    await waitFor(() => expect(submit.disabled).toBe(false));
    expect(successfulRow.isConnected).toBe(false);
    expect(list.querySelector("[aria-busy=true]")).toBeNull();
    expect(list.textContent).toContain("Every 1 month");
    const [first, second] = api.bodies() as { requestId: string }[];
    expect(first).toMatchObject({
      intervalCount: 2,
      intervalUnit: "month",
      personId,
    });
    expect(second!.requestId).toBe(first!.requestId);
  });

  it.each([problemResponse(503), unreachable])(
    "keeps add controls hidden when reminders fail to load (%#)",
    async (failure) => {
      shell();
      stubApi({ [LIST]: failure });
      await mount();
      expect(reminderAdd().hidden).toBe(true);
      expect(cadenceAdd().hidden).toBe(true);
      expect(reminders().dataset.sectionState).toBe("error");
      expect(stay().dataset.sectionState).toBe("error");
      expect(reminderState().textContent).toBe(
        "Reminders could not be loaded. Retry this section.",
      );
      expect(cadenceState().textContent).toBe(
        "Cadence could not be loaded. Other profile sections remain available.",
      );
      expect(summary.vital("stay-in-touch")).toBe("Unavailable");
      expect(summary.railCount("stay-in-touch")).toBeUndefined();
      expect(summary.railEmpty("stay-in-touch")).toBe(false);
    },
  );

  it("loads reminder and cadence and keeps archived mutations disabled", async () => {
    shell();
    stubApi({
      [LIST]: listed([{
        ...reminder,
        nextOccurrence: {
          ...reminder.nextOccurrence,
          status: "sent",
          visibleAt: "2026-08-20T07:00:01.000Z",
        },
      }], [cadence()]),
    });
    await mount(true);
    expect(element("[data-reminder-list]").textContent).toContain("Call Ada");
    expect(element("[data-reminder-list]").textContent).toContain(
      "Notification visible",
    );
    expect(element("[data-cadence-list]").textContent).toContain(
      "Every 1 month",
    );
    expect(summary.railCount("stay-in-touch")).toBe("1");
    expect(summary.railEmpty("stay-in-touch")).toBe(false);
    expect(disableButtons()).toHaveLength(0);
    expect(submitOf(reminderForm()).disabled).toBe(true);
    expect(submitOf(cadenceForm()).disabled).toBe(true);
    expect(reminderAdd().hidden).toBe(true);
    expect(cadenceAdd().hidden).toBe(true);
  });

  it("collapses an empty archived stay-in-touch block", async () => {
    shell();
    stubApi({ [LIST]: listed() });
    await mount(true);
    expect(summary.railEmpty("stay-in-touch")).toBe(true);
    expect(stay().dataset.sectionState).toBe("empty");
    expect(reminders().dataset.sectionState).toBe("empty");
  });

  it("reuses the reminder request id after an ambiguous create failure", async () => {
    shell();
    const api = stubApi({
      [CREATE_REMINDER]: [
        unreachable,
        jsonResponse({ reminder, status: "created" }, 201),
      ],
      [SUMMARY]: summaryOf(),
      [LIST]: [listed(), listed([reminder])],
    });
    await mount();
    expect(summary.railCount("stay-in-touch")).toBe("0");
    expect(summary.railEmpty("stay-in-touch")).toBe(true);
    fireEvent.submit(reminderForm());
    await waitFor(() =>
      expect(reminderState().textContent).toContain("could not")
    );
    fireEvent.submit(reminderForm());
    await waitFor(() => expect(api.calls()).toHaveLength(5));
    const posts = api.requests().filter((request) => request.method === "POST");
    expect(posts).toHaveLength(2);
    expect((posts[1]!.body as { requestId: string }).requestId).toBe(
      (posts[0]!.body as { requestId: string }).requestId,
    );
  });

  it("becomes read-only immediately when the person lifecycle changes", async () => {
    shell();
    stubApi({ [LIST]: listed([reminder]) });
    await mount();
    expect(disableButtons()[0]?.className).toBe(
      buttonVariants({ variant: "outline" }),
    );
    lifecycle({ archived: true, personId: "someone-else" });
    lifecycle({ archived: "yes", personId });
    expect(disableButtons()).toHaveLength(1);

    lifecycle({ archived: true, personId, state: "archived" });

    expect(submitOf(reminderForm()).disabled).toBe(true);
    expect(submitOf(cadenceForm()).disabled).toBe(true);
    expect(reminderAdd().hidden).toBe(true);
    expect(cadenceAdd().hidden).toBe(true);
    expect(disableButtons()).toHaveLength(0);
    fireEvent.submit(reminderForm());
    expect(reminderState().textContent).toBe("1 reminder.");
  });

  it("reads both sections again when the person is restored", async () => {
    shell();
    const api = stubApi({ [LIST]: listed([reminder]) });
    await mount(true);
    expect(disableButtons()).toHaveLength(0);
    lifecycle({ archived: false, personId, state: "active" });
    expect(reminderState().textContent).toBe("Loading reminders…");
    expect(cadenceState().textContent).toBe("Loading stay-in-touch cadence…");
    expect(summary.vital("stay-in-touch")).toBe("Loading cadence…");
    await waitFor(() =>
      expect(reminderState().textContent).toBe("1 reminder.")
    );
    expect(api.calls()).toHaveLength(2);
    expect(disableButtons()).toHaveLength(1);
    expect(reminderAdd().hidden).toBe(false);
  });

  it("says so when a reminder cannot be disabled", async () => {
    shell();
    const api = stubApi({
      [DISABLE]: problemResponse(409),
      [LIST]: listed([reminder]),
    });
    await mount();
    fireEvent.click(disableButtons()[0]!);
    expect(reminderState().textContent).toBe("Disabling reminder…");
    await waitFor(() =>
      expect(reminderState().textContent).toBe(
        "Reminder could not be disabled.",
      )
    );
    expect(api.calls()).toHaveLength(2);
    expect(disableButtons()[0]!.disabled).toBe(false);
  });

  it("holds both sections busy until the first read answers", async () => {
    shell();
    const first = deferred<Response>();
    stubApi({ [LIST]: first.promise });
    const mounted = mountPending(() =>
      mountPersonReminders(
        element("#person-profile-ready"),
        sectionProps({ preferences: preferences() }),
      )
    );
    expect(reminders().getAttribute("aria-busy")).toBe("true");
    expect(reminders().dataset.sectionState).toBe("loading");
    expect(reminderState().textContent).toBe("Loading reminders…");
    expect(reminderAdd().hidden).toBe(true);
    await act(async () => {
      first.resolve(listed([reminder]));
      await mounted;
    });
    expect(reminders().hasAttribute("aria-busy")).toBe(false);
    expect(reminderAdd().disabled).toBe(false);
  });

  it("REL-049 resolves once the settled add controls are drawn", async () => {
    shell();
    stubApi({ [LIST]: listed() });
    // Outside `act`, as the page mounts it: the page acts on the block as
    // soon as the mount resolves.
    const unmount = await mountPersonReminders(
      element("#person-profile-ready"),
      sectionProps({ preferences: preferences() }),
    );
    onTestFinished(() => act(unmount));
    expect(cadenceAdd().hidden).toBe(false);
    expect(cadenceAdd().disabled).toBe(false);
  });

  it("lets a restore's read replace a pending page, and a pending write hold the restore", async () => {
    shell();
    const page = deferred<Response>();
    const save = deferred<Response>();
    const api = stubApi({
      [`${LIST}?cursor=next`]: () => page.promise,
      [CREATE_REMINDER]: () => save.promise,
      [SUMMARY]: summaryOf(),
      [LIST]: listed([reminder], [], { nextCursor: "next" }),
    });
    await mount();
    fireEvent.click(element('[data-load-more="reminders"]'));
    lifecycle({ archived: false, personId });
    await waitFor(() =>
      expect(reminderState().textContent).toContain("Showing")
    );
    await act(async () => {
      page.resolve(listed([{ ...reminder, id: "late", title: "Late page" }]));
      await page.promise;
    });
    expect(element("[data-reminder-list]").textContent).not.toContain(
      "Late page",
    );
    fireEvent.submit(reminderForm());
    const reads = api.calls().length;
    lifecycle({ archived: false, personId });
    expect(api.calls()).toHaveLength(reads);
    await act(async () => {
      save.resolve(problemResponse(503));
      await save.promise;
    });
    await waitFor(() =>
      expect(reminders().hasAttribute("aria-busy")).toBe(false)
    );
  });

  it("hides Load more while a write refreshes both sections", async () => {
    shell();
    const summaryRead = deferred<Response>();
    const api = stubApi({
      [`${LIST}?cursor=next`]: listed([{
        ...reminder,
        id: "old",
        title: "Old",
      }]),
      [CREATE_REMINDER]: jsonResponse({ reminder, status: "created" }, 201),
      [SUMMARY]: () => summaryRead.promise,
      [LIST]: listed([reminder], [], { nextCursor: "next" }),
    });
    await mount();
    fireEvent.submit(reminderForm());
    await waitFor(() =>
      expect(api.calls().some((call) => call.includes("summary"))).toBe(true)
    );
    expect(element('[data-load-more="reminders"]').hidden).toBe(true);
    await act(async () => {
      summaryRead.resolve(summaryOf(nextReminderAt));
      await summaryRead.promise;
    });
    await waitFor(() =>
      expect(summary.vital("next-reminder")).toBe(
        formatInstant(nextReminderAt, utc),
      )
    );
    expect(reminderState().textContent).toBe("Showing first 1 reminders.");
    expect(element('[data-load-more="reminders"]').hidden).toBe(false);
    expect(api.calls().some((call) => call.includes("cursor=next")))
      .toBe(false);
  });

  it("works without the shell's headings", async () => {
    drawShell(`
      <main id="person-profile-ready">
        <section data-profile-section="reminders"><form data-reminder-form hidden></form></section>
        <section class="profile-rail-block" data-profile-section="stay-in-touch"><form data-cadence-form hidden></form></section>
      </main>`);
    stubApi({ [LIST]: listed([reminder]) });
    await mount();
    expect(reminderState().textContent).toBe("1 reminder.");
    expect(document.querySelector("[data-reminder-add]")).toBeNull();
    expect(document.querySelector("[data-cadence-add]")).toBeNull();
  });

  it("resolves at once without both sections", async () => {
    drawShell('<main id="person-profile-ready"></main>');
    const api = stubApi();
    await mount();
    expect(api.fetch).not.toHaveBeenCalled();
  });
});

describe("REL-052 person reminders status lines", () => {
  // Mounted during the initial fan-out, the line waits for the workspace's
  // promotion (UXD-003B); mounted after it, the line is its own live region
  // from the first commit.
  it.each([false, true])(
    "owns both lines' live regions from the first commit only once states are live (%s)",
    async (live) => {
      shell();
      const first = deferred<Response>();
      stubApi({ [LIST]: first.promise });
      const mounted = mountPending(() =>
        mountPersonReminders(
          element("#person-profile-ready"),
          sectionProps({ preferences: preferences(), statesLive: () => live }),
        )
      );
      const lines = [reminderState(), element("[data-cadence-state]")];
      for (const line of lines) {
        expect(line.getAttribute("role")).toBe(live ? "status" : null);
        expect(line.getAttribute("aria-live")).toBe(live ? "polite" : null);
      }
      await act(async () => {
        first.resolve(listed([reminder]));
        await mounted;
      });
      expect(lines.map((line) => line.isConnected)).toEqual([true, true]);
    },
  );
});

describe("AUD-Q3 reminders from the person read", () => {
  const mountWith = (entry: unknown) =>
    mountSection(
      mountPersonReminders,
      sectionProps({
        initial: { ...personProfile(), rail: { reminders: entry } } as
          & ReturnType<typeof personProfile>
          & { readonly rail: never },
        preferences: preferences(),
      }),
      element("#person-profile-ready"),
    );

  it("shows the reminders and cadence that came with the person read without reading them", async () => {
    shell();
    const api = stubApi({ [LIST]: unreachable });
    await mountWith({
      status: "ready",
      value: { cadences: [cadence()], reminders: [reminder], status: "ready" },
    });
    expect(reminders().dataset.sectionState).toBe("ready");
    expect(stay().dataset.sectionState).toBe("ready");
    expect(within(reminders()).getAllByText("Call Ada")).not.toHaveLength(0);
    expect(api.calls()).toEqual([]);
  });

  it.each(["hidden", "unavailable"] as const)(
    "shows a %s rail section as its own error without reading",
    async (status) => {
      shell();
      const api = stubApi({ [LIST]: unreachable });
      await mountWith({ status });
      expect(reminders().dataset.sectionState).toBe("error");
      expect(stay().dataset.sectionState).toBe("error");
      expect(api.calls()).toEqual([]);
    },
  );
});
