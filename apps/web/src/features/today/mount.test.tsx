// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { jsonResponse, stubApi } from "../../testing/api.ts";
import { preferences, workspaceSession } from "../../testing/fixtures.ts";
import { drawShell, mountSettled } from "../../testing/render.tsx";
import { resolveWorkspaceSession } from "../../lib/workspace-context.ts";
import { mountToday } from "./mount.tsx";

const page = readFileSync("apps/web/src/pages/app.astro", "utf8");

/** The page's `<main>`, with its Astro expressions reduced to plain classes. */
function pageShell(): void {
  const main = page.slice(page.indexOf("<main"), page.indexOf("</main>") + 7)
    .replace(/class=\{[^}]*\}\)?\}?/g, 'class="today"');
  drawShell(main);
}

afterEach(() => sessionStorage.clear());

describe("TODAY-001 Today page islands", () => {
  it("mounts every section of the page as its own island, in the page's semantic order", async () => {
    pageShell();
    const empty = { items: [], status: "ready" };
    stubApi({
      "GET /api/v1/session": jsonResponse(workspaceSession()),
      "GET /api/v1/settings/preferences": jsonResponse({
        preferences: preferences(),
        status: "ready",
      }),
      "GET /api/v1/today/attention": jsonResponse({
        attention: { nextSevenDays: [], overdue: [], today: [] },
        date: "2026-08-18",
        status: "ready",
        timezone: "UTC",
        upcoming: [],
      }),
      "GET /api/v1/today/reminders": jsonResponse({
        cadences: [],
        reminders: [],
        status: "ready",
        timezone: "UTC",
      }),
      "GET /api/v1/today/recent-people": jsonResponse({
        people: [],
        status: "ready",
      }),
      "GET /api/v1/today/favorite-notes": jsonResponse(empty),
      "GET /api/v1/today/recent-activity": jsonResponse(empty),
    });
    const unmount = await mountSettled(() => mountToday());
    expect(
      [...document.querySelectorAll("[data-island]")].map((island) => [
        island.getAttribute("data-island"),
        island.hasAttribute("data-island-ready"),
      ]),
    ).toEqual([
      ["today-attention", true],
      ["today-reminders", true],
      ["today-recent-people", true],
      ["today-favorite-notes", true],
      ["today-recent-activity", true],
    ]);
    expect(
      [...document.querySelectorAll("main > section h2")].map((heading) =>
        heading.textContent
      ),
    ).toEqual([
      "Needs attention",
      "People to reconnect",
      "Upcoming",
      "Recently viewed people",
      "Favorite notes",
      "Recent activity",
    ]);
    expect(document.querySelectorAll("[data-today-date]")).toHaveLength(1);
    expect(
      document.querySelector("[data-today-date]")?.getAttribute("datetime"),
    )
      .toBe("2026-08-18");
    expect(document.querySelectorAll("#today-upcoming-state")).toHaveLength(1);
    expect(document.querySelectorAll(".success-loop > li")).toHaveLength(3);
    expect(document.body.textContent).not.toContain("Loading");
    unmount();
    expect(document.querySelectorAll("[data-island]")).toHaveLength(0);
  });

  it("AUD-F3 mounts with exactly one session read and no preference reads", async () => {
    pageShell();
    const empty = { items: [], status: "ready" };
    const api = stubApi({
      "GET /api/v1/session": jsonResponse(
        workspaceSession({
          preferences: preferences({
            effectiveTimezone: "Europe/Belgrade",
            locale: "en-GB",
          }),
        }),
      ),
      "GET /api/v1/today/attention": jsonResponse({
        attention: { nextSevenDays: [], overdue: [], today: [] },
        date: "2026-08-18",
        status: "ready",
        timezone: "Europe/Belgrade",
        upcoming: [],
      }),
      "GET /api/v1/today/reminders": jsonResponse({
        cadences: [],
        reminders: [],
        status: "ready",
        timezone: "Europe/Belgrade",
      }),
      "GET /api/v1/today/recent-people": jsonResponse({
        people: [],
        status: "ready",
      }),
      "GET /api/v1/today/favorite-notes": jsonResponse(empty),
      "GET /api/v1/today/recent-activity": jsonResponse(empty),
    });
    // The shell resolves the session first; Today's islands arrive after it.
    await resolveWorkspaceSession();
    const unmount = await mountSettled(() => mountToday());

    const calls = api.calls();
    expect(calls.filter((call) => call === "GET /api/v1/session"))
      .toHaveLength(1);
    expect(calls.filter((call) => call.includes("/settings/preferences")))
      .toEqual([]);
    expect(
      document.querySelectorAll("[data-island][data-island-ready]"),
    ).toHaveLength(5);
    unmount();
  });

  it("does nothing on a page without Today's sections", async () => {
    drawShell("<main><p>Other page</p></main>");
    await mountSettled(() => mountToday());
    expect(document.body.textContent).toBe("Other page");
  });
});
