// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  idle: [] as (() => void)[],
  notifications: vi.fn(),
}));
vi.mock("../../../lib/idle.ts", () => ({
  whenIdle: (task: () => void) => mocks.idle.push(task),
}));
vi.mock(
  "../../../../../../packages/contracts/generated/auth-client.ts",
  async (original) => ({
    ...await original<
      typeof import("../../../../../../packages/contracts/generated/auth-client.ts")
    >(),
    listNotifications: mocks.notifications,
  }),
);

import { deferred } from "../../../testing/api.ts";
import { drawShell, element } from "../../../testing/render.tsx";
import {
  mountNotificationCount,
  type NotificationPanelModule,
} from "./notification-count.ts";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";

/** The header slot as ApplicationLayout.astro draws it. */
function markup(): void {
  drawShell(
    `<div class="notification-bell" data-notification-bell><button class="notification-bell-button" type="button" aria-label="Notifications" disabled><span class="desktop-action-label">Notifications</span><span class="notification-bell-badge" aria-hidden="true" hidden></span></button></div>`,
  );
}

const page = (unreadCount: number) => ({
  items: [],
  status: "ready" as const,
  unreadCount,
});

const answer = (unreadCount: number) => ({
  ok: true,
  value: page(unreadCount),
});

const bell = () => element<HTMLButtonElement>(".notification-bell-button");
const badge = () => element(".notification-bell-badge");

/** Runs the reads the count left for an idle moment. */
async function idle(): Promise<void> {
  for (const task of mocks.idle.splice(0)) task();
  await vi.waitFor(() => undefined);
}

function panel(): NotificationPanelModule & {
  mountNotificationBell: ReturnType<typeof vi.fn>;
} {
  return { mountNotificationBell: vi.fn(() => () => undefined) };
}

let stop = (): void => undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  mocks.idle.length = 0;
  mocks.notifications.mockReset();
});

afterEach(() => {
  stop();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("FER-01 the bell's count before its panel loads", () => {
  it("enables the bell at once and reads the count when the browser is idle", async () => {
    markup();
    mocks.notifications.mockResolvedValue(answer(3));
    stop = mountNotificationCount(WORKSPACE, () => Promise.resolve(panel()));
    expect(bell().disabled).toBe(false);
    expect(mocks.notifications).not.toHaveBeenCalled();
    await idle();
    expect(mocks.notifications).toHaveBeenCalledWith(undefined, WORKSPACE);
    await vi.waitFor(() =>
      expect(bell().getAttribute("aria-label")).toBe("Notifications, 3 unread")
    );
    expect(badge().textContent).toBe("3");
    expect(badge().hidden).toBe(false);
  });

  it.each([
    [0, "Notifications", ""],
    [100, "Notifications, more than 99 unread", "99+"],
  ])(
    "shows %i unread as %s",
    async (unread, label, text) => {
      markup();
      mocks.notifications.mockResolvedValue(answer(unread));
      stop = mountNotificationCount(WORKSPACE, () => Promise.resolve(panel()));
      await idle();
      await vi.waitFor(() =>
        expect(bell().getAttribute("aria-label")).toBe(label)
      );
      expect(badge().textContent).toBe(text);
      expect(badge().hidden).toBe(text === "");
    },
  );

  it("reads again each refresh while the page is visible, and not while it is hidden", async () => {
    markup();
    mocks.notifications.mockResolvedValue(answer(1));
    stop = mountNotificationCount(
      WORKSPACE,
      () => Promise.resolve(panel()),
      1_000,
    );
    await idle();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.notifications).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocks.notifications).toHaveBeenCalledTimes(2);
  });

  it("keeps only the latest read's answer, and the last count when a read fails", async () => {
    markup();
    const older = deferred<ReturnType<typeof answer>>();
    mocks.notifications
      .mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(answer(2))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: false });
    stop = mountNotificationCount(
      WORKSPACE,
      () => Promise.resolve(panel()),
      1_000,
    );
    await idle();
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.waitFor(() =>
      expect(bell().getAttribute("aria-label")).toBe("Notifications, 2 unread")
    );
    older.resolve(answer(7));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.notifications).toHaveBeenCalledTimes(4);
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 2 unread");
    expect(badge().textContent).toBe("2");
  });

  it("hands the bell to its island on the first click and stops reading", async () => {
    markup();
    mocks.notifications.mockResolvedValueOnce(answer(4));
    const inFlight = deferred<ReturnType<typeof answer>>();
    mocks.notifications.mockReturnValueOnce(inFlight.promise);
    const island = panel();
    const load = vi.fn(() => Promise.resolve(island));
    stop = mountNotificationCount(WORKSPACE, load, 1_000);
    await idle();
    await vi.waitFor(() =>
      expect(bell().getAttribute("aria-label")).toBe("Notifications, 4 unread")
    );
    await vi.advanceTimersByTimeAsync(1_000);
    bell().click();
    expect(bell().getAttribute("aria-busy")).toBe("true");
    bell().click();
    await vi.waitFor(() =>
      expect(island.mountNotificationBell).toHaveBeenCalledWith(document, {
        initialPage: page(4),
        openOnReady: true,
      })
    );
    expect(load).toHaveBeenCalledTimes(1);
    inFlight.resolve(answer(9));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.notifications).toHaveBeenCalledTimes(2);
    expect(bell().getAttribute("aria-label")).toBe("Notifications, 4 unread");
  });

  it("hands over with no page when the bell is clicked before its first read", async () => {
    markup();
    const island = panel();
    stop = mountNotificationCount(WORKSPACE, () => Promise.resolve(island));
    bell().click();
    await vi.waitFor(() =>
      expect(island.mountNotificationBell).toHaveBeenCalledWith(document, {
        initialPage: undefined,
        openOnReady: true,
      })
    );
    await idle();
    expect(mocks.notifications).not.toHaveBeenCalled();
  });

  it("keeps the bell and tries again on the next click when the island cannot load", async () => {
    markup();
    mocks.notifications.mockResolvedValue(answer(1));
    const island = panel();
    const load = vi.fn<() => Promise<NotificationPanelModule>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(island);
    stop = mountNotificationCount(WORKSPACE, load, 1_000);
    bell().click();
    await vi.waitFor(() =>
      expect(bell().hasAttribute("aria-busy")).toBe(false)
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.notifications).toHaveBeenCalledTimes(1);
    bell().click();
    await vi.waitFor(() =>
      expect(island.mountNotificationBell).toHaveBeenCalled()
    );
  });

  it("stays stopped when the island fails to load after the count was stopped", async () => {
    markup();
    const failed = deferred<NotificationPanelModule>();
    stop = mountNotificationCount(WORKSPACE, () => failed.promise, 1_000);
    bell().click();
    stop();
    failed.reject(new Error("offline"));
    await vi.waitFor(() =>
      expect(bell().hasAttribute("aria-busy")).toBe(false)
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mocks.notifications).not.toHaveBeenCalled();
  });

  it("does nothing on a page without the bell", async () => {
    drawShell("<header></header>");
    stop = mountNotificationCount(WORKSPACE, () => Promise.resolve(panel()));
    await idle();
    expect(mocks.notifications).not.toHaveBeenCalled();
  });
});
