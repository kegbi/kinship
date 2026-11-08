// @vitest-environment happy-dom
import { act, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { buttonVariants } from "@/components/ui/variants.ts";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
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
import {
  mountTodayRecentPeople,
  TODAY_RECENT_PEOPLE_ISLAND,
} from "./today-recent-people.tsx";

const SESSION = "GET /api/v1/session";
const RECENT = "GET /api/v1/today/recent-people";
const personId = ids.person;
const people = (...entries: readonly object[]) =>
  jsonResponse({ people: entries, status: "ready" });

/** The section as `pages/app.astro` draws it. */
function todayShell(): void {
  drawShell(`
    <main>
      <section id="today-recent-people-region" aria-labelledby="recent-people-heading" data-region-state="loading">
        <h2 id="recent-people-heading">Recently viewed people</h2>
        <p id="today-recent-people-state" role="status">Loading recently viewed people…</p>
      </section>
    </main>`);
}

const mount = () => mountSettled(() => mountTodayRecentPeople());
const region = () => element("#today-recent-people-region");
const status = () => element("#today-recent-people-state");
const retry = () => element<HTMLButtonElement>("#today-recent-people-retry");

function click(target: HTMLElement): void {
  act(() => {
    fireEvent.click(target);
  });
}

afterEach(() => sessionStorage.clear());

describe("TODAY-001 actual recently viewed people", () => {
  it("does nothing when the section is absent", async () => {
    drawShell("<p>Other page</p>");
    await mount();
    expect(document.body.textContent).toBe("Other page");
    expect(TODAY_RECENT_PEOPLE_ISLAND).toBe("today-recent-people");
  });

  it("renders bounded active and archived return paths with accessible targets", async () => {
    todayShell();
    const api = stubApi({
      [SESSION]: jsonResponse(workspaceSession()),
      [RECENT]: people(
        { archived: false, id: personId, name: "Ada Lovelace" },
        {
          archived: true,
          id: "00000000-0000-4000-8000-000000000101",
          name: "Grace Hopper",
        },
        ...Array.from({ length: 6 }, (_, index) => ({
          archived: false,
          id: `00000000-0000-4000-8000-${
            (index + 102).toString().padStart(12, "0")
          }`,
          name: `Person ${index + 3}`,
        })),
      ),
    });
    await mount();
    const read = api.requests().find((request) =>
      request.url.pathname === "/api/v1/today/recent-people"
    )!;
    expect(read.headers.get("X-Workspace-Id")).toBe(ids.workspace);
    const links = within(element("#today-recent-people-list")).getAllByRole(
      "link",
    );
    expect(links).toHaveLength(8);
    expect(links.slice(0, 2).map((link) => link.getAttribute("href")))
      .toEqual([
        `/app/people/${personId}`,
        "/app/people/00000000-0000-4000-8000-000000000101",
      ]);
    expect(
      links.every((link) =>
        link.className === buttonVariants({ variant: "outline", wrap: true })
      ),
    ).toBe(true);
    expect(document.body.textContent).toContain("Archived");
    expect(region().dataset.regionState).toBe("ready");
    expect(element("#today-recent-people-badge").textContent).toBe("8 recent");
    expect(status().textContent).toBe("8 recently viewed people.");
    expect(retry().hidden).toBe(true);
    expect(document.activeElement).not.toBe(status());
    await expectNoAxeViolations(document.body);
  });

  it("isolates failure, focuses a successful retry, and lets a second retry join the first", async () => {
    todayShell();
    const held = deferred<Response>();
    const api = stubApi({
      [SESSION]: jsonResponse(workspaceSession()),
      [RECENT]: [
        unreachable,
        problemResponse(503),
        people({ archived: false, id: personId, name: "Only person" }),
        held.promise,
      ],
    });
    await mount();
    expect(region().dataset.regionState).toBe("error");
    expect(element("#today-recent-people-badge").textContent).toBe(
      "Unavailable",
    );
    expect(status().textContent).toBe(
      "Recently viewed people could not be loaded. Other Today regions are still available.",
    );
    expect(retry().hidden).toBe(false);
    click(retry());
    expect(region().dataset.regionState).toBe("loading");
    await waitFor(() => expect(document.activeElement).toBe(status()));
    expect(retry().hidden).toBe(false);
    click(retry());
    await waitFor(() => expect(region().dataset.regionState).toBe("ready"));
    expect(status().textContent).toBe("1 recently viewed person.");
    // A second retry while the first is held asks for the same read, so it
    // joins it (AUD-F1, D7): one request, whose answer settles the region.
    click(retry());
    click(retry());
    await act(async () => {
      held.resolve(
        people({ archived: false, id: personId, name: "Current person" }),
      );
      await held.promise;
    });
    await waitFor(() =>
      expect(document.body.textContent).toContain("Current person")
    );
    expect(region().dataset.regionState).toBe("ready");
    expect(api.calls().filter((call) => call === RECENT)).toHaveLength(4);
  });

  it("recovers an initially unavailable session on retry", async () => {
    todayShell();
    stubApi({
      [SESSION]: [
        unreachable,
        jsonResponse(workspaceSession()),
      ],
      [RECENT]: people({
        archived: false,
        id: personId,
        name: "Recovered person",
      }),
    });
    await mount();
    expect(status().textContent).toBe(
      "Recently viewed people could not be loaded.",
    );
    click(retry());
    await waitFor(() => {
      expect(document.body.textContent).toContain("Recovered person");
      expect(document.activeElement).toBe(status());
    });
  });

  it.each([
    ["ninth item", {
      people: Array.from({ length: 9 }, (_, index) => ({
        archived: false,
        id: `00000000-0000-4000-8000-${
          (index + 100).toString().padStart(12, "0")
        }`,
        name: `Person ${index}`,
      })),
      status: "ready",
    }],
    ["invalid UUID", {
      people: [{ archived: false, id: "invalid", name: "Unsafe" }],
      status: "ready",
    }],
    ["unexpected property", { people: [], status: "ready", unexpected: true }],
  ])("isolates malformed 200 %s and recovers on retry", async (_name, body) => {
    todayShell();
    stubApi({
      [SESSION]: jsonResponse(workspaceSession()),
      [RECENT]: [jsonResponse(body), people()],
    });
    await mount();
    expect(document.querySelectorAll("li a")).toHaveLength(0);
    expect(retry().hidden).toBe(false);
    click(retry());
    await waitFor(() => {
      expect(region().dataset.regionState).toBe("empty");
      expect(document.activeElement).toBe(status());
    });
    expect(element("#today-recent-people-badge").textContent).toBe("Empty");
  });

  it("settles its first read even when a reader retries before it lands", async () => {
    todayShell();
    const first = deferred<Response>();
    const api = stubApi({
      [SESSION]: jsonResponse(workspaceSession()),
      [RECENT]: [first.promise],
    });
    const mounted = mountPending(() => mountTodayRecentPeople());
    // The retry asks for the read the mount is still waiting for, so it
    // joins it (AUD-F1, D7), and that one answer settles the mount.
    click(retry());
    await act(async () => {
      first.resolve(people({ archived: false, id: personId, name: "Late" }));
      await mounted;
    });
    await waitFor(() => expect(region().dataset.regionState).toBe("ready"));
    expect(document.body.textContent).toContain("Late");
    expect(api.calls().filter((call) => call === RECENT)).toHaveLength(1);
  });
});
