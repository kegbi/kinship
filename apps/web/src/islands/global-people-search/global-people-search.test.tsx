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
      <input id="global-people-search-input" type="search" role="combobox" aria-label="Find a person" aria-expanded="false" placeholder="Search people…" autocomplete="off">
      <button data-global-people-search-open type="button" aria-label="Find a person" aria-expanded="false"><span>Search</span></button>
    </div>
    <header><button data-quick-capture type="button">Quick capture</button></header>
    <button id="shortcut-opener" type="button">Open shortcut</button>
    <input id="other-input">
    <textarea id="note"></textarea>
    <div id="editor" contenteditable="true" tabindex="0"></div>`);
}

const SESSION = "GET /api/v1/session";

/** The API behind the palette: a session, recent people, and a directory. */
function stubPeople(
  people: readonly (ReturnType<typeof directoryPerson> & {
    readonly avatar?: { readonly color: string };
  })[] = [],
  recent: readonly { archived: boolean; id: string; name: string }[] = [],
  sessionAnswer: Response | Promise<Response> = jsonResponse(session),
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
    "GET /api/v1/people": jsonResponse({
      lifecycle: "active",
      people,
      status: "ready",
    }),
  });
}

const peopleRequests = (api: StubbedApi) =>
  api.requests().filter(({ url }) => url.pathname === "/api/v1/people");

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
      type(query);
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
    type("Grace");
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
    type("Ada");
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
    type("Ada");
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
        call.startsWith("GET /api/v1/people?") ||
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
    expect(screen.queryByText("No people match")).toBeNull();
    type("zzz");
    await waitFor(() =>
      expect(screen.getByText("No people match")).toBeTruthy()
    );
    expect(screen.queryByText("No commands match")).toBeNull();
    // Empty copy is not an alert.
    expect(screen.getByText("No people match").getAttribute("role")).toBeNull();
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
    type("task");
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
    type("task");
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
    expect(statusLine()).toBe("Searching people");
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
    expect(peopleRequests(api).at(-1)?.url.searchParams.get("search")).toBe(
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
    type("a");
    await waitFor(() => expect(screen.getAllByRole("option")).toHaveLength(3));
    const options = screen.getAllByRole("option");
    const listbox = screen.getByRole("listbox", {
      name: "People search results",
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
    type("Marie Dupont");
    const add = await screen.findByRole("option", {
      name: 'Add "Marie Dupont" as a new person',
    });
    expect(screen.getByText("No people match")).toBeTruthy();
    fireEvent.click(add);
    const destination = new URL(
      String(navigate.mock.calls[0]?.[0]),
      "https://kinship.test",
    );
    expect(destination.pathname).toBe("/app/people/new");
    expect(destination.searchParams.get("givenName")).toBe("Marie");
    expect(destination.searchParams.get("familyName")).toBe("Dupont");

    await waitFor(() => expect(palette()).toBeNull());
    type("Prince");
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
      "People search is temporarily unavailable. Try again.",
    );
    expect(problem.getAttribute("role")).toBeNull();
    expect(statusLine()).toBe("People search is temporarily unavailable");
    type("A");
    await waitFor(() =>
      expect(screen.getByText(
        "People search is temporarily unavailable. Try again.",
      )).toBeTruthy()
    );
    expect(statusLine()).toBe("People search is temporarily unavailable");
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
