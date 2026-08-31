// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountPersonLifeEvents } from "./person-life-events.ts";

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
    <section data-person-life-events data-section-state="loading">
      <span data-life-event-badge>Loading</span>
      <p data-life-event-state></p>
      <button data-life-event-retry hidden>Retry life events</button>
      <ol data-life-event-list hidden></ol>
    </section>`;
  return document.querySelector("[data-person-life-events]")!;
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("complete person life-event history", () => {
  it("[PEOPLE-003] keeps loaded life events in the timeline while the card stays ready", async () => {
    const root = markup();
    const fetchMock = vi.fn().mockResolvedValue(response({
      events: [{
        date: { month: 12, precision: "year_month", year: 1843 },
        id: "00000000-0000-4000-8000-000000000200",
        name: "Published Notes",
        note: "The first published computer algorithm.",
        typeName: "Career",
      }, {
        date: {
          happenedAt: "1852-11-27T12:00:00.000Z",
          precision: "full",
        },
        id: crypto.randomUUID(),
        typeName: "Milestone",
      }, {
        date: { day: 10, month: 5, precision: "month_day" },
        id: crypto.randomUUID(),
        name: "Recurring memory",
      }, {
        date: { precision: "year", year: 1815 },
        id: crypto.randomUUID(),
        name: "Year event",
      }, {
        date: { month: 6, precision: "month" },
        id: crypto.randomUUID(),
        name: "Month event",
      }, {
        date: { day: 3, precision: "day" },
        id: crypto.randomUUID(),
        name: "Day event",
      }, {
        date: { precision: "unknown" },
        id: crypto.randomUUID(),
      }],
      status: "ready",
    }));
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonLifeEvents(personId, workspaceId);

    expect(root.dataset.sectionState).toBe("ready");
    expect(root.querySelector("[data-life-event-state]")?.textContent)
      .toBe("7 life events. Listed in the timeline above.");
    const list = root.querySelector<HTMLOListElement>(
      "[data-life-event-list]",
    )!;
    expect(list.hidden).toBe(true);
    expect(list.children).toHaveLength(0);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/v1/people/${personId}/life-events`,
      {
        headers: expect.objectContaining({ "X-Workspace-Id": workspaceId }),
      },
    );
  });

  it("keeps failure local and retries to an honest empty state", async () => {
    const root = markup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        detail: "History query failed.",
        status: 503,
        title: "Unavailable",
        type: "about:blank",
      }, 503))
      .mockResolvedValueOnce(response({ events: [], status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonLifeEvents(personId);
    expect(root.dataset.sectionState).toBe("error");
    expect(root.querySelector("[data-life-event-state]")?.textContent)
      .toBe("History query failed.");
    const retry = root.querySelector<HTMLButtonElement>(
      "[data-life-event-retry]",
    )!;
    expect(retry.hidden).toBe(false);
    retry.click();
    await vi.waitFor(() => expect(root.dataset.sectionState).toBe("empty"));
    expect(root.querySelector("[data-life-event-state]")?.textContent)
      .toBe("No life events saved.");
  });

  it("hides disabled history without reading retained data", async () => {
    const root = markup();
    document.body.insertAdjacentHTML(
      "beforeend",
      '<nav><ul><li><a data-section-link="life-events">Life events</a></li></ul></nav>',
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await mountPersonLifeEvents(personId, workspaceId, true);

    expect(root.hidden).toBe(true);
    expect(root.dataset.sectionState).toBe("hidden");
    expect(
      document.querySelector('[data-section-link="life-events"]')
        ?.closest("li")?.hasAttribute("hidden"),
    ).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("conceals history when the endpoint observes a newly disabled module", async () => {
    const root = markup();
    root.querySelector("[data-life-event-list]")!.textContent =
      "Retained private event";
    document.body.insertAdjacentHTML(
      "beforeend",
      '<nav><ul><li><a data-section-link="life-events">Life events</a></li></ul></nav>',
    );
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({ events: [], status: "hidden" }),
      ),
    );

    await mountPersonLifeEvents(personId, workspaceId);

    expect(root.hidden).toBe(true);
    expect(root.dataset.sectionState).toBe("hidden");
    expect(root.textContent).not.toContain("Retained private event");
    expect(
      document.querySelector('[data-section-link="life-events"]')
        ?.closest("li")?.hasAttribute("hidden"),
    ).toBe(true);
  });

  it("keeps forbidden history non-retryable and tolerates a missing surface", async () => {
    const root = markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({
        detail: "Membership no longer permits this view.",
        status: 403,
        title: "Forbidden",
        type: "about:blank",
      }, 403)),
    );

    await mountPersonLifeEvents(personId);
    expect(root.dataset.sectionState).toBe("forbidden");
    expect(
      root.querySelector<HTMLButtonElement>("[data-life-event-retry]")
        ?.hidden,
    ).toBe(true);
    document.body.innerHTML = "<main></main>";
    await expect(mountPersonLifeEvents(personId)).resolves.toBeUndefined();
  });
});
