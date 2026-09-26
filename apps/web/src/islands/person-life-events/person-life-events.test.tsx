// @vitest-environment happy-dom
import { waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SECTION_HIDDEN_EVENT } from "../../features/person/sections.ts";
import { jsonResponse, stubApi, unreachable } from "../../testing/api.ts";
import { ids, personProfile, sectionProps } from "../../testing/fixtures.ts";
import { drawShell, element, mountSection } from "../../testing/render.tsx";
import { mountPersonLifeEvents } from "./mount.tsx";

const { person: personId, workspace: workspaceId } = ids;
const LIFE_EVENTS = "GET /api/v1/people/:personId/life-events";

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

const props = (hidden = false) =>
  sectionProps({
    initial: personProfile({
      person: {
        profileSections: hidden
          ? [{ id: "life-events", status: "hidden" }]
          : [],
      },
    }),
  });

const mount = (hidden = false) =>
  mountSection(mountPersonLifeEvents, props(hidden));

const card = () => within(element("[data-person-life-events]"));
const stateLine = () =>
  document.querySelector("[data-life-event-state]")?.textContent;
const badge = () =>
  document.querySelector("[data-life-event-badge]")?.textContent;

describe("complete person life-event history island", () => {
  it("[PEOPLE-003] keeps loaded life events in the timeline while the card stays ready", async () => {
    const root = markup();
    const api = stubApi({
      [LIFE_EVENTS]: jsonResponse({
        events: [{
          date: { month: 12, precision: "year_month", year: 1843 },
          id: "00000000-0000-4000-8000-000000000200",
          name: "Published Notes",
          note: "The first published computer algorithm.",
          typeName: "Career",
        }, {
          date: { happenedAt: "1852-11-27T12:00:00.000Z", precision: "full" },
          id: crypto.randomUUID(),
          typeName: "Milestone",
        }],
        status: "ready",
      }),
    });

    await mount();

    expect(root.dataset.island).toBe("person-life-events");
    expect(root.hasAttribute("data-island-ready")).toBe(true);
    expect(root.dataset.sectionState).toBe("ready");
    expect(stateLine()).toBe("2 life events. Listed in the timeline above.");
    expect(badge()).toBe("Ready");
    expect(
      card().getByRole("heading", { level: 3, name: "Life events" }).id,
    ).toBe("profile-section-life-events-heading");
    const list = root.querySelector<HTMLOListElement>(
      "[data-life-event-list]",
    )!;
    expect(list.hidden).toBe(true);
    expect(list.children).toHaveLength(0);
    expect(card().queryByRole("button", { name: /add/i })).toBeNull();
    expect(api.fetch).toHaveBeenCalledWith(
      `/api/v1/people/${personId}/life-events`,
      { headers: expect.objectContaining({ "X-Workspace-Id": workspaceId }) },
    );
  });

  it("counts a single event in the singular", async () => {
    markup();
    stubApi({
      [LIFE_EVENTS]: jsonResponse({
        events: [{
          date: { precision: "unknown" },
          id: crypto.randomUUID(),
        }],
        status: "ready",
      }),
    });
    await mount();
    expect(stateLine()).toBe("1 life event. Listed in the timeline above.");
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
        jsonResponse({ events: [], status: "ready" }),
      ],
    });

    await mount();
    expect(root.dataset.sectionState).toBe("error");
    expect(stateLine()).toBe("History query failed.");
    expect(badge()).toBe("Unavailable");
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
      [LIFE_EVENTS]: jsonResponse({ events: [], status: "hidden" }),
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
