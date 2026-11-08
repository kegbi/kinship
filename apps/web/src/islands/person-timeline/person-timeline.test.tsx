// @vitest-environment happy-dom
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { segmentVariants } from "@/components/ui/variants.ts";
import type { SectionProps } from "../../features/person/section-mounts.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../testing/api.ts";
import { ids, preferences, sectionProps } from "../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSection,
} from "../../testing/render.tsx";
import { mountPersonTimeline } from "./mount.tsx";

const segment = segmentVariants();
const { person: personId, workspace: workspaceId } = ids;
const TIMELINE = "GET /api/v1/people/:personId/timeline";

/** The card as the static shell draws it, filters disabled until wired. */
function markup(): HTMLElement {
  drawShell(`
    <main>
      <section id="person-timeline" class="profile-section-card person-timeline" aria-labelledby="person-timeline-heading">
        <header class="profile-section-heading"><div class="profile-section-title"><h3 id="person-timeline-heading">Everything, in order</h3></div></header>
        <div class="person-timeline-filters" role="group" aria-label="Filter timeline by type">
          <button class="${segment}" data-timeline-filter="all" type="button" aria-pressed="true" disabled>All types</button>
        </div>
        <p data-timeline-state class="section-state">Loading the timeline…</p>
        <ul data-timeline-list class="person-timeline-list" aria-label="Person timeline"></ul>
      </section>
    </main>`);
  return element("#person-timeline");
}

function item(overrides: Record<string, unknown> = {}) {
  return {
    datePrecision: "full",
    excerpt: "A short memory",
    id: crypto.randomUUID(),
    kind: "note",
    occurredAt: "2026-01-02T15:04:00.000Z",
    title: "A full title",
    ...overrides,
  };
}

/** A ready timeline page. */
const page = (items: readonly unknown[], more: object = {}) =>
  jsonResponse({ items, status: "ready", ...more });

/** Answers every timeline read with one ready page of `items`. */
const serve = (items: readonly unknown[]) =>
  stubApi({ [TIMELINE]: page(items) });

const props = (prefs: SectionProps["preferences"] = preferences()) =>
  sectionProps({ preferences: prefs });

const mount = (prefs?: SectionProps["preferences"]) =>
  mountSection(mountPersonTimeline, props(prefs));

const card = () => within(element("#person-timeline"));
const stateLine = () =>
  document.querySelector("p[data-timeline-state]")?.textContent;
const rows = () => [
  ...document.querySelectorAll<HTMLElement>("[data-timeline-id]"),
];

describe("merged person timeline island", () => {
  it("accepts an immediate filter click and supersedes the initial request", async () => {
    const root = markup();
    const initial = deferred<Response>();
    const activity = item({
      excerpt: "Designed a compiler together",
      kind: "activity",
    });
    const api = stubApi({
      [TIMELINE]: [initial.promise, page([activity])],
    });

    const settledMount = mountPending(() =>
      mountPersonTimeline(document.body, props())
    );
    // The island took the card over: its filters are wired and enabled.
    expect(root.dataset.island).toBe("person-timeline");
    expect(root.hasAttribute("data-island-ready")).toBe(true);
    const filters = card().getByRole("group", {
      name: "Filter timeline by type",
    });
    const chips = within(filters).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "All types",
      "Notes",
      "Calls",
      "Conversations",
      "Activities",
      "Life events",
    ]);
    expect(chips.every((chip) => !(chip as HTMLButtonElement).disabled)).toBe(
      true,
    );
    expect(root.dataset.timelineState).toBe("loading");
    const activities = within(filters).getByRole("button", {
      name: "Activities",
    });
    await userEvent.setup().click(activities);

    await waitFor(() => expect(root.dataset.timelineState).toBe("ready"));
    expect(api.fetch).toHaveBeenCalledTimes(2);
    expect(api.fetch.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}/timeline?kind=activity&limit=20`,
    );
    expect(api.requests()[1]?.headers.get("X-Workspace-Id")).toBe(workspaceId);
    expect(activities.getAttribute("aria-pressed")).toBe("true");

    initial.resolve(page([item({ excerpt: "A newer unfiltered note" })], {
      nextCursor: "older-unfiltered-events",
    }));
    await act(() => settledMount);
    const list = card().getByRole("list", { name: "Person timeline" });
    expect(list.textContent).toContain("Designed a compiler together");
    expect(list.textContent).not.toContain("A newer unfiltered note");
    expect(activities.getAttribute("aria-pressed")).toBe("true");
    expect(
      document.querySelector<HTMLElement>("[data-timeline-more]")?.hidden,
    ).toBe(true);
  });

  it.each(["America/Los_Angeles", "Europe/Belgrade"])(
    "APR-009 keeps calendar components stable in %s and preserves actual event instants",
    async (effectiveTimezone) => {
      markup();
      const occurredAt = "2026-09-04T22:10:00Z";
      serve([
        item({
          calendarDate: { day: 5, month: 9, year: 2026 },
          kind: "life-event",
          occurredAt,
        }),
        item({
          calendarDate: { day: 29, month: 2 },
          datePrecision: "month_day",
          kind: "life-event",
          occurredAt,
        }),
        item({
          calendarDate: {},
          datePrecision: "unknown",
          kind: "life-event",
          occurredAt,
        }),
        item({ kind: "life-event", occurredAt }),
      ]);
      await mount(preferences({ effectiveTimezone, locale: "en-US" }));
      const dates = [...document.querySelectorAll("[data-timeline-date]")];
      expect(dates.map((date) => date.textContent)).toEqual([
        "September 5, 2026",
        "February 29",
        "Date unknown",
        effectiveTimezone === "Europe/Belgrade"
          ? "Sep 5, 2026, 12:10 AM"
          : "Sep 4, 2026, 3:10 PM",
      ]);
      expect(dates.map((date) => date.getAttribute("datetime"))).toEqual([
        "2026-09-05",
        "02-29",
        null,
        occurredAt,
      ]);
    },
  );

  it("APR-009 formats an instant with explicit member locale and timezone", async () => {
    markup();
    serve([item({ occurredAt: "2026-09-04T22:10:00Z" })]);
    await mount(
      preferences({ effectiveTimezone: "Europe/Belgrade", locale: "de-DE" }),
    );
    expect(document.querySelector("[data-timeline-date]")?.textContent)
      .toBe("05.09.2026, 00:10");
  });

  it("renders the first page in API order with the summary fields in contract order", async () => {
    markup();
    const first = item({
      excerpt: "First excerpt",
      id: "00000000-0000-4000-8000-000000000201",
      kind: "call",
      title: "First title",
    });
    const second = item({
      excerpt: "Second excerpt",
      id: "00000000-0000-4000-8000-000000000202",
      kind: "activity",
      occurredAt: "2025-12-31T10:00:00.000Z",
      title: "Second title",
    });
    const api = serve([first, second]);

    await mount();

    expect(rows().map((row) => row.dataset.timelineId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(rows().map((row) => row.dataset.timelineKind)).toEqual([
      "call",
      "activity",
    ]);
    expect(
      [...rows()[0]!.querySelector("summary")!.children].map((element) =>
        element.textContent
      ),
    ).toEqual(["Jan 2, 2026, 3:04 PM", "Call", "First excerpt"]);
    expect(rows()[0]!.querySelector("details > strong")?.textContent).toBe(
      "First title",
    );
    expect(rows()[0]!.querySelector("details > p")?.textContent).toBe(
      "First excerpt",
    );
    expect(stateLine()).toBe("2 timeline events");
    expect(api.fetch).toHaveBeenCalledWith(
      `/api/v1/people/${personId}/timeline?limit=20`,
      {
        cache: "no-store",
        headers: expect.objectContaining({ "X-Workspace-Id": workspaceId }),
      },
    );
  });

  it("falls back to the kind and an honest placeholder when a row has no text", async () => {
    markup();
    serve([item({ excerpt: undefined, kind: "note", title: undefined })]);
    await mount(undefined);
    const [row] = rows();
    expect(row!.querySelector(".person-timeline-summary-excerpt")?.textContent)
      .toBe("No details recorded.");
    expect(row!.querySelector("details > strong")?.textContent).toBe("Note");
    expect(row!.querySelector("details > p")?.textContent).toBe(
      "No details recorded.",
    );
    expect(stateLine()).toBe("1 timeline event");
  });

  it("renders activity participants, category, and emotions in received order", async () => {
    markup();
    serve([
      item({
        activityType: "Workshop",
        emotions: [
          { id: crypto.randomUUID(), name: "Inspired" },
          { id: crypto.randomUUID(), name: "Curious" },
        ],
        kind: "activity",
        participants: [
          { id: crypto.randomUUID(), name: "Ada Lovelace" },
          { id: crypto.randomUUID(), name: "Grace Hopper" },
        ],
      }),
    ]);

    await mount();

    expect(
      [...document.querySelectorAll("details > ul > li")].map((line) =>
        line.textContent
      ),
    ).toEqual([
      "Participants: Ada Lovelace, Grace Hopper",
      "Category: Workshop",
      "Emotions: Inspired, Curious",
    ]);
  });

  it("renders incoming and outgoing call direction", async () => {
    markup();
    serve([
      item({ contactWasCaller: true, kind: "call" }),
      item({ contactWasCaller: false, kind: "call" }),
    ]);

    await mount();

    expect(
      [...document.querySelectorAll("details > ul")].map((list) =>
        list.textContent
      ),
    ).toEqual(["Incoming call", "Outgoing call"]);
  });

  it("renders conversation metadata and messages in received order", async () => {
    markup();
    serve([
      item({
        channelType: "Email",
        contactMethod: "ada@example.test",
        kind: "conversation",
        messages: [
          {
            content: "Can we compare notes?",
            direction: "inbound",
            writtenAt: "2026-01-02T14:00:00.000Z",
          },
          {
            content: "Yes, tomorrow works.",
            direction: "outbound",
            writtenAt: "2026-01-02T14:05:00.000Z",
          },
        ],
      }),
      item({ kind: "conversation" }),
      item({ kind: "conversation", messages: [] }),
    ]);

    await mount();

    expect(
      [...document.querySelectorAll("details > ul")].map((list) =>
        [...list.children].map((line) => line.textContent)
      ),
    ).toEqual([
      [
        "Channel: Email",
        "Via ada@example.test",
        "Inbound: Can we compare notes?",
        "Outbound: Yes, tomorrow works.",
      ],
      ["Direction not recorded"],
      ["Direction not recorded"],
    ]);
  });

  it("omits detail lists for notes and life events", async () => {
    markup();
    serve([item({ kind: "note" }), item({ kind: "life-event" })]);

    await mount();

    expect(document.querySelectorAll("details > ul")).toHaveLength(0);
  });

  it("formats every date precision in UTC without inventing an unknown date", async () => {
    markup();
    const occurredAt = "1999-12-31T23:59:00.000Z";
    serve([
      item({ datePrecision: "full" }),
      item({ datePrecision: "year_month" }),
      item({ datePrecision: "year" }),
      item({ datePrecision: "month_day" }),
      item({ datePrecision: "month" }),
      item({ datePrecision: "day" }),
      item({ datePrecision: "unknown", occurredAt }),
    ]);

    await mount();

    const dates = [...document.querySelectorAll<HTMLElement>(
      "[data-timeline-date]",
    )];
    expect(dates.map((date) => date.textContent)).toEqual([
      "Jan 2, 2026, 3:04 PM",
      "January 2026",
      "2026",
      "January 2",
      "January",
      "2",
      "Date unknown",
    ]);
    expect(dates.map((date) => ({
      dateTime: date.getAttribute("datetime"),
      tagName: date.tagName,
    }))).toEqual([
      { dateTime: "2026-01-02T15:04:00.000Z", tagName: "TIME" },
      { dateTime: "2026-01", tagName: "TIME" },
      { dateTime: "2026", tagName: "TIME" },
      { dateTime: "01-02", tagName: "TIME" },
      { dateTime: null, tagName: "SPAN" },
      { dateTime: null, tagName: "SPAN" },
      { dateTime: null, tagName: "SPAN" },
    ]);
    expect(dates[6]?.textContent).not.toContain("1999");
  });

  it("reloads a selected kind from the first page and updates chip state", async () => {
    markup();
    const api = stubApi({
      [TIMELINE]: [
        page([item()], { nextCursor: "cursor-for-all" }),
        page([]),
      ],
    });

    await mount();
    const notes = card().getByRole("button", { name: "Notes" });
    await userEvent.setup().click(notes);

    await waitFor(() => expect(api.fetch).toHaveBeenCalledTimes(2));
    expect(api.fetch.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}/timeline?kind=note&limit=20`,
    );
    expect(String(api.fetch.mock.calls[1]?.[0])).not.toContain("cursor");
    await waitFor(() =>
      expect(stateLine()).toBe("No timeline events recorded.")
    );
    expect(notes.getAttribute("aria-pressed")).toBe("true");
    expect(notes.className).toBe(segment);
    const all = card().getByRole("button", { name: "All types" });
    expect(all.getAttribute("aria-pressed")).toBe("false");
    expect(all.className).toBe(segment);
  });

  it("shows a reload in progress without the first-load skeleton", async () => {
    markup();
    const reload = deferred<Response>();
    stubApi({ [TIMELINE]: [page([item()]), reload.promise] });
    await mount();
    await userEvent.setup().click(
      card().getByRole("button", { name: "Calls" }),
    );
    expect(stateLine()).toBe("Loading the timeline…");
    expect(rows()).toHaveLength(0);
    await act(async () => {
      reload.resolve(page([]));
      await reload.promise;
    });
    await waitFor(() =>
      expect(stateLine()).toBe("No timeline events recorded.")
    );
  });

  it("reloads when a changed timeline includes the mounted person", async () => {
    markup();
    const original = item({
      excerpt: "Original note",
      id: "00000000-0000-4000-8000-000000000203",
    });
    const created = item({
      excerpt: "Newly created note",
      id: "00000000-0000-4000-8000-000000000204",
    });
    const api = stubApi({
      [TIMELINE]: [page([original]), page([created, original])],
    });

    await mount();
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-timeline-changed", {
          detail: { personIds: [crypto.randomUUID(), personId] },
        }),
      );
    });

    await waitFor(() => {
      expect(api.fetch).toHaveBeenCalledTimes(2);
      expect(
        card().getByRole("list", { name: "Person timeline" }).textContent,
      ).toContain("Newly created note");
    });
  });

  it("ignores a changed timeline for another person or without detail", async () => {
    markup();
    const api = serve([item()]);

    await mount();
    api.fetch.mockClear();
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-timeline-changed", {
          detail: { personIds: [crypto.randomUUID()] },
        }),
      );
      document.dispatchEvent(new CustomEvent("person-timeline-changed"));
    });
    await Promise.resolve();

    expect(api.fetch).not.toHaveBeenCalled();
  });

  it("appends older pages, preserves paging focus, and hides the exhausted control", async () => {
    markup();
    const first = item({ id: "00000000-0000-4000-8000-000000000211" });
    const second = item({ id: "00000000-0000-4000-8000-000000000212" });
    const third = item({ id: "00000000-0000-4000-8000-000000000213" });
    const older = deferred<Response>();
    const api = stubApi({
      [TIMELINE]: [
        page([first], { nextCursor: "cursor-1" }),
        older.promise,
        page([third]),
      ],
    });

    await mount();
    const user = userEvent.setup();
    const more = card().getByRole("button", { name: "Load older events" });
    await user.click(more);
    expect(stateLine()).toBe("Loading older events…");
    expect((more as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      older.resolve(page([second], { nextCursor: "cursor-2" }));
      await older.promise;
    });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(api.fetch.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}/timeline?cursor=cursor-1&limit=20`,
    );
    expect(document.activeElement).toBe(more);
    expect(more.hidden).toBe(false);
    await user.click(more);
    await waitFor(() => expect(more.hidden).toBe(true));
    expect(rows().map((row) => row.dataset.timelineId)).toEqual([
      first.id,
      second.id,
      third.id,
    ]);
    // With nothing older, focus moves to the first row the page appended.
    expect(document.activeElement).toBe(rows()[2]!.querySelector("summary"));
  });

  it("offers retry for a server failure but not when the person is gone", async () => {
    let root = markup();
    const api = stubApi({
      [TIMELINE]: [
        problemResponse(503, {
          detail: "Timeline storage is unavailable.",
          title: "Unavailable",
        }),
        page([]),
      ],
    });

    const unmount = await mount();
    expect(stateLine()).toBe("Timeline storage is unavailable.");
    expect(root.dataset.timelineState).toBe("error");
    const retry = card().getByRole("button", { name: "Retry the timeline" });
    expect(retry.hidden).toBe(false);
    await userEvent.setup().click(retry);
    await waitFor(() => expect(root.dataset.timelineState).toBe("empty"));
    expect(api.fetch).toHaveBeenCalledTimes(2);

    unmount();
    root = markup();
    api.route(
      TIMELINE,
      problemResponse(404, {
        detail: "No person was found.",
        title: "Not found",
      }),
    );
    await mount();
    expect(stateLine()).toBe("This person is no longer available.");
    expect(root.dataset.timelineState).toBe("not-found");
    expect(
      document.querySelector<HTMLElement>("[data-timeline-retry]")?.hidden,
    ).toBe(true);
  });

  it("names forbidden access and an unreachable server honestly", async () => {
    const root = markup();
    stubApi({
      [TIMELINE]: [
        problemResponse(403, { detail: "Forbidden.", title: "Forbidden" }),
        unreachable,
      ],
    });
    await mount();
    expect(root.dataset.timelineState).toBe("forbidden");
    expect(stateLine()).toBe(
      "You no longer have access to this person's timeline.",
    );
    await userEvent.setup().click(
      card().getByRole("button", { name: "Notes" }),
    );
    await waitFor(() =>
      expect(stateLine()).toBe("The timeline is temporarily unavailable.")
    );
    expect(root.dataset.timelineState).toBe("error");
    expect(card().getByRole("button", { name: "Retry the timeline" }).hidden)
      .toBe(false);
  });

  it("renders an honest empty state and tolerates a missing surface", async () => {
    markup();
    const api = serve([]);

    await mount();
    expect(stateLine()).toBe("No timeline events recorded.");
    expect(rows()).toHaveLength(0);

    document.body.innerHTML = "<main></main>";
    const unmount = await mountPersonTimeline(document.body, {
      archived: false,
      personId,
      workspaceId,
    });
    expect(unmount).toBeTypeOf("function");
    unmount();
    expect(api.fetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("list")).toBeNull();
  });
});

describe("REL-052 person timeline status line", () => {
  // Mounted during the initial fan-out, the line waits for the workspace's
  // promotion (UXD-003B); mounted after it, the line is its own live region
  // from the first commit.
  it.each([false, true])(
    "owns its live region from its first commit only once states are live (%s)",
    async (live) => {
      markup();
      const answer = deferred<Response>();
      stubApi({ [TIMELINE]: answer.promise });
      const settled = mountPending(() =>
        mountPersonTimeline(document.body, {
          ...props(),
          statesLive: () => live,
        })
      );
      const line = element("p[data-timeline-state]");
      expect(line.getAttribute("role")).toBe(live ? "status" : null);
      expect(line.getAttribute("aria-live")).toBe(live ? "polite" : null);
      await act(async () => {
        answer.resolve(page([]));
        await settled;
      });
      expect(line.isConnected).toBe(true);
    },
  );
});
