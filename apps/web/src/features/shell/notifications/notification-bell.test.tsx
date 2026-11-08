// @vitest-environment happy-dom

import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
} from "../../../testing/api.ts";
import { ids, workspaceSession } from "../../../testing/fixtures.ts";
import { drawShell, element, mountSettled } from "../../../testing/render.tsx";
import type { NotificationsPage } from "../../../../../../packages/contracts/generated/auth-client.ts";
import { mountNotificationBell } from "./notification-bell.tsx";

const SESSION = "GET /api/v1/session";
const FEED = "GET /api/v1/notifications";
const UI_STATE = "PATCH /api/v1/member/ui-state";
const personId = ids.person;

afterEach(() => {
  vi.useRealTimers();
  sessionStorage.clear();
});

/**
 * Puts the bell's refresh interval on a fake clock, so a test decides when
 * each refresh runs however slowly the machine runs it (REL-087). Timeouts
 * stay real for Testing Library's waits.
 */
const fakeInterval = () =>
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });

/** Lets `ms` of the fake clock pass inside `act`. */
const elapse = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

const item = (index: number, unread: boolean) => ({
  href: `/app/people/${personId}?section=reminders`,
  id: `00000000-0000-4000-8000-00000000000${index}`,
  kind: "reminder",
  occurredAt: `2026-09-28T1${index}:00:00.000Z`,
  person: { archived: false, id: personId, name: "Ada Lovelace" },
  title: `Call Ada ${index}`,
  unread,
});

const feed = (items: readonly unknown[], unreadCount: number) =>
  jsonResponse({ items, status: "ready", unreadCount });

/** The header slot as ApplicationLayout.astro draws it. */
function markup(): void {
  drawShell(`
    <header>
      <div class="notification-bell" data-notification-bell>
        <button type="button" aria-label="Notifications" disabled>Notifications</button>
      </div>
      <button id="elsewhere" type="button">Elsewhere</button>
    </header>`);
}

const mount = (refreshMs?: number) =>
  mountSettled(() =>
    Promise.resolve(
      mountNotificationBell(
        document,
        refreshMs === undefined ? {} : { refreshMs },
      ),
    )
  );

const bell = () =>
  screen.getByRole("button", { name: /^Notifications/ }) as HTMLButtonElement;

describe("TODAY-002 notification bell", () => {
  it("shows the unread count, opens the list, and marks everything read", async () => {
    markup();
    const api = stubApi({
      [FEED]: [
        feed([item(2, true), item(1, false)], 1),
        feed([item(2, true), item(1, false)], 1),
        feed([item(2, false), item(1, false)], 0),
      ],
      [SESSION]: jsonResponse(workspaceSession()),
      [UI_STATE]: jsonResponse({
        status: "ready",
        uiState: { notificationsReadThrough: "2026-09-28T12:00:00.000Z" },
      }),
    });
    await mount();
    await waitFor(() =>
      expect(bell().getAttribute("aria-label")).toBe(
        "Notifications, 1 unread",
      )
    );
    expect(element(".notification-bell-badge").textContent).toBe("1");
    expect(
      element("[data-notification-bell]").hasAttribute("data-island-ready"),
    )
      .toBe(true);
    const user = userEvent.setup();
    await user.click(bell());
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    const list = await within(panel).findByRole("list", {
      name: "Recent notifications",
    });
    const links = within(list).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      `/app/people/${personId}?section=reminders`,
      `/app/people/${personId}?section=reminders`,
    ]);
    expect(links[0]!.textContent).toContain("Unread:");
    expect(links[0]!.textContent).toContain("Call Ada 2");
    expect(links[1]!.textContent).not.toContain("Unread:");
    await expectNoAxeViolations(panel);
    await user.click(
      within(panel).getByRole("button", { name: "Mark all read" }),
    );
    await waitFor(() =>
      expect(bell().getAttribute("aria-label")).toBe("Notifications")
    );
    expect(document.querySelector(".notification-bell-badge")).toBeNull();
    expect(within(panel).getByRole("status").textContent).toBe(
      "All notifications marked read.",
    );
    expect(
      within(panel).getByRole("button", { name: "Mark all read" }),
    ).toHaveProperty("disabled", true);
    expect(document.activeElement, "focus leaves the disabled button").toBe(
      within(panel).getByRole("heading", { name: "Notifications" }),
    );
    const saved = api.requests().find((request) => request.method === "PATCH");
    expect(saved?.body).toEqual({
      notificationsReadThrough: "2026-09-28T12:00:00.000Z",
    });
    expect(saved?.headers.get("X-Workspace-Id")).toBe(ids.workspace);
    await waitFor(() =>
      expect(
        api.requests().filter((request) =>
          request.url.pathname === "/api/v1/notifications"
        ),
        "one authoritative read follows the mark",
      ).toHaveLength(3)
    );
  });

  it("closes on Escape and hands focus back to the bell", async () => {
    markup();
    stubApi({
      [FEED]: feed([], 0),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    await waitFor(() => expect(bell().disabled).toBe(false));
    const user = userEvent.setup();
    await user.click(bell());
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    expect(panel.textContent).toContain("No notifications yet.");
    expect(
      within(panel).getByRole("button", { name: "Mark all read" }),
    ).toHaveProperty("disabled", true);
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Notifications" }))
        .toBeNull()
    );
    expect(document.activeElement).toBe(bell());
  });

  it("bounds the badge at 99+ and says so in the name", async () => {
    markup();
    stubApi({
      [FEED]: feed([item(1, true)], 100),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    await mount();
    await waitFor(() =>
      expect(bell().getAttribute("aria-label")).toBe(
        "Notifications, more than 99 unread",
      )
    );
    expect(element(".notification-bell-badge").textContent).toBe("99+");
  });

  it("offers a retry when the list cannot be read, and keeps a failed mark's count", async () => {
    markup();
    stubApi({
      [FEED]: [
        problemResponse(503, { code: "notifications_unavailable" }),
        problemResponse(503, { code: "notifications_unavailable" }),
        feed([item(1, true)], 1),
        feed([item(1, true)], 1),
      ],
      [SESSION]: jsonResponse(workspaceSession()),
      [UI_STATE]: problemResponse(503, {
        code: "member_ui_state_unavailable",
        detail: "Your member UI state could not be saved.",
      }),
    });
    await mount();
    await waitFor(() => expect(bell().disabled).toBe(false));
    const user = userEvent.setup();
    await user.click(bell());
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    const alert = await within(panel).findByRole("alert");
    expect(alert.textContent).toContain("Notifications could not be loaded.");
    await user.click(within(alert).getByRole("button", { name: "Try again" }));
    await within(panel).findByRole("list", { name: "Recent notifications" });
    await user.click(
      within(panel).getByRole("button", { name: "Mark all read" }),
    );
    await waitFor(() =>
      expect(within(panel).getByRole("status").textContent).toBe(
        "Your member UI state could not be saved.",
      )
    );
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 1 unread");
  });

  it("refreshes the badge on its interval through one slot", async () => {
    markup();
    fakeInterval();
    const late = deferred<Response>();
    const api = stubApi({
      [FEED]: [late.promise, feed([item(1, true)], 1), feed([], 0)],
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const reads = () =>
      api.requests().filter((request) =>
        request.url.pathname === "/api/v1/notifications"
      );
    await mount(40);
    await waitFor(() => expect(reads()).toHaveLength(1));
    // A poll while the first read is still on the wire joins it (AUD-F1, D7):
    // no second request, and the one answer settles both.
    await elapse(40);
    expect(reads()).toHaveLength(1);
    await act(async () => {
      late.resolve(feed([item(1, true), item(2, true)], 2));
      await late.promise;
    });
    await waitFor(() =>
      expect(bell().getAttribute("aria-label")).toBe(
        "Notifications, 2 unread",
      )
    );
    // Once it settled, each poll is a new request, and the latest lands.
    await elapse(40);
    await waitFor(() =>
      expect(bell().getAttribute("aria-label")).toBe(
        "Notifications, 1 unread",
      )
    );
    expect(element(".notification-bell-badge").textContent).toBe("1");
    await elapse(40);
    await waitFor(() =>
      expect(bell().getAttribute("aria-label")).toBe("Notifications")
    );
    expect(reads()).toHaveLength(3);
  });

  it("stays out of a page whose session is gone", async () => {
    markup();
    const api = stubApi({
      "POST /api/v1/application-entry": problemResponse(409, {
        code: "entry_handoff_invalid",
      }),
      [SESSION]: problemResponse(401, { code: "authentication_required" }),
    });
    await mount();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^Notifications/ }))
        .toBeNull()
    );
    expect(api.calls()).not.toContain("GET /api/v1/notifications");
  });
});

describe("TODAY-002 notification bell edges", () => {
  it("skips a refresh while the page is hidden", async () => {
    markup();
    const api = stubApi({
      [FEED]: feed([], 0),
      [SESSION]: jsonResponse(workspaceSession()),
    });
    const visibility = Object.getOwnPropertyDescriptor(
      Document.prototype,
      "visibilityState",
    );
    let hidden = true;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => hidden ? "hidden" : "visible",
    });
    const reads = () =>
      api.requests().filter((request) =>
        request.url.pathname === "/api/v1/notifications"
      );
    try {
      fakeInterval();
      await mount(20);
      await waitFor(() => expect(bell().disabled).toBe(false));
      await elapse(120);
      expect(reads(), "only the first read runs while hidden").toHaveLength(1);
      hidden = false;
      await elapse(20);
      await waitFor(() =>
        expect(reads(), "the next tick reads once it is visible")
          .toHaveLength(2)
      );
    } finally {
      delete (document as unknown as Record<string, unknown>).visibilityState;
      if (visibility) {
        Object.defineProperty(
          Document.prototype,
          "visibilityState",
          visibility,
        );
      }
    }
  });

  it("keeps the bell waiting when the session is unavailable", async () => {
    markup();
    const api = stubApi({
      [SESSION]: problemResponse(503, { code: "session_unavailable" }),
    });
    await mount();
    await waitFor(() => expect(api.calls()).toContain("GET /api/v1/session"));
    expect(bell().disabled).toBe(true);
    expect(api.calls()).not.toContain("GET /api/v1/notifications");
  });

  it("says so when marking read gets no answer", async () => {
    markup();
    stubApi({
      [FEED]: feed([item(1, true)], 1),
      [SESSION]: jsonResponse(workspaceSession()),
      [UI_STATE]: () => Promise.reject(new TypeError("Failed to fetch")),
    });
    await mount();
    await waitFor(() => expect(bell().disabled).toBe(false));
    const user = userEvent.setup();
    await user.click(bell());
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    await within(panel).findByRole("list", { name: "Recent notifications" });
    await user.click(
      within(panel).getByRole("button", { name: "Mark all read" }),
    );
    await waitFor(() =>
      expect(within(panel).getByRole("status").textContent).toBe(
        "Notifications could not be marked read. Try again.",
      )
    );
  });

  it("mounts nothing where the layout drew no bell", () => {
    drawShell("<header></header>");
    const unmount = mountNotificationBell();
    expect(document.querySelector("[data-island]")).toBeNull();
    unmount();
  });
});

describe("FER-01 the bell loaded by its first click", () => {
  it("shows the count it was handed, opens once the session is known, and hands focus back to the bell", async () => {
    markup();
    const session = deferred<Response>();
    stubApi({
      [FEED]: feed([item(2, true)], 1),
      [SESSION]: session.promise,
    });
    await mountSettled(() =>
      Promise.resolve(
        mountNotificationBell(document, {
          initialPage: {
            items: [item(2, true)],
            status: "ready",
            unreadCount: 1,
          } as NotificationsPage,
          openOnReady: true,
        }),
      )
    );
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 1 unread");
    expect(element(".notification-bell-badge").textContent).toBe("1");
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await Promise.resolve();
    });
    const panel = await screen.findByRole("dialog", { name: "Notifications" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(panel).getByRole("heading", { name: "Notifications" }),
      )
    );
    expect(within(panel).getAllByRole("link")).toHaveLength(1);
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Notifications" }))
        .toBeNull()
    );
    expect(document.activeElement).toBe(bell());
  });

  it("stays closed when the session never becomes ready", async () => {
    markup();
    stubApi({
      [SESSION]: problemResponse(503),
      "POST /api/v1/application-entry": problemResponse(503),
    });
    await mountSettled(() =>
      Promise.resolve(mountNotificationBell(document, { openOnReady: true }))
    );
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(screen.queryByRole("dialog", { name: "Notifications" })).toBeNull();
  });
});

describe("TODAY-002 notification bell before the session", () => {
  it("does not read on its interval until the session resolves", async () => {
    markup();
    const session = deferred<Response>();
    const api = stubApi({
      [FEED]: feed([], 0),
      [SESSION]: session.promise,
    });
    fakeInterval();
    await mount(20);
    await elapse(100);
    expect(api.calls()).not.toContain("GET /api/v1/notifications");
    await act(async () => {
      session.resolve(jsonResponse(workspaceSession()));
      await Promise.resolve();
    });
    await waitFor(() => expect(bell().disabled).toBe(false));
  });
});
