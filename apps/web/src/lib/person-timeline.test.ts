// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPersonTimeline } from "./person-timeline.ts";

const personId = "00000000-0000-4000-8000-000000000100";
const workspaceId = "00000000-0000-4000-8000-000000000300";

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function markup(): HTMLElement {
  document.body.innerHTML = `
    <section id="person-timeline" class="profile-section-card person-timeline">
      <div class="person-timeline-filters" role="group" aria-label="Filter timeline by type">
        <button class="button-primary" data-timeline-filter="all" type="button" aria-pressed="true">All types</button>
        <button class="button-secondary" data-timeline-filter="note" type="button" aria-pressed="false">Notes</button>
        <button class="button-secondary" data-timeline-filter="call" type="button" aria-pressed="false">Calls</button>
        <button class="button-secondary" data-timeline-filter="conversation" type="button" aria-pressed="false">Conversations</button>
        <button class="button-secondary" data-timeline-filter="activity" type="button" aria-pressed="false">Activities</button>
        <button class="button-secondary" data-timeline-filter="life-event" type="button" aria-pressed="false">Life events</button>
      </div>
      <p data-timeline-state class="section-state">Loading the timeline…</p>
      <ul data-timeline-list class="person-timeline-list"></ul>
      <button data-timeline-more class="button-secondary" type="button" hidden>Load older events</button>
      <button data-timeline-retry class="button-secondary" type="button" hidden>Retry the timeline</button>
    </section>`;
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

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("merged person timeline", () => {
  it("renders the first page in API order with the summary fields in contract order", async () => {
    const root = markup();
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

    await mountPersonTimeline({ personId, workspaceId });

    const rows = [...root.querySelectorAll<HTMLElement>(
      "[data-timeline-id]",
    )];
    expect(rows.map((row) => row.dataset.timelineId)).toEqual([
      first.id,
      second.id,
    ]);
    expect(
      [...rows[0]!.querySelector("summary")!.children].map((element) =>
        element.textContent
      ),
    ).toEqual(["January 2, 2026 at 3:04 PM", "Call", "First excerpt"]);
    expect(rows[0]!.querySelector("details > strong")?.textContent).toBe(
      "First title",
    );
    expect(rows[0]!.querySelector("details > p")?.textContent).toBe(
      "First excerpt",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/people/${personId}/timeline?limit=20`,
      { headers: expect.objectContaining({ "X-Workspace-Id": workspaceId }) },
    );
  });

  it("formats every date precision in UTC without inventing an unknown date", async () => {
    const root = markup();
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

    await mountPersonTimeline({ personId, workspaceId });

    const dates = [...root.querySelectorAll<HTMLElement>(
      "[data-timeline-date]",
    )];
    expect(dates.map((date) => date.textContent)).toEqual([
      "January 2, 2026 at 3:04 PM",
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
    const root = markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        items: [item()],
        nextCursor: "cursor-for-all",
        status: "ready",
      }))
      .mockResolvedValueOnce(response({ items: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonTimeline({ personId, workspaceId });
    const notes = root.querySelector<HTMLButtonElement>(
      '[data-timeline-filter="note"]',
    )!;
    notes.click();

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `/api/v1/people/${personId}/timeline?kind=note&limit=20`,
    );
    expect(String(fetchMock.mock.calls[1]?.[0])).not.toContain("cursor");
    expect(notes.getAttribute("aria-pressed")).toBe("true");
    expect(notes.classList.contains("button-primary")).toBe(true);
    const all = root.querySelector<HTMLButtonElement>(
      '[data-timeline-filter="all"]',
    )!;
    expect(all.getAttribute("aria-pressed")).toBe("false");
    expect(all.classList.contains("button-secondary")).toBe(true);
  });

  it("reloads when a changed timeline includes the mounted person", async () => {
    const root = markup();
    const original = item({
      excerpt: "Original note",
      id: "00000000-0000-4000-8000-000000000203",
    });
    const created = item({
      excerpt: "Newly created note",
      id: "00000000-0000-4000-8000-000000000204",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        items: [original],
        status: "ready",
      }))
      .mockResolvedValueOnce(response({
        items: [created, original],
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonTimeline({ personId, workspaceId });
    document.dispatchEvent(
      new CustomEvent("person-timeline-changed", {
        detail: { personIds: [crypto.randomUUID(), personId] },
      }),
    );

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(root.querySelector("[data-timeline-list]")?.textContent).toContain(
        "Newly created note",
      );
    });
  });

  it("ignores a changed timeline for another person", async () => {
    markup();
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: [item()],
      status: "ready",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonTimeline({ personId, workspaceId });
    fetchMock.mockClear();
    document.dispatchEvent(
      new CustomEvent("person-timeline-changed", {
        detail: { personIds: [crypto.randomUUID()] },
      }),
    );
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ignores a changed timeline without detail", async () => {
    markup();
    const fetchMock = vi.fn().mockResolvedValue(response({
      items: [item()],
      status: "ready",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonTimeline({ personId, workspaceId });
    fetchMock.mockClear();
    document.dispatchEvent(new CustomEvent("person-timeline-changed"));
    await Promise.resolve();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("appends older pages, preserves paging focus, and hides the exhausted control", async () => {
    const root = markup();
    const first = item({ id: "00000000-0000-4000-8000-000000000211" });
    const second = item({ id: "00000000-0000-4000-8000-000000000212" });
    const third = item({ id: "00000000-0000-4000-8000-000000000213" });
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(response({
          items: [first],
          nextCursor: "cursor-1",
          status: "ready",
        }))
        .mockResolvedValueOnce(response({
          items: [second],
          nextCursor: "cursor-2",
          status: "ready",
        }))
        .mockResolvedValueOnce(response({ items: [third], status: "ready" })),
    );

    await mountPersonTimeline({ personId, workspaceId });
    const more = root.querySelector<HTMLButtonElement>("[data-timeline-more]")!;
    more.focus();
    more.click();
    await vi.waitFor(() =>
      expect(root.querySelectorAll("[data-timeline-id]")).toHaveLength(2)
    );
    expect(document.activeElement).toBe(more);
    expect(more.hidden).toBe(false);
    more.click();
    await vi.waitFor(() => expect(more.hidden).toBe(true));
    expect(
      [...root.querySelectorAll<HTMLElement>("[data-timeline-id]")].map(
        (row) => row.dataset.timelineId,
      ),
    ).toEqual([first.id, second.id, third.id]);
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

    await mountPersonTimeline({ personId, workspaceId });
    const retry = root.querySelector<HTMLButtonElement>(
      "[data-timeline-retry]",
    )!;
    expect(root.querySelector("[data-timeline-state]")?.textContent).toBe(
      "Timeline storage is unavailable.",
    );
    expect(retry.hidden).toBe(false);
    retry.click();
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

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
    await mountPersonTimeline({ personId, workspaceId });
    expect(root.querySelector("[data-timeline-state]")?.textContent).toBe(
      "This person is no longer available.",
    );
    expect(
      root.querySelector<HTMLButtonElement>("[data-timeline-retry]")?.hidden,
    ).toBe(true);
  });

  it("renders an honest empty state and tolerates a missing surface", async () => {
    const root = markup();
    const fetchMock = vi.fn().mockResolvedValue(
      response({ items: [], status: "ready" }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonTimeline({ personId, workspaceId });
    expect(root.querySelector("[data-timeline-state]")?.textContent).toBe(
      "No timeline events recorded.",
    );
    expect(root.querySelector("[data-timeline-list]")?.children).toHaveLength(
      0,
    );

    document.body.innerHTML = "<main></main>";
    await expect(mountPersonTimeline({ personId, workspaceId })).resolves
      .toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
