// @vitest-environment happy-dom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { segmentVariants } from "@/components/ui/variants.ts";
import type { SectionProps } from "../../features/person/section-mounts.ts";
import { mountPersonTimeline } from "./mount.tsx";

const segment = segmentVariants();
const personId = "00000000-0000-4000-8000-000000000100";
const workspaceId = "00000000-0000-4000-8000-000000000300";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => resolve = done);
  return { promise, resolve };
}

/** The card as the static shell draws it, filters disabled until wired. */
function markup(): HTMLElement {
  document.body.innerHTML = `
    <main>
      <section id="person-timeline" class="profile-section-card person-timeline" aria-labelledby="person-timeline-heading">
        <header class="profile-section-heading"><div class="profile-section-title"><h3 id="person-timeline-heading">Everything, in order</h3></div></header>
        <div class="person-timeline-filters" role="group" aria-label="Filter timeline by type">
          <button class="${segment}" data-timeline-filter="all" type="button" aria-pressed="true" disabled>All types</button>
        </div>
        <p data-timeline-state class="section-state">Loading the timeline…</p>
        <ul data-timeline-list class="person-timeline-list" aria-label="Person timeline"></ul>
      </section>
    </main>`;
  return document.querySelector("#person-timeline")!;
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

const utc = {
  contactNameOrder: "given_family_nickname",
  effectiveTimezone: "UTC",
  locale: "en",
} as unknown as NonNullable<SectionProps["preferences"]>;

const mounted: Array<() => void> = [];

async function mount(
  preferences: SectionProps["preferences"] = utc,
): Promise<void> {
  await act(async () => {
    mounted.push(
      await mountPersonTimeline(document.body, {
        archived: false,
        personId,
        preferences,
        workspaceId,
      }),
    );
  });
}

const card = () =>
  within(document.querySelector<HTMLElement>("#person-timeline")!);
const stateLine = () =>
  document.querySelector("p[data-timeline-state]")?.textContent;
const rows = () => [
  ...document.querySelectorAll<HTMLElement>("[data-timeline-id]"),
];

afterEach(() => {
  act(() => {
    for (const unmount of mounted.splice(0)) unmount();
  });
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("merged person timeline island", () => {
  it("accepts an immediate filter click and supersedes the initial request", async () => {
    const root = markup();
    const initial = deferred<Response>();
    const activity = item({
      excerpt: "Designed a compiler together",
      kind: "activity",
    });
    const fetchMock = vi.fn()
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce(response({ items: [activity], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    let settledMount!: Promise<void>;
    act(() => {
      settledMount = mount();
    });
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
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}/timeline?kind=activity&limit=20`,
    );
    expect(
      new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get("X-Workspace-Id"),
    ).toBe(workspaceId);
    expect(activities.getAttribute("aria-pressed")).toBe("true");

    initial.resolve(response({
      items: [item({ excerpt: "A newer unfiltered note" })],
      nextCursor: "older-unfiltered-events",
      status: "ready",
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
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(response({
          items: [
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
          ],
          status: "ready",
        })),
      );
      await mount({
        ...utc,
        effectiveTimezone,
        locale: "en-US",
      });
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [item({ occurredAt: "2026-09-04T22:10:00Z" })],
        status: "ready",
      })),
    );
    await mount({
      ...utc,
      effectiveTimezone: "Europe/Belgrade",
      locale: "de-DE",
    });
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
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: [first, second],
      status: "ready",
    }));
    vi.stubGlobal("fetch", fetchMock);

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
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/people/${personId}/timeline?limit=20`,
      { headers: expect.objectContaining({ "X-Workspace-Id": workspaceId }) },
    );
  });

  it("falls back to the kind and an honest placeholder when a row has no text", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [item({ excerpt: undefined, kind: "note", title: undefined })],
        status: "ready",
      })),
    );
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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [
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
        ],
        status: "ready",
      })),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [
          item({ contactWasCaller: true, kind: "call" }),
          item({ contactWasCaller: false, kind: "call" }),
        ],
        status: "ready",
      })),
    );

    await mount();

    expect(
      [...document.querySelectorAll("details > ul")].map((list) =>
        list.textContent
      ),
    ).toEqual(["Incoming call", "Outgoing call"]);
  });

  it("renders conversation metadata and messages in received order", async () => {
    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [
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
        ],
        status: "ready",
      })),
    );

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
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [item({ kind: "note" }), item({ kind: "life-event" })],
        status: "ready",
      })),
    );

    await mount();

    expect(document.querySelectorAll("details > ul")).toHaveLength(0);
  });

  it("formats every date precision in UTC without inventing an unknown date", async () => {
    markup();
    const occurredAt = "1999-12-31T23:59:00.000Z";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        items: [
          item({ datePrecision: "full" }),
          item({ datePrecision: "year_month" }),
          item({ datePrecision: "year" }),
          item({ datePrecision: "month_day" }),
          item({ datePrecision: "month" }),
          item({ datePrecision: "day" }),
          item({ datePrecision: "unknown", occurredAt }),
        ],
        status: "ready",
      })),
    );

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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        items: [item()],
        nextCursor: "cursor-for-all",
        status: "ready",
      }))
      .mockResolvedValueOnce(response({ items: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    await mount();
    const notes = card().getByRole("button", { name: "Notes" });
    await userEvent.setup().click(notes);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}/timeline?kind=note&limit=20`,
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("cursor");
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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({ items: [item()], status: "ready" }))
        .mockReturnValueOnce(reload.promise),
    );
    await mount();
    await userEvent.setup().click(
      card().getByRole("button", { name: "Calls" }),
    );
    expect(stateLine()).toBe("Loading the timeline…");
    expect(rows()).toHaveLength(0);
    await act(async () => {
      reload.resolve(response({ items: [], status: "ready" }));
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ items: [original], status: "ready" }))
      .mockResolvedValueOnce(response({
        items: [created, original],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await mount();
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-timeline-changed", {
          detail: { personIds: [crypto.randomUUID(), personId] },
        }),
      );
    });

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(
        card().getByRole("list", { name: "Person timeline" }).textContent,
      ).toContain("Newly created note");
    });
  });

  it("ignores a changed timeline for another person or without detail", async () => {
    markup();
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: [item()],
      status: "ready",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await mount();
    fetchMock.mockClear();
    act(() => {
      document.dispatchEvent(
        new CustomEvent("person-timeline-changed", {
          detail: { personIds: [crypto.randomUUID()] },
        }),
      );
      document.dispatchEvent(new CustomEvent("person-timeline-changed"));
    });
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("appends older pages, preserves paging focus, and hides the exhausted control", async () => {
    markup();
    const first = item({ id: "00000000-0000-4000-8000-000000000211" });
    const second = item({ id: "00000000-0000-4000-8000-000000000212" });
    const third = item({ id: "00000000-0000-4000-8000-000000000213" });
    const older = deferred<Response>();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        items: [first],
        nextCursor: "cursor-1",
        status: "ready",
      }))
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(response({ items: [third], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    await mount();
    const user = userEvent.setup();
    const more = card().getByRole("button", { name: "Load older events" });
    await user.click(more);
    expect(stateLine()).toBe("Loading older events…");
    expect((more as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      older.resolve(response({
        items: [second],
        nextCursor: "cursor-2",
        status: "ready",
      }));
      await older.promise;
    });
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
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
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        detail: "Timeline storage is unavailable.",
        status: 503,
        title: "Unavailable",
        type: "about:blank",
      }, 503))
      .mockResolvedValueOnce(response({ items: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    await mount();
    expect(stateLine()).toBe("Timeline storage is unavailable.");
    expect(root.dataset.timelineState).toBe("error");
    const retry = card().getByRole("button", { name: "Retry the timeline" });
    expect(retry.hidden).toBe(false);
    await userEvent.setup().click(retry);
    await waitFor(() => expect(root.dataset.timelineState).toBe("empty"));
    expect(fetchMock).toHaveBeenCalledTimes(2);

    act(() => {
      for (const unmount of mounted.splice(0)) unmount();
    });
    root = markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        detail: "No person was found.",
        status: 404,
        title: "Not found",
        type: "about:blank",
      }, 404)),
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
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          detail: "Forbidden.",
          status: 403,
          title: "Forbidden",
          type: "about:blank",
        }, 403))
        .mockRejectedValueOnce(new TypeError("offline")),
    );
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
    const fetchMock = vi.fn().mockResolvedValue(
      response({ items: [], status: "ready" }),
    );
    vi.stubGlobal("fetch", fetchMock);

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
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("list")).toBeNull();
  });
});
