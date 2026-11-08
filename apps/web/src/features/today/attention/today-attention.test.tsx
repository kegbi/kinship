// @vitest-environment happy-dom
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonVariants } from "@/components/ui/variants.ts";
import { readApplicationStylesheet } from "../../../lib/application-stylesheet.test-helper.ts";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  afterRequests,
  deferred,
  jsonResponse,
  problemResponse,
  sendWrite,
  stubApi,
} from "../../../testing/api.ts";
import {
  ids,
  preferences,
  sessionWithoutPreferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { TASK_CHANGED_EVENT } from "../../tasks/tasks.ts";
import { TODAY_RECONNECT_RECORDED_EVENT } from "../../interactions/shared.ts";
import { REMINDER_ACKNOWLEDGED_EVENT } from "../regions.ts";
import {
  clearSessionCache,
  updateCachedSessionPreferences,
} from "../../../lib/workspace-context.ts";
import {
  mountTodayAttention,
  TODAY_ATTENTION_ISLAND,
} from "./today-attention.tsx";

const SESSION = "GET /api/v1/session";
const ATTENTION = "GET /api/v1/today/attention";
const COMPLETION = "PUT /api/v1/tasks/:taskId/completion";
const ACKNOWLEDGEMENT =
  "PUT /api/v1/reminder-occurrences/:occurrenceId/acknowledgement";

const personId = ids.person;
const person = { archived: false, id: personId, name: "Ada Lovelace" };
const uuid = (index: number) =>
  `00000000-0000-4000-8000-${String(900 + index).padStart(12, "0")}`;

type Item = Record<string, unknown>;

function task(index: number, title: string, overrides: Item = {}): Item {
  return {
    dueAt: "2026-08-20T09:00:00.000Z",
    id: uuid(index),
    kind: "task",
    person,
    title,
    ...overrides,
  };
}

function attention(
  overdue: readonly Item[] = [],
  upcoming: readonly Item[] = [],
  overrides: Item = {},
): Response {
  return jsonResponse({
    attention: { nextSevenDays: [], overdue, today: [] },
    date: "2026-08-18",
    status: "ready",
    timezone: "Europe/Belgrade",
    upcoming,
    ...overrides,
  });
}

const saved = () =>
  jsonResponse({
    status: "saved",
    task: {
      createdAt: "2026-08-18T10:00:00.000Z",
      id: uuid(1),
      status: "completed",
      title: "Done",
      updatedAt: "2026-08-18T10:00:00.000Z",
    },
  });

function routes(
  answers:
    | Response
    | Promise<Response>
    | readonly (
      | Response
      | Promise<Response>
    )[],
  extra: Record<string, unknown> = {},
) {
  return stubApi(
    {
      [SESSION]: jsonResponse(workspaceSession()),
      [ATTENTION]: answers as Response,
      ...extra,
    } as Parameters<typeof stubApi>[0],
  );
}

/** Today as `pages/app.astro` draws it before the island hydrates. */
function todayShell(): void {
  drawShell(`
    <main id="main-content">
      <header class="page-heading"><div><h1 id="today-heading">Today</h1>
        <span class="contents" data-today-date-root><time data-today-date>Loading date…</time></span></div></header>
      <section class="today-section attention-section" data-today-attention aria-labelledby="attention-heading">
        <h2 id="attention-heading">Needs attention</h2>
        <p id="today-attention-state" role="status">Loading relationship priorities…</p>
      </section>
      <section class="today-section" aria-labelledby="upcoming-heading">
        <h2 id="upcoming-heading">Upcoming</h2>
        <div class="contents" data-today-upcoming>
          <p id="today-upcoming-state" role="status">Loading upcoming work…</p>
        </div>
      </section>
      <p id="secondary">Preserved</p>
    </main>`);
}

const mount = () => mountSettled(() => mountTodayAttention());
const state = () => element("#today-attention-state");
const upcomingState = () => element("#today-upcoming-state");
const retry = () => element<HTMLButtonElement>("#today-attention-retry");
const upcomingRetry = () => element<HTMLButtonElement>("#today-upcoming-retry");
const date = () => element<HTMLTimeElement>("[data-today-date]");
const overdue = () => element("#today-overdue-list");
const upcomingList = () => element("#today-upcoming-list");
const row = (list: HTMLElement, title: string) =>
  within(list).getByText(title).closest("li")!;
const complete = (title: string) =>
  within(row(overdue(), title)).getByRole<HTMLButtonElement>("button", {
    name: `Complete ${title}`,
  });
const completions = (api: ReturnType<typeof stubApi>) =>
  api.calls().filter((call) => call.startsWith("PUT "));
const reads = (api: ReturnType<typeof stubApi>) =>
  api.calls().filter((call) => call.startsWith("GET /api/v1/today/attention"));

function click(target: HTMLElement): void {
  act(() => {
    fireEvent.click(target);
  });
}

/** Quick capture's write, then its announcement, as the application does. */
async function recordedReconnect(
  api: ReturnType<typeof stubApi>,
): Promise<void> {
  await act(async () => {
    await sendWrite(api);
    globalThis.dispatchEvent(new CustomEvent(TODAY_RECONNECT_RECORDED_EVENT));
  });
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("PLANNING-001 Today attention island", () => {
  it("links the complete person name independently in next-seven-days and upcoming reminders", async () => {
    todayShell();
    const named = { ...person, name: "Ada · Lovelace" };
    const birthday = {
      dueAt: "2026-11-22T00:00:00Z",
      id: uuid(1),
      kind: "important-date",
      occursOn: "2026-11-22",
      person: named,
      title: "Birthday",
    };
    const items = [
      birthday,
      {
        ...birthday,
        id: uuid(2),
        title: "Unavailable birthday",
        person: { ...named, unavailable: true },
      },
      {
        ...birthday,
        id: uuid(3),
        title: "Personless birthday",
        person: undefined,
      },
    ];
    routes(attention([], items, {
      attention: { nextSevenDays: items, overdue: [], today: [] },
    }));
    await mount();
    for (const list of [element("#today-next-seven-list"), upcomingList()]) {
      const birthdayRow = row(list, "Birthday");
      const personLink = within(birthdayRow).getByRole<HTMLAnchorElement>(
        "link",
        { name: named.name },
      );
      expect(personLink.getAttribute("href")).toBe(
        `/app/people/${personId}?section=important-dates`,
      );
      expect(
        within(birthdayRow).getByRole("link", {
          name: "Birthday",
        }),
      ).not.toBe(personLink);
      expect(personLink.tabIndex).toBe(0);
      expect(personLink.classList).toContain("today-touch-target");
      expect(birthdayRow.textContent).not.toContain("Reminder due");
      expect(birthdayRow.textContent).toContain("Important date Nov 22, 2026");
      expect(row(list, "Unavailable birthday").textContent).toContain(
        named.name,
      );
      expect(row(list, "Unavailable birthday").querySelector("a")).toBeNull();
      expect(row(list, "Personless birthday").querySelector("a")).toBeNull();
    }
  });

  it("draws each item as a scannable row: icon, title, a quieter person link, and when", async () => {
    todayShell();
    const birthday = {
      dueAt: "2026-08-18T09:00:00Z",
      id: uuid(1),
      kind: "important-date",
      occursOn: "2026-08-20",
      person,
      title: "Birthday",
    };
    const late = task(2, "Send flowers", { dueAt: "2026-08-16T09:00:00Z" });
    routes(attention([late], [birthday], {
      attention: {
        nextSevenDays: [birthday],
        overdue: [late],
        today: [],
      },
    }));
    await mount();

    const birthdayRow = row(element("#today-next-seven-list"), "Birthday");
    const title = within(birthdayRow).getByRole("link", { name: "Birthday" });
    const personLink = within(birthdayRow).getByRole("link", {
      name: person.name,
    });
    // The title and the person no longer share one look.
    expect(title.classList).toContain("attention-title");
    expect(personLink.classList).toContain("attention-person");
    expect(personLink.classList).not.toContain("attention-title");
    expect(
      birthdayRow.querySelector("[data-attention-icon='important-date']"),
    ).not.toBeNull();
    expect(birthdayRow.querySelector(".attention-when")?.textContent).toBe(
      "In 2 days",
    );
    expect(
      row(upcomingList(), "Birthday").querySelector(".attention-when")
        ?.textContent,
    ).toBe("In 2 days");
    const overdueRow = row(overdue(), "Send flowers");
    expect(overdueRow.querySelector(".attention-when")?.textContent).toBe(
      "2 days overdue",
    );
    expect(overdueRow.querySelector(".attention-when-overdue")).not.toBeNull();
  });

  it("does nothing when the Today regions are absent", async () => {
    drawShell("<p>Other page</p>");
    const unmount = await mount();
    unmount();
    expect(document.body.textContent).toBe("Other page");
    // Other surfaces listen for task writes by this frozen name.
    expect(TASK_CHANGED_EVENT).toBe("kinship:task-changed");
    expect(TODAY_ATTENTION_ISLAND).toBe("today-attention");
  });

  it("renders and completes one coherent server-clock Today snapshot", async () => {
    todayShell();
    document.body.style.width = "320px";
    const dueAt = "2026-03-08T06:30:00.000Z";
    const longTitle = "T".repeat(500);
    const unavailableLongTitle = "U".repeat(500);
    const active = task(1, "Call Ada", { dueAt });
    const reminder = {
      channel: "in_app",
      dueAt,
      kind: "reminder",
      occursOn: "2026-03-08",
      reminderStatus: "pending",
    };
    const items = [
      active,
      task(2, "Archived", { dueAt, person: { ...person, archived: true } }),
      task(3, "Unavailable", {
        dueAt,
        person: { ...person, unavailable: true },
      }),
      task(4, unavailableLongTitle, {
        dueAt,
        person: { ...person, unavailable: true },
      }),
      task(5, "Workspace", { dueAt, person: undefined }),
      { ...reminder, id: uuid(6), person, title: "Direct reminder" },
      {
        dueAt,
        occursOn: "2026-03-08",
        id: uuid(7),
        kind: "important-date",
        person,
        title: "Birthday",
      },
      {
        dueAt,
        occursOn: "2026-03-08",
        id: uuid(8),
        kind: "life-event",
        person,
        title: "Moved home",
      },
      { ...reminder, id: uuid(9), title: "Imported personless reminder" },
      {
        dueAt,
        occursOn: "2026-03-08",
        id: uuid(10),
        kind: "important-date",
        title: "Imported personless date",
      },
      task(11, longTitle, { dueAt }),
    ];
    const cadences = [
      {
        dueAt,
        id: uuid(12),
        kind: "cadence",
        lastContactedAt: dueAt,
        person,
        title: "Contacted",
      },
      {
        dueAt,
        id: uuid(13),
        kind: "cadence",
        person: { ...person, archived: true },
        title: "Never contacted",
      },
    ];
    const changed = vi.fn();
    globalThis.addEventListener(TASK_CHANGED_EVENT, changed);
    const api = routes([
      attention([...items, ...cadences], [...items, ...cadences], {
        date: "2026-03-07",
        timezone: "America/New_York",
      }),
      attention([], [], { date: "2026-03-07" }),
    ], {
      [COMPLETION]: saved(),
      [SESSION]: jsonResponse(workspaceSession({
        preferences: preferences({ effectiveTimezone: "America/New_York" }),
      })),
    });
    await mount();
    expect(
      element(`[data-island="${TODAY_ATTENTION_ISLAND}"]`)
        .hasAttribute("data-island-ready"),
    ).toBe(true);
    expect(reads(api)).toHaveLength(1);
    for (const list of [overdue(), upcomingList()]) {
      const link = (title: string) =>
        within(row(list, title)).getByRole("link", { name: title })
          .getAttribute("href");
      expect(link("Call Ada")).toBe(`/app/people/${personId}?section=tasks`);
      expect(link("Archived")).toBe(`/app/people/${personId}?section=tasks`);
      expect(row(list, "Unavailable").textContent).toContain("Ada Lovelace");
      expect(row(list, "Unavailable").querySelector("a,button")).toBeNull();
      expect(link("Workspace")).toBe("/app/tasks");
      expect(link("Direct reminder")).toContain("?section=reminders");
      expect(link("Birthday")).toContain("?section=important-dates");
      expect(link("Moved home")).toContain("?section=life-events");
      expect(link("Contacted")).toContain("?section=stay-in-touch");
      for (
        const title of [
          "Imported personless reminder",
          "Imported personless date",
        ]
      ) {
        const personless = row(list, title);
        expect(personless.querySelector("a,button")).toBeNull();
        expect(personless.querySelector(".attention-title")?.tagName).toBe(
          "P",
        );
      }
    }
    expect(row(overdue(), "Contacted").textContent).toContain("Last contact");
    expect(row(overdue(), "Never contacted").textContent).toContain(
      "No contact recorded",
    );
    // Complete is offered only for active people's and workspace tasks.
    expect(
      within(overdue()).getAllByRole("button", { name: /^Complete / }),
    ).toHaveLength(3);
    const style = document.createElement("style");
    style.textContent = readApplicationStylesheet("general");
    document.head.append(style);
    const links = [
      ...document.querySelectorAll<HTMLElement>(
        "#today-overdue-list a, #today-upcoming-list a",
      ),
    ];
    for (const target of links) {
      const computed = getComputedStyle(target);
      expect(target.classList).toContain("today-touch-target");
      expect(computed.minHeight).toBe("44px");
      expect(computed.minWidth).toBe("44px");
      expect(computed.maxInlineSize).toBe("100%");
      expect(computed.width).not.toBe("100%");
    }
    const longLink = within(row(overdue(), longTitle)).getByRole("link", {
      name: longTitle,
    });
    const longStyle = getComputedStyle(longLink);
    expect(longLink.textContent).toHaveLength(500);
    expect(longLink.tabIndex).toBe(0);
    expect(longLink.classList).toContain("attention-title");
    expect(longStyle.display).toBe("inline-flex");
    expect(longStyle.whiteSpace).toBe("normal");
    expect(longStyle.overflowWrap).toBe("anywhere");
    for (const list of [overdue(), upcomingList()]) {
      const title = row(list, unavailableLongTitle)
        .querySelector<HTMLElement>(".attention-title")!;
      const unavailableStyle = getComputedStyle(title);
      expect(title.tagName).toBe("P");
      expect(title.classList).not.toContain("today-touch-target");
      expect(title.tabIndex).toBe(-1);
      expect(unavailableStyle.maxInlineSize).toBe("100%");
      expect(unavailableStyle.overflowWrap).toBe("anywhere");
      expect(unavailableStyle.minHeight).not.toBe("44px");
    }
    // Both retries and every Complete are 44px buttons that wrap.
    for (const control of [retry(), upcomingRetry()]) {
      expect(control.type).toBe("button");
      expect(control.hidden).toBe(true);
      expect(control.className).toBe(
        buttonVariants({ variant: "outline", wrap: true }),
      );
    }
    expect(complete("Call Ada").className).toBe(
      buttonVariants({ variant: "outline" }),
    );
    expect(buttonVariants({ variant: "outline" }).split(" ")).toContain(
      "min-h-11",
    );
    expect(date().getAttribute("datetime")).toBe("2026-03-07");
    expect(date().textContent).toBe("Saturday, March 7, 2026");
    expect(document.body.textContent).toContain(
      new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      }).format(new Date(dueAt)),
    );
    click(complete("Call Ada"));
    await waitFor(() => expect(document.activeElement).toBe(state()));
    expect(completions(api)).toEqual([
      `PUT /api/v1/tasks/${uuid(1)}/completion`,
    ]);
    expect(api.requests().find((request) => request.method === "PUT")?.body)
      .toEqual({ completed: true });
    expect(changed).toHaveBeenCalledTimes(1);
    expect(reads(api)).toHaveLength(2);
    expect(document.querySelectorAll(".attention-item")).toHaveLength(0);
    expect(element("#secondary").textContent).toBe("Preserved");
    expect(element("#today-onboarding").hidden).toBe(false);
    globalThis.removeEventListener(TASK_CHANGED_EVENT, changed);
  });

  it("settles an invalid runtime timezone honestly and preserves the last good date", async () => {
    todayShell();
    const good = attention([task(1, "Call Ada")]);
    const invalid = attention([task(1, "Call Ada")], [], {
      timezone: "Definitely/Not_A_Zone",
    });
    routes([invalid, good, invalid.clone()]);
    await mount();
    expect(date().textContent).toBe("Date unavailable");
    expect(date().hasAttribute("datetime")).toBe(false);
    expect(document.querySelectorAll(".attention-item")).toHaveLength(0);
    expect(retry().hidden).toBe(false);
    expect(upcomingRetry().hidden).toBe(false);
    expect(upcomingState().textContent).toMatch(/could not be loaded/i);

    click(retry());
    await waitFor(() => expect(date().dateTime).toBe("2026-08-18"));
    const lastGoodText = date().textContent;
    expect(document.querySelectorAll(".attention-item")).toHaveLength(1);

    click(retry());
    await waitFor(() => expect(retry().hidden).toBe(false));
    expect(date().dateTime).toBe("2026-08-18");
    expect(date().textContent).toBe(lastGoodText);
    expect(document.querySelectorAll(".attention-item")).toHaveLength(1);
  });

  it("settles the Today date when the initial workspace session is unavailable", async () => {
    todayShell();
    stubApi({ "* /api/v1/*": problemResponse(503) });
    await mount();
    expect(date().textContent).toBe("Date unavailable");
    expect(date().hasAttribute("datetime")).toBe(false);
    expect(document.body.textContent).not.toContain("Loading");
  });

  it("APR-009 renders current Today data with unavailable labels for an unsupported saved locale", async () => {
    todayShell();
    routes([
      attention([task(1, "Preserved task")]),
      attention([task(2, "Current task", { person: undefined })]),
    ]);
    await mount();
    expect(date().textContent).toBe("Tuesday, August 18, 2026");
    // The member saves an unsupported locale; the session carries it from
    // then on (AUD-F3), so the next read formats with it.
    updateCachedSessionPreferences(
      workspaceSession().workspace.id,
      preferences({ locale: "en-USA" }),
    );
    // The retry is hidden; the reader cannot reach it, a click still reads.
    click(retry());
    await waitFor(() =>
      expect(document.body.textContent).toContain("Current task")
    );
    expect(retry().hidden).toBe(true);
    expect(document.body.textContent).not.toContain("Preserved task");
    expect(document.body.textContent).toContain("Time unavailable");
    expect(date().textContent).toBe("Date unavailable");
    expect(date().dateTime).toBe("2026-08-18");
  });

  it("REL-059 lists an undelivered email reminder as an email problem that opens the person's reminders", async () => {
    todayShell();
    const reminder = {
      channel: "email",
      dueAt: "2026-08-17T09:00:00.000Z",
      kind: "reminder",
      occursOn: "2026-08-17",
      person,
    };
    routes(attention([
      { ...reminder, id: uuid(1), reminderStatus: "failed", title: "Failed" },
      {
        ...reminder,
        id: uuid(2),
        reminderStatus: "manual_attention",
        title: "Unclear",
      },
    ]));
    await mount();
    const failed = row(overdue(), "Failed");
    expect(failed.textContent).toContain(
      "Email reminder not delivered · Reminder due",
    );
    expect(
      within(failed).getByRole("link", { name: "Failed" }).getAttribute("href"),
    ).toBe(`/app/people/${personId}?section=reminders`);
    expect(row(overdue(), "Unclear").textContent).toContain(
      "Email reminder needs attention · Reminder due",
    );
    // Each can be dismissed (REL-088); neither is a task to complete.
    expect(
      within(overdue()).getAllByRole("button").map((button) => [
        button.textContent,
        button.getAttribute("aria-label"),
      ]),
    ).toEqual([["Dismiss", "Dismiss Failed"], ["Dismiss", "Dismiss Unclear"]]);
  });

  it("REL-088 dismisses an undelivered reminder through planning and reads the queue again", async () => {
    todayShell();
    const first = deferred<Response>();
    const reminder = {
      channel: "email",
      dueAt: "2026-08-17T09:00:00.000Z",
      kind: "reminder",
      occursOn: "2026-08-17",
      person,
    };
    const failed = {
      ...reminder,
      id: uuid(1),
      reminderStatus: "failed",
      title: "Failed",
    };
    const inApp = {
      ...reminder,
      channel: "in_app",
      id: uuid(2),
      kind: "reminder",
      reminderStatus: "failed",
      title: "Birthday",
    };
    const pending = {
      ...reminder,
      channel: "in_app",
      id: uuid(3),
      reminderStatus: "pending",
      title: "Pending",
    };
    const api = routes([
      attention([failed, inApp, pending, task(4, "Call Ada")]),
      attention([inApp, pending, task(4, "Call Ada")]),
    ], {
      [ACKNOWLEDGEMENT]: [
        first.promise,
        jsonResponse({ occurrenceId: uuid(1), status: "acknowledged" }),
      ],
    });
    await mount();
    const dismiss = (title: string) =>
      within(row(overdue(), title)).getByRole<HTMLButtonElement>("button", {
        name: `Dismiss ${title}`,
      });
    const acknowledged = vi.fn();
    globalThis.addEventListener(REMINDER_ACKNOWLEDGED_EVENT, acknowledged);
    expect(within(row(overdue(), "Pending")).queryByRole("button")).toBeNull();
    const control = dismiss("Failed");
    const failedRow = control.closest("li")!;
    expect(control.className).toBe(buttonVariants({ variant: "outline" }));
    click(control);
    click(dismiss("Birthday"));
    click(complete("Call Ada"));
    expect(completions(api)).toEqual([
      `PUT /api/v1/reminder-occurrences/${uuid(1)}/acknowledgement`,
    ]);
    expect(api.requests().find((request) => request.method === "PUT")?.body)
      .toBeUndefined();
    expect(failedRow.hidden).toBe(true);
    expect(dismiss("Birthday").disabled).toBe(true);
    expect(complete("Call Ada").disabled).toBe(true);
    expect(state().textContent).toBe("Dismissing reminder…");
    await act(async () => {
      first.resolve(problemResponse(503));
      await first.promise;
    });
    await waitFor(() => expect(control.disabled).toBe(false));
    expect(failedRow.hidden).toBe(false);
    expect(state().textContent).toMatch(
      /could not be dismissed\. Retry Dismiss\./,
    );
    expect(document.activeElement).toBe(control);
    expect(reads(api)).toHaveLength(1);
    expect(acknowledged).not.toHaveBeenCalled();

    click(control);
    await waitFor(() =>
      expect(document.body.textContent).not.toContain("Failed")
    );
    expect(completions(api)).toHaveLength(2);
    expect(reads(api)).toHaveLength(2);
    expect(document.activeElement).toBe(state());
    expect(state().textContent).toBe("3 relationship priorities.");
    expect(dismiss("Birthday").disabled).toBe(false);
    // The reminder panel reads its own projection again on this event.
    expect(acknowledged).toHaveBeenCalledTimes(1);
    globalThis.removeEventListener(REMINDER_ACKNOWLEDGED_EVENT, acknowledged);
  });

  it("REL-088 reads the queue again instead of offering a retry when the reminder already changed", async () => {
    todayShell();
    const reminder = {
      channel: "email",
      dueAt: "2026-08-17T09:00:00.000Z",
      id: uuid(1),
      kind: "reminder",
      occursOn: "2026-08-17",
      person,
      reminderStatus: "failed",
      title: "Changed elsewhere",
    };
    const api = routes([
      attention([reminder, task(2, "Call Ada")]),
      attention([task(2, "Call Ada")]),
    ], {
      [ACKNOWLEDGEMENT]: problemResponse(409, {
        code: "reminder_occurrence_stale",
      }),
    });
    const acknowledged = vi.fn();
    globalThis.addEventListener(REMINDER_ACKNOWLEDGED_EVENT, acknowledged);
    await mount();
    click(
      within(row(overdue(), "Changed elsewhere")).getByRole("button", {
        name: "Dismiss Changed elsewhere",
      }),
    );
    await waitFor(() =>
      expect(document.body.textContent).not.toContain("Changed elsewhere")
    );
    expect(completions(api)).toHaveLength(1);
    expect(reads(api)).toHaveLength(2);
    expect(state().textContent).toBe("1 relationship priority.");
    expect(document.activeElement).toBe(state());
    expect(complete("Call Ada").disabled).toBe(false);
    expect(acknowledged).not.toHaveBeenCalled();
    globalThis.removeEventListener(REMINDER_ACKNOWLEDGED_EVENT, acknowledged);
  });

  it("REL-048 settles the queue once its read answers, even when the session carries no preferences or a newer read replaced it", async () => {
    todayShell();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const api = routes([first.promise, second.promise], {
      [SESSION]: jsonResponse(sessionWithoutPreferences()),
    });
    const mounted = mountPending(() => mountTodayAttention());
    await waitFor(() => expect(reads(api)).toHaveLength(1));
    expect(state().textContent).toBe("Loading relationship priorities…");
    // The announcement follows the write that recorded the reconnect, so its
    // read is its own request (AUD-F1, D7) and replaces the first.
    await recordedReconnect(api);
    await waitFor(() => expect(reads(api)).toHaveLength(2));
    await act(async () => {
      first.resolve(attention([task(1, "Superseded")]));
      await first.promise;
    });
    expect(state().textContent).toBe("Loading relationship priorities…");
    await act(async () => {
      second.resolve(attention([task(2, "Plan Ada's call")], [
        task(3, "Prepare Ada's visit"),
      ]));
      await mounted;
    });
    expect(state().textContent).toBe("1 relationship priority.");
    expect(upcomingState().textContent).toBe("1 upcoming item.");
    expect(complete("Plan Ada's call").disabled).toBe(false);
    expect(document.body.textContent).not.toContain("Superseded");
    expect(document.body.textContent).toContain("Time unavailable");
  });

  it("serializes Today completion across failure, success, and a later failure", async () => {
    todayShell();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const third = deferred<Response>();
    const firstTask = task(1, "First task", { person: undefined });
    const secondTask = task(2, "Second task", { person: undefined });
    const api = routes([
      attention([firstTask, secondTask]),
      attention([firstTask]),
    ], { [COMPLETION]: [first.promise, second.promise, third.promise] });
    await mount();
    const firstButton = complete("First task");
    const secondButton = complete("Second task");
    click(firstButton);
    expect([firstButton.disabled, secondButton.disabled]).toEqual([true, true]);
    expect(retry().hidden).toBe(true);
    click(retry());
    click(upcomingRetry());
    click(secondButton);
    click(firstButton);
    expect(completions(api)).toHaveLength(1);
    expect(reads(api)).toHaveLength(1);
    await act(async () => {
      first.resolve(problemResponse(503));
      await first.promise;
    });
    await waitFor(() => expect(firstButton.disabled).toBe(false));
    expect(secondButton.disabled).toBe(false);
    expect(document.activeElement).toBe(firstButton);

    click(secondButton);
    click(secondButton);
    expect(completions(api)).toHaveLength(2);
    expect([firstButton.disabled, secondButton.disabled]).toEqual([true, true]);
    await act(async () => {
      second.resolve(saved());
      await second.promise;
    });
    await waitFor(() =>
      expect(document.body.textContent).not.toContain("Second task")
    );
    expect(completions(api)).toHaveLength(2);
    expect(reads(api)).toHaveLength(2);
    expect(complete("First task").disabled).toBe(false);
    expect(document.activeElement).toBe(state());

    const liveFirst = complete("First task");
    click(liveFirst);
    click(liveFirst);
    expect(completions(api)).toHaveLength(3);
    await act(async () => {
      third.resolve(problemResponse(503));
      await third.promise;
    });
    await waitFor(() => expect(liveFirst.disabled).toBe(false));
    expect(document.activeElement).toBe(liveFirst);
  });

  it("keeps a failed completion terminal and retries the owning mutation", async () => {
    todayShell();
    const first = deferred<Response>();
    const second = deferred<Response>();
    const item = task(1, "Retry this task");
    routes([attention([item], [item]), attention()], {
      [COMPLETION]: [first.promise, second.promise],
    });
    await mount();
    const control = complete("Retry this task");
    const taskRow = control.closest("li")!;
    click(control);
    expect(control.disabled).toBe(true);
    expect(taskRow.hidden).toBe(true);
    expect(state().textContent).toBe("Completing task…");
    await act(async () => {
      first.resolve(problemResponse(503));
      await first.promise;
    });
    await waitFor(() => expect(control.disabled).toBe(false));
    expect(complete("Retry this task")).toBe(control);
    expect(taskRow.hidden).toBe(false);
    expect(state().textContent).toMatch(
      /1 relationship priority.*could not be completed.*Retry Complete/i,
    );
    expect(document.activeElement).toBe(control);
    expect(retry().hidden).toBe(true);
    expect(upcomingRetry().hidden).toBe(true);

    click(control);
    expect(control.disabled).toBe(true);
    expect(taskRow.hidden).toBe(true);
    await act(async () => {
      second.resolve(saved());
      await second.promise;
    });
    await waitFor(() =>
      expect(document.querySelectorAll(".attention-item")).toHaveLength(0)
    );
    expect(state().textContent).toMatch(/All clear/i);
    expect(document.activeElement).toBe(state());
  });

  it("keeps confirmed completion ownership until a causal snapshot removes it", async () => {
    todayShell();
    const refresh = deferred<Response>();
    const stale = task(1, "Completed stale task");
    const other = task(2, "Other live task");
    const api = routes([
      attention([stale, other]),
      refresh.promise,
      attention([stale, other]),
      attention([other]),
    ], { [COMPLETION]: saved() });
    await mount();
    const staleButton = complete("Completed stale task");
    const otherButton = complete("Other live task");
    click(staleButton);
    await waitFor(() => expect(reads(api)).toHaveLength(2));
    expect([staleButton.disabled, otherButton.disabled]).toEqual([true, true]);
    expect(retry().hidden).toBe(true);
    await act(async () => {
      refresh.resolve(problemResponse(503));
      await refresh.promise;
    });
    await waitFor(() => expect(document.activeElement).toBe(state()));
    expect(retry().hidden).toBe(false);
    expect(state().textContent).toMatch(/completion is confirmed/i);
    expect(complete("Completed stale task").disabled).toBe(true);
    click(complete("Other live task"));
    expect(completions(api)).toHaveLength(1);

    click(retry());
    await waitFor(() => expect(reads(api)).toHaveLength(3));
    await waitFor(() => expect(retry().hidden).toBe(false));
    expect(complete("Completed stale task").disabled).toBe(true);
    expect(complete("Other live task").disabled).toBe(true);
    click(retry());
    await waitFor(() =>
      expect(document.body.textContent).not.toContain("Completed stale task")
    );
    expect(complete("Other live task").disabled).toBe(false);
    expect(retry().hidden).toBe(true);
  });

  it("forgets an unmounted island's pending completion and read; a remount starts fresh", async () => {
    todayShell();
    const obsolete = deferred<Response>();
    const pendingRead = deferred<Response>();
    const api = routes([
      attention([task(1, "Obsolete task")]),
      pendingRead.promise,
    ], { [COMPLETION]: obsolete.promise });
    const unmount = await mount();
    click(retry());
    click(complete("Obsolete task"));
    await waitFor(() => expect(reads(api)).toHaveLength(2));
    unmount();
    todayShell();
    // The remount asks for the read the unmounted island left on the wire, so
    // it joins it (AUD-F1, D7), and it takes the document's session without a
    // read of its own (AUD-F3); the old island's completion and read change
    // nothing on the new page.
    const sessions = api.calls().filter((call) => call === SESSION).length;
    const remounted = mountPending(() => mountTodayAttention());
    await afterRequests(api, SESSION, sessions);
    expect(reads(api)).toHaveLength(2);
    await act(async () => {
      obsolete.resolve(problemResponse(503));
      pendingRead.resolve(attention([task(2, "Current task")]));
      await remounted;
    });
    expect(reads(api)).toHaveLength(2);
    expect(document.body.textContent).toContain("Current task");
    expect(document.body.textContent).not.toMatch(
      /Obsolete task|Late read|could not be/,
    );
    expect(retry().hidden).toBe(true);
    expect(complete("Current task").disabled).toBe(false);
    expect(document.activeElement).not.toBe(state());
  });

  it("starts over when a later read answers for another workspace", async () => {
    todayShell();
    const other = { id: "00000000-0000-4000-8000-000000000004", name: "Other" };
    let active = workspaceSession({
      workspaces: [workspaceSession().workspace, other],
    });
    const api = routes([
      attention([task(1, "First workspace task")], [task(3, "Old upcoming")]),
      attention([task(2, "Second workspace task")]),
    ], {
      [COMPLETION]: problemResponse(503),
      [SESSION]: () => jsonResponse(active),
    });
    await mount();
    click(complete("First workspace task"));
    await waitFor(() =>
      expect(state().textContent).toMatch(/could not be completed/i)
    );
    expect(completions(api)).toHaveLength(1);
    // Switching the workspace forgets the document's session.
    active = { ...active, workspace: other };
    clearSessionCache();
    act(() => {
      globalThis.dispatchEvent(new CustomEvent(TODAY_RECONNECT_RECORDED_EVENT));
    });
    await waitFor(() =>
      expect(document.body.textContent).toContain("Second workspace task")
    );
    expect(api.requests().at(-1)?.headers.get("X-Workspace-Id")).toBe(
      other.id,
    );
    expect(state().textContent).toBe("1 relationship priority.");
    expect(document.body.textContent).not.toContain("Old upcoming");
    expect(complete("Second workspace task").disabled).toBe(false);
  });

  it("keeps region retry failures isolated and refreshes both on success", async () => {
    todayShell();
    const preserved = task(1, "Preserved");
    const refreshed = task(1, "Refreshed");
    routes([
      attention([preserved], [preserved]),
      problemResponse(503),
      attention([refreshed], [refreshed]),
      problemResponse(503),
      attention([preserved], [preserved]),
    ], { [COMPLETION]: problemResponse(503) });
    await mount();
    click(retry());
    await waitFor(() =>
      expect(state().textContent).toMatch(/could not be loaded/i)
    );
    expect(upcomingState().textContent).toBe("1 upcoming item.");
    expect(overdue().textContent).toContain("Preserved");
    click(retry());
    await waitFor(() =>
      expect(document.body.textContent).toContain("Refreshed")
    );
    expect(document.activeElement).toBe(state());
    // Only the region asked for takes the answer.
    expect(upcomingList().textContent).toContain("Preserved");
    click(upcomingRetry());
    await waitFor(() =>
      expect(upcomingState().textContent).toMatch(/could not be loaded/i)
    );
    expect(overdue().textContent).toContain("Refreshed");
    click(complete("Refreshed"));
    await waitFor(() =>
      expect(state().textContent).toMatch(/could not be completed/i)
    );
    expect(upcomingState().textContent).toMatch(/could not be loaded/i);
    expect(upcomingRetry().hidden).toBe(false);
    click(upcomingRetry());
    await waitFor(() =>
      expect(upcomingState().textContent).toBe("1 upcoming item.")
    );
    expect(state().textContent).toMatch(/could not be completed/i);
    expect(upcomingRetry().hidden).toBe(true);
    expect(document.activeElement).toBe(upcomingState());
  });

  it("serves retries of both regions with one read that settles both and focuses the last one asked", async () => {
    todayShell();
    const first = deferred<Response>();
    const api = routes([
      attention([task(1, "Attention base")], [task(2, "Upcoming base")]),
      first.promise,
    ]);
    await mount();
    const sessions = api.calls().filter((call) => call === SESSION).length;
    click(retry());
    click(upcomingRetry());
    // Both retries ask for the same read, so the second joins the first
    // (AUD-F1, D7): one request settles both regions. Neither reads the
    // session again: the document already holds it (AUD-F3).
    await afterRequests(api, SESSION, sessions);
    expect(reads(api)).toHaveLength(2);
    expect(state().textContent).toBe("Loading relationship priorities…");
    expect(upcomingState().textContent).toBe("Loading upcoming work…");
    await act(async () => {
      first.resolve(attention([task(3, "Attention newest")], [
        task(4, "Upcoming newest"),
      ], { date: "2026-08-20" }));
      await first.promise;
    });
    await waitFor(() => expect(document.activeElement).toBe(upcomingState()));
    expect(reads(api)).toHaveLength(2);
    expect(overdue().textContent).toContain("Attention newest");
    expect(upcomingList().textContent).toContain("Upcoming newest");
    expect(document.body.textContent).not.toContain("obsolete");
    expect(date().dateTime).toBe("2026-08-20");
    expect([retry().hidden, upcomingRetry().hidden]).toEqual([true, true]);
  });

  it("refreshes on a recorded reconnect without moving focus, and a later reconnect supersedes an earlier retry", async () => {
    todayShell();
    const regional = deferred<Response>();
    const reconnect = deferred<Response>();
    const api = routes([
      problemResponse(503),
      regional.promise,
      reconnect.promise,
    ]);
    await mount();
    retry().focus();
    click(retry());
    await waitFor(() => expect(reads(api)).toHaveLength(2));
    // The announcement follows the write that recorded the reconnect, so its
    // read is its own request (AUD-F1, D7) and supersedes the retry.
    await recordedReconnect(api);
    await waitFor(() => expect(reads(api)).toHaveLength(3));
    await act(async () => {
      reconnect.resolve(attention([], [task(1, "Owned reconnect")], {
        date: "2026-08-21",
      }));
      regional.resolve(attention([], [], { date: "2026-08-17" }));
      await regional.promise;
    });
    await waitFor(() =>
      expect(document.body.textContent).toContain("Owned reconnect")
    );
    expect(date().dateTime).toBe("2026-08-21");
    expect(document.activeElement).toBe(retry());
  });

  it.each(["confirmed", "failed"] as const)(
    "preserves task completion ownership when reconnect settles while PUT is %s",
    async (outcome) => {
      todayShell();
      const mutation = deferred<Response>();
      const reconnectRefresh = deferred<Response>();
      const completion = deferred<Response>();
      const item = task(1, "Completion owner");
      const api = routes([
        attention([item], [item]),
        reconnectRefresh.promise,
        completion.promise,
      ], { [COMPLETION]: mutation.promise });
      await mount();
      click(complete("Completion owner"));
      const title = within(overdue()).getByRole("link", {
        hidden: true,
        name: "Completion owner",
      });
      title.focus();
      act(() => {
        globalThis.dispatchEvent(
          new CustomEvent(TODAY_RECONNECT_RECORDED_EVENT),
        );
      });
      await waitFor(() => expect(reads(api)).toHaveLength(2));
      await act(async () => {
        reconnectRefresh.resolve(attention([item], [item], {
          date: "2026-08-20",
        }));
        await reconnectRefresh.promise;
      });
      await waitFor(() => expect(date().dateTime).toBe("2026-08-20"));
      expect(state().textContent).toBe("Completing task…");
      const liveComplete = element<HTMLButtonElement>("[data-today-complete]");
      expect(liveComplete.disabled).toBe(true);
      expect(document.activeElement).toBe(title);

      await act(async () => {
        mutation.resolve(
          outcome === "confirmed" ? saved() : problemResponse(503),
        );
        await mutation.promise;
      });
      if (outcome === "confirmed") {
        await waitFor(() => expect(reads(api)).toHaveLength(3));
        await act(async () => {
          completion.resolve(attention([], [], { date: "2026-08-22" }));
          await completion.promise;
        });
        await waitFor(() =>
          expect(document.querySelectorAll(".attention-item")).toHaveLength(0)
        );
        expect(date().dateTime).toBe("2026-08-22");
      } else {
        await waitFor(() =>
          expect(state().textContent).toMatch(/could not be completed/i)
        );
        expect(document.activeElement).toBe(liveComplete);
      }
    },
  );

  it("passes axe with a populated queue", async () => {
    todayShell();
    routes(attention([task(1, "Call Ada"), {
      channel: "email",
      dueAt: "2026-08-17T09:00:00.000Z",
      id: uuid(3),
      kind: "reminder",
      occursOn: "2026-08-17",
      person,
      reminderStatus: "failed",
      title: "Undelivered",
    }], [task(2, "Visit")]));
    await mount();
    await expectNoAxeViolations(document.body);
  });
});
