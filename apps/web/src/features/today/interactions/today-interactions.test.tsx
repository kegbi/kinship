// @vitest-environment happy-dom
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  type ApiAnswer,
  deferred,
  jsonResponse,
  problemResponse,
  sendWrite,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import { ids, workspaceSession } from "../../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../../testing/render.tsx";
import { INTERACTION_CREATED_EVENT } from "../../interactions/shared.ts";
import {
  mountTodayInteractions,
  TODAY_FAVORITE_NOTES_ISLAND,
  TODAY_RECENT_ACTIVITY_ISLAND,
} from "./today-interactions.tsx";

const SESSION = "GET /api/v1/session";
const FAVORITES = "GET /api/v1/today/favorite-notes";
const RECENT = "GET /api/v1/today/recent-activity";
const personId = ids.person;
let sequence = 0;
const uuid = () =>
  `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`;

function note(body: string, overrides: Record<string, unknown> = {}) {
  return {
    body,
    createdAt: "2026-08-17T12:30:00.000Z",
    id: uuid(),
    isFavorited: true,
    kind: "note",
    participants: [{ id: personId, name: "Ada Lovelace" }],
    ...overrides,
  };
}

function activity(summary: string, overrides: Record<string, unknown> = {}) {
  return {
    emotions: [],
    happenedAt: "2026-08-17T12:31:00.000Z",
    id: uuid(),
    kind: "activity",
    participants: [{ id: personId, name: "Ada Lovelace" }],
    summary,
    ...overrides,
  };
}

const items = (...entries: readonly object[]) =>
  jsonResponse({ items: entries, status: "ready" });

type Answer = ApiAnswer;

function routes(
  favorites: Answer | readonly Answer[],
  recent: Answer | readonly Answer[],
) {
  return stubApi({
    [SESSION]: jsonResponse(workspaceSession()),
    [FAVORITES]: favorites as Response,
    [RECENT]: recent as Response,
  });
}

/** The two sections as `pages/app.astro` draws them. */
function todayShell(): void {
  drawShell(`
    <main>
      <section id="today-favorite-notes-region" aria-labelledby="favorite-notes-heading">
        <h2 id="favorite-notes-heading">Favorite notes</h2>
        <p id="today-favorite-notes-state">Loading favorite notes…</p>
      </section>
      <section id="today-recent-activity-region" aria-labelledby="activity-heading">
        <h2 id="activity-heading">Recent activity</h2>
        <p id="today-recent-activity-state">Loading recent activity…</p>
      </section>
    </main>`);
}

const mount = () => mountSettled(() => mountTodayInteractions());
const favorites = () => element("#today-favorite-notes");
const recent = () => element("#today-recent-activity");
const favoriteState = () => element("#today-favorite-notes-state");
const recentState = () => element("#today-recent-activity-state");
const favoriteRegion = () => element("#today-favorite-notes-region");
const count = (api: ReturnType<typeof stubApi>, route: string) =>
  api.calls().filter((call) => call === route).length;

function created(detail?: { readonly kind: string }): void {
  act(() => {
    globalThis.dispatchEvent(
      new CustomEvent(INTERACTION_CREATED_EVENT, { detail }),
    );
  });
}

/** Quick capture's write, then its announcement, as the application does. */
async function recorded(
  api: ReturnType<typeof stubApi>,
  detail?: { readonly kind: string },
): Promise<void> {
  await act(async () => {
    await sendWrite(api);
    globalThis.dispatchEvent(
      new CustomEvent(INTERACTION_CREATED_EVENT, { detail }),
    );
  });
}

function click(target: HTMLElement): void {
  act(() => {
    fireEvent.click(target);
  });
}

afterEach(() => sessionStorage.clear());

describe("INTERACTION-001 Today projections", () => {
  it("links each recent activity participant and note author to their person workspace", async () => {
    todayShell();
    const graceId = uuid();
    routes(
      items(note("Pinned context")),
      items(
        activity("Shared lunch", {
          activityType: "Collaboration",
          description: "Compared notes",
          emotions: [{ id: "joy", name: "Joy" }],
          participants: [
            { id: personId, name: "Ada Lovelace" },
            { id: graceId, name: "Grace Hopper" },
          ],
        }),
        note("Prefers written updates", {
          participants: [{ id: graceId, name: "Grace Hopper" }],
        }),
      ),
    );
    await mount();
    const [activityRow, noteRow] = Array.from(recent().children);
    expect(activityRow!.querySelector("p")?.textContent).toBe(
      "Ada Lovelace, Grace Hopper · Category: Collaboration · Emotions: Joy · Compared notes",
    );
    expect(
      within(activityRow as HTMLElement).getByRole("link", {
        name: "Ada Lovelace",
      }).getAttribute("href"),
    ).toBe(`/app/people/${personId}`);
    expect(
      within(activityRow as HTMLElement).getByRole("link", {
        name: "Grace Hopper",
      }).getAttribute("href"),
    ).toBe(`/app/people/${graceId}`);
    expect(
      within(noteRow as HTMLElement).getByRole("link", {
        name: "Grace Hopper",
      }).getAttribute("href"),
    ).toBe(`/app/people/${graceId}`);
    expect(
      within(favorites()).getByRole("link", {
        name: "Ada Lovelace",
      }).getAttribute("href"),
    ).toBe(`/app/people/${personId}`);
    await expectNoAxeViolations(document.body);
  });

  it("does nothing when an interaction projection is absent from the page", async () => {
    drawShell("");
    await mount();
    expect(document.body.textContent).toBe("");
    expect([TODAY_FAVORITE_NOTES_ISLAND, TODAY_RECENT_ACTIVITY_ISLAND])
      .toEqual(["today-favorite-notes", "today-recent-activity"]);
  });

  it("refreshes only Recent for activity and both Today projections for note, including during initial load", async () => {
    todayShell();
    const favoriteInitial = deferred<Response>();
    const recentInitial = deferred<Response>();
    const api = routes(
      [favoriteInitial.promise, items(note("Favorite 2"))],
      [
        recentInitial.promise,
        items(activity("Recent 2")),
        items(activity("Recent 3")),
      ],
    );
    const mounting = mountPending(() => mountTodayInteractions());
    await waitFor(() =>
      expect([count(api, FAVORITES), count(api, RECENT)]).toEqual([1, 1])
    );
    // Each announcement follows the write that recorded the interaction, so
    // each refresh is its own request (AUD-F1, D7), even during the first load.
    await recorded(api, { kind: "activity" });
    await waitFor(() => expect(count(api, RECENT)).toBe(2));
    expect(count(api, FAVORITES)).toBe(1);
    await recorded(api, { kind: "note" });
    await waitFor(() =>
      expect([count(api, FAVORITES), count(api, RECENT)]).toEqual([2, 3])
    );
    await act(async () => {
      favoriteInitial.resolve(items(note("Obsolete favorite")));
      recentInitial.resolve(items(activity("Obsolete recent")));
      await mounting;
    });
    await waitFor(() => expect(recent().textContent).toContain("Recent 3"));
    expect(document.body.textContent).not.toContain("Obsolete");
    expect(favorites().textContent).toContain("Favorite 2");
  });

  it("isolates a favorite-note outage and retries only that region", async () => {
    todayShell();
    const api = routes(
      [problemResponse(503), items(note("Pinned context"))],
      items(activity("Shared lunch")),
    );
    await mount();
    expect(favoriteState().textContent).toBe(
      "Favorite notes could not be loaded. Recent activity is unchanged.",
    );
    expect(recent().textContent).toContain("Shared lunch");
    const retry = element<HTMLButtonElement>("#today-favorite-notes-retry");
    expect(retry.hidden).toBe(false);
    click(retry);
    expect(favoriteState().textContent).toBe("Loading favorite notes…");
    await waitFor(() =>
      expect(favorites().textContent).toContain("Pinned context")
    );
    expect(favoriteState().textContent).toBe("1 favorite note.");
    expect(retry.hidden).toBe(true);
    expect([count(api, FAVORITES), count(api, RECENT)]).toEqual([2, 1]);
  });

  it("isolates a recent-activity outage and retries only that region, keeping what it showed", async () => {
    todayShell();
    const api = routes(items(note("Preserved favorite"), note("Second")), [
      items(activity("Kept activity")),
      problemResponse(503),
      items(),
    ]);
    await mount();
    expect(favoriteState().textContent).toBe("2 favorite notes.");
    expect(recentState().textContent).toBe("1 recent interaction.");
    created({ kind: "activity" });
    await waitFor(() =>
      expect(recentState().textContent).toBe(
        "Recent activity could not be loaded. Favorite notes are unchanged.",
      )
    );
    expect(recent().textContent).toContain("Kept activity");
    click(element("#today-recent-activity-retry"));
    await waitFor(() =>
      expect(recentState().textContent).toBe(
        "No activities or notes recorded yet.",
      )
    );
    expect(favorites().textContent).toContain("Preserved favorite");
    expect(count(api, FAVORITES)).toBe(1);
  });

  it("hides empty favorite notes and reveals a later nonempty refresh without stale overwrite", async () => {
    todayShell();
    const older = deferred<Response>();
    const api = routes(
      [items(), older.promise, items(note("Newest favorite"))],
      items(),
    );
    await mount();
    expect(favoriteRegion().hidden).toBe(true);
    expect(favoriteRegion().getAttribute("aria-labelledby")).toBe(
      "favorite-notes-heading",
    );
    expect(element("#today-recent-activity-region").hidden).toBe(false);
    // Each refresh follows its own recorded note, so neither joins the other.
    await recorded(api);
    // A read in flight shows the section with its loading status.
    expect(favoriteRegion().hidden).toBe(false);
    await recorded(api);
    await waitFor(() =>
      expect(favorites().textContent).toContain("Newest favorite")
    );
    expect(favoriteRegion().hidden).toBe(false);
    await act(async () => {
      older.resolve(items(note("Older favorite")));
      await older.promise;
    });
    expect(favorites().textContent).not.toContain("Older favorite");
  });

  it("renders retained activity with redacted participants, emotions, and notes safely", async () => {
    todayShell();
    routes(
      items(note("Without a participant", { participants: [] })),
      items(
        activity("Retained redacted activity", {
          activityType: "Collaboration",
          participants: [],
        }),
        activity("Walked by the river", {
          description: "Slow walk",
          emotions: [{ id: "joy", name: "Joy" }, { id: "calm", name: "Calm" }],
          participants: [{ id: personId, name: "Ada" }],
        }),
      ),
    );
    await mount();
    const text = recent().textContent ?? "";
    expect(text).toContain("Retained redacted activity");
    expect(text).toContain("Category: Collaboration");
    expect(text).not.toContain("undefined");
    expect(text).toContain("Ada · Emotions: Joy, Calm · Slow walk");
    expect(favorites().textContent).toContain("Person · Without a participant");
    expect(recent().children[0]?.querySelector("a")).toBeNull();
    expect(favorites().querySelector("a")).toBeNull();
    const time = favorites().querySelector("time")!;
    expect(time.dateTime).toBe("2026-08-17T12:30:00.000Z");
    expect(time.textContent).toBe("Aug 17, 2026, 12:30 PM");
    await expectNoAxeViolations(document.body);
  });

  it("keeps unreachable Today projections retryable", async () => {
    todayShell();
    routes(unreachable, unreachable);
    await mount();
    expect(favoriteState().textContent).toBe(
      "Favorite notes could not be loaded. Recent activity is unchanged.",
    );
    expect(recentState().textContent).toBe(
      "Recent activity could not be loaded. Favorite notes are unchanged.",
    );
    expect(element<HTMLButtonElement>("#today-recent-activity-retry").hidden)
      .toBe(false);
  });

  it("says the projections are unavailable when the session is", async () => {
    todayShell();
    stubApi({ "* /api/v1/*": problemResponse(503) });
    await mount();
    expect(favoriteState().textContent).toBe("Favorite notes are unavailable.");
    expect(recentState().textContent).toBe("Recent activity is unavailable.");
    expect(element<HTMLButtonElement>("#today-favorite-notes-retry").hidden)
      .toBe(false);
  });

  it("distinguishes empty Today from a retryable projection outage", async () => {
    todayShell();
    routes([problemResponse(503), items()], [problemResponse(503), items()]);
    await mount();
    expect(favoriteState().textContent).toContain("could not be loaded");
    expect(recentState().textContent).toContain("could not be loaded");
    expect(favoriteRegion().hidden).toBe(false);
    click(element("#today-favorite-notes-retry"));
    click(element("#today-recent-activity-retry"));
    await waitFor(() => expect(favoriteRegion().hidden).toBe(true));
    await waitFor(() =>
      expect(recentState().textContent).toContain("No activities or notes")
    );
  });
});
