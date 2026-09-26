import { loadTimePreferences } from "./time-presentation.ts";
import { formatInstant } from "./time-presentation.ts";
// @vitest-environment happy-dom

vi.mock("./time-presentation.ts", async (original) => ({
  ...await original<typeof import("./time-presentation.ts")>(),
  loadTimePreferences: vi.fn().mockResolvedValue({
    locale: "en",
    effectiveTimezone: "UTC",
  }),
}));
import { mountUnsavedChangesGuard } from "./unsaved-changes.ts";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readApplicationStylesheet } from "./application-stylesheet.test-helper.ts";
import { registerRailEditors, requestRailEditorOpen } from "./rail-editors.ts";
import { mountPersonReminders, mountTodayReminders } from "./reminders.ts";
import { buttonVariants } from "../components/ui/variants.ts";

const applicationCss = readApplicationStylesheet();

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";
const reminderId = "00000000-0000-4000-8000-000000000900";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function personMarkup(): void {
  document.body.innerHTML = `
    <span id="person-profile-due-state">Loading cadence…</span>
    <span data-person-vital-value="next-reminder">Not recorded</span>
    <section data-profile-section="reminders">
      <p data-reminder-state></p><ul data-reminder-list></ul>
      <button data-load-more="reminders" hidden>Load more reminders</button>
      <button data-reminder-add type="button" hidden>Add reminder</button>
      <form data-reminder-form hidden><input name="title"><input name="anchorOn"><input name="sendTime"><select name="recurrenceUnit"><option value="month">month</option></select><input name="recurrenceInterval"><button type="submit">Save</button><button data-reminder-cancel type="button">Cancel</button></form>
    </section>
    <section data-profile-section="stay-in-touch">
      <span data-profile-rail-count hidden></span>
      <p data-cadence-state tabindex="-1"></p><ul data-cadence-list></ul>
      <button data-cadence-add type="button" hidden>Add stay-in-touch cadence</button>
      <form data-cadence-form hidden><input name="intervalCount" value="1"><select name="intervalUnit"><option value="month">month</option></select><button type="submit">Save</button><button data-cadence-cancel type="button">Cancel</button></form>
    </section>`;
}

function todayMarkup(): void {
  document.body.innerHTML = `
    <p id="today-reminders-state"></p><ul id="today-reminders-list"></ul><button id="today-reminders-retry" class="today-touch-target" type="button" hidden>Retry</button>
    <p id="today-cadences-state"></p><ul id="today-cadences-list"></ul><button id="today-cadences-retry" class="today-touch-target" type="button" hidden>Retry cadence</button>`;
  sessionStorage.setItem(
    "kinship.workspace.session",
    JSON.stringify({
      member: { id: "member", role: "member" },
      principal: { userId: "user" },
      status: "authenticated",
      workspace: { id: workspaceId, name: "Circle" },
      workspaces: [{ id: workspaceId, name: "Circle" }],
    }),
  );
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

const session = {
  member: { id: "member", role: "member" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
};

function todaySnapshot(title = "Call Ada") {
  return {
    cadences: [{
      dueAt: "2026-08-18T08:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000903",
      person: { archived: false, id: personId, name: "Ada Lovelace" },
    }],
    reminders: [{
      attemptCount: 0,
      deliverAt: "2026-08-18T08:00:00.000Z",
      id: reminderId,
      person: { archived: false, id: personId, name: "Ada Lovelace" },
      status: "pending",
      title,
    }],
    status: "ready",
    timezone: "Europe/Belgrade",
  };
}

function todayFetch(...snapshots: Array<Response | Promise<Response>>) {
  let index = 0;
  return vi.fn((input: string | URL | Request) =>
    String(input).includes("/session")
      ? Promise.resolve(response(session))
      : Promise.resolve(snapshots[index++])
  );
}

function deferredResponse() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((done) => resolve = done);
  return { promise, resolve };
}

function observedResponse(body: unknown, status = 200) {
  const value = response(body, status);
  let consumed!: () => void;
  const consumedPromise = new Promise<void>((done) => consumed = done);
  const json = value.json.bind(value);
  Object.defineProperty(value, "json", {
    value: async () => {
      const parsed = await json();
      consumed();
      return parsed;
    },
  });
  return { consumed: consumedPromise, value };
}

async function settleResponse(
  deferred: ReturnType<typeof deferredResponse>,
  observed: ReturnType<typeof observedResponse>,
): Promise<void> {
  deferred.resolve(observed.value);
  await observed.consumed;
  for (let turn = 0; turn < 6; turn += 1) await Promise.resolve();
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.head.innerHTML = "";
  document.body.innerHTML = "";
  void mountTodayReminders();
  sessionStorage.clear();
});

describe("PLANNING-002 reminder browser behavior", () => {
  it.each(["success", "failure"])(
    "APR-006 serializes reminder actions through a delayed %s summary",
    async (outcome) => {
      personMarkup();
      const delayedSummary = deferredResponse();
      const remainingId = "00000000-0000-4000-8000-000000000902";
      const disabledIds = new Set<string>();
      let summaryReads = 0;
      const writes = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn((resource: string | URL | Request, init?: RequestInit) => {
          const url = String(resource);
          if (init?.method === "PUT") {
            writes();
            disabledIds.add(
              url.includes(remainingId) ? remainingId : reminderId,
            );
            return response({ status: "saved" });
          }
          if (init?.method === "POST") {
            writes();
            return response({ status: "created" }, 201);
          }
          if (url.includes("include=summary")) {
            summaryReads += 1;
            return summaryReads === 1
              ? delayedSummary.promise
              : response({ dueInformation: { status: "ready" } });
          }
          return response({
            cadences: [],
            status: "ready",
            reminders: [reminderId, remainingId].map((id) => ({
              ...reminder,
              id,
              isActive: !disabledIds.has(id),
            })),
          });
        }),
      );
      await mountPersonReminders({
        timePreferences: { locale: "en", effectiveTimezone: "UTC" },
        archived: false,
        personId,
        workspaceId,
      });
      const disableButtons = [
        ...document.querySelectorAll<HTMLButtonElement>(
          "[data-reminder-list] button",
        ),
      ];
      disableButtons[0]!.click();
      await vi.waitFor(() => expect(summaryReads).toBe(1));
      // Even programmatic submits/clicks cannot enter a second write while
      // the first mutation's authoritative summary remains unresolved.
      disableButtons[1]!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      for (const kind of ["reminder", "cadence"]) {
        document.querySelector<HTMLFormElement>(`[data-${kind}-form]`)!
          .dispatchEvent(
            new SubmitEvent("submit", { cancelable: true, bubbles: true }),
          );
      }
      expect(writes).toHaveBeenCalledTimes(1);
      expect(disableButtons.every((button) => button.disabled)).toBe(true);
      expect(
        document.querySelector<HTMLButtonElement>(
          "[data-reminder-form] [type=submit]",
        )!.disabled,
      ).toBe(true);
      expect(
        document.querySelector<HTMLButtonElement>(
          "[data-cadence-form] [type=submit]",
        )!.disabled,
      ).toBe(true);
      expect(
        document.querySelector('[data-profile-section="reminders"]')
          ?.getAttribute("aria-busy"),
      ).toBe("true");
      delayedSummary.resolve(
        outcome === "failure" ? response({}, 503) : response({
          dueInformation: {
            status: "ready",
            nextReminderAt: "2026-09-21T07:00:00.000000Z",
          },
        }),
      );
      await vi.waitFor(() =>
        expect(
          document.querySelector<HTMLButtonElement>(
            "[data-reminder-form] [type=submit]",
          )!.disabled,
        ).toBe(false)
      );
      expect(
        document.querySelector('[data-person-vital-value="next-reminder"]')
          ?.textContent,
      ).toBe(
        outcome === "failure"
          ? "Unavailable"
          : formatInstant("2026-09-21T07:00:00.000000Z", {
            locale: "en",
            effectiveTimezone: "UTC",
          }),
      );
      document.querySelector<HTMLButtonElement>("[data-reminder-list] button")!
        .click();
      await vi.waitFor(() =>
        expect(
          document.querySelector('[data-person-vital-value="next-reminder"]')
            ?.textContent,
        ).toBe("Not recorded")
      );
      expect(writes).toHaveBeenCalledTimes(2);
      expect(
        document.querySelector('[data-profile-section="reminders"]')
          ?.hasAttribute("aria-busy"),
      ).toBe(false);
    },
  );

  it.each([
    { kind: "reminder", archived: false },
    { kind: "cadence", archived: false },
    { kind: "reminder", archived: true },
    { kind: "cadence", archived: true },
  ])(
    "APR-006 serializes a pending $kind save with archived=$archived and preserves adjacent drafts",
    async ({ kind, archived }) => {
      personMarkup();
      const pendingSave = deferredResponse();
      const writes = vi.fn();
      vi.stubGlobal(
        "fetch",
        vi.fn((resource: string | URL | Request, init?: RequestInit) => {
          if (init?.method === "POST" || init?.method === "PUT") {
            writes();
            return pendingSave.promise;
          }
          if (String(resource).includes("include=summary")) {
            return response({ dueInformation: { status: "ready" } });
          }
          return response({
            cadences: [],
            reminders: [reminder],
            status: "ready",
          });
        }),
      );
      await mountPersonReminders({
        timePreferences: { locale: "en", effectiveTimezone: "UTC" },
        archived: false,
        personId,
        workspaceId,
      });
      const form = document.querySelector<HTMLFormElement>(
        `[data-${kind}-form]`,
      )!;
      const other = kind === "reminder" ? "cadence" : "reminder";
      const otherForm = document.querySelector<HTMLFormElement>(
        `[data-${other}-form]`,
      )!;
      const draft = otherForm.querySelector<HTMLInputElement>("input")!;
      otherForm.hidden = false;
      draft.value = "Adjacent draft";
      draft.dispatchEvent(new Event("input", { bubbles: true }));
      form.dispatchEvent(
        new SubmitEvent("submit", { cancelable: true, bubbles: true }),
      );
      document.querySelector<HTMLFormElement>(`[data-${other}-form]`)!
        .dispatchEvent(
          new SubmitEvent("submit", { cancelable: true, bubbles: true }),
        );
      document.querySelector<HTMLButtonElement>("[data-reminder-list] button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
      expect(writes).toHaveBeenCalledTimes(1);
      expect(
        document.querySelector<HTMLButtonElement>(
          `[data-${other}-form] [type=submit]`,
        )!.disabled,
      ).toBe(true);
      expect(
        document.querySelector<HTMLButtonElement>("[data-reminder-add]")!
          .disabled,
      ).toBe(true);
      expect(
        document.querySelector<HTMLButtonElement>("[data-cadence-add]")!
          .disabled,
      ).toBe(true);
      if (archived) {
        document.dispatchEvent(
          new CustomEvent("person-lifecycle-changed", {
            detail: { personId, archived: true },
          }),
        );
      }
      pendingSave.resolve(response({}, 503));
      await vi.waitFor(() =>
        expect(
          document.querySelector(
            `[data-profile-section="${
              kind === "cadence" ? "stay-in-touch" : "reminders"
            }"]`,
          )!.hasAttribute("aria-busy"),
        ).toBe(false)
      );
      expect(form.querySelector<HTMLButtonElement>("[type=submit]")!.disabled)
        .toBe(archived);
      expect(
        otherForm.querySelector<HTMLButtonElement>("[type=submit]")!.disabled,
      ).toBe(archived);
      expect(otherForm.hidden).toBe(false);
      expect(draft.value).toBe("Adjacent draft");
      if (archived) {
        expect(document.querySelector("[data-reminder-list] button"))
          .toBeNull();
      } else {expect(
          document.querySelector<HTMLButtonElement>(
            "[data-reminder-list] button",
          )!.disabled,
        ).toBe(false);}
    },
  );

  it("APR-006 identifies a full reminder preview without claiming a known total", async () => {
    personMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        cadences: [],
        nextCursor: "reminder-cursor",
        reminders: Array.from(
          { length: 50 },
          (_, index) => ({ ...reminder, id: `reminder-${index}` }),
        ),
        status: "ready",
      })),
    );
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });
    expect(document.querySelector("[data-reminder-state]")?.textContent).toBe(
      "Showing first 50 reminders.",
    );
    expect(
      document.querySelector<HTMLButtonElement>('[data-load-more="reminders"]')
        ?.hidden,
    ).toBe(false);
    expect(document.querySelector("#person-profile-due-state")?.textContent)
      .toBe("Not set");
  });

  it("GAP-023 appends the next reminder page and retires the control", async () => {
    personMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        cadences: [],
        nextCursor: "reminder-cursor",
        reminders: [{ ...reminder, id: "reminder-1", title: "First page" }],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        cadences: [],
        reminders: [{ ...reminder, id: "reminder-2", title: "Second page" }],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });
    const more = document.querySelector<HTMLButtonElement>(
      '[data-load-more="reminders"]',
    )!;
    expect(more.hidden).toBe(false);
    more.click();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-reminder-list]")?.textContent)
        .toContain("Second page")
    );
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain(
      "cursor=reminder-cursor",
    );
    expect(document.querySelector("[data-reminder-list]")?.textContent)
      .toContain("First page");
    expect(document.querySelector("[data-reminder-state]")?.textContent).toBe(
      "2 reminders.",
    );
    expect(more.hidden).toBe(true);
  });
  it.each([true, false])(
    "APR-006 shows an active cadence or unset hero when active=%s",
    async (isActive) => {
      personMarkup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response({
          cadences: [{
            id: "cadence",
            isActive,
            intervalCount: 2,
            intervalUnit: "week",
            nextDueAt: "2026-09-20T07:00:00.000000Z",
            personId,
          }],
          reminders: [],
          status: "ready",
        })),
      );
      await mountPersonReminders({
        timePreferences: { locale: "en", effectiveTimezone: "UTC" },
        archived: false,
        personId,
        workspaceId,
      });
      expect(document.querySelector("#person-profile-due-state")?.textContent)
        .toBe(isActive ? "Every 2 weeks" : "Not set");
      expect(document.querySelector("[data-cadence-state]")?.textContent).toBe(
        isActive
          ? "Stay-in-touch cadence is active."
          : "No stay-in-touch cadence yet.",
      );
    },
  );

  it("APR-006 refreshes cadence and authoritative next reminder after local writes", async () => {
    personMarkup();
    let created = false;
    let disabled = false;
    let cadenceSaved = false;
    const summaryReads = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request, init?: RequestInit) => {
        const url = String(resource);
        if (url.includes("include=summary")) {
          summaryReads();
          return response({
            dueInformation: {
              ...(created && !disabled
                ? { nextReminderAt: "2026-09-21T07:00:00.000000Z" }
                : {}),
              openTaskCount: 7,
              detail: "7 open tasks",
              status: "ready",
            },
          });
        }
        if (init?.method === "POST") {
          if (url.includes("cadences")) cadenceSaved = true;
          else created = true;
          return response({ status: "created" }, 201);
        }
        if (init?.method === "PUT") {
          disabled = true;
          return response({ status: "updated" });
        }
        return response({
          cadences: cadenceSaved
            ? [{
              id: "cadence",
              isActive: true,
              intervalCount: 1,
              intervalUnit: "month",
              nextDueAt: "2026-10-05T07:00:00.000000Z",
              personId,
            }]
            : [],
          // This preview contains an older occurrence. The hero must use the summary.
          reminders: created ? [{ ...reminder, isActive: !disabled }] : [],
          status: "ready",
        });
      }),
    );
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });
    expect(document.querySelector("#person-profile-due-state")?.textContent)
      .toBe("Not set");
    expect(summaryReads).not.toHaveBeenCalled();
    document.querySelector<HTMLFormElement>("[data-reminder-form]")!
      .requestSubmit();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-person-vital-value="next-reminder"]')
          ?.textContent,
      ).toBe(
        formatInstant("2026-09-21T07:00:00.000000Z", {
          locale: "en",
          effectiveTimezone: "UTC",
        }),
      )
    );
    expect(document.querySelector("#person-profile-due-state")?.textContent)
      .toBe("Not set");
    document.querySelector<HTMLButtonElement>("[data-reminder-list] button")!
      .click();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-person-vital-value="next-reminder"]')
          ?.textContent,
      ).toBe("Not recorded")
    );
    document.querySelector<HTMLFormElement>("[data-cadence-form]")!
      .requestSubmit();
    await vi.waitFor(() =>
      expect(document.querySelector("#person-profile-due-state")?.textContent)
        .toBe("Every 1 month")
    );
    expect(summaryReads).toHaveBeenCalledTimes(3);
  });

  it("APR-006 clears an obsolete next reminder when its post-save summary read fails", async () => {
    personMarkup();
    document.querySelector('[data-person-vital-value="next-reminder"]')!
      .textContent = "Old reminder";
    vi.stubGlobal(
      "fetch",
      vi.fn((resource: string | URL | Request, init?: RequestInit) => {
        if (String(resource).includes("include=summary")) {
          return response({}, 503);
        }
        if (init?.method === "POST") {
          return response({ status: "created" }, 201);
        }
        return response({
          cadences: [],
          reminders: [reminder],
          status: "ready",
        });
      }),
    );
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });
    document.querySelector<HTMLFormElement>("[data-reminder-form]")!
      .requestSubmit();
    await vi.waitFor(() =>
      expect(
        document.querySelector('[data-person-vital-value="next-reminder"]')
          ?.textContent,
      ).toBe("Unavailable")
    );
    expect(document.querySelector("[data-reminder-state]")?.textContent).toBe(
      "1 reminder.",
    );
  });

  it.each(["clean", "declined", "accepted"])(
    "APR-002 gates incoming and outgoing local-editor switches when %s",
    async (decision) => {
      personMarkup();
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          response({ cadences: [], reminders: [], status: "ready" }),
        ),
      );
      await mountPersonReminders({
        timePreferences: { locale: "en", effectiveTimezone: "UTC" },
        archived: false,
        personId,
        workspaceId,
      });
      mountUnsavedChangesGuard({
        confirmMessage: "Discard?",
        root: document.body,
      });
      const confirm = vi.fn(() => decision === "accepted");
      vi.stubGlobal("confirm", confirm);
      const add = document.querySelector<HTMLButtonElement>(
        "[data-cadence-add]",
      )!;
      const form = document.querySelector<HTMLFormElement>(
        "[data-cadence-form]",
      )!;
      const field = form.querySelector<HTMLInputElement | HTMLTextAreaElement>(
        'input[name="intervalCount"]',
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
        field.value = "4";
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
      confirm.mockClear().mockReturnValue(decision === "accepted");
      add.focus();
      expect(requestRailEditorOpen(foreign)).toBe(decision !== "declined");
      expect(confirm).toHaveBeenCalledTimes(decision === "clean" ? 0 : 1);
      if (decision === "declined") {
        expect(form.hidden).toBe(false);
        expect(field.value).toBe("4");
        expect(document.activeElement).toBe(field);
        form.querySelector<HTMLButtonElement>("[data-cadence-cancel]")!.click();
        expect(document.activeElement).toBe(add);
        expect(confirm).toHaveBeenCalledOnce();
      }
      expect(form.hidden).toBe(true);
      expect(field.value).toBe("1");
    },
  );

  it("uses the shared add-form pattern for reminders and cadence", async () => {
    personMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        cadences: [],
        reminders: [],
        status: "ready",
      })),
    );

    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });

    for (const kind of ["reminder", "cadence"] as const) {
      const add = document.querySelector<HTMLButtonElement>(
        `[data-${kind}-add]`,
      )!;
      const form = document.querySelector<HTMLFormElement>(
        `[data-${kind}-form]`,
      )!;
      const firstControl = form.querySelector<HTMLInputElement>("input")!;
      const initialValue = firstControl.defaultValue;
      const reset = vi.fn();
      form.addEventListener("reset", reset);

      expect(add.hidden).toBe(false);
      expect(form.hidden).toBe(true);
      add.click();
      expect(form.hidden).toBe(false);
      expect(document.activeElement).toBe(firstControl);

      firstControl.value = "draft";
      form.querySelector<HTMLButtonElement>(`[data-${kind}-cancel]`)!.click();
      expect(form.hidden).toBe(true);
      expect(firstControl.value).toBe(initialValue);
      expect(reset).toHaveBeenCalledOnce();
      expect(document.activeElement).toBe(add);
    }
  });

  it("closes only the rail cadence on a foreign editor without restoring focus", async () => {
    personMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        cadences: [],
        reminders: [],
        status: "ready",
      })),
    );
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });
    const reminderForm = document.querySelector<HTMLFormElement>(
      "[data-reminder-form]",
    )!;
    const cadenceForm = document.querySelector<HTMLFormElement>(
      "[data-cadence-form]",
    )!;
    document.querySelector<HTMLButtonElement>("[data-reminder-add]")!.click();
    const cadenceAdd = document.querySelector<HTMLButtonElement>(
      "[data-cadence-add]",
    )!;
    cadenceAdd.click();
    const cadenceCount = cadenceForm.elements.namedItem(
      "intervalCount",
    ) as HTMLInputElement;
    cadenceCount.value = "4";
    const reset = vi.fn();
    cadenceForm.addEventListener("reset", reset);
    const restoreFocus = vi.spyOn(cadenceAdd, "focus");
    const foreign = document.createElement("form");
    const foreignControl = document.createElement("input");
    foreign.append(foreignControl);
    document.body.append(foreign);
    foreignControl.focus();

    requestRailEditorOpen(foreign);

    expect(reminderForm.hidden).toBe(false);
    expect(cadenceForm.hidden).toBe(true);
    expect(cadenceCount.value).toBe("1");
    expect(reset).toHaveBeenCalledOnce();
    expect(restoreFocus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(foreignControl);
  });

  it("hides each editor after its save succeeds", async () => {
    personMarkup();
    const cadence = {
      id: "cadence",
      isActive: true,
      intervalCount: 1,
      intervalUnit: "day",
      nextDueAt: "2026-08-19T10:00:00.000Z",
      personId,
    };
    const emptySnapshot = { cadences: [], reminders: [], status: "ready" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(emptySnapshot))
      .mockResolvedValueOnce(response({ reminder, status: "created" }, 201))
      .mockResolvedValueOnce(response(emptySnapshot))
      .mockResolvedValueOnce(response({ dueInformation: { status: "ready" } }))
      .mockResolvedValueOnce(response({ cadence, status: "created" }, 201))
      .mockResolvedValueOnce(response(emptySnapshot))
      .mockResolvedValueOnce(response({ dueInformation: { status: "ready" } }));
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });

    const reminderForm = document.querySelector<HTMLFormElement>(
      "[data-reminder-form]",
    )!;
    document.querySelector<HTMLButtonElement>("[data-reminder-add]")!.click();
    reminderForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(4);
      expect(reminderForm.hidden).toBe(true);
    });

    const cadenceForm = document.querySelector<HTMLFormElement>(
      "[data-cadence-form]",
    )!;
    document.querySelector<HTMLButtonElement>("[data-cadence-add]")!.click();
    cadenceForm.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(7);
      expect(cadenceForm.hidden).toBe(true);
    });
  });

  it("shows a muted busy reminder row before save and removes it on failure", async () => {
    personMarkup();
    const failedSave = deferredResponse();
    const successfulSave = deferredResponse();
    const refresh = deferredResponse();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        cadences: [],
        reminders: [],
        status: "ready",
      }))
      .mockReturnValueOnce(failedSave.promise)
      .mockReturnValueOnce(successfulSave.promise)
      .mockReturnValueOnce(refresh.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });
    document.querySelector<HTMLButtonElement>("[data-reminder-add]")!.click();
    const form = document.querySelector<HTMLFormElement>(
      "[data-reminder-form]",
    )!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Call Ada";
    (form.elements.namedItem("anchorOn") as HTMLInputElement).value =
      "2026-08-20";
    (form.elements.namedItem("sendTime") as HTMLInputElement).value = "09:00";
    (form.elements.namedItem("recurrenceInterval") as HTMLInputElement).value =
      "1";
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    const list = document.querySelector<HTMLUListElement>(
      "[data-reminder-list]",
    )!;

    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    const failedRow = list.querySelector<HTMLLIElement>("[aria-busy=true]")!;
    expect(failedRow.textContent).toContain("Call Ada");
    expect(failedRow.classList).toContain("optimistic-save");
    expect(submit.disabled).toBe(true);
    expect(applicationCss).toMatch(
      /\.optimistic-save\s*\{[^}]*color:\s*var\(--ink-3\)/s,
    );
    expect(applicationCss).not.toMatch(
      /\.optimistic-save\s*\{[^}]*opacity\s*:/s,
    );

    failedSave.resolve(response({}, 503));
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    expect(failedRow.isConnected).toBe(false);
    expect(list.querySelector("[aria-busy=true]")).toBeNull();
    expect(form.hidden).toBe(false);
    expect(document.querySelector("[data-reminder-state]")?.textContent).toBe(
      "Reminder could not be saved. Review the calendar fields.",
    );

    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    const successfulRow = list.querySelector<HTMLLIElement>(
      "[aria-busy=true]",
    )!;
    expect(successfulRow.textContent).toContain("Call Ada");
    expect(submit.disabled).toBe(true);
    successfulSave.resolve(response({ reminder, status: "created" }, 201));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(successfulRow.isConnected).toBe(true);

    refresh.resolve(response({
      cadences: [],
      reminders: [reminder],
      status: "ready",
    }));
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    expect(successfulRow.isConnected).toBe(false);
    expect(list.querySelector("[aria-busy=true]")).toBeNull();
    expect(list.textContent).toContain("Call Ada");
  });

  it("shows a muted busy cadence row before save and removes it on failure", async () => {
    personMarkup();
    mountUnsavedChangesGuard({
      confirmMessage: "Discard?",
      root: document.body,
    });
    const failedSave = deferredResponse();
    const successfulSave = deferredResponse();
    const refresh = deferredResponse();
    const cadence = {
      id: "cadence",
      isActive: true,
      intervalCount: 1,
      intervalUnit: "month",
      nextDueAt: "2026-09-18T10:00:00.000Z",
      personId,
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        cadences: [],
        reminders: [],
        status: "ready",
      }))
      .mockReturnValueOnce(failedSave.promise)
      .mockReturnValueOnce(successfulSave.promise)
      .mockReturnValueOnce(refresh.promise);
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });
    document.querySelector<HTMLButtonElement>("[data-cadence-add]")!.click();
    const form = document.querySelector<HTMLFormElement>(
      "[data-cadence-form]",
    )!;
    const submit = form.querySelector<HTMLButtonElement>("[type=submit]")!;
    const list = document.querySelector<HTMLUListElement>(
      "[data-cadence-list]",
    )!;
    const intervalCount = form.elements.namedItem(
      "intervalCount",
    ) as HTMLInputElement;
    intervalCount.value = "2";
    intervalCount.dispatchEvent(new Event("input", { bubbles: true }));

    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );

    const failedRow = list.querySelector<HTMLLIElement>("[aria-busy=true]")!;
    expect(failedRow.textContent).toContain("Every 2 months");
    expect(failedRow.classList).toContain("optimistic-save");
    expect(submit.disabled).toBe(true);
    expect(
      globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);

    failedSave.resolve(response({}, 503));
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    expect(failedRow.isConnected).toBe(false);
    expect(list.querySelector("[aria-busy=true]")).toBeNull();
    expect(form.hidden).toBe(false);
    expect(document.querySelector("[data-cadence-state]")?.textContent).toBe(
      "Cadence could not be saved.",
    );
    expect(document.activeElement).toBe(
      document.querySelector("[data-cadence-state]"),
    );
    expect(
      globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(false);

    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    const successfulRow = list.querySelector<HTMLLIElement>(
      "[aria-busy=true]",
    )!;
    expect(successfulRow.textContent).toContain("Every 2 months");
    expect(submit.disabled).toBe(true);
    successfulSave.resolve(response({ cadence, status: "created" }, 201));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(
      globalThis.dispatchEvent(new Event("beforeunload", { cancelable: true })),
    ).toBe(true);
    expect(successfulRow.isConnected).toBe(true);

    refresh.resolve(response({
      cadences: [cadence],
      reminders: [],
      status: "ready",
    }));
    await vi.waitFor(() => expect(submit.disabled).toBe(false));
    expect(successfulRow.isConnected).toBe(false);
    expect(list.querySelector("[aria-busy=true]")).toBeNull();
    expect(list.textContent).toContain("Every 1 month");
  });

  it("keeps add controls hidden when reminders fail to load", async () => {
    personMarkup();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 503)));

    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });

    expect(
      document.querySelector<HTMLButtonElement>("[data-reminder-add]")?.hidden,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>("[data-cadence-add]")?.hidden,
    ).toBe(true);
  });

  it("loads reminder and cadence and keeps archived mutations disabled", async () => {
    personMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        cadences: [{
          id: "cadence",
          isActive: true,
          intervalCount: 1,
          intervalUnit: "month",
          nextDueAt: "2026-09-18T10:00:00.000Z",
          personId,
        }],
        reminders: [{
          ...reminder,
          nextOccurrence: {
            ...reminder.nextOccurrence,
            status: "sent",
            visibleAt: "2026-08-20T07:00:01.000Z",
          },
        }],
        status: "ready",
      })),
    );
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: true,
      personId,
      workspaceId,
    });
    expect(document.querySelector("[data-reminder-list]")?.textContent)
      .toContain("Call Ada");
    expect(document.querySelector("[data-reminder-list]")?.textContent)
      .toContain("Notification visible");
    expect(document.querySelector("[data-cadence-list]")?.textContent)
      .toContain("Every 1 month");
    expect(document.querySelector("[data-profile-rail-count]")?.textContent)
      .toBe("1");
    expect(
      document.querySelector('[data-profile-section="stay-in-touch"]')
        ?.hasAttribute("data-rail-empty"),
    ).toBe(false);
    expect(document.querySelectorAll("[data-reminder-list] button"))
      .toHaveLength(0);
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-reminder-form] [type=submit]",
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-cadence-form] [type=submit]",
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>("[data-reminder-add]")?.hidden,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>("[data-cadence-add]")?.hidden,
    ).toBe(true);
  });

  it("collapses an empty archived stay-in-touch block", async () => {
    personMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        cadences: [],
        reminders: [],
        status: "ready",
      })),
    );

    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: true,
      personId,
      workspaceId,
    });

    expect(
      document.querySelector<HTMLElement>(
        '[data-profile-section="stay-in-touch"]',
      )?.dataset.railEmpty,
    ).toBe("true");
  });

  it("reuses the reminder request id after an ambiguous create failure", async () => {
    personMarkup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(
        response({ cadences: [], reminders: [], status: "ready" }),
      )
      .mockRejectedValueOnce(new Error("connection lost"))
      .mockResolvedValueOnce(response({ reminder, status: "created" }, 201))
      .mockResolvedValueOnce(
        response({ cadences: [], reminders: [reminder], status: "ready" }),
      );
    vi.stubGlobal("fetch", fetchMock);
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });
    expect(document.querySelector("[data-profile-rail-count]")?.textContent)
      .toBe("0");
    expect(
      document.querySelector<HTMLElement>(
        '[data-profile-section="stay-in-touch"]',
      )?.dataset.railEmpty,
    ).toBe("true");
    const form = document.querySelector<HTMLFormElement>(
      "[data-reminder-form]",
    )!;
    (form.elements.namedItem("title") as HTMLInputElement).value = "Call Ada";
    (form.elements.namedItem("anchorOn") as HTMLInputElement).value =
      "2026-08-20";
    (form.elements.namedItem("sendTime") as HTMLInputElement).value = "09:00";
    (form.elements.namedItem("recurrenceInterval") as HTMLInputElement).value =
      "1";
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() =>
      expect(document.querySelector("[data-reminder-state]")?.textContent)
        .toContain("could not")
    );
    form.dispatchEvent(
      new SubmitEvent("submit", { bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const posts = fetchMock.mock.calls.filter((call) =>
      call[1]?.method === "POST"
    );
    expect(posts).toHaveLength(2);
    expect(JSON.parse(String(posts[1]?.[1]?.body)).requestId).toBe(
      JSON.parse(String(posts[0]?.[1]?.body)).requestId,
    );
  });

  it("becomes read-only immediately when the person lifecycle changes", async () => {
    personMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        cadences: [],
        reminders: [reminder],
        status: "ready",
      })),
    );
    await mountPersonReminders({
      timePreferences: { locale: "en", effectiveTimezone: "UTC" },
      archived: false,
      personId,
      workspaceId,
    });
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-reminder-list] button",
      )?.className,
    ).toBe(buttonVariants({ variant: "outline" }));

    document.dispatchEvent(
      new CustomEvent("person-lifecycle-changed", {
        detail: { archived: true, personId, state: "archived" },
      }),
    );

    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-reminder-form] [type=submit]",
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>(
        "[data-cadence-form] [type=submit]",
      )?.disabled,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>("[data-reminder-add]")?.hidden,
    ).toBe(true);
    expect(
      document.querySelector<HTMLButtonElement>("[data-cadence-add]")?.hidden,
    ).toBe(true);
    expect(document.querySelectorAll("[data-reminder-list] button"))
      .toHaveLength(0);
  });

  it.each(["unavailable", "access-lost"])(
    "ends initial Today loading when the session is %s",
    async (sessionState) => {
      todayMarkup();
      vi.stubGlobal(
        "fetch",
        sessionState === "unavailable"
          ? vi.fn().mockRejectedValue(new Error("offline"))
          : vi.fn().mockResolvedValue(
            response({ code: "session_invalid", status: 401 }, 401),
          ),
      );

      await mountTodayReminders();

      expect(document.querySelector("#today-reminders-state")?.textContent)
        .toMatch(/unavailable/i);
      expect(document.querySelector("#today-cadences-state")?.textContent)
        .toMatch(/unavailable/i);
      expect(document.body.textContent).not.toContain("Loading");
      expect(
        document.querySelector<HTMLButtonElement>("#today-reminders-retry")
          ?.hidden,
      ).toBe(false);
    },
  );

  it.each(
    [
      [false, true],
      [true, false],
    ] as const,
  )(
    "keeps the newer retry atomic when older-success=%s newer-success=%s",
    async (olderSucceeds, newerSucceeds) => {
      todayMarkup();
      const older = deferredResponse();
      const newer = deferredResponse();
      const fetchMock = todayFetch(
        response({}, 503),
        older.promise,
        newer.promise,
      );
      vi.stubGlobal("fetch", fetchMock);
      await mountTodayReminders();
      const retry = document.querySelector<HTMLButtonElement>(
        "#today-reminders-retry",
      )!;
      const states = () => [
        document.querySelector("#today-reminders-state")?.textContent,
        document.querySelector("#today-cadences-state")?.textContent,
      ];
      const snapshotCount = () =>
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).includes("/today/reminders")
        ).length;
      expect(states().every((value) => value?.includes("unavailable"))).toBe(
        true,
      );
      expect(retry.hidden).toBe(false);

      retry.focus();
      retry.click();
      expect(states()).toEqual([
        "Loading reminder state…",
        "Reconnect suggestions are unavailable.",
      ]);
      expect(retry.hidden).toBe(true);
      await vi.waitFor(() => expect(snapshotCount()).toBe(2));
      retry.click();
      expect(states()).toEqual([
        "Loading reminder state…",
        "Reconnect suggestions are unavailable.",
      ]);
      await vi.waitFor(() => expect(snapshotCount()).toBe(3));

      await settleResponse(
        newer,
        newerSucceeds
          ? observedResponse(todaySnapshot("Newer"))
          : observedResponse({}, 503),
      );
      expect(states()[0]).toMatch(
        newerSucceeds ? /1 reminder state/ : /unavailable/,
      );
      expect(document.activeElement?.id).toBe("today-reminders-state");
      await settleResponse(
        older,
        olderSucceeds
          ? observedResponse(todaySnapshot("Older"))
          : observedResponse({}, 503),
      );
      expect(states()[0]).toMatch(
        newerSucceeds ? /1 reminder state/ : /unavailable/,
      );
      expect(states()[1]).toMatch(/unavailable/);
      expect(document.body.textContent).not.toContain("Older");
      expect(retry.hidden).toBe(newerSucceeds);
    },
  );

  it("preserves stale content and restores focus when a retry fails", async () => {
    todayMarkup();
    const pending = deferredResponse();
    const fetchMock = todayFetch(
      response(todaySnapshot("Preserved")),
      pending.promise,
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayReminders();
    const retry = document.querySelector<HTMLButtonElement>(
      "#today-reminders-retry",
    )!;
    const cadenceList = document.querySelector<HTMLUListElement>(
      "#today-cadences-list",
    )!;
    const cadenceState = document.querySelector<HTMLElement>(
      "#today-cadences-state",
    )!;
    const cadenceRetry = document.querySelector<HTMLButtonElement>(
      "#today-cadences-retry",
    )!;
    const cadenceNode = cadenceList.firstElementChild;
    const cadenceText = cadenceState.textContent;
    const cadenceRetryHidden = cadenceRetry.hidden;
    const expectCadenceUnchanged = () => {
      expect(cadenceList.firstElementChild).toBe(cadenceNode);
      expect(cadenceState.textContent).toBe(cadenceText);
      expect(cadenceRetry.hidden).toBe(cadenceRetryHidden);
    };
    retry.focus();
    retry.click();
    expect(document.body.textContent).toContain("Preserved");
    expect(document.querySelector("#today-reminders-state")?.textContent)
      .toBe("Loading reminder state…");
    expect(retry.hidden).toBe(true);
    expectCadenceUnchanged();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await settleResponse(pending, observedResponse({}, 503));
    expect(retry.hidden).toBe(false);
    expect(document.body.textContent).toContain("Preserved");
    expect(document.activeElement?.id).toBe("today-reminders-state");
    expectCadenceUnchanged();
  });

  it("rejects an invalid runtime timezone without partially replacing reminder state", async () => {
    todayMarkup();
    const invalid = {
      ...todaySnapshot("Must not render"),
      timezone: "Definitely/Not_A_Zone",
    };
    const fetchMock = todayFetch(
      response(todaySnapshot("Preserved")),
      response(invalid),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayReminders();
    const retry = document.querySelector<HTMLButtonElement>(
      "#today-reminders-retry",
    )!;
    retry.click();
    await vi.waitFor(() => expect(retry.hidden).toBe(false));
    expect(document.body.textContent).toContain("Preserved");
    expect(document.body.textContent).not.toContain("Must not render");
    expect(document.querySelector("#today-reminders-state")?.textContent)
      .toMatch(/unavailable/i);
  });

  it("isolates a Reminder rendering failure from the cadence region", async () => {
    todayMarkup();
    const fetchMock = todayFetch(
      response(todaySnapshot("Preserved")),
      response(todaySnapshot("Must not partially render")),
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayReminders();
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    let calls = 0;
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      (function (
        locales?: Intl.LocalesArgument,
        options?: Intl.DateTimeFormatOptions,
      ) {
        calls += 1;
        if (calls === 1) throw new RangeError("formatter unavailable");
        return new NativeDateTimeFormat(locales, options);
      }) as typeof Intl.DateTimeFormat,
    );
    const retry = document.querySelector<HTMLButtonElement>(
      "#today-reminders-retry",
    )!;
    retry.click();
    await vi.waitFor(() => expect(retry.hidden).toBe(false));
    expect(document.body.textContent).toContain("Preserved");
    expect(document.body.textContent).not.toContain(
      "Must not partially render",
    );
    expect(document.querySelector("#today-reminders-state")?.textContent)
      .toMatch(/unavailable/i);
    expect(document.querySelector("#today-cadences-state")?.textContent)
      .toMatch(/1 people/i);
  });

  it("makes a pending old mount inert after remount", async () => {
    todayMarkup();
    const obsolete = deferredResponse();
    const fetchMock = todayFetch(
      obsolete.promise,
      response(todaySnapshot("Current mount")),
    );
    vi.stubGlobal("fetch", fetchMock);
    const oldMount = mountTodayReminders();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await mountTodayReminders();
    obsolete.resolve(response({}, 503));
    await oldMount;
    expect(document.body.textContent).toContain("Current mount");
    expect(document.body.textContent).not.toMatch(/unavailable/i);
    expect(
      document.querySelector<HTMLButtonElement>("#today-reminders-retry")
        ?.hidden,
    ).toBe(true);
  });

  it("shows manual-attention delivery and independent cadence state on Today", async () => {
    vi.mocked(loadTimePreferences).mockResolvedValue({
      locale: "en",
      effectiveTimezone: "America/New_York",
    });
    todayMarkup();
    const extra = ["pending", "claimed", "retry", "failed"].map((
      status,
      index,
    ) => ({
      attemptCount: index,
      deliverAt: "2026-08-18T08:00:00.000Z",
      id: crypto.randomUUID(),
      ...(status === "retry"
        ? { nextAttemptAt: "2026-08-20T10:00:00.000Z" }
        : {}),
      person: { archived: false, id: personId, name: "Ada Lovelace" },
      status,
      title: `${status} reminder`,
    }));
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          member: { id: "member", role: "member" },
          principal: { userId: "user" },
          status: "authenticated",
          workspace: { id: workspaceId, name: "Circle" },
          workspaces: [{ id: workspaceId, name: "Circle" }],
        }))
        .mockResolvedValueOnce(response({
          cadences: [{
            dueAt: "2026-08-18T08:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000903",
            lastContactedAt: "2026-08-17T08:00:00.000Z",
            person: { archived: false, id: personId, name: "Ada Lovelace" },
          }, {
            dueAt: "2026-08-18T09:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000904",
            person: { archived: true, id: personId, name: "Grace Hopper" },
          }],
          reminders: [...extra, {
            attemptCount: 3,
            deliverAt: "2026-08-18T08:00:00.000Z",
            id: reminderId,
            person: { archived: false, id: personId, name: "Ada Lovelace" },
            status: "manual_attention",
            title: "Call Ada",
          }, {
            attemptCount: 1,
            deliverAt: "2026-08-18T09:00:00.000Z",
            id: "00000000-0000-4000-8000-000000000902",
            person: { archived: false, id: personId, name: "Ada Lovelace" },
            status: "sent",
            title: "Visible reminder",
            visibleAt: "2026-08-18T09:00:01.000Z",
          }],
          status: "ready",
          timezone: "America/New_York",
        })),
    );
    await mountTodayReminders();
    const reminderList = document.querySelector("#today-reminders-list")!;
    for (
      const status of [
        ...extra.map((item) => item.status),
        "sent",
        "manual_attention",
      ]
    ) {
      expect(reminderList.querySelector(`.reminder-${status}`)).not.toBeNull();
    }
    expect(
      [
        "Scheduled for",
        "Retry scheduled",
        "Delivery failed",
        "Delivery needs manual attention",
        "Notification visible",
      ].every((text) => reminderList.textContent?.includes(text)),
    ).toBe(true);
    const format = (value: string) =>
      new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      }).format(new Date(value));
    expect(reminderList.textContent).toContain(
      format("2026-08-18T09:00:01.000Z"),
    );
    const retryRow = reminderList.querySelector(".reminder-retry")!;
    expect(retryRow.textContent).toContain(
      format("2026-08-20T10:00:00.000Z"),
    );
    expect(retryRow.textContent).not.toContain(
      format("2026-08-18T08:00:00.000Z"),
    );
    expect(reminderList.querySelector(".reminder-cancelled,.reminder-skipped"))
      .toBeNull();
    const cadenceList = document.querySelector("#today-cadences-list")!;
    expect(
      ["Last contact", "No contact recorded", "archived"].every((text) =>
        cadenceList.textContent?.includes(text)
      ),
    ).toBe(true);
    expect(cadenceList.textContent).toContain(
      format("2026-08-17T08:00:00.000Z"),
    );
    const style = document.createElement("style");
    style.textContent = applicationCss;
    document.head.append(style);
    const retry = document.querySelector<HTMLButtonElement>(
      "#today-reminders-retry",
    )!;
    const links = [
      reminderList.querySelector<HTMLAnchorElement>("a")!,
      cadenceList.querySelector<HTMLAnchorElement>("a")!,
    ];
    expect(retry.hidden).toBe(true);
    expect(retry.type).toBe("button");
    for (const link of links) {
      const computed = getComputedStyle(link);
      expect(link.classList).toContain("today-touch-target");
      expect(link.tabIndex).toBe(0);
      expect(link.getAttribute("href")).toMatch(/^\/app\/people\//);
      expect(computed.minHeight).toBe("44px");
      expect(computed.minWidth).toBe("44px");
      expect(computed.maxInlineSize).toBe("100%");
      expect(computed.whiteSpace).toBe("normal");
      expect(computed.overflowWrap).toBe("anywhere");
      expect(computed.width).not.toBe("100%");
    }
    const cadenceRows = [...cadenceList.children];
    const reconnect = cadenceRows[0]?.querySelector<HTMLButtonElement>(
      "[data-today-reconnect-capture]",
    );
    expect(reconnect?.textContent).toBe("Log interaction");
    expect(reconnect?.dataset.interactionPersonId).toBe(personId);
    expect(reconnect?.dataset.interactionIntendedKind).toBe("activity");
    // A 44px target in both directions that wraps a long name.
    expect(reconnect?.className).toBe(
      buttonVariants({ variant: "outline", wrap: true }),
    );
    expect(reconnect?.classList).toContain("min-h-11");
    expect(reconnect?.classList).toContain("min-w-11");
    expect(cadenceRows[1]?.querySelector("button")).toBeNull();
  });

  it("gives cadence its own recovery owner while preserving exact Reminder state", async () => {
    todayMarkup();
    const initial = todaySnapshot("Preserved reminder");
    const oldEvent = deferredResponse();
    const retryFailure = deferredResponse();
    const retrySuccess = deferredResponse();
    const fetchMock = todayFetch(
      response(initial),
      oldEvent.promise,
      response({}, 503),
      retryFailure.promise,
      retrySuccess.promise,
    );
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayReminders();
    const reminderList = document.querySelector<HTMLUListElement>(
      "#today-reminders-list",
    )!;
    const reminderState = document.querySelector<HTMLElement>(
      "#today-reminders-state",
    )!;
    const reminderRetry = document.querySelector<HTMLButtonElement>(
      "#today-reminders-retry",
    )!;
    const cadenceState = document.querySelector<HTMLElement>(
      "#today-cadences-state",
    )!;
    const cadenceRetry = document.querySelector<HTMLButtonElement>(
      "#today-cadences-retry",
    )!;
    const reminderNode = reminderList.firstElementChild;
    const reminderText = reminderState.textContent;
    const reminderRetryHidden = reminderRetry.hidden;
    const assertReminderPreserved = () => {
      expect(reminderList.firstElementChild).toBe(reminderNode);
      expect(reminderState.textContent).toBe(reminderText);
      expect(reminderRetry.hidden).toBe(reminderRetryHidden);
    };

    globalThis.dispatchEvent(
      new CustomEvent("kinship:today-reconnect-recorded"),
    );
    await vi.waitFor(() =>
      expect(cadenceState.textContent).toContain("Loading")
    );
    assertReminderPreserved();
    globalThis.dispatchEvent(
      new CustomEvent("kinship:today-reconnect-recorded"),
    );
    await vi.waitFor(() =>
      expect(cadenceState.textContent).toMatch(/unavailable/i)
    );
    expect(cadenceRetry.hidden).toBe(false);
    assertReminderPreserved();

    cadenceRetry.click();
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).includes("/today/reminders")
        ),
      ).toHaveLength(4)
    );
    retryFailure.resolve(response({}, 503));
    await vi.waitFor(() => expect(cadenceRetry.hidden).toBe(false));
    expect(cadenceState.textContent).toMatch(/unavailable/i);
    assertReminderPreserved();

    cadenceRetry.click();
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((call) =>
          String(call[0]).includes("/today/reminders")
        ),
      ).toHaveLength(5)
    );
    retrySuccess.resolve(response({ ...initial, cadences: [] }));
    await vi.waitFor(() =>
      expect(cadenceState.textContent).toBe("No one is due for contact.")
    );
    expect(cadenceRetry.hidden).toBe(true);
    expect(document.activeElement).toBe(cadenceState);
    assertReminderPreserved();

    oldEvent.resolve(response({
      ...initial,
      cadences: [{
        ...initial.cadences[0],
        person: { archived: false, id: personId, name: "Obsolete person" },
      }],
      reminders: [{ ...initial.reminders[0], title: "Obsolete reminder" }],
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.body.textContent).not.toContain("Obsolete");
    assertReminderPreserved();
  });

  it("makes pending initial owners inert across remount and receives reconnect events before initial completion", async () => {
    todayMarkup();
    const oldInitial = deferredResponse();
    const newInitial = deferredResponse();
    const event = deferredResponse();
    const fetchMock = todayFetch(
      oldInitial.promise,
      newInitial.promise,
      event.promise,
    );
    vi.stubGlobal("fetch", fetchMock);
    const oldMount = mountTodayReminders();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const newMount = mountTodayReminders();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    globalThis.dispatchEvent(
      new CustomEvent("kinship:today-reconnect-recorded"),
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(6));
    event.resolve(response({ ...todaySnapshot(), cadences: [] }));
    await vi.waitFor(() =>
      expect(document.querySelector("#today-cadences-state")?.textContent)
        .toBe("No one is due for contact.")
    );
    newInitial.resolve(response(todaySnapshot("Must not commit")));
    oldInitial.resolve(response(todaySnapshot("Obsolete mount")));
    await Promise.all([oldMount, newMount]);
    expect(document.body.textContent).toContain("Must not commit");
    expect(document.body.textContent).not.toContain("Obsolete mount");
    expect(document.querySelector("#today-cadences-state")?.textContent)
      .toBe("No one is due for contact.");
  });
});

beforeEach(() => {
  vi.mocked(loadTimePreferences).mockResolvedValue({
    locale: "en",
    effectiveTimezone: "UTC",
  });
});
