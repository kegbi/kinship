// @vitest-environment happy-dom
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonVariants } from "@/components/ui/variants.ts";
import { readApplicationStylesheet } from "../../../lib/application-stylesheet.test-helper.ts";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  afterRequests,
  type ApiAnswer,
  deferred,
  jsonResponse,
  problemResponse,
  sendWrite,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import {
  ids,
  preferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { TODAY_RECONNECT_RECORDED_EVENT } from "../../interactions/shared.ts";
import { REMINDER_ACKNOWLEDGED_EVENT } from "../regions.ts";
import {
  mountTodayReminders,
  TODAY_REMINDERS_ISLAND,
} from "./today-reminders.tsx";

const SESSION = "GET /api/v1/session";
const FEED = "GET /api/v1/today/reminders";

const personId = ids.person;
const reminderId = "00000000-0000-4000-8000-000000000900";
const person = { archived: false, id: personId, name: "Ada Lovelace" };

function feed(title = "Call Ada", overrides: Record<string, unknown> = {}) {
  return jsonResponse({
    cadences: [{
      dueAt: "2026-08-18T08:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000903",
      person,
    }],
    reminders: [{
      attemptCount: 0,
      deliverAt: "2026-08-18T08:00:00.000Z",
      id: reminderId,
      person,
      status: "pending",
      title,
    }],
    status: "ready",
    timezone: "Europe/Belgrade",
    ...overrides,
  });
}

type Answer = ApiAnswer;

function routes(answers: Answer | readonly Answer[], timezone = "UTC") {
  return stubApi({
    [SESSION]: jsonResponse(workspaceSession({
      preferences: preferences({ effectiveTimezone: timezone }),
    })),
    [FEED]: answers as Response,
  });
}

/** The reconnect section as `pages/app.astro` draws it. */
function todayShell(): void {
  drawShell(`
    <main>
      <section class="today-section" data-today-reminders aria-labelledby="reconnect-heading">
        <h2 id="reconnect-heading">People to reconnect</h2>
        <p id="today-cadences-state" role="status">Loading reconnect suggestions…</p>
      </section>
    </main>`);
}

const mount = () => mountSettled(() => mountTodayReminders());
const reminderState = () => element("#today-reminders-state");
const cadenceState = () => element("#today-cadences-state");
const reminderRetry = () =>
  element<HTMLButtonElement>("#today-reminders-retry");
const cadenceRetry = () => element<HTMLButtonElement>("#today-cadences-retry");
const reminderList = () => element("#today-reminders-list");
const cadenceList = () => element("#today-cadences-list");
const states = () => [reminderState().textContent, cadenceState().textContent];
const reads = (api: ReturnType<typeof stubApi>) =>
  api.calls().filter((call) => call === FEED).length;

function click(target: HTMLElement): void {
  act(() => {
    fireEvent.click(target);
  });
}

function reconnect(): void {
  act(() => {
    globalThis.dispatchEvent(new CustomEvent(TODAY_RECONNECT_RECORDED_EVENT));
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

afterEach(() => sessionStorage.clear());

describe("PLANNING-002 Today reminder regions island", () => {
  it("does nothing when the reconnect section is absent", async () => {
    drawShell("<p>Other page</p>");
    await mount();
    expect(document.body.textContent).toBe("Other page");
    expect(TODAY_REMINDERS_ISLAND).toBe("today-reminders");
  });

  it.each(["unavailable", "access-lost"])(
    "ends initial Today loading when the session is %s",
    async (sessionState) => {
      todayShell();
      stubApi({
        "* /api/v1/*": sessionState === "unavailable"
          ? unreachable
          : problemResponse(401, { code: "session_invalid" }),
      });
      await mount();
      expect(reminderState().textContent).toMatch(/unavailable/i);
      expect(cadenceState().textContent).toMatch(/unavailable/i);
      expect(document.body.textContent).not.toContain("Loading");
      expect(reminderRetry().hidden).toBe(false);
    },
  );

  it.each([true, false])(
    "settles a second retry that joined the first atomically when success=%s",
    async (succeeds) => {
      todayShell();
      const held = deferred<Response>();
      const api = routes([problemResponse(503), held.promise]);
      await mount();
      expect(states().every((value) => value?.includes("unavailable"))).toBe(
        true,
      );
      expect(reminderRetry().hidden).toBe(false);
      reminderRetry().focus();
      click(reminderRetry());
      expect(states()).toEqual([
        "Loading reminder state…",
        "Reconnect suggestions are unavailable.",
      ]);
      expect(reminderRetry().hidden).toBe(true);
      await waitFor(() => expect(reads(api)).toBe(2));
      // The same read again while the first retry is held joins it (AUD-F1,
      // D7): no third request, and the one answer settles the region once.
      // No retry reads the session again: the document holds it (AUD-F3).
      click(reminderRetry());
      await afterRequests(api, SESSION, 1);
      expect(reads(api)).toBe(2);
      await act(async () => {
        held.resolve(succeeds ? feed("Retried") : problemResponse(503));
        await held.promise;
      });
      await waitFor(() =>
        expect(states()[0]).toMatch(
          succeeds ? /1 reminder state/ : /unavailable/,
        )
      );
      expect(document.activeElement).toBe(reminderState());
      expect(states()[1]).toMatch(/unavailable/);
      expect(reminderRetry().hidden).toBe(succeeds);
      expect(reads(api)).toBe(2);
    },
  );

  it("preserves stale content and restores focus when a retry fails", async () => {
    todayShell();
    const pending = deferred<Response>();
    const api = routes([feed("Preserved"), pending.promise]);
    await mount();
    const cadenceNode = cadenceList().firstElementChild;
    const cadenceText = cadenceState().textContent;
    const expectCadenceUnchanged = () => {
      expect(cadenceList().firstElementChild).toBe(cadenceNode);
      expect(cadenceState().textContent).toBe(cadenceText);
      expect(cadenceRetry().hidden).toBe(true);
    };
    reminderRetry().focus();
    click(reminderRetry());
    expect(document.body.textContent).toContain("Preserved");
    expect(reminderState().textContent).toBe("Loading reminder state…");
    expect(reminderRetry().hidden).toBe(true);
    expectCadenceUnchanged();
    await waitFor(() => expect(reads(api)).toBe(2));
    await act(async () => {
      pending.resolve(problemResponse(503));
      await pending.promise;
    });
    await waitFor(() => expect(reminderRetry().hidden).toBe(false));
    expect(document.body.textContent).toContain("Preserved");
    expect(document.activeElement).toBe(reminderState());
    expectCadenceUnchanged();
  });

  it("rejects an invalid runtime timezone without partially replacing reminder state", async () => {
    todayShell();
    routes([
      feed("Preserved"),
      feed("Must not render", { timezone: "Definitely/Not_A_Zone" }),
    ]);
    await mount();
    click(reminderRetry());
    await waitFor(() => expect(reminderRetry().hidden).toBe(false));
    expect(document.body.textContent).toContain("Preserved");
    expect(document.body.textContent).not.toContain("Must not render");
    expect(reminderState().textContent).toMatch(/unavailable/i);
    expect(cadenceState().textContent).toBe("1 people to reconnect with.");
  });

  it("isolates a Reminder rendering failure from the cadence region", async () => {
    todayShell();
    routes([feed("Preserved"), feed("Must not partially render")]);
    await mount();
    const cadenceNode = cadenceList().firstElementChild;
    const NativeDateTimeFormat = Intl.DateTimeFormat;
    let calls = 0;
    // The first formatter asked for the feed's zone fails, as a browser
    // without the zone would; rows format through `formatInstant`, which
    // cannot throw, so the failure lands while the answer is read.
    const spy = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      (function (
        locales?: Intl.LocalesArgument,
        options?: Intl.DateTimeFormatOptions,
      ) {
        if (options?.timeZone === "Europe/Belgrade" && ++calls === 1) {
          throw new RangeError("formatter unavailable");
        }
        return new NativeDateTimeFormat(locales, options);
      }) as typeof Intl.DateTimeFormat,
    );
    click(reminderRetry());
    await waitFor(() => expect(reminderRetry().hidden).toBe(false));
    spy.mockRestore();
    expect(calls).toBeGreaterThan(0);
    expect(document.body.textContent).toContain("Preserved");
    expect(document.body.textContent).not.toContain(
      "Must not partially render",
    );
    expect(reminderState().textContent).toMatch(/unavailable/i);
    expect(cadenceState().textContent).toBe("1 people to reconnect with.");
    expect(cadenceList().firstElementChild).toBe(cadenceNode);
  });

  it("makes a pending old mount inert after the page draws again", async () => {
    todayShell();
    const shared = deferred<Response>();
    const api = routes([shared.promise]);
    const stale = mountPending(() => mountTodayReminders());
    await waitFor(() => expect(reads(api)).toBe(1));
    todayShell();
    // The new mount asks for the read the old one is still waiting for, so it
    // joins it (AUD-F1, D7), with the document's session (AUD-F3); only the
    // new mount draws the answer.
    const current = mountPending(() => mountTodayReminders());
    await afterRequests(api, SESSION, 1);
    expect(reads(api)).toBe(1);
    await act(async () => {
      shared.resolve(feed("Current mount"));
      await Promise.all([stale, current]);
    });
    await waitFor(() =>
      expect(document.body.textContent).toContain("Current mount")
    );
    expect(reads(api)).toBe(1);
    expect(reminderList().children).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/unavailable/i);
    expect(reminderRetry().hidden).toBe(true);
  });

  it("shows manual-attention delivery and independent cadence state on Today", async () => {
    todayShell();
    const extra = ["pending", "claimed", "retry", "failed"].map((
      status,
      index,
    ) => ({
      attemptCount: index,
      deliverAt: "2026-08-18T08:00:00.000Z",
      id: `00000000-0000-4000-8000-00000000091${index}`,
      ...(status === "retry"
        ? { nextAttemptAt: "2026-08-20T10:00:00.000Z" }
        : {}),
      person,
      status,
      title: `${status} reminder`,
    }));
    routes(
      jsonResponse({
        cadences: [{
          dueAt: "2026-08-18T08:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000903",
          lastContactedAt: "2026-08-17T08:00:00.000Z",
          person,
        }, {
          dueAt: "2026-08-18T09:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000904",
          person: { archived: true, id: personId, name: "Grace Hopper" },
        }],
        reminders: [...extra, {
          attemptCount: 3,
          deliverAt: "2026-08-18T08:00:00.000Z",
          id: reminderId,
          person,
          status: "manual_attention",
          title: "Call Ada",
        }, {
          attemptCount: 1,
          deliverAt: "2026-08-18T09:00:00.000Z",
          id: "00000000-0000-4000-8000-000000000902",
          person,
          status: "sent",
          title: "Visible reminder",
          visibleAt: "2026-08-18T09:00:01.000Z",
        }],
        status: "ready",
        timezone: "America/New_York",
      }),
      "America/New_York",
    );
    await mount();
    for (
      const status of [
        ...extra.map((item) => item.status),
        "sent",
        "manual_attention",
      ]
    ) {
      expect(reminderList().querySelector(`.reminder-${status}`)).not
        .toBeNull();
    }
    for (
      const text of [
        "Scheduled for",
        "Retry scheduled",
        "Delivery failed",
        "Delivery needs manual attention",
        "Notification visible",
      ]
    ) expect(reminderList().textContent).toContain(text);
    const format = (value: string) =>
      new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "America/New_York",
      }).format(new Date(value));
    expect(reminderList().textContent).toContain(
      format("2026-08-18T09:00:01.000Z"),
    );
    const retryRow = reminderList().querySelector(".reminder-retry")!;
    expect(retryRow.textContent).toContain(format("2026-08-20T10:00:00.000Z"));
    expect(retryRow.textContent).not.toContain(
      format("2026-08-18T08:00:00.000Z"),
    );
    for (const text of ["Last contact", "No contact recorded", "archived"]) {
      expect(cadenceList().textContent).toContain(text);
    }
    expect(cadenceList().textContent).toContain(
      format("2026-08-17T08:00:00.000Z"),
    );
    const style = document.createElement("style");
    style.textContent = readApplicationStylesheet("general");
    document.head.append(style);
    expect(reminderRetry().hidden).toBe(true);
    expect(reminderRetry().type).toBe("button");
    const links = [
      within(reminderList()).getAllByRole("link")[0]!,
      within(cadenceList()).getAllByRole("link")[0]!,
    ];
    expect(links[0]!.textContent).toBe("pending reminder · Ada Lovelace");
    expect(links[0]!.getAttribute("href")).toBe(
      `/app/people/${personId}?section=reminders`,
    );
    expect(links[1]!.getAttribute("href")).toBe(
      `/app/people/${personId}?section=stay-in-touch`,
    );
    for (const link of links) {
      const computed = getComputedStyle(link);
      expect(link.classList).toContain("today-touch-target");
      expect(link.tabIndex).toBe(0);
      expect(computed.minHeight).toBe("44px");
      expect(computed.minWidth).toBe("44px");
      expect(computed.maxInlineSize).toBe("100%");
      expect(computed.whiteSpace).toBe("normal");
      expect(computed.overflowWrap).toBe("anywhere");
      expect(computed.width).not.toBe("100%");
    }
    const cadenceRows = [...cadenceList().children];
    const opener = cadenceRows[0]?.querySelector<HTMLButtonElement>(
      "[data-today-reconnect-capture]",
    );
    expect(opener?.textContent).toBe("Log interaction");
    // Quick capture enables the opener once it is wired (REL-039).
    expect(opener?.disabled).toBe(true);
    expect(
      [
        "data-interaction-capture-ready",
        "data-interaction-intended-kind",
        "data-interaction-person-id",
        "data-quick-capture",
      ].map((name) => opener?.getAttribute(name)),
    ).toEqual(["false", "activity", personId, ""]);
    // A 44px target in both directions that wraps a long name.
    expect(opener?.className).toBe(
      buttonVariants({ variant: "outline", wrap: true }),
    );
    expect(opener?.classList).toContain("min-h-11");
    expect(opener?.classList).toContain("min-w-11");
    expect(cadenceRows[1]?.querySelector("button")).toBeNull();
    await expectNoAxeViolations(document.body);
  });

  it("gives cadence its own recovery while preserving exact reminder state, and focuses it after a reconnect", async () => {
    todayShell();
    const retryFailure = deferred<Response>();
    const retrySuccess = deferred<Response>();
    const api = routes([
      feed("Preserved reminder"),
      problemResponse(503),
      retryFailure.promise,
      retrySuccess.promise,
    ]);
    await mount();
    const reminderNode = reminderList().firstElementChild;
    const reminderText = reminderState().textContent;
    const assertReminderPreserved = () => {
      expect(reminderList().firstElementChild).toBe(reminderNode);
      expect(reminderState().textContent).toBe(reminderText);
      expect(reminderRetry().hidden).toBe(true);
    };
    reconnect();
    expect(cadenceState().textContent).toContain("Loading");
    assertReminderPreserved();
    await waitFor(() =>
      expect(cadenceState().textContent).toMatch(/unavailable/i)
    );
    expect(cadenceRetry().hidden).toBe(false);
    expect(document.activeElement).toBe(cadenceState());
    assertReminderPreserved();

    click(cadenceRetry());
    await waitFor(() => expect(reads(api)).toBe(3));
    await act(async () => {
      retryFailure.resolve(problemResponse(503));
      await retryFailure.promise;
    });
    await waitFor(() => expect(cadenceRetry().hidden).toBe(false));
    expect(cadenceState().textContent).toMatch(/unavailable/i);
    assertReminderPreserved();

    click(cadenceRetry());
    await waitFor(() => expect(reads(api)).toBe(4));
    await act(async () => {
      retrySuccess.resolve(feed("Preserved reminder", { cadences: [] }));
      await retrySuccess.promise;
    });
    await waitFor(() =>
      expect(cadenceState().textContent).toBe("No one is due for contact.")
    );
    expect(cadenceRetry().hidden).toBe(true);
    expect(document.activeElement).toBe(cadenceState());
    assertReminderPreserved();
  });

  it("REL-088 reads its reminders again when Today dismissed an undelivered one, without moving focus", async () => {
    todayShell();
    const api = routes([
      feed("Undelivered reminder", {
        reminders: [{
          attemptCount: 1,
          deliverAt: "2026-08-18T08:00:00.000Z",
          id: reminderId,
          person,
          status: "failed",
          title: "Undelivered reminder",
        }],
      }),
      feed("Next reminder"),
    ]);
    await mount();
    expect(reminderList().textContent).toContain("Undelivered reminder");
    const focused = document.activeElement;
    act(() => {
      globalThis.dispatchEvent(new CustomEvent(REMINDER_ACKNOWLEDGED_EVENT));
    });
    await waitFor(() =>
      expect(reminderList().textContent).toContain("Next reminder")
    );
    expect(reads(api)).toBe(2);
    expect(reminderList().textContent).not.toContain("Undelivered reminder");
    expect(document.activeElement).toBe(focused);
  });

  it("lets a reconnect during the first read supersede it and settle both regions", async () => {
    todayShell();
    const initial = deferred<Response>();
    const event = deferred<Response>();
    const api = routes([initial.promise, event.promise]);
    const mounted = mountPending(() => mountTodayReminders());
    await waitFor(() => expect(reads(api)).toBe(1));
    // The announcement follows the write that recorded the reconnect, so its
    // read is its own request (AUD-F1, D7) and supersedes the first.
    await recordedReconnect(api);
    await waitFor(() => expect(reads(api)).toBe(2));
    await act(async () => {
      event.resolve(feed("From the reconnect", { cadences: [] }));
      await mounted;
    });
    expect(states()).toEqual([
      "1 reminder state.",
      "No one is due for contact.",
    ]);
    await act(async () => {
      initial.resolve(feed("Obsolete initial"));
      await initial.promise;
    });
    expect(document.body.textContent).toContain("From the reconnect");
    expect(document.body.textContent).not.toContain("Obsolete initial");
    expect(cadenceState().textContent).toBe("No one is due for contact.");
  });
});
