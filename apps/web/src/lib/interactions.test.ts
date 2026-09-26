// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountActivityReport, mountTodayInteractions } from "./interactions.ts";

import { getMemberPreferences } from "../../../../packages/contracts/generated/auth-client.ts";

vi.mock(
  "../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<Record<string, unknown>>(),
    getMemberPreferences: vi.fn(),
  }),
);

beforeEach(() => {
  vi.mocked(getMemberPreferences).mockReset().mockResolvedValue({
    ok: true,
    value: {
      status: "ready",
      preferences: {
        effectiveTimezone: "UTC",
        contactNameOrder: "given_family_nickname",
        contactSortOrder: "given_name_asc",
        fluidLayout: false,
        locale: "en",
        measurementSystem: "metric",
        temperatureScale: "celsius",
      },
    },
  });
});

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, reject, resolve };
}

const workspaceId = "00000000-0000-4000-8000-000000000003";
const personId = "00000000-0000-4000-8000-000000000100";

function session() {
  return {
    member: { id: "member", role: "member" },
    principal: { userId: "user" },
    status: "authenticated",
    workspace: { id: workspaceId, name: "Circle" },
    workspaces: [{ id: workspaceId, name: "Circle" }],
  };
}

function todayMarkup(): void {
  document.body.innerHTML = `
    <section id="today-favorite-notes-region" aria-labelledby="favorite-notes-heading">
      <h2 id="favorite-notes-heading">Favorite notes</h2>
      <p id="today-favorite-notes-state" aria-live="polite"></p>
      <ul id="today-favorite-notes"></ul>
      <button id="today-favorite-notes-retry" type="button" hidden>Retry favorite notes</button>
    </section>
    <section id="today-recent-activity-region" aria-labelledby="activity-heading">
      <h2 id="activity-heading">Recent activity</h2>
      <p id="today-recent-activity-state" aria-live="polite"></p>
      <ul id="today-recent-activity"></ul>
      <button id="today-recent-activity-retry" type="button" hidden>Retry recent activity</button>
    </section>`;
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  void mountTodayInteractions();
  sessionStorage.clear();
  history.replaceState({}, "", "/");
});

describe("INTERACTION-001 browser behavior", () => {
  it("does nothing when an interaction projection is absent from the page", async () => {
    document.body.innerHTML = "";
    await mountTodayInteractions();
    await mountActivityReport();
    expect(document.body.textContent).toBe("");
  });

  it("refreshes only Recent for activity and both Today projections for note, including during initial load", async () => {
    todayMarkup();
    const favoriteInitial = deferred<Response>();
    const recentInitial = deferred<Response>();
    let favoriteCalls = 0;
    let recentCalls = 0;
    const item = (kind: "activity" | "note", label: string) =>
      kind === "activity"
        ? {
          emotions: [],
          happenedAt: "2026-08-22T10:00:00.000Z",
          id: crypto.randomUUID(),
          kind,
          participants: [{ id: personId, name: "Ada" }],
          summary: label,
        }
        : {
          body: label,
          createdAt: "2026-08-22T10:00:00.000Z",
          id: crypto.randomUUID(),
          isFavorited: true,
          kind,
          participants: [{ id: personId, name: "Ada" }],
        };
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/session")) {
          return Promise.resolve(response(session()));
        }
        if (path.endsWith("/favorite-notes")) {
          favoriteCalls += 1;
          return favoriteCalls === 1
            ? favoriteInitial.promise
            : Promise.resolve(response({
              items: [item("note", `Favorite ${favoriteCalls}`)],
              status: "ready",
            }));
        }
        recentCalls += 1;
        return recentCalls === 1
          ? recentInitial.promise
          : Promise.resolve(response({
            items: [item("activity", `Recent ${recentCalls}`)],
            status: "ready",
          }));
      }),
    );
    const mounting = mountTodayInteractions();
    await vi.waitFor(() =>
      expect([favoriteCalls, recentCalls]).toEqual([1, 1])
    );
    globalThis.dispatchEvent(
      new CustomEvent("kinship:interaction-created", {
        detail: { kind: "activity" },
      }),
    );
    await vi.waitFor(() => expect(recentCalls).toBe(2));
    expect(favoriteCalls).toBe(1);
    globalThis.dispatchEvent(
      new CustomEvent("kinship:interaction-created", {
        detail: { kind: "note" },
      }),
    );
    await vi.waitFor(() =>
      expect([favoriteCalls, recentCalls]).toEqual([2, 3])
    );
    favoriteInitial.resolve(response({
      items: [item("note", "Obsolete favorite")],
      status: "ready",
    }));
    recentInitial.resolve(response({
      items: [item("activity", "Obsolete recent")],
      status: "ready",
    }));
    await mounting;
    expect(document.body.textContent).not.toContain("Obsolete");
    expect(document.querySelector("#today-favorite-notes")?.textContent)
      .toContain("Favorite 2");
    expect(document.querySelector("#today-recent-activity")?.textContent)
      .toContain("Recent 3");
  });

  it("isolates a favorite-note outage and retries only that region", async () => {
    todayMarkup();
    const note = {
      body: "Pinned context",
      createdAt: "2026-08-17T12:30:00.000Z",
      id: "note",
      isFavorited: true,
      kind: "note",
      participants: [{ id: personId, name: "Ada Lovelace" }],
    };
    const activity = {
      emotions: [],
      happenedAt: "2026-08-17T12:31:00.000Z",
      id: "activity",
      kind: "activity",
      participants: [{ id: personId, name: "Ada Lovelace" }],
      summary: "Shared lunch",
    };
    let favoriteCalls = 0;
    let recentCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/favorite-notes")) {
          favoriteCalls += 1;
          return Promise.resolve(
            favoriteCalls === 1
              ? response({
                detail: "offline",
                status: 503,
                title: "Unavailable",
              }, 503)
              : response({ items: [note], status: "ready" }),
          );
        }
        if (path.endsWith("/recent-activity")) {
          recentCalls += 1;
          return Promise.resolve(
            response({ items: [activity], status: "ready" }),
          );
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountTodayInteractions();
    expect(document.querySelector("#today-favorite-notes-state")?.textContent)
      .toContain("could not be loaded");
    expect(document.querySelector("#today-recent-activity")?.textContent)
      .toContain("Shared lunch");
    const retry = document.querySelector<HTMLButtonElement>(
      "#today-favorite-notes-retry",
    )!;
    expect(retry.hidden).toBe(false);
    retry.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#today-favorite-notes")?.textContent)
        .toContain("Pinned context")
    );
    expect(favoriteCalls).toBe(2);
    expect(recentCalls).toBe(1);
  });

  it("isolates a recent-activity outage and retries only that region", async () => {
    todayMarkup();
    const note = {
      body: "Preserved favorite",
      createdAt: "2026-08-17T12:30:00.000Z",
      id: "note",
      isFavorited: true,
      kind: "note",
      participants: [{ id: personId, name: "Ada Lovelace" }],
    };
    let favoriteCalls = 0;
    let recentCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/favorite-notes")) {
          favoriteCalls += 1;
          return Promise.resolve(response({ items: [note], status: "ready" }));
        }
        if (path.endsWith("/recent-activity")) {
          recentCalls += 1;
          return Promise.resolve(
            recentCalls === 1
              ? response({
                detail: "offline",
                status: 503,
                title: "Unavailable",
              }, 503)
              : response({ items: [], status: "ready" }),
          );
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountTodayInteractions();
    expect(document.querySelector("#today-favorite-notes")?.textContent)
      .toContain("Preserved favorite");
    expect(document.querySelector("#today-recent-activity-state")?.textContent)
      .toContain("could not be loaded");
    document.querySelector<HTMLButtonElement>(
      "#today-recent-activity-retry",
    )!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector("#today-recent-activity-state")?.textContent,
      )
        .toContain("No activities or notes")
    );
    expect(favoriteCalls).toBe(1);
    expect(recentCalls).toBe(2);
  });

  it("hides empty favorite notes and reveals a later nonempty refresh without stale overwrite", async () => {
    todayMarkup();
    let favoriteCalls = 0;
    let releaseOlder!: (value: Response) => void;
    const older = new Promise<Response>((resolve) => releaseOlder = resolve);
    const note = (body: string) => ({
      body,
      createdAt: "2026-08-17T12:30:00.000Z",
      id: body,
      isFavorited: true,
      kind: "note",
      participants: [{ id: personId, name: "Ada Lovelace" }],
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/favorite-notes")) {
          favoriteCalls += 1;
          if (favoriteCalls === 1) {
            return Promise.resolve(response({ items: [], status: "ready" }));
          }
          if (favoriteCalls === 2) return older;
          return Promise.resolve(response({
            items: [note("Newest favorite")],
            status: "ready",
          }));
        }
        if (path.endsWith("/recent-activity")) {
          return Promise.resolve(response({ items: [], status: "ready" }));
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountTodayInteractions();
    const region = document.querySelector<HTMLElement>(
      "#today-favorite-notes-region",
    )!;
    expect(region.hidden).toBe(true);
    expect(region.getAttribute("aria-labelledby")).toBe(
      "favorite-notes-heading",
    );
    expect(
      document.querySelector<HTMLElement>("#today-recent-activity-region")
        ?.hidden,
    ).toBe(false);
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() => expect(favoriteCalls).toBe(2));
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() =>
      expect(document.querySelector("#today-favorite-notes")?.textContent)
        .toContain("Newest favorite")
    );
    expect(region.hidden).toBe(false);
    releaseOlder(response({
      items: [note("Older favorite")],
      status: "ready",
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#today-favorite-notes")?.textContent)
      .not.toContain("Older favorite");
  });

  it("renders retained activity with redacted participants safely", async () => {
    todayMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/favorite-notes")) {
          return Promise.resolve(response({ items: [], status: "ready" }));
        }
        if (path.endsWith("/recent-activity")) {
          return Promise.resolve(response({
            items: [{
              activityType: "Collaboration",
              emotions: [],
              happenedAt: "2026-06-01T09:00:00.000Z",
              id: crypto.randomUUID(),
              kind: "activity",
              participants: [],
              summary: "Retained redacted activity",
            }],
            status: "ready",
          }));
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountTodayInteractions();
    const text =
      document.querySelector("#today-recent-activity")?.textContent ?? "";
    expect(text).toContain("Retained redacted activity");
    expect(text).toContain("Category: Collaboration");
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("Deleted private identity");
  });

  it("names a recent activity's emotions", async () => {
    todayMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        if (path.endsWith("/favorite-notes")) {
          return Promise.resolve(response({ items: [], status: "ready" }));
        }
        if (path.endsWith("/recent-activity")) {
          return Promise.resolve(response({
            items: [{
              emotions: [{ id: "joy", name: "Joy" }, {
                id: "calm",
                name: "Calm",
              }],
              happenedAt: "2026-06-01T09:00:00.000Z",
              id: crypto.randomUUID(),
              kind: "activity",
              participants: [{ id: personId, name: "Ada" }],
              summary: "Walked by the river",
            }],
            status: "ready",
          }));
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountTodayInteractions();
    expect(document.querySelector("#today-recent-activity")?.textContent)
      .toContain("Emotions: Joy, Calm");
  });

  it("keeps unreachable Today projections retryable", async () => {
    todayMarkup();
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        return path.endsWith("/session")
          ? Promise.resolve(response(session()))
          : Promise.reject(new TypeError("Failed to fetch"));
      }),
    );
    await mountTodayInteractions();
    expect(document.querySelector("#today-favorite-notes-state")?.textContent)
      .toBe(
        "Favorite notes could not be loaded. Recent activity is unchanged.",
      );
    expect(document.querySelector("#today-recent-activity-state")?.textContent)
      .toBe(
        "Recent activity could not be loaded. Favorite notes are unchanged.",
      );
    expect(
      document.querySelector<HTMLButtonElement>("#today-recent-activity-retry")
        ?.hidden,
    ).toBe(false);
  });

  it("keeps an unreachable activity report truthful", async () => {
    document.body.innerHTML = `
      <a data-breadcrumb-person href="/app/people"><span data-slot="skeleton" aria-hidden="true"></span></a>
      <p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ul id="activity-report-list"></ul>`;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const path = new URL(String(input), "http://localhost").pathname;
        return path.endsWith("/session")
          ? Promise.resolve(response(session()))
          : Promise.reject(new TypeError("Failed to fetch"));
      }),
    );
    await mountActivityReport(personId);
    expect(document.querySelector("#activity-report-state")?.textContent)
      .toBe(
        "Activity report could not be loaded. Saved interactions are unchanged.",
      );
    expect(document.querySelector("[data-breadcrumb-person]")?.textContent)
      .toBe("Person");
  });

  it("UXD-009 renders favorite notes, chronological activity, and the report breadcrumb", async () => {
    todayMarkup();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<nav aria-label="Breadcrumb">
        <a href="/app/people">People</a><span aria-hidden="true">/</span>
        <a data-breadcrumb-person href="/app/people">Loading person…</a><span aria-hidden="true">/</span>
        <span aria-current="page">Activity report</span>
      </nav>
      <p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ul id="activity-report-list"></ul><button id="activity-report-more" hidden></button>`,
    );
    const note = {
      body: "Prefers quiet mornings",
      createdAt: "2026-08-17T12:30:00.000Z",
      id: "note",
      isFavorited: true,
      kind: "note",
      participants: [{ id: personId, name: "Ada Lovelace" }],
    };
    let reportCalls = 0;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path.endsWith("/favorite-notes")) {
        return Promise.resolve(response({ items: [note], status: "ready" }));
      }
      if (path.endsWith("/recent-activity")) {
        return Promise.resolve(response({
          items: [note, { ...note, id: "note-2" }],
          status: "ready",
        }));
      }
      if (path.endsWith("/activity-report")) {
        reportCalls += 1;
        return Promise.resolve(response({
          items: reportCalls === 1
            ? [note]
            : [{ ...note, body: "Second page", id: "note-2" }],
          ...(reportCalls === 1 ? { nextCursor: "report-2" } : {}),
          person: { id: personId, name: "Ada Lovelace" },
          status: "ready",
        }));
      }
      return Promise.resolve(response(session()));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayInteractions();
    await mountActivityReport(personId);
    expect(document.querySelector("#today-favorite-notes")?.textContent)
      .toContain("quiet mornings");
    expect(document.querySelector("#today-recent-activity")?.textContent)
      .toContain("Ada Lovelace");
    expect(document.querySelector("#activity-report-heading")?.textContent)
      .toContain("Ada Lovelace");
    const personCrumb = document.querySelector("[data-breadcrumb-person]");
    expect({
      href: personCrumb?.getAttribute("href"),
      tagName: personCrumb?.tagName,
      text: personCrumb?.textContent,
    }).toEqual({
      href: `/app/people/${personId}`,
      tagName: "A",
      text: "Ada Lovelace",
    });
    document.querySelector<HTMLButtonElement>("#activity-report-more")!.click();
    await vi.waitFor(() =>
      expect(document.querySelector("#activity-report-list")?.textContent)
        .toContain("Second page")
    );
  });

  it("appends one bounded report continuation and retires its consumed cursor", async () => {
    document.body.innerHTML =
      `<p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ol id="activity-report-list"></ol><button id="activity-report-more" hidden>Load more</button>`;
    const note = (index: number) => ({
      body: `Paged note ${String(index).padStart(2, "0")}`,
      createdAt: "2026-08-17T12:30:00.000Z",
      id: `00000000-0000-8000-8000-${String(index).padStart(12, "0")}`,
      isFavorited: false,
      kind: "note" as const,
      participants: [{ id: personId, name: "Ada Lovelace" }],
    });
    const reportUrls: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = new URL(String(input), "http://localhost");
        if (url.pathname.endsWith("/activity-report")) {
          reportUrls.push(url);
          const continued = url.searchParams.get("cursor") === "report-2";
          return Promise.resolve(response({
            items: continued
              ? [note(0)]
              : Array.from({ length: 20 }, (_, index) => note(20 - index)),
            ...(continued ? {} : { nextCursor: "report-2" }),
            person: { id: personId, name: "Ada Lovelace" },
            status: "ready",
          }));
        }
        return Promise.resolve(response(session()));
      }),
    );
    await mountActivityReport(personId);
    const list = document.querySelector<HTMLOListElement>(
      "#activity-report-list",
    )!;
    const more = document.querySelector<HTMLButtonElement>(
      "#activity-report-more",
    )!;
    expect(list.children).toHaveLength(20);
    expect(more.hidden).toBe(false);
    more.click();
    await vi.waitFor(() => expect(list.children).toHaveLength(21));
    expect(reportUrls).toHaveLength(2);
    expect(reportUrls[1]?.searchParams.get("cursor")).toBe("report-2");
    expect(list.textContent).toContain("Paged note 00");
    expect(
      new Set([...list.children].map((entry) => entry.textContent)).size,
    ).toBe(21);
    expect(more.hidden).toBe(true);
    expect(document.querySelector("#activity-report-state")?.textContent)
      .toBe("21 recorded items.");
  });

  it("UXD-009 keeps a failed activity-report crumb truthful and tenant-concealing", async () => {
    todayMarkup();
    document.body.insertAdjacentHTML(
      "beforeend",
      `<nav aria-label="Breadcrumb">
        <a href="/app/people">People</a><span aria-hidden="true">/</span>
        <a data-breadcrumb-person href="/app/people/${personId}"><span data-slot="skeleton" aria-hidden="true"></span><span class="sr-only">Loading person…</span></a><span aria-hidden="true">/</span>
        <span aria-current="page">Activity report</span>
      </nav>
      <p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ul id="activity-report-list"></ul>`,
    );
    const unauthorized = response({
      detail: "Sign in",
      status: 401,
      title: "Unauthorized",
      type: "about:blank",
    }, 401);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(unauthorized)
      .mockResolvedValueOnce(response({
        detail: "Entry unavailable",
        status: 409,
        title: "Application entry unavailable",
        type: "about:blank",
      }, 409))
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        detail: "Missing",
        status: 404,
        title: "Not found",
        type: "about:blank",
      }, 404));
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayInteractions();
    expect(document.querySelector("#today-favorite-notes-state")?.textContent)
      .toContain("unavailable");
    expect(document.querySelector("#today-recent-activity-state")?.textContent)
      .toContain("unavailable");
    history.replaceState(
      {},
      "",
      "/app/people/example/activity-report?year=2026",
    );
    await mountActivityReport(personId);
    expect(document.querySelector("#activity-report-state")?.textContent)
      .toContain("not found in this workspace");
    const personCrumb = document.querySelector<HTMLAnchorElement>(
      "[data-breadcrumb-person]",
    );
    expect({
      href: personCrumb?.getAttribute("href"),
      text: personCrumb?.textContent,
    }).toEqual({
      href: `/app/people/${personId}`,
      text: "Person",
    });
  });

  it("keeps report access loss and a real empty period distinct", async () => {
    document.body.innerHTML = `
      <p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ul id="activity-report-list"></ul>`;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({
        detail: "Sign in",
        status: 401,
        title: "Unauthorized",
        type: "about:blank",
      }, 401))
      .mockResolvedValueOnce(response({
        detail: "Entry unavailable",
        status: 409,
        title: "Application entry unavailable",
        type: "about:blank",
      }, 409))
      .mockResolvedValueOnce(response(session()))
      .mockResolvedValueOnce(response({
        items: [],
        person: { id: personId, name: "Ada Lovelace" },
        status: "ready",
      }));
    vi.stubGlobal("fetch", fetchMock);
    await mountActivityReport(personId);
    expect(document.querySelector("#activity-report-state")?.textContent)
      .toContain("unavailable");
    await mountActivityReport(personId);
    expect(document.querySelector("#activity-report-state")?.textContent)
      .toContain("No activities or notes for this period");
  });

  it("distinguishes empty Today from a retryable projection outage", async () => {
    todayMarkup();
    let outage = true;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (
        path.endsWith("/favorite-notes") ||
        path.endsWith("/recent-activity")
      ) {
        return Promise.resolve(
          outage
            ? response({
              detail: "Try again",
              status: 503,
              title: "Unavailable",
              type: "about:blank",
            }, 503)
            : response({ items: [], status: "ready" }),
        );
      }
      return Promise.resolve(response(session()));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayInteractions();
    expect(document.querySelector("#today-favorite-notes-state")?.textContent)
      .toContain("could not be loaded");
    expect(document.querySelector("#today-recent-activity-state")?.textContent)
      .toContain("could not be loaded");
    outage = false;
    await mountTodayInteractions();
    expect(
      document.querySelector<HTMLElement>("#today-favorite-notes-region")
        ?.hidden,
    ).toBe(true);
    expect(document.querySelector("#today-recent-activity-state")?.textContent)
      .toContain("No activities or notes");
  });

  it("keeps projection listeners through two captures and prevents an older Today load from overwriting", async () => {
    todayMarkup();
    document.body.insertAdjacentHTML(
      "beforeend",
      `
      <p id="activity-report-state"></p><h1 id="activity-report-heading"></h1><ul id="activity-report-list"></ul><button id="activity-report-more"></button>`,
    );
    let todayCalls = 0;
    let reportCalls = 0;
    let releaseOlder!: (value: Response) => void;
    const older = new Promise<Response>((resolve) => releaseOlder = resolve);
    const interaction = (label: string) => ({
      emotions: [],
      happenedAt: "2026-08-17T12:30:00.000Z",
      id: crypto.randomUUID(),
      kind: "activity",
      participants: [{ id: personId, name: "Ada Lovelace" }],
      summary: label,
    });
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path.endsWith("/favorite-notes")) {
        return Promise.resolve(response({ items: [], status: "ready" }));
      }
      if (path.endsWith("/recent-activity")) {
        todayCalls += 1;
        if (todayCalls === 2) return older;
        const item = interaction(`Today ${todayCalls}`);
        return Promise.resolve(
          response({
            items: [item],
            status: "ready",
          }),
        );
      }
      if (path.endsWith("/activity-report")) {
        reportCalls += 1;
        const item = interaction(`Report ${reportCalls}`);
        return Promise.resolve(
          response({
            items: [item],
            person: { id: personId, name: "Ada" },
            status: "ready",
          }),
        );
      }
      return Promise.resolve(response(session()));
    });
    vi.stubGlobal("fetch", fetchMock);
    await mountTodayInteractions();
    await mountActivityReport(personId);
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() => expect(todayCalls).toBe(2));
    globalThis.dispatchEvent(new CustomEvent("kinship:interaction-created"));
    await vi.waitFor(() =>
      expect(document.querySelector("#today-recent-activity")?.textContent)
        .toContain("Today 3")
    );
    await vi.waitFor(() => expect(reportCalls).toBeGreaterThanOrEqual(3));
    releaseOlder(response({
      items: [interaction("Older response")],
      status: "ready",
    }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector("#today-recent-activity")?.textContent)
      .toContain("Today 3");
    expect(document.querySelector("#activity-report-list")?.textContent)
      .toContain("Report");
  });
});
