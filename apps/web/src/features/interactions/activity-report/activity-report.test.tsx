// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  type ApiAnswer,
  deferred,
  jsonResponse,
  problemBody,
  problemResponse,
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
import { INTERACTION_CREATED_EVENT } from "../shared.ts";
import {
  ACTIVITY_REPORT_ISLAND,
  mountActivityReport,
  reportReducer,
  type ReportState,
  reportYear,
} from "./activity-report.tsx";

const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";
const REPORT = "GET /api/v1/people/:personId/activity-report";
const personId = ids.person;

function note(
  index: number,
  body = `Paged note ${String(index).padStart(2, "0")}`,
) {
  return {
    body,
    createdAt: "2026-08-17T12:30:00.000Z",
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    isFavorited: false,
    kind: "note" as const,
    participants: [{ id: personId, name: "Ada Lovelace" }],
  };
}

function report(
  items: readonly object[],
  nextCursor?: string,
  name = "Ada Lovelace",
) {
  return jsonResponse({
    items,
    ...(nextCursor ? { nextCursor } : {}),
    person: { id: personId, name },
    status: "ready",
  });
}

type Answer = ApiAnswer;

function routes(answers: Answer | readonly Answer[]) {
  return stubApi({
    [SESSION]: jsonResponse(workspaceSession()),
    [PREFERENCES]: jsonResponse({
      preferences: preferences(),
      status: "ready",
    }),
    [REPORT]: answers as Response,
  });
}

/** The page as `pages/internal/activity-report-shell.astro` draws it. */
function reportShell(): void {
  drawShell(`
    <nav aria-label="Breadcrumb">
      <a href="/app/people">People</a><span aria-hidden="true">/</span>
      <a data-breadcrumb-person href="/app/people/${personId}"><span data-slot="skeleton" aria-hidden="true"></span><span class="sr-only">Loading person…</span></a><span aria-hidden="true">/</span>
      <span aria-current="page">Activity report</span>
    </nav>
    <main>
      <h1 id="activity-report-heading" tabindex="-1">Loading activity report…</h1>
      <div class="contents" data-activity-report>
        <p id="activity-report-state" role="status">Loading activities and notes…</p>
        <ol id="activity-report-list"></ol>
      </div>
    </main>`);
}

const mount = () => mountSettled(() => mountActivityReport(document, personId));
const status = () => element("#activity-report-state");
const list = () => element("#activity-report-list");
const crumb = () => element<HTMLAnchorElement>("[data-breadcrumb-person]");
const heading = () => element("#activity-report-heading");
const more = () =>
  screen.queryByRole<HTMLButtonElement>("button", { name: "Load more" });

afterEach(() => {
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});

describe("INTERACTION-001 activity report island", () => {
  it("does nothing without the report region or a person", async () => {
    drawShell("<p>Other page</p>");
    await mount();
    reportShell();
    await mountSettled(() => mountActivityReport(document, undefined));
    expect(document.querySelector("[data-island]")).toBeNull();
    expect(ACTIVITY_REPORT_ISLAND).toBe("activity-report");
  });

  it("UXD-009 renders chronological activity, the heading, and the report breadcrumb", async () => {
    reportShell();
    const api = routes([
      report([note(1, "Prefers quiet mornings")], "report-2"),
      report([note(2, "Second page")]),
    ]);
    const pending = mountPending(() => mountActivityReport(document, personId));
    expect(crumb().querySelector('[data-slot="skeleton"]')).not.toBeNull();
    expect(crumb().textContent).toBe("Loading person…");
    expect(heading().textContent).toBe("Loading activity report…");
    await act(async () => {
      await pending;
    });
    expect(heading().textContent).toBe("Ada Lovelace activity");
    expect({
      href: crumb().getAttribute("href"),
      text: crumb().textContent,
    }).toEqual({ href: `/app/people/${personId}`, text: "Ada Lovelace" });
    expect(list().textContent).toContain("quiet mornings");
    expect(list().querySelector("time")?.textContent).toBe(
      "Aug 17, 2026, 12:30 PM",
    );
    expect(api.requests()[1]?.url.searchParams.get("limit")).toBe("20");
    act(() => {
      fireEvent.click(more()!);
    });
    await waitFor(() => expect(list().textContent).toContain("Second page"));
    expect(status().textContent).toBe("2 recorded items.");
    await expectNoAxeViolations(document.body);
  });

  it("appends one bounded report continuation and retires its consumed cursor", async () => {
    reportShell();
    const api = routes([
      report(
        Array.from({ length: 20 }, (_, index) => note(20 - index)),
        "report-2",
      ),
      report([note(0), note(1)]),
    ]);
    await mount();
    expect(list().children).toHaveLength(20);
    expect(more()?.hidden).toBe(false);
    act(() => {
      fireEvent.click(more()!);
    });
    await waitFor(() => expect(list().children).toHaveLength(21));
    const reads = api.requests().filter((request) =>
      request.url.pathname.endsWith("/activity-report")
    );
    expect(reads).toHaveLength(2);
    expect(reads[1]?.url.searchParams.get("cursor")).toBe("report-2");
    expect(list().textContent).toContain("Paged note 00");
    expect(new Set([...list().children].map((entry) => entry.textContent)).size)
      .toBe(21);
    expect(document.querySelector('[data-load-more="activity-report"]'))
      .toHaveProperty("hidden", true);
    expect(status().textContent).toBe("21 recorded items.");
  });

  it("reads the year the filter asks for", async () => {
    reportShell();
    history.replaceState(
      {},
      "",
      `/app/people/${personId}/activity-report?year=2025`,
    );
    const api = routes(report([]));
    await mount();
    expect(api.requests()[1]?.url.searchParams.get("year")).toBe("2025");
    expect(status().textContent).toBe(
      "No activities or notes for this period.",
    );
    expect(reportYear("?year=abc")).toBeUndefined();
    expect(reportYear("?year=1.5")).toBeUndefined();
    expect(reportYear("")).toBeUndefined();
  });

  it("keeps an unreachable activity report truthful", async () => {
    reportShell();
    routes(unreachable);
    await mount();
    expect(status().textContent).toBe(
      "Activity report could not be loaded. Saved interactions are unchanged.",
    );
    expect(crumb().textContent).toBe("Person");
    expect(crumb().querySelector('[data-slot="skeleton"]')).toBeNull();
  });

  it("UXD-009 keeps a failed activity-report crumb truthful and tenant-concealing", async () => {
    reportShell();
    routes(problemResponse(404, { detail: "Missing" }));
    await mount();
    expect(status().textContent).toBe("Person not found in this workspace.");
    expect({
      href: crumb().getAttribute("href"),
      text: crumb().textContent,
    }).toEqual({ href: `/app/people/${personId}`, text: "Person" });
    // A settled failure stops saying it is loading, and names nobody.
    expect(heading().textContent).toBe("Activity report");
  });

  it("keeps report access loss and a real empty period distinct", async () => {
    reportShell();
    stubApi({ "* /api/v1/*": problemResponse(401) });
    await mount();
    expect(status().textContent).toBe("Activity report unavailable.");
    expect(crumb().textContent).toBe("Person");
  });

  it("refreshes from the first page when an interaction is recorded, hiding Load more meanwhile", async () => {
    reportShell();
    const refresh = deferred<Response>();
    const stale = deferred<Response>();
    routes([
      report([note(1, "Report 1")], "report-2"),
      refresh.promise,
      stale.promise,
      report([note(3, "Report 3")]),
    ]);
    await mount();
    expect(more()?.hidden).toBe(false);
    act(() => {
      globalThis.dispatchEvent(new CustomEvent(INTERACTION_CREATED_EVENT));
    });
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-load-more="activity-report"]',
      )?.hidden,
    ).toBe(true);
    act(() => {
      globalThis.dispatchEvent(new CustomEvent(INTERACTION_CREATED_EVENT));
    });
    act(() => {
      globalThis.dispatchEvent(new CustomEvent(INTERACTION_CREATED_EVENT));
    });
    await waitFor(() => expect(list().textContent).toContain("Report 3"));
    await act(async () => {
      refresh.resolve(report([note(2, "Older response")], "report-9"));
      stale.resolve(report([note(4, "Stale response")]));
      await stale.promise;
    });
    expect(list().textContent).not.toMatch(/Older|Stale/);
    expect(list().textContent).not.toContain("Report 1");
    expect(status().textContent).toBe("1 recorded item.");
    expect(
      document.querySelector<HTMLButtonElement>(
        '[data-load-more="activity-report"]',
      )?.hidden,
    ).toBe(true);
  });

  it("keeps what it showed when a later read fails", async () => {
    reportShell();
    routes([report([note(1, "Kept")]), problemResponse(503)]);
    await mount();
    act(() => {
      globalThis.dispatchEvent(new CustomEvent(INTERACTION_CREATED_EVENT));
    });
    await waitFor(() =>
      expect(status().textContent).toMatch(/could not be loaded/)
    );
    expect(list().textContent).toContain("Kept");
    expect(crumb().textContent).toBe("Ada Lovelace");
    expect(heading().textContent).toBe("Ada Lovelace activity");
  });
});

describe("INTERACTION-001 activity report reducer", () => {
  const empty: ReportState = {
    items: [],
    refreshing: false,
    status: "loading",
  };
  const page = (
    items: readonly ReturnType<typeof note>[],
    nextCursor?: string,
  ) => ({
    data: {
      preferences: undefined,
      report: {
        items,
        ...(nextCursor ? { nextCursor } : {}),
        person: { id: personId, name: "Ada Lovelace" },
        status: "ready" as const,
      },
    },
    status: "ready" as const,
  });

  it("replaces on a first page, extends without duplicates on a continuation, and holds paging while refreshing", () => {
    const first = reportReducer(empty, {
      answer: page([note(1), note(2)], "next"),
      cursor: undefined,
      type: "answered",
    });
    expect(first).toMatchObject({
      name: "Ada Lovelace",
      nextCursor: "next",
      refreshing: false,
      status: "ready",
    });
    const more = reportReducer(first, {
      answer: page([note(2), note(3)]),
      cursor: "next",
      type: "answered",
    });
    expect(more.items.map((item) => item.id)).toEqual(
      [note(1), note(2), note(3)].map((item) => item.id),
    );
    expect(more.nextCursor).toBeUndefined();
    const refreshing = reportReducer(more, { type: "refresh" });
    expect(refreshing.refreshing).toBe(true);
    expect(refreshing.items).toBe(more.items);
    const replaced = reportReducer(refreshing, {
      answer: page([note(4)]),
      cursor: undefined,
      type: "answered",
    });
    expect(replaced.items.map((item) => item.id)).toEqual([note(4).id]);
  });

  it("keeps what it showed on failure and tells not-found, refused, and no-session apart", () => {
    const shown = reportReducer(empty, {
      answer: page([note(1)]),
      cursor: undefined,
      type: "answered",
    });
    const refreshing = reportReducer(shown, { type: "refresh" });
    const missing = reportReducer(refreshing, {
      answer: {
        problem: problemBody(404),
        status: "problem",
      },
      cursor: undefined,
      type: "answered",
    });
    expect(missing).toMatchObject({ refreshing: false, status: "not-found" });
    expect(missing.items).toBe(shown.items);
    expect(
      reportReducer(refreshing, {
        answer: { status: "unavailable" },
        cursor: undefined,
        type: "answered",
      }).status,
    ).toBe("failed");
    expect(
      reportReducer(refreshing, {
        answer: { data: undefined, status: "ready" },
        cursor: undefined,
        type: "answered",
      }),
    ).toMatchObject({ refreshing: false, status: "no-session" });
  });
});
