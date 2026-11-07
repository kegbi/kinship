// @vitest-environment happy-dom

import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getMemberPreferences,
  type ResolvedMemberPreferences,
} from "../../../../../packages/contracts/generated/auth-client.ts";
import {
  deferred,
  jsonResponse,
  stubApi,
  type StubbedApi,
  unreachable,
} from "../../testing/api.ts";
import { ids, preferences, workspaceSession } from "../../testing/fixtures.ts";
import {
  drawShell,
  element,
  mountPending,
  mountSettled,
} from "../../testing/render.tsx";
import { SEARCH_DEBOUNCE_MS } from "./global-people-search.tsx";
import {
  GLOBAL_PEOPLE_SEARCH_ISLAND,
  mountGlobalPeopleSearch,
} from "./mount.tsx";

vi.mock(
  "../../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<Record<string, unknown>>(),
    getMemberPreferences: vi.fn(),
  }),
);

const workspaceId = ids.workspace;
const adaId = "00000000-0000-4000-8000-000000000101";
const graceId = "00000000-0000-4000-8000-000000000102";
const session = workspaceSession({
  member: { id: ids.member, role: "member" },
});

const savedPreferences = (
  contactNameOrder: ResolvedMemberPreferences["contactNameOrder"],
) => ({
  ok: true as const,
  value: {
    preferences: preferences({ contactNameOrder }),
    status: "ready" as const,
    supportedCurrencyCodes: [],
  },
});

beforeEach(() => {
  vi.mocked(getMemberPreferences).mockReset().mockResolvedValue(
    savedPreferences("given_family_nickname"),
  );
});

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

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

/** The header as ApplicationLayout.astro draws it before the island mounts. */
function markup(): void {
  drawShell(`
    <div class="global-search" data-global-people-search>
      <input id="global-people-search-input" type="search" role="combobox" aria-label="Find a person" aria-expanded="false" placeholder="Search people, notes, tasks…" autocomplete="off">
      <button data-global-people-search-open type="button" aria-label="Find a person" aria-expanded="false"><span>Search</span></button>
    </div>
    <header><button data-quick-capture type="button">Quick capture</button></header>
    <button id="shortcut-opener" type="button">Open shortcut</button>
    <input id="other-input">
    <textarea id="note"></textarea>
    <div id="editor" contenteditable="true" tabindex="0"></div>`);
}

const SESSION = "GET /api/v1/session";
const NOTHING_MATCHES = "Nothing in this workspace matches";

type Person = ReturnType<typeof directoryPerson> & {
  readonly avatar?: { readonly color: string };
};

/** A directory person as the search route answers it. */
function searchPerson({ avatar, familyName, givenName, id, nickname }: Person) {
  return {
    ...(avatar ? { avatar } : {}),
    familyName,
    givenName,
    href: `/app/people/${id}`,
    id,
    kind: "person",
    ...(nickname ? { nickname } : {}),
  };
}

interface EntityGroups {
  readonly activities?: readonly unknown[];
  readonly journalPosts?: readonly unknown[];
  readonly notes?: readonly unknown[];
  readonly tasks?: readonly unknown[];
  /** The text groups the search could not answer in time. */
  readonly unavailable?: boolean;
}

/** The search route's answer: people first, then the four other groups. */
function searchBody(
  query: string,
  people: readonly Person[],
  groups: EntityGroups = {},
) {
  const marked = groups.unavailable ? { unavailable: true } : {};
  return {
    groups: [
      { kind: "people", results: people.map(searchPerson) },
      { kind: "notes", results: groups.notes ?? [], ...marked },
      { kind: "activities", results: groups.activities ?? [], ...marked },
      {
        kind: "journal-posts",
        results: groups.journalPosts ?? [],
        ...marked,
      },
      { kind: "tasks", results: groups.tasks ?? [], ...marked },
    ],
    query,
    status: "ready",
  };
}

/** The API behind the palette: a session, recent people, and a search. */
function stubPeople(
  people: readonly Person[] = [],
  recent: readonly { archived: boolean; id: string; name: string }[] = [],
  sessionAnswer: Response | Promise<Response> = jsonResponse(session),
  groups: EntityGroups = {},
): StubbedApi {
  return stubApi({
    [SESSION]: sessionAnswer,
    "GET /api/v1/today/recent-people": jsonResponse({
      people: recent,
      status: "ready",
    }),
    "GET /api/v1/people/:personId?include=summary": ({ params }) => {
      const isAda = params["personId"] === adaId;
      return jsonResponse({
        status: isAda ? "ready" : "archived",
        person: directoryPerson(
          isAda ? adaId : graceId,
          isAda ? "Ada" : "Grace",
          isAda ? "Lovelace" : "Hopper",
        ),
      });
    },
    "GET /api/v1/search": ({ url }) =>
      jsonResponse(searchBody(url.searchParams.get("q") ?? "", people, groups)),
  });
}

const peopleRequests = (api: StubbedApi) =>
  api.requests().filter(({ url }) => url.pathname === "/api/v1/search");

/** Mounts the island and lets its session and preference reads settle. */
const mount = (navigate: (path: string) => void = vi.fn()) =>
  mountSettled(() => Promise.resolve(mountGlobalPeopleSearch(navigate)));

/** Mounts without settling, for the reads a test holds back. */
const mountNow = () =>
  void mountPending(() => Promise.resolve(mountGlobalPeopleSearch(vi.fn())));

/** Holds the session read back until the test releases `answer`. */
function gatedSession(answer: () => Response = () => jsonResponse(session)) {
  const gate = deferred<Response>();
  return { answer: gate.promise, release: () => gate.resolve(answer()) };
}

const field = () =>
  screen.getByRole<HTMLInputElement>("combobox", { name: "Find a person" });
const palette = () => screen.queryByRole("dialog", { name: "Find a person" });
const optionNames = () =>
  screen.queryAllByRole("option").map((option) =>
    option.querySelector("strong")?.textContent
  );
const statusLine = () =>
  document.querySelector("#global-people-search-status")?.textContent;

function type(value: string): void {
  act(() => {
    fireEvent.change(field(), { target: { value } });
  });
}

/**
 * Types a workspace query and lets its debounce elapse on a fake clock, so a
 * case does not wait the real {@link SEARCH_DEBOUNCE_MS} for each query.
 */
async function search(value: string): Promise<void> {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    type(value);
    await act(() => vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS));
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
}

function key(target: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

describe("GAP-027 people palette island", () => {
  it("takes over the static header and marks itself ready", async () => {
    markup();
    stubPeople();
    await mount();
    const container = element("[data-global-people-search]");
    expect(container.dataset.island).toBe(GLOBAL_PEOPLE_SEARCH_ISLAND);
    expect(container.hasAttribute("data-island-ready")).toBe(true);
    expect(field().getAttribute("aria-expanded")).toBe("false");
    expect(field().id).toBe("global-people-search-input");
    expect(
      screen.getByRole("button", { name: "Find a person" })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(palette()).toBeNull();
  });

  it("does nothing without the header", () => {
    expect(mountGlobalPeopleSearch()()).toBeUndefined();
  });

  it("FER-01 keeps the focus on the Search button whose focus mounted it", async () => {
    markup();
    stubPeople([]);
    const staticButton = screen.getByRole("button", { name: "Find a person" });
    staticButton.focus();
    await mount();
    const button = screen.getByRole("button", { name: "Find a person" });
    expect(button).not.toBe(staticButton);
    expect(document.activeElement).toBe(button);
    expect(palette()).toBeNull();
  });

  it("FER-01 navigates the document itself when the shell mounts it", async () => {
    markup();
    stubPeople([]);
    const assign = vi.spyOn(globalThis.location, "assign")
      .mockImplementation(() => undefined);
    await mountSettled(() => Promise.resolve(mountGlobalPeopleSearch()));
    await search("Marie Dupont");
    fireEvent.click(
      await screen.findByRole("option", {
        name: 'Add "Marie Dupont" as a new person',
      }),
    );
    expect(String(assign.mock.calls[0]?.[0])).toMatch(/^\/app\/people\/new\?/);
    assign.mockRestore();
  });
});

describe("UXD-004 global people search", () => {
  it.each(["Ada Lovelace", "Lovelace Ada", "Countess"])(
    "APR-008 recognizes an existing identity %s after changing display order",
    async (query) => {
      markup();
      vi.mocked(getMemberPreferences).mockResolvedValue(
        savedPreferences("family_given_nickname"),
      );
      stubPeople([directoryPerson(adaId, "Ada", "Lovelace", "Countess")]);
      await mount();
      await search(query);
      await waitFor(() =>
        expect(optionNames()).toEqual(["Lovelace Ada “Countess”"])
      );
      expect(screen.queryByRole("option", { name: /as a new person/ }))
        .toBeNull();
    },
  );

  it.each([403, 404, "transport"] as const)(
    "APR-008 omits an unavailable recent identity (%s) without exposing its stale name",
    async (failure) => {
      markup();
      stubPeople([], [
        { id: adaId, name: "Old Ada", archived: false },
        { id: graceId, name: "Do not expose this stale name", archived: false },
      ]).route(
        `GET /api/v1/people/${graceId}`,
        failure === "transport"
          ? unreachable
          : jsonResponse({ status: failure }, failure),
      );
      await mount();
      fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
      await waitFor(() =>
        expect(statusLine()).toBe("Some recent people are unavailable")
      );
      expect(optionNames()).toEqual(["Ada Lovelace"]);
      expect(document.body.textContent).not.toContain("stale name");
    },
  );

  it("APR-008 ignores a late recent identity after a newer search", async () => {
    markup();
    const pending = deferred<Response>();
    const api = stubPeople([directoryPerson(graceId, "Grace", "Hopper")], [{
      id: adaId,
      name: "Old Ada",
      archived: false,
    }]);
    api.route(`GET /api/v1/people/${adaId}`, pending.promise);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    await waitFor(() =>
      expect(api.fetch).toHaveBeenCalledWith(
        `/api/v1/people/${adaId}?include=summary`,
        expect.anything(),
      )
    );
    await search("Grace");
    await waitFor(() => expect(optionNames()[0]).toBe("Grace Hopper"));
    await act(async () => {
      pending.resolve(jsonResponse({
        status: "ready",
        person: directoryPerson(adaId, "Ada", "Lovelace"),
      }));
      await Promise.resolve();
    });
    expect(optionNames()).toEqual([
      "Grace Hopper",
      'Add "Grace" as a new person',
    ]);
  });

  it("APR-008 formats search results and recent identities with explicit saved preferences", async () => {
    markup();
    vi.mocked(getMemberPreferences).mockResolvedValue(
      savedPreferences("family_given_nickname"),
    );
    stubPeople([directoryPerson(adaId, "Ada", "Lovelace")], [{
      id: adaId,
      name: "Do not parse this label",
      archived: false,
    }]);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    await waitFor(() => expect(optionNames()).toEqual(["Lovelace Ada"]));
    await search("Ada");
    await waitFor(() => expect(statusLine()).toBe("1 person found"));
    expect(optionNames()[0]).toBe("Lovelace Ada");
    expect(getMemberPreferences).toHaveBeenCalledWith(workspaceId);
  });

  it("PEOPLE-007 draws each person row with their avatar and initials", async () => {
    markup();
    stubPeople([{
      ...directoryPerson(adaId, "Ada", "Lovelace"),
      avatar: { color: "#1f6f5c" },
    }]);
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    await search("Ada");
    await waitFor(() => expect(statusLine()).toBe("1 person found"));
    const [person, add] = screen.getAllByRole("option");
    const avatar = person!.querySelector<HTMLElement>("[data-slot=avatar]")!;
    expect(avatar.textContent).toBe("AL");
    expect(avatar.style.backgroundColor).toBe("#1f6f5c");
    expect(add!.querySelector("[data-slot=avatar]")).toBeNull();
  });

  it("renders command rows locally for > without a people request", async () => {
    markup();
    const api = stubPeople();
    await mount();
    type(">");
    expect(screen.getAllByRole("option")).toHaveLength(11);
    expect(optionNames()[0]).toBe("Log interaction");
    expect(statusLine()).toBe("11 commands found");
    expect(
      api.calls().filter((call) =>
        call.startsWith("GET /api/v1/search?") ||
        call === "GET /api/v1/today/recent-people"
      ),
    ).toHaveLength(0);
  });

  it("shows mode-specific empty copy when commands and people do not match", async () => {
    markup();
    stubPeople([]);
    await mount();
    type("> zzz");
    expect(screen.getByText("No commands match")).toBeTruthy();
    expect(screen.queryByText(NOTHING_MATCHES)).toBeNull();
    await search("zzz");
    await waitFor(() => expect(screen.getByText(NOTHING_MATCHES)).toBeTruthy());
    expect(screen.queryByText("No commands match")).toBeNull();
    // Empty copy is not an alert.
    expect(screen.getByText(NOTHING_MATCHES).getAttribute("role")).toBeNull();
  });

  it("filters commands case-insensitively and gates settings by role", async () => {
    markup();
    stubPeople();
    const unmount = await mount();
    type("> PREFERENCES");
    expect(optionNames()).toEqual(["Personal · Preferences"]);
    type(">");
    let labels = optionNames();
    expect(labels).toContain("Personal · Preferences");
    expect(labels).not.toContain("Workspace · General");
    expect(labels).not.toContain("Data · Import");
    expect(labels).not.toContain("Workspace actions · Workspace danger zone");

    unmount();
    sessionStorage.clear();
    markup();
    stubPeople(
      [],
      [],
      jsonResponse({
        ...session,
        member: { ...session.member, role: "admin" },
      }),
    );
    await mount();
    type(">");
    labels = optionNames();
    expect(labels).toHaveLength(20);
    expect(labels).toContain("Workspace · General");
    expect(labels).toContain("Data · Import");
    expect(labels).not.toContain("Workspace actions · Workspace danger zone");
  });

  it("closes command mode and opens quick capture for Log interaction", async () => {
    markup();
    stubPeople();
    const openQuickCapture = vi.fn();
    element("header [data-quick-capture]")
      .addEventListener("click", openQuickCapture);
    await mount();
    type("> log");
    expect(palette()).not.toBeNull();
    fireEvent.click(screen.getByRole("option", { name: "Log interaction" }));
    await waitFor(() => expect(palette()).toBeNull());
    await waitFor(() => expect(openQuickCapture).toHaveBeenCalledOnce());
  });

  it("appends matching commands only when a people query has zero matches", async () => {
    markup();
    stubPeople([]);
    const unmount = await mount();
    await search("task");
    await waitFor(() => expect(statusLine()).toBe("0 people found"));
    expect(optionNames()).toEqual([
      'Add "task" as a new person',
      "Add task",
      "Tasks",
    ]);

    unmount();
    markup();
    stubPeople([directoryPerson(adaId, "Task", "Master")]);
    await mount();
    await search("task");
    await waitFor(() => expect(statusLine()).toBe("1 person found"));
    expect(optionNames()).toEqual([
      "Task Master",
      'Add "task" as a new person',
    ]);
  });

  it("opens from Ctrl/Cmd+K, renders recent people, and returns the focus", async () => {
    markup();
    const api = stubPeople([], [
      { archived: false, id: adaId, name: "Ada Lovelace" },
      { archived: true, id: graceId, name: "Grace Hopper" },
    ]);
    await mount();
    const opener = element("#shortcut-opener");
    opener.focus();
    const shortcut = key(document, { ctrlKey: true, key: "k" });
    expect(shortcut.defaultPrevented).toBe(true);
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(2));
    expect(screen.getAllByRole("option")[0]?.textContent).toContain(
      "Ada Lovelace",
    );
    expect(screen.getAllByRole("option")[1]?.textContent).toContain(
      "Archived",
    );
    expect(statusLine()).toBe("2 people found");
    expect(field().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(field());
    expect(api.fetch).toHaveBeenCalledWith(
      "/api/v1/today/recent-people",
      expect.objectContaining({
        headers: expect.objectContaining({ "X-Workspace-Id": workspaceId }),
      }),
    );

    key(document.activeElement!, { key: "Escape" });
    await waitFor(() => expect(palette()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));

    const compactOpener = screen.getByRole("button", { name: "Find a person" });
    fireEvent.click(compactOpener);
    expect(palette()).not.toBeNull();
    expect(compactOpener.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(palette()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(compactOpener));
    expect(compactOpener.getAttribute("aria-expanded")).toBe("false");

    const commandShortcut = key(document, { key: "k", metaKey: true });
    expect(commandShortcut.defaultPrevented).toBe(true);
    expect(palette()).not.toBeNull();
    key(document, { ctrlKey: true, key: "k" });
    expect(palette()).not.toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it.each([
    ["the element that pressed Ctrl+K", true],
    ["no one, when the page itself had the focus", false],
  ])(
    "FER-01 opens at once for a Ctrl+K pressed before it mounted, and returns the focus to %s",
    async (_label, fromElement) => {
      markup();
      stubPeople([], [{ archived: false, id: adaId, name: "Ada Lovelace" }]);
      const opener = element("#shortcut-opener");
      opener.focus();
      await mountSettled(() =>
        Promise.resolve(
          mountGlobalPeopleSearch(vi.fn(), fromElement ? opener : null),
        )
      );
      expect(palette()).not.toBeNull();
      await waitFor(() =>
        expect(screen.getAllByRole("option")).toHaveLength(1)
      );
      expect(document.activeElement).toBe(field());
      key(document.activeElement!, { key: "Escape" });
      await waitFor(() => expect(palette()).toBeNull());
      if (fromElement) {
        await waitFor(() => expect(document.activeElement).toBe(opener));
      } else {
        expect(document.activeElement).not.toBe(opener);
      }
    },
  );

  it.each(
    [
      ["field", "combobox"],
      ["Search button", "button"],
    ] as const,
  )(
    "APR-008 returns the focus to the mounted %s after a Ctrl+K pressed on the static one before it mounted",
    async (_label, role) => {
      markup();
      stubPeople([], [{ archived: false, id: adaId, name: "Ada Lovelace" }]);
      const staticOpener = screen.getByRole(role, { name: "Find a person" });
      staticOpener.focus();
      await mountSettled(() =>
        Promise.resolve(mountGlobalPeopleSearch(vi.fn(), staticOpener))
      );
      expect(palette()).not.toBeNull();
      await waitFor(() =>
        expect(screen.getAllByRole("option")).toHaveLength(1)
      );
      key(document.activeElement!, { key: "Escape" });
      await waitFor(() => expect(palette()).toBeNull());
      const mounted = screen.getByRole(role, { name: "Find a person" });
      expect(mounted).not.toBe(staticOpener);
      await waitFor(() => expect(document.activeElement).toBe(mounted));
    },
  );

  it("returns the focus and an empty field to the header after typing there", async () => {
    markup();
    stubPeople([directoryPerson(adaId, "Ada", "Lovelace")]);
    await mount();
    field().focus();
    type("Ada");
    expect(palette()).not.toBeNull();
    expect(field().value).toBe("Ada");
    expect(document.activeElement).toBe(field());
    key(field(), { key: "Escape" });
    await waitFor(() => expect(palette()).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(field()));
    expect(field().value).toBe("");
    expect(field().getAttribute("aria-expanded")).toBe("false");
  });

  it("debounces one-character searches and drops superseded keystrokes", async () => {
    markup();
    const api = stubPeople([
      directoryPerson(adaId, "Ada", "Lovelace", "Countess"),
    ]);
    await mount();
    vi.useFakeTimers();
    type("A");
    expect(statusLine()).toBe("Searching");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(199);
    });
    expect(peopleRequests(api)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(peopleRequests(api)).toHaveLength(1);

    type("A ");
    type("Ad");
    type("Ada");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(peopleRequests(api)).toHaveLength(2);
    expect(peopleRequests(api).at(-1)?.url.searchParams.get("q")).toBe(
      "Ada",
    );
    vi.useRealTimers();
    await waitFor(() =>
      expect(optionNames()[0]).toBe("Ada Lovelace “Countess”")
    );
    expect(field().getAttribute("aria-expanded")).toBe("true");
  });

  it("moves the active option with the arrows, wrapping, and navigates with Enter", async () => {
    markup();
    stubPeople([
      directoryPerson(adaId, "Ada", "Lovelace"),
      directoryPerson(graceId, "Grace", "Hopper"),
    ]);
    const navigate = vi.fn();
    await mount(navigate);
    await search("a");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    const options = screen.getAllByRole("option");
    const listbox = screen.getByRole("listbox", {
      name: "Search results",
    });
    await waitFor(() =>
      expect(field().getAttribute("aria-activedescendant")).toBe(options[0]?.id)
    );
    expect(field().getAttribute("aria-controls")).toBe(listbox.id);
    expect(options[0]?.getAttribute("aria-selected")).toBe("true");

    key(field(), { key: "ArrowDown" });
    await waitFor(() =>
      expect(field().getAttribute("aria-activedescendant")).toBe(options[1]?.id)
    );
    key(field(), { key: "ArrowUp" });
    key(field(), { key: "ArrowUp" });
    await waitFor(() =>
      expect(field().getAttribute("aria-activedescendant")).toBe(options[2]?.id)
    );
    key(field(), { key: "ArrowDown" });
    await waitFor(() =>
      expect(field().getAttribute("aria-activedescendant")).toBe(options[0]?.id)
    );
    key(field(), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(`/app/people/${adaId}`);
    await waitFor(() => expect(palette()).toBeNull());
  });

  it("adds a split-name synthetic option only when there is no exact match", async () => {
    markup();
    stubPeople([]);
    const navigate = vi.fn();
    await mount(navigate);
    await search("Marie Dupont");
    const add = await screen.findByRole("option", {
      name: 'Add "Marie Dupont" as a new person',
    });
    expect(screen.getByText(NOTHING_MATCHES)).toBeTruthy();
    fireEvent.click(add);
    const destination = new URL(
      String(navigate.mock.calls[0]?.[0]),
      "https://kinship.test",
    );
    expect(destination.pathname).toBe("/app/people/new");
    expect(destination.searchParams.get("givenName")).toBe("Marie");
    expect(destination.searchParams.get("familyName")).toBe("Dupont");

    await waitFor(() => expect(palette()).toBeNull());
    await search("Prince");
    fireEvent.click(
      await screen.findByRole("option", {
        name: 'Add "Prince" as a new person',
      }),
    );
    const single = new URL(
      String(navigate.mock.calls[1]?.[0]),
      "https://kinship.test",
    );
    expect(single.searchParams.get("givenName")).toBe("Prince");
    expect(single.searchParams.has("familyName")).toBe(false);
  });

  it("opens from the header field's arrow and Enter keys", async () => {
    markup();
    stubPeople();
    await mount();
    for (const pressed of ["ArrowDown", "ArrowUp", "Enter"]) {
      const event = key(field(), { key: pressed });
      expect(event.defaultPrevented).toBe(true);
      expect(palette()).not.toBeNull();
      key(field(), { key: "Escape" });
      await waitFor(() => expect(palette()).toBeNull());
    }
    const other = key(field(), { key: "a" });
    expect(other.defaultPrevented).toBe(false);
    expect(palette()).toBeNull();
  });

  it("focuses the header field with slash except from an editable control", async () => {
    markup();
    stubPeople();
    await mount();
    const slash = key(document, { key: "/" });
    expect(slash.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field());
    for (const selector of ["#other-input", "#note", "#editor"]) {
      const editable = element(selector);
      editable.focus();
      const event = key(editable, { key: "/" });
      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(editable);
    }
    element("#shortcut-opener").focus();
    key(document.activeElement!, { ctrlKey: true, key: "/" });
    expect(document.activeElement?.id).toBe("shortcut-opener");
  });

  it("keeps unavailable search states non-alerting", async () => {
    markup();
    stubApi({
      [SESSION]: jsonResponse(session),
      "* /api/v1/*": jsonResponse(
        { code: "people_unavailable", status: 503 },
        503,
      ),
    });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    const problem = await screen.findByText(
      "Search is temporarily unavailable. Try again.",
    );
    expect(problem.getAttribute("role")).toBeNull();
    expect(statusLine()).toBe("Search is temporarily unavailable");
    await search("A");
    await waitFor(() =>
      expect(screen.getByText(
        "Search is temporarily unavailable. Try again.",
      )).toBeTruthy()
    );
    expect(statusLine()).toBe("Search is temporarily unavailable");
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("stays closed when the session is unavailable", async () => {
    markup();
    stubApi({
      "* /api/v1/*": jsonResponse(
        { code: "session_unavailable", status: 503 },
        503,
      ),
    });
    await mount();
    fireEvent.click(screen.getByRole("button", { name: "Find a person" }));
    expect(palette()).toBeNull();
    key(document, { ctrlKey: true, key: "k" });
    expect(palette()).toBeNull();
  });
});

describe("REL-039 global people search before its startup reads", () => {
  it("opens from Ctrl+K pressed before the session resolves and renders once ready", async () => {
    markup();
    const { answer, release } = gatedSession();
    stubPeople(
      [],
      [{ archived: false, id: adaId, name: "Ada Lovelace" }],
      answer,
    );
    mountNow();
    const shortcut = key(document, { ctrlKey: true, key: "k" });
    expect(shortcut.defaultPrevented).toBe(true);
    expect(palette()).not.toBeNull();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => expect(optionNames()).toEqual(["Ada Lovelace"]));
  });

  it("keeps a command query typed before the session resolves", async () => {
    markup();
    const { answer, release } = gatedSession();
    stubPeople([], [], answer);
    mountNow();
    type("> log");
    expect(palette()).not.toBeNull();
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => expect(optionNames()).toEqual(["Log interaction"]));
  });

  it("opens with a query typed into the focused field before the script mounted", async () => {
    markup();
    stubPeople();
    const staticField = element<HTMLInputElement>(
      "#global-people-search-input",
    );
    staticField.focus();
    staticField.value = "> log";
    await mount();
    expect(palette()).not.toBeNull();
    expect(field().value).toBe("> log");
    await waitFor(() => expect(optionNames()).toEqual(["Log interaction"]));
    expect(document.activeElement).toBe(field());
  });

  it("keeps the focus a reader gave the empty field before the script mounted", async () => {
    markup();
    stubPeople();
    element("#global-people-search-input").focus();
    await mount();
    expect(palette()).toBeNull();
    expect(document.activeElement).toBe(field());
  });

  it("closes an early palette and stops opening when the session is unavailable", async () => {
    markup();
    const { answer, release } = gatedSession(() =>
      jsonResponse({ code: "session_unavailable", status: 503 }, 503)
    );
    stubPeople([], [], answer);
    mountNow();
    const opener = screen.getByRole("button", { name: "Find a person" });
    fireEvent.click(opener);
    expect(palette()).not.toBeNull();
    await act(async () => {
      release();
      await Promise.resolve();
    });
    await waitFor(() => expect(palette()).toBeNull());
    fireEvent.click(opener);
    expect(palette()).toBeNull();
  });

  it("hands Log interaction to quick capture only once its opener is wired", async () => {
    markup();
    stubPeople();
    const quickCapture = element<HTMLButtonElement>(
      "header [data-quick-capture]",
    );
    quickCapture.disabled = true;
    quickCapture.dataset.interactionCaptureReady = "false";
    const openQuickCapture = vi.fn();
    quickCapture.addEventListener("click", openQuickCapture);
    await mount();
    type("> log");
    fireEvent.click(screen.getByRole("option", { name: "Log interaction" }));
    await waitFor(() => expect(palette()).toBeNull());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(openQuickCapture).not.toHaveBeenCalled();
    quickCapture.dataset.interactionCaptureReady = "true";
    quickCapture.disabled = false;
    await waitFor(() => expect(openQuickCapture).toHaveBeenCalledOnce());
  });
});

describe("SEARCH-001 workspace search groups", () => {
  const noteId = "00000000-0000-4000-8000-000000000201";
  const activityId = "00000000-0000-4000-8000-000000000202";
  const postId = "00000000-0000-4000-8000-000000000203";
  const itemId = "00000000-0000-4000-8000-000000000204";
  const taskId = "00000000-0000-4000-8000-000000000205";
  const ada = { archived: false, id: adaId, name: "Ada Lovelace" };
  const grace = { archived: true, id: graceId, name: "Grace Hopper" };
  const groups: EntityGroups = {
    activities: [{
      href: `/app/people/${adaId}?section=activities`,
      id: activityId,
      kind: "activity",
      person: ada,
      snippet: "Rowed down the river",
      title: "River walk",
    }],
    journalPosts: [{
      href: `/app/journal/${itemId}`,
      id: postId,
      kind: "journal-post",
      snippet: "A quiet river evening",
    }],
    notes: [{
      href: `/app/people/${adaId}?section=notes`,
      id: noteId,
      kind: "note",
      person: ada,
      snippet: "Loves the <b>river</b> & boats",
    }],
    tasks: [{
      href: `/app/people/${graceId}?section=tasks`,
      id: taskId,
      kind: "task",
      person: grace,
      snippet: "Book the river cruise",
      title: "Cruise",
    }],
  };

  const groupNames = () =>
    screen.getAllByRole("group").map((group) =>
      group.getAttribute("aria-labelledby")
        ? document.getElementById(group.getAttribute("aria-labelledby")!)
          ?.textContent
        : group.getAttribute("aria-label")
    );

  it("draws each group under its heading with an icon per kind and plain-text snippets", async () => {
    markup();
    stubPeople(
      [directoryPerson(adaId, "Ada", "Lovelace")],
      [],
      undefined,
      groups,
    );
    await mount();
    await search("river");
    await waitFor(() =>
      expect(statusLine()).toBe(
        "1 person, 1 note, 1 activity, 1 journal post, and 1 task found",
      )
    );
    expect(groupNames()).toEqual([
      "People",
      "Notes",
      "Activities",
      "Journal posts",
      "Tasks",
    ]);
    expect(optionNames()).toEqual([
      "Ada Lovelace",
      'Add "river" as a new person',
      "Ada Lovelace",
      "River walk",
      "Journal post",
      "Cruise",
    ]);
    const options = screen.getAllByRole("option");
    for (const option of options.slice(2)) {
      const icon = option.querySelector("svg");
      expect(icon).not.toBeNull();
      expect(icon?.closest("[aria-hidden=true]")).not.toBeNull();
    }
    const note = options[2]!;
    expect(note.textContent).toContain("Loves the <b>river</b> & boats");
    expect(note.querySelector("b")).toBeNull();
    expect(options[3]?.textContent).toContain("Ada Lovelace");
    expect(options[5]?.textContent).toContain("Grace Hopper");
    expect(options[5]?.textContent).toContain("Archived");
    expect(screen.queryByText(NOTHING_MATCHES)).toBeNull();
  });

  it("moves across groups with the arrow keys and opens the deep link with Enter", async () => {
    markup();
    stubPeople([], [], undefined, groups);
    const navigate = vi.fn();
    await mount(navigate);
    await search("river");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(5));
    const options = screen.getAllByRole("option");
    await waitFor(() =>
      expect(field().getAttribute("aria-activedescendant")).toBe(options[0]?.id)
    );
    key(field(), { key: "ArrowDown" });
    key(field(), { key: "ArrowDown" });
    key(field(), { key: "ArrowDown" });
    await waitFor(() =>
      expect(field().getAttribute("aria-activedescendant")).toBe(options[3]?.id)
    );
    key(field(), { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith(`/app/journal/${itemId}`);
    await waitFor(() => expect(palette()).toBeNull());

    await search("river");
    fireEvent.click(
      await screen.findByRole("option", { name: /Loves the/ }),
    );
    expect(navigate).toHaveBeenLastCalledWith(
      `/app/people/${adaId}?section=notes`,
    );
  });

  it("never lets a stale answer overwrite a newer query", async () => {
    markup();
    const late = deferred<Response>();
    const api = stubPeople([], [], undefined, groups);
    api.route("GET /api/v1/search?q=Ada", late.promise);
    await mount();
    await search("Ada");
    await waitFor(() => expect(peopleRequests(api)).toHaveLength(1));
    await search("river");
    await waitFor(() => expect(optionNames()).toContain("River walk"));
    await act(async () => {
      late.resolve(jsonResponse(searchBody("Ada", [
        directoryPerson(adaId, "Ada", "Lovelace"),
      ])));
      await Promise.resolve();
    });
    expect(optionNames()).toEqual([
      'Add "river" as a new person',
      "Ada Lovelace",
      "River walk",
      "Journal post",
      "Cruise",
    ]);
    expect(peopleRequests(api).at(-1)?.url.searchParams.get("limit")).toBe(
      "8",
    );
  });

  it("shows people with a quiet note when the other groups are unavailable", async () => {
    markup();
    stubPeople([directoryPerson(adaId, "Ada", "Lovelace")], [], undefined, {
      unavailable: true,
    });
    await mount();
    await search("Ada");
    await waitFor(() =>
      expect(screen.getByText("Other results are temporarily unavailable."))
        .toBeTruthy()
    );
    const note = screen.getByText(
      "Other results are temporarily unavailable.",
    );
    expect(note.getAttribute("role")).toBeNull();
    expect(optionNames()).toEqual([
      "Ada Lovelace",
      'Add "Ada" as a new person',
    ]);
    expect(statusLine()).toBe(
      "1 person found; other results are temporarily unavailable",
    );
    expect(screen.queryByText(NOTHING_MATCHES)).toBeNull();
    expect(
      screen.queryByText("Search is temporarily unavailable. Try again."),
    ).toBeNull();
  });

  it("asks for people in the member's contact sort order", async () => {
    markup();
    vi.mocked(getMemberPreferences).mockResolvedValue({
      ok: true,
      value: {
        preferences: preferences({ contactSortOrder: "family_name_asc" }),
        status: "ready",
        supportedCurrencyCodes: [],
      },
    });
    const api = stubPeople();
    await mount();
    await search("Ada");
    await waitFor(() => expect(peopleRequests(api)).toHaveLength(1));
    expect(peopleRequests(api)[0]?.url.searchParams.get("sort")).toBe(
      "family-name",
    );
  });
});

describe("SEARCH-001 highlighted matches", () => {
  /** Each option's marked text, in order; an option without a mark is "". */
  const marked = () =>
    screen.getAllByRole("option").map((option) =>
      [...option.querySelectorAll("mark")].map((mark) => mark.textContent)
        .join("|")
    );

  it.each([
    ["Pet", "Pet"],
    ["елена", "Elena"],
    ["удутф", "Elena"],
    ["ELENA P", "Elena P"],
  ])("marks what %s matched in each person's name", async (query, mark) => {
    markup();
    stubPeople([directoryPerson(adaId, "Elena", "Petrova")]);
    await mount();
    await search(query);
    await waitFor(() => expect(statusLine()).toBe("1 person found"));
    expect(optionNames()[0]).toBe("Elena Petrova");
    // The add row repeats the query; it marks nothing.
    expect(marked()).toEqual([mark, ""]);
  });

  it("marks the query's words in record labels and snippets", async () => {
    markup();
    stubPeople([], [], undefined, {
      notes: [{
        href: `/app/people/${adaId}?section=notes`,
        id: "00000000-0000-4000-8000-000000000201",
        kind: "note",
        person: { archived: false, id: adaId, name: "Ada Lovelace" },
        snippet: "Rowed down the River with Ada",
      }],
    });
    await mount();
    await search("river");
    await waitFor(() => expect(statusLine()).toBe("0 people and 1 note found"));
    const note = screen.getAllByRole("option").at(-1)!;
    expect([...note.querySelectorAll("mark")].map((mark) => mark.textContent))
      .toEqual(["River"]);
    expect(note.textContent).toContain("Rowed down the River with Ada");
  });

  it("matches and marks commands typed on the other keyboard layout", async () => {
    markup();
    stubPeople();
    await mount();
    // "settings" typed on the Russian layout.
    type("> ыуеештпы");
    expect(optionNames()).toEqual(["Settings"]);
    expect(marked()).toEqual(["Settings"]);
    type("> pref");
    expect(marked()).toEqual(["Pref"]);
  });
});
