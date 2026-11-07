// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceSessionResolution } from "../../../lib/workspace-context.ts";

/**
 * Each island module counts its own evaluation, so a test can tell whether
 * the shell imported it at all, and records the calls to its mount.
 */
const islands = vi.hoisted(() => ({
  imported: { bell: 0, capture: 0, search: 0 },
  mountBell: vi.fn((..._args: unknown[]) => () => undefined),
  mountCapture: vi.fn((..._args: unknown[]) => () => undefined),
  mountSearch: vi.fn((..._args: unknown[]) => () => undefined),
  notifications: vi.fn(),
  session: vi.fn(),
}));
vi.mock("../../../lib/workspace-context.ts", async (original) => ({
  ...await original<typeof import("../../../lib/workspace-context.ts")>(),
  onSessionRevalidated: vi.fn(),
  resolveWorkspaceSession: islands.session,
}));
vi.mock(
  "../../../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<
      typeof import("../../../../../../packages/contracts/generated/auth-client.ts")
    >(),
    getMemberPreferences: vi.fn().mockResolvedValue({ ok: false }),
    listNotifications: islands.notifications,
  }),
);

import { workspaceSession } from "../../../testing/fixtures.ts";
import { drawShell, element } from "../../../testing/render.tsx";
import { ACCESS_TEMPLATES } from "../../../testing/shell.ts";
import type { ShellIslandLoaders } from "./shell-islands.ts";

/**
 * The layout script's entry, imported afresh for every test with freshly
 * counted island modules, so an island the shell imports statically or
 * imported in an earlier test is counted too.
 */
let stop = (): void => undefined;

async function startApplicationShell(
  loaders?: ShellIslandLoaders,
): Promise<void> {
  vi.resetModules();
  vi.doMock("../../../islands/global-people-search/mount.tsx", () => {
    islands.imported.search += 1;
    return { mountGlobalPeopleSearch: islands.mountSearch };
  });
  vi.doMock("../../interactions/mount.tsx", () => {
    islands.imported.capture += 1;
    return { mountQuickCapture: islands.mountCapture };
  });
  vi.doMock("../notifications/notification-bell.tsx", () => {
    islands.imported.bell += 1;
    return { mountNotificationBell: islands.mountBell };
  });
  const shell = await import("./shell-islands.ts");
  stop = await shell.startApplicationShell(loaders);
}

/** The parts of ApplicationLayout.astro the shell and its islands use. */
function markup(): void {
  drawShell(`
    <section id="access-state" tabindex="-1"></section>
    ${ACCESS_TEMPLATES}
    <div id="protected-shell" hidden>
      <header>
        <div class="global-search" data-global-people-search>
          <input id="global-people-search-input" type="search" role="combobox" aria-label="Find a person" />
          <button data-global-people-search-open type="button" aria-label="Find a person">Search</button>
        </div>
        <button data-quick-capture data-interaction-capture-ready="false" type="button" aria-label="Quick capture" disabled>Quick capture</button>
        <div class="notification-bell" data-notification-bell><button class="notification-bell-button" type="button" aria-label="Notifications" disabled><span class="notification-bell-badge" aria-hidden="true" hidden></span></button></div>
        <select id="workspace-switcher"></select>
        <div id="workspace-switcher-container"></div>
        <button id="member-sign-out" type="button">Sign out</button>
      </header>
      <main><a href="/app/people">People</a></main>
      <div data-quick-capture-root></div>
    </div>`);
}

const session = workspaceSession({ member: { id: "member", role: "owner" } });

function ready(role: "member" | "owner" = "owner"): WorkspaceSessionResolution {
  return {
    session: workspaceSession({ member: { id: "member", role } }),
    status: "ready",
  };
}

/** Lets any import or idle callback the shell started run to its end. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** Every intent a member could show toward the shell's three controls. */
function touchEverything(): void {
  const field = element("#global-people-search-input");
  for (const type of ["pointerenter", "focusin", "keydown"]) {
    field.dispatchEvent(new Event(type, { bubbles: true }));
  }
  document.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }),
  );
  element("[data-global-people-search-open]").click();
  element("[data-quick-capture]").click();
  element(".notification-bell-button").click();
}

/** Loaders that answer the island mocks, with `overrides` in their place. */
function loaders(
  overrides: Partial<ShellIslandLoaders> = {},
): ShellIslandLoaders {
  return {
    bell: () => Promise.resolve({ mountNotificationBell: islands.mountBell }),
    capture: () => Promise.resolve({ mountQuickCapture: islands.mountCapture }),
    search: () =>
      Promise.resolve({ mountGlobalPeopleSearch: islands.mountSearch }),
    ...overrides,
  };
}

beforeEach(() => {
  islands.imported.bell = 0;
  islands.imported.capture = 0;
  islands.imported.search = 0;
  islands.mountBell.mockReset().mockReturnValue(() => undefined);
  islands.mountCapture.mockReset().mockReturnValue(() => undefined);
  islands.mountSearch.mockReset().mockReturnValue(() => undefined);
  islands.notifications.mockReset();
  islands.notifications.mockResolvedValue({
    ok: true,
    value: { items: [], status: "ready", unreadCount: 0 },
  });
  islands.session.mockReset();
  islands.session.mockResolvedValue(ready());
  document.body.dataset.pageId = "settings.index";
});

afterEach(() => {
  stop();
  sessionStorage.clear();
});

describe("FER-01 the shell's islands wait for a signed-in member", () => {
  it.each([
    ["signed out", { status: "access-lost" } as const],
    ["unavailable", { status: "unavailable" } as const],
  ])(
    "never imports an island module when the session is %s",
    async (_label, resolution) => {
      markup();
      islands.session.mockResolvedValue(resolution);
      await startApplicationShell();
      touchEverything();
      await settle();
      expect(islands.imported).toEqual({ bell: 0, capture: 0, search: 0 });
      expect(islands.notifications).not.toHaveBeenCalled();
      expect(element<HTMLButtonElement>("[data-quick-capture]").disabled)
        .toBe(true);
    },
  );

  it("never imports an island module on a page the member may not enter", async () => {
    markup();
    document.body.dataset.pageId = "settings.members";
    islands.session.mockResolvedValue(ready("member"));
    await startApplicationShell();
    touchEverything();
    await settle();
    expect(islands.imported).toEqual({ bell: 0, capture: 0, search: 0 });
  });

  it("imports nothing for a ready member but the palette, which it only prefetches at idle", async () => {
    markup();
    await startApplicationShell();
    expect(islands.imported).toEqual({ bell: 0, capture: 0, search: 0 });
    await vi.waitFor(() => expect(islands.imported.search).toBe(1));
    await settle();
    expect(islands.imported).toEqual({ bell: 0, capture: 0, search: 1 });
    expect(islands.mountSearch).not.toHaveBeenCalled();
    expect(islands.notifications).toHaveBeenCalledWith(
      undefined,
      session.workspace.id,
    );
  });

  it("imports each island from its own module when it is first used", async () => {
    markup();
    await startApplicationShell();
    element("#global-people-search-input").dispatchEvent(
      new Event("focusin", { bubbles: true }),
    );
    await vi.waitFor(() => expect(islands.mountSearch).toHaveBeenCalled());
    expect(islands.imported).toEqual({ bell: 0, capture: 0, search: 1 });
    element("[data-quick-capture]").click();
    await vi.waitFor(() => expect(islands.mountCapture).toHaveBeenCalled());
    expect(islands.imported).toEqual({ bell: 0, capture: 1, search: 1 });
    element(".notification-bell-button").click();
    await vi.waitFor(() => expect(islands.mountBell).toHaveBeenCalled());
    expect(islands.imported).toEqual({ bell: 1, capture: 1, search: 1 });
  });
});

describe("FER-01 the people palette mounts on first intent", () => {
  it.each(["pointerenter", "focusin", "keydown"])(
    "mounts once on the first %s on the header's search",
    async (type) => {
      markup();
      await startApplicationShell(loaders());
      const field = element("#global-people-search-input");
      field.dispatchEvent(new Event(type, { bubbles: true }));
      field.dispatchEvent(new Event(type, { bubbles: true }));
      await vi.waitFor(() =>
        expect(islands.mountSearch).toHaveBeenCalledWith(undefined, undefined)
      );
      field.dispatchEvent(new Event("pointerenter", { bubbles: true }));
      await settle();
      expect(islands.mountSearch).toHaveBeenCalledTimes(1);
    },
  );

  it("opens for whoever pressed Ctrl+K before it loaded", async () => {
    markup();
    await startApplicationShell(loaders());
    const link = element("main a");
    link.focus();
    const press = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "K",
      metaKey: true,
    });
    link.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(islands.mountSearch).toHaveBeenCalledWith(undefined, link)
    );
  });

  it("opens with no one to return to when Ctrl+K came from the page itself", async () => {
    markup();
    await startApplicationShell(loaders());
    document.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "k" }),
    );
    await vi.waitFor(() =>
      expect(islands.mountSearch).toHaveBeenCalledWith(undefined, null)
    );
  });

  it("moves the focus to the field on /, which mounts the palette", async () => {
    markup();
    await startApplicationShell(loaders());
    const press = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "/",
    });
    document.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element("#global-people-search-input"));
    await vi.waitFor(() =>
      expect(islands.mountSearch).toHaveBeenCalledWith(undefined, undefined)
    );
  });

  it("leaves other keys alone", async () => {
    markup();
    await startApplicationShell(loaders());
    const press = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "j",
    });
    document.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
    await settle();
    expect(islands.mountSearch).not.toHaveBeenCalled();
  });

  it("replays a click on its Search button on the mounted palette's button", async () => {
    markup();
    const clicked = vi.fn();
    islands.mountSearch.mockImplementation(() => {
      const container = element("[data-global-people-search]");
      container.innerHTML =
        '<button data-global-people-search-open type="button">Search</button>';
      container.querySelector("button")!.addEventListener("click", clicked);
      return () => undefined;
    });
    await startApplicationShell(loaders());
    element("main a").addEventListener(
      "click",
      (event) => event.preventDefault(),
    );
    element("main a").click();
    element("[data-global-people-search-open]").click();
    await vi.waitFor(() => expect(clicked).toHaveBeenCalledTimes(1));
    expect(islands.mountSearch).toHaveBeenCalledTimes(1);
  });

  it("tries again on the next intent when its module could not load", async () => {
    markup();
    const search = vi.fn<ShellIslandLoaders["search"]>()
      .mockRejectedValue(new Error("offline"));
    await startApplicationShell(loaders({ search }));
    const field = element("#global-people-search-input");
    field.dispatchEvent(new Event("focusin", { bubbles: true }));
    await settle();
    expect(islands.mountSearch).not.toHaveBeenCalled();
    search.mockResolvedValue({ mountGlobalPeopleSearch: islands.mountSearch });
    field.dispatchEvent(new Event("focusin", { bubbles: true }));
    await vi.waitFor(() => expect(islands.mountSearch).toHaveBeenCalled());
  });

  it("does nothing on a page without the header's search", async () => {
    markup();
    element("[data-global-people-search]").remove();
    const search = vi.fn<ShellIslandLoaders["search"]>();
    await startApplicationShell(loaders({ search }));
    await settle();
    expect(search).not.toHaveBeenCalled();
  });
});

describe("FER-01 Quick capture loads on the first click", () => {
  it("enables every opener a ready member can see, including later ones", async () => {
    markup();
    await startApplicationShell(loaders());
    const header = element<HTMLButtonElement>("[data-quick-capture]");
    expect(header.disabled).toBe(false);
    expect(header.dataset.interactionCaptureReady).toBe("true");
    const later = document.createElement("button");
    later.dataset.quickCapture = "";
    later.dataset.interactionCaptureReady = "false";
    later.disabled = true;
    later.hidden = true;
    element("main").append(later);
    await vi.waitFor(() =>
      expect(later.dataset.interactionCaptureReady).toBe("true")
    );
    expect(later.disabled).toBe(true);
    later.hidden = false;
    await vi.waitFor(() => expect(later.disabled).toBe(false));
  });

  it("imports the island on the first click and opens it from that opener", async () => {
    markup();
    let release!: () => void;
    const capture = vi.fn(() =>
      new Promise<{ mountQuickCapture: typeof islands.mountCapture }>(
        (resolve) => {
          release = () => resolve({ mountQuickCapture: islands.mountCapture });
        },
      )
    );
    await startApplicationShell(loaders({ capture }));
    await settle();
    expect(capture).not.toHaveBeenCalled();
    const opener = element<HTMLButtonElement>("[data-quick-capture]");
    opener.click();
    expect(opener.getAttribute("aria-busy")).toBe("true");
    opener.click();
    release();
    await vi.waitFor(() =>
      expect(islands.mountCapture).toHaveBeenCalledWith(opener)
    );
    await vi.waitFor(() =>
      expect(opener.hasAttribute("aria-busy")).toBe(false)
    );
    opener.click();
    await settle();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(islands.mountCapture).toHaveBeenCalledTimes(1);
  });

  it("loads on Enter or Space even when a surface keeps the key from becoming a click", async () => {
    markup();
    const capture = vi.fn<ShellIslandLoaders["capture"]>()
      .mockResolvedValue({ mountQuickCapture: islands.mountCapture });
    await startApplicationShell(loaders({ capture }));
    const opener = element<HTMLButtonElement>("[data-quick-capture]");
    for (const [key, repeat] of [["a", false], ["Enter", true]] as const) {
      const ignored = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        repeat,
      });
      opener.dispatchEvent(ignored);
      expect(ignored.defaultPrevented).toBe(key === "Enter");
    }
    element("main a").dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect(capture).not.toHaveBeenCalled();
    const press = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: " ",
    });
    opener.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(true);
    await vi.waitFor(() =>
      expect(islands.mountCapture).toHaveBeenCalledWith(opener)
    );
    opener.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    await settle();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it("ignores clicks that are not on an enabled opener", async () => {
    markup();
    const capture = vi.fn<ShellIslandLoaders["capture"]>();
    await startApplicationShell(loaders({ capture }));
    element("main a").addEventListener(
      "click",
      (event) => event.preventDefault(),
    );
    element("main a").click();
    const opener = element<HTMLButtonElement>("[data-quick-capture]");
    opener.hidden = true;
    await vi.waitFor(() => expect(opener.disabled).toBe(true));
    opener.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await settle();
    expect(capture).not.toHaveBeenCalled();
  });

  it("lets the next click try again when the island could not load", async () => {
    markup();
    const capture = vi.fn<ShellIslandLoaders["capture"]>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ mountQuickCapture: islands.mountCapture });
    await startApplicationShell(loaders({ capture }));
    const opener = element<HTMLButtonElement>("[data-quick-capture]");
    opener.click();
    await vi.waitFor(() =>
      expect(opener.hasAttribute("aria-busy")).toBe(false)
    );
    expect(islands.mountCapture).not.toHaveBeenCalled();
    opener.click();
    await vi.waitFor(() =>
      expect(islands.mountCapture).toHaveBeenCalledWith(opener)
    );
  });
});
