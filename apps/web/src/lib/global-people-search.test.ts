// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { mountGlobalPeopleSearch } from "./global-people-search.ts";

const workspaceId = "00000000-0000-4000-8000-000000000003";
const adaId = "00000000-0000-4000-8000-000000000101";
const graceId = "00000000-0000-4000-8000-000000000102";
const session = {
  member: { id: "member", role: "member" },
  principal: { userId: "user" },
  status: "authenticated",
  workspace: { id: workspaceId, name: "Circle" },
  workspaces: [{ id: workspaceId, name: "Circle" }],
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

function directoryPerson(
  id: string,
  givenName: string,
  familyName: string,
  nickname?: string,
) {
  return {
    familyName,
    givenName,
    id,
    isPartial: false,
    isStarred: false,
    lifecycle: "active",
    ...(nickname ? { nickname } : {}),
    tagCount: 0,
    tags: [],
  };
}

function markup(): void {
  document.body.innerHTML = `
    <div class="global-search">
      <input
        id="global-people-search-input"
        role="combobox"
        aria-expanded="false"
        aria-controls="global-people-search-results"
        placeholder="Search people…"
      >
      <button class="button-secondary" data-global-people-search-open type="button" aria-label="Find a person">Find</button>
    </div>
    <header><button data-quick-capture type="button">Quick capture</button></header>
    <button id="shortcut-opener" type="button">Open shortcut</button>
    <input id="other-input">
    <textarea id="note"></textarea>
    <div id="editor" contenteditable="true" tabindex="0"></div>
    <dialog id="global-people-search-dialog" aria-labelledby="global-people-search-heading">
      <div data-global-people-search-input-slot></div>
      <p id="global-people-search-empty" hidden>No people match</p>
      <p id="global-people-search-problem" hidden>People search is temporarily unavailable</p>
      <ul id="global-people-search-results" role="listbox"></ul>
      <p id="global-people-search-status" role="status" aria-live="polite"></p>
      <button class="button-secondary" data-global-people-search-close type="button">Close</button>
    </dialog>`;
}

function fetchFor(
  people: readonly ReturnType<typeof directoryPerson>[] = [],
  recent: readonly { archived: boolean; id: string; name: string }[] = [],
  sessionBody = session,
) {
  return vi.fn((request: RequestInfo | URL) => {
    const url = String(request);
    if (url === "/api/v1/session") {
      return Promise.resolve(response(sessionBody));
    }
    if (url === "/api/v1/today/recent-people") {
      return Promise.resolve(response({ people: recent, status: "ready" }));
    }
    if (url.startsWith("/api/v1/people?")) {
      return Promise.resolve(response({
        lifecycle: "active",
        people,
        status: "ready",
      }));
    }
    throw new Error(`Unexpected request: ${url}`);
  });
}

function setQuery(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

let cleanup: (() => void) | undefined;

afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  sessionStorage.clear();
});

describe("UXD-004 global people search", () => {
  it("renders command rows locally for > without a people request", async () => {
    markup();
    const fetchMock = fetchFor();
    vi.stubGlobal("fetch", fetchMock);
    cleanup = await mountGlobalPeopleSearch();
    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;

    setQuery(input, ">");

    expect(document.querySelectorAll('[role="option"]')).toHaveLength(11);
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Log interaction",
    );
    expect(document.querySelector("#global-people-search-status")?.textContent)
      .toBe("11 commands found");
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/v1/people?") ||
        String(url) === "/api/v1/today/recent-people"
      ),
    ).toHaveLength(0);
  });

  it("shows mode-specific empty copy when commands and people do not match", async () => {
    vi.useFakeTimers();
    markup();
    vi.stubGlobal("fetch", fetchFor([]));
    cleanup = await mountGlobalPeopleSearch();
    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;
    const empty = document.querySelector<HTMLElement>(
      "#global-people-search-empty",
    )!;

    setQuery(input, "> zzz");
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe("No commands match");

    setQuery(input, "zzz");
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(empty.hidden).toBe(false));
    expect(empty.textContent).toBe("No people match");
  });

  it("filters commands case-insensitively and gates settings by role", async () => {
    markup();
    vi.stubGlobal("fetch", fetchFor());
    cleanup = await mountGlobalPeopleSearch();
    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;

    setQuery(input, "> PREFERENCES");
    let labels = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .map((option) => option.querySelector("strong")?.textContent);
    expect(labels).toEqual(["Personal · Preferences"]);

    setQuery(input, ">");
    labels = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .map((option) => option.querySelector("strong")?.textContent);
    expect(labels).toContain("Personal · Preferences");
    expect(labels).not.toContain("Workspace · General");
    expect(labels).not.toContain("Data · Import");
    expect(labels).not.toContain("Workspace actions · Workspace danger zone");

    cleanup();
    cleanup = undefined;
    sessionStorage.clear();
    markup();
    vi.stubGlobal(
      "fetch",
      fetchFor([], [], {
        ...session,
        member: { ...session.member, role: "admin" },
      }),
    );
    cleanup = await mountGlobalPeopleSearch();
    const adminInput = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;
    setQuery(adminInput, ">");
    labels = [...document.querySelectorAll<HTMLElement>('[role="option"]')]
      .map((option) => option.querySelector("strong")?.textContent);
    expect(labels).toHaveLength(20);
    expect(labels).toContain("Workspace · General");
    expect(labels).toContain("Data · Import");
    expect(labels).not.toContain("Workspace actions · Workspace danger zone");
  });

  it("closes command mode and opens quick capture for Log interaction", async () => {
    markup();
    vi.stubGlobal("fetch", fetchFor());
    const quickCapture = document.querySelector<HTMLButtonElement>(
      "header [data-quick-capture]",
    )!;
    const openQuickCapture = vi.fn();
    quickCapture.addEventListener("click", openQuickCapture);
    cleanup = await mountGlobalPeopleSearch();
    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;

    setQuery(input, "> log");
    const dialog = document.querySelector<HTMLDialogElement>(
      "#global-people-search-dialog",
    )!;
    expect(dialog.open).toBe(true);
    document.querySelector<HTMLElement>('[role="option"]')!.click();

    expect(dialog.open).toBe(false);
    expect(openQuickCapture).toHaveBeenCalledOnce();
  });

  it("appends matching commands only when a people query has zero matches", async () => {
    vi.useFakeTimers();
    markup();
    vi.stubGlobal("fetch", fetchFor([]));
    cleanup = await mountGlobalPeopleSearch();
    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;

    setQuery(input, "task");
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(3)
    );
    const labels = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].map((option) => option.querySelector("strong")?.textContent);
    expect(labels).toEqual([
      'Add "task" as a new person',
      "Add task",
      "Tasks",
    ]);
    expect(document.querySelector("#global-people-search-status")?.textContent)
      .toBe("0 people found");

    cleanup();
    cleanup = undefined;
    markup();
    vi.stubGlobal(
      "fetch",
      fetchFor([directoryPerson(adaId, "Task", "Master")]),
    );
    cleanup = await mountGlobalPeopleSearch();
    const matchedInput = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;
    setQuery(matchedInput, "task");
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    );
    const matchedLabels = [
      ...document.querySelectorAll<HTMLElement>('[role="option"]'),
    ].map((option) => option.querySelector("strong")?.textContent);
    expect(matchedLabels).toEqual([
      "Task Master",
      'Add "task" as a new person',
    ]);
  });

  it("opens from Ctrl/Cmd+K and renders recent people for an empty query", async () => {
    markup();
    const fetchMock = fetchFor([], [
      { archived: false, id: adaId, name: "Ada Lovelace" },
      { archived: true, id: graceId, name: "Grace Hopper" },
    ]);
    vi.stubGlobal("fetch", fetchMock);
    cleanup = await mountGlobalPeopleSearch();
    const opener = document.querySelector<HTMLButtonElement>(
      "#shortcut-opener",
    )!;
    opener.focus();

    const shortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      key: "k",
    });
    document.dispatchEvent(shortcut);

    expect(shortcut.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(2)
    );
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Ada Lovelace",
    );
    expect(document.querySelectorAll('[role="option"]')[1]?.textContent)
      .toContain("Archived");
    expect(document.querySelector("#global-people-search-status")?.textContent)
      .toBe("2 people found");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/today/recent-people",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Id": workspaceId }),
      }),
    );

    const dialog = document.querySelector<HTMLDialogElement>(
      "#global-people-search-dialog",
    )!;
    dialog.close();
    expect(document.activeElement).toBe(opener);

    const compactOpener = document.querySelector<HTMLButtonElement>(
      "[data-global-people-search-open]",
    )!;
    compactOpener.click();
    expect(dialog.open).toBe(true);
    document.querySelector<HTMLButtonElement>(
      "[data-global-people-search-close]",
    )!.click();
    expect(dialog.open).toBe(false);
    expect(document.activeElement).toBe(compactOpener);

    const commandShortcut = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "k",
      metaKey: true,
    });
    document.dispatchEvent(commandShortcut);
    expect(commandShortcut.defaultPrevented).toBe(true);
    expect(dialog.open).toBe(true);
    document.dispatchEvent(shortcut);
    expect(dialog.open).toBe(true);
  });

  it("debounces one-character searches and aborts superseded keystrokes", async () => {
    vi.useFakeTimers();
    markup();
    const controllers: AbortController[] = [];
    const NativeAbortController = AbortController;
    class TrackedAbortController extends NativeAbortController {
      constructor() {
        super();
        controllers.push(this);
      }
    }
    vi.stubGlobal("AbortController", TrackedAbortController);
    const fetchMock = fetchFor([
      directoryPerson(adaId, "Ada", "Lovelace", "Countess"),
    ]);
    vi.stubGlobal("fetch", fetchMock);
    cleanup = await mountGlobalPeopleSearch();
    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;

    setQuery(input, "A");
    await vi.advanceTimersByTimeAsync(199);
    expect(
      fetchMock.mock.calls.filter(([url]) =>
        String(url).startsWith("/api/v1/people?")
      ),
    ).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).startsWith("/api/v1/people?")
        ),
      ).toHaveLength(1)
    );

    setQuery(input, "A");
    setQuery(input, "Ad");
    setQuery(input, "Ada");
    expect(controllers.filter((controller) => !controller.signal.aborted))
      .toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() =>
      expect(
        fetchMock.mock.calls.filter(([url]) =>
          String(url).startsWith("/api/v1/people?")
        ),
      ).toHaveLength(2)
    );
    const lastSearchUrl = String(fetchMock.mock.calls.at(-1)?.[0]);
    expect(new URL(lastSearchUrl, "https://kinship.test").searchParams.get(
      "search",
    )).toBe("Ada");
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(document.querySelector('[role="option"]')?.textContent).toContain(
      "Countess",
    );
  });

  it("moves the active option and navigates with Enter", async () => {
    vi.useFakeTimers();
    markup();
    vi.stubGlobal(
      "fetch",
      fetchFor([
        directoryPerson(adaId, "Ada", "Lovelace"),
        directoryPerson(graceId, "Grace", "Hopper"),
      ]),
    );
    const navigate = vi.fn();
    cleanup = await mountGlobalPeopleSearch(navigate);
    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;
    setQuery(input, "a");
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() =>
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(3)
    );
    const options = document.querySelectorAll<HTMLElement>('[role="option"]');
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);

    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowDown",
      }),
    );
    expect(input.getAttribute("aria-activedescendant")).toBe(options[1]?.id);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "ArrowUp",
      }),
    );
    expect(input.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Enter",
      }),
    );
    expect(navigate).toHaveBeenCalledWith(`/app/people/${adaId}`);
  });

  it("adds a split-name synthetic option only when there is no exact match", async () => {
    vi.useFakeTimers();
    markup();
    vi.stubGlobal("fetch", fetchFor([]));
    const navigate = vi.fn();
    cleanup = await mountGlobalPeopleSearch(navigate);
    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;

    setQuery(input, "Marie Dupont");
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() =>
      expect(document.querySelector('[role="option"]')?.textContent).toContain(
        'Add "Marie Dupont" as a new person',
      )
    );
    expect(document.querySelector("#global-people-search-empty")?.textContent)
      .toBe("No people match");
    expect(
      document.querySelector("#global-people-search-empty")?.getAttribute(
        "role",
      ),
    ).toBeNull();
    document.querySelector<HTMLElement>('[role="option"]')!.click();
    const destination = new URL(
      String(navigate.mock.calls[0]?.[0]),
      "https://kinship.test",
    );
    expect(destination.pathname).toBe("/app/people/new");
    expect(destination.searchParams.get("givenName")).toBe("Marie");
    expect(destination.searchParams.get("familyName")).toBe("Dupont");

    cleanup();
    cleanup = undefined;
    markup();
    cleanup = await mountGlobalPeopleSearch(navigate);
    const singleNameInput = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;
    setQuery(singleNameInput, "Prince");
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() =>
      expect(document.querySelector('[role="option"]')?.textContent).toContain(
        'Add "Prince" as a new person',
      )
    );
    const singleNameDestination = new URL(
      document.querySelector<HTMLElement>('[role="option"]')!.dataset.path!,
      "https://kinship.test",
    );
    expect(singleNameDestination.searchParams.get("givenName")).toBe("Prince");
    expect(singleNameDestination.searchParams.has("familyName")).toBe(false);
  });

  it("focuses the header input with slash except from an editable control", async () => {
    markup();
    vi.stubGlobal("fetch", fetchFor());
    cleanup = await mountGlobalPeopleSearch();
    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "/",
      }),
    );
    expect(document.activeElement).toBe(input);

    for (const selector of ["#other-input", "#note", "#editor"]) {
      const editable = document.querySelector<HTMLElement>(selector)!;
      editable.focus();
      editable.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          cancelable: true,
          key: "/",
        }),
      );
      expect(document.activeElement).toBe(editable);
    }
  });

  it("keeps unavailable search states non-alerting and ignores incomplete shells", async () => {
    const noElementsCleanup = await mountGlobalPeopleSearch();
    expect(noElementsCleanup()).toBeUndefined();

    markup();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        response({ code: "session_unavailable", status: 503 }, 503),
      ),
    );
    const unavailableCleanup = await mountGlobalPeopleSearch();
    document.querySelector<HTMLButtonElement>(
      "[data-global-people-search-open]",
    )!.click();
    expect(
      document.querySelector<HTMLDialogElement>(
        "#global-people-search-dialog",
      )!.open,
    ).toBe(false);
    unavailableCleanup();

    vi.useFakeTimers();
    markup();
    const fetchMock = vi.fn((request: RequestInfo | URL) => {
      const url = String(request);
      if (url === "/api/v1/session") return Promise.resolve(response(session));
      return Promise.resolve(
        response({ code: "people_unavailable", status: 503 }, 503),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    cleanup = await mountGlobalPeopleSearch();
    document.querySelector<HTMLButtonElement>(
      "[data-global-people-search-open]",
    )!.click();
    await vi.waitFor(() =>
      expect(
        document.querySelector<HTMLElement>(
          "#global-people-search-problem",
        )!.hidden,
      ).toBe(false)
    );
    const problem = document.querySelector<HTMLElement>(
      "#global-people-search-problem",
    )!;
    expect(problem.getAttribute("role")).toBeNull();

    const input = document.querySelector<HTMLInputElement>(
      "#global-people-search-input",
    )!;
    setQuery(input, "A");
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(problem.hidden).toBe(false));
    expect(document.querySelector("#global-people-search-status")?.textContent)
      .toBe("People search is temporarily unavailable");
  });
});
