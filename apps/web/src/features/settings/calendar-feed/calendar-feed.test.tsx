// @vitest-environment happy-dom
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { expectNoAxeViolations } from "../../../testing/a11y.ts";
import {
  deferred,
  jsonResponse,
  problemResponse,
  stubApi,
  unreachable,
} from "../../../testing/api.ts";
import {
  ids,
  preferences,
  workspaceSession,
} from "../../../testing/fixtures.ts";
import { buttonVariants } from "@/components/ui/variants.ts";
import { drawShell, element, mountSettled } from "../../../testing/render.tsx";
import { CALENDAR_FEED_ISLAND, mountCalendarFeed } from "./calendar-feed.tsx";

const SESSION = "GET /api/v1/session";
const PREFERENCES = "GET /api/v1/settings/preferences";
const READ = "GET /api/v1/settings/calendar-feed";
const CREATE = "POST /api/v1/settings/calendar-feed";
const ROTATE = "POST /api/v1/settings/calendar-feed/rotation";
const REVOKE = "DELETE /api/v1/settings/calendar-feed";
const FEED = { createdAt: "2026-09-28T10:00:00.000Z" };
const FIRST =
  "http://localhost/api/v1/calendar-feeds/kin_cal_00000000-0000-4000-8000-000000000001.first-secret-value.ics";
const SECOND =
  "http://localhost/api/v1/calendar-feeds/kin_cal_00000000-0000-4000-8000-000000000002.second-secret-value.ics";
const base = {
  [PREFERENCES]: jsonResponse({ preferences: preferences(), status: "ready" }),
  [SESSION]: jsonResponse(workspaceSession()),
};

function shell(): void {
  drawShell(
    "<main><section data-calendar-feed-surface></section></main>",
  );
}

const mount = () => mountSettled(() => mountCalendarFeed());
const state = () => element("[data-calendar-feed-state]");
const button = (name: string) =>
  screen.getByRole<HTMLButtonElement>("button", { name });
const link = () =>
  screen.queryByLabelText<HTMLInputElement>("Calendar feed link");

function click(name: string): void {
  act(() => {
    fireEvent.click(button(name));
  });
}

afterEach(() => sessionStorage.clear());

describe("INTEGRATION-002 calendar feed settings", () => {
  it("does nothing without its region", async () => {
    drawShell("<p>Other page</p>");
    const api = stubApi();
    await mount();
    expect(api.calls()).toEqual([]);
    expect(CALENDAR_FEED_ISLAND).toBe("settings-calendar-feed");
  });

  it("creates a feed, shows its link once with a warning, and copies it", async () => {
    shell();
    const created = deferred<Response>();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const api = stubApi({
      ...base,
      [CREATE]: created.promise,
      [READ]: jsonResponse({ status: "ready" }),
    });
    await mount();
    expect(state().textContent).toBe("No calendar feed yet.");
    expect(state().getAttribute("role")).toBe("status");
    // The page's own button styles, so the controls keep their contrast in
    // every theme rather than falling back to the browser's (WebKit dark).
    expect(button("Create calendar feed").className).toContain(
      buttonVariants(),
    );
    expect(link()).toBeNull();
    await expectNoAxeViolations(document.body);
    click("Create calendar feed");
    expect(state().textContent).toBe("Creating calendar feed…");
    expect(button("Create calendar feed").disabled).toBe(true);
    await act(async () => {
      created.resolve(
        jsonResponse({ feed: FEED, status: "created", url: FIRST }, 201),
      );
      await created.promise;
    });
    await waitFor(() => expect(link()?.value).toBe(FIRST));
    expect(document.activeElement).toBe(link());
    expect(document.body.textContent).toContain(
      "Anyone with this link can see the names, dates, and reminders in this feed.",
    );
    expect(element("[data-calendar-feed-summary]").textContent).toContain(
      "Never used",
    );
    await expectNoAxeViolations(document.body);
    expect(button("Copy link").className).toContain(buttonVariants());
    click("Copy link");
    await waitFor(() => expect(state().textContent).toBe("Link copied."));
    expect(writeText).toHaveBeenCalledWith(FIRST);
    click("I have saved it");
    expect(link()).toBeNull();
    expect(api.calls().filter((call) => call.startsWith("POST"))).toHaveLength(
      1,
    );
  });

  it("rotates to a new link and revokes, moving focus to the next control", async () => {
    shell();
    const api = stubApi({
      ...base,
      [READ]: jsonResponse({
        feed: { ...FEED, lastUsedAt: "2026-09-28T11:00:00.000Z" },
        status: "ready",
      }),
      [REVOKE]: jsonResponse({ status: "revoked" }),
      [ROTATE]: jsonResponse(
        { feed: FEED, status: "rotated", url: SECOND },
        201,
      ),
    });
    await mount();
    expect(state().textContent).toBe("Your calendar feed is active.");
    expect(element("[data-calendar-feed-summary]").textContent).toContain(
      "Last used",
    );
    expect(screen.queryByRole("button", { name: "Create calendar feed" }))
      .toBeNull();
    expect(button("Rotate link").className).toContain(buttonVariants());
    click("Rotate link");
    await waitFor(() => expect(link()?.value).toBe(SECOND));
    expect(state().textContent).toBe(
      "Calendar feed link rotated. The old link no longer works; copy the new one now.",
    );
    click("Revoke feed");
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Calendar feed revoked. Its link no longer works.",
      )
    );
    expect(link()).toBeNull();
    expect(document.activeElement).toBe(button("Create calendar feed"));
    expect(api.calls().slice(-2)).toEqual([
      "POST /api/v1/settings/calendar-feed/rotation",
      "DELETE /api/v1/settings/calendar-feed",
    ]);
  });

  it("reports refusals and a failed copy, and releases the controls", async () => {
    shell();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
    stubApi({
      ...base,
      [CREATE]: [
        unreachable,
        jsonResponse({ feed: FEED, status: "created", url: FIRST }, 201),
      ],
      [READ]: jsonResponse({ status: "ready" }),
    });
    await mount();
    click("Create calendar feed");
    await waitFor(() =>
      expect(state().textContent).toBe(
        "The calendar feed could not be created.",
      )
    );
    expect(button("Create calendar feed").disabled).toBe(false);
    click("Create calendar feed");
    await waitFor(() => expect(link()?.value).toBe(FIRST));
    click("Copy link");
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Copy failed. Select the link and copy it manually.",
      )
    );
  });

  it("dismissing the link keeps focus on the section", async () => {
    shell();
    stubApi({
      ...base,
      [CREATE]: jsonResponse(
        { feed: FEED, status: "created", url: FIRST },
        201,
      ),
      [READ]: jsonResponse({ status: "ready" }),
    });
    await mount();
    click("Create calendar feed");
    await waitFor(() => expect(link()?.value).toBe(FIRST));
    click("I have saved it");
    expect(link()).toBeNull();
    expect(document.activeElement).toBe(button("Rotate link"));
  });

  it("reads the feed again when another window created, rotated, or revoked it", async () => {
    shell();
    const api = stubApi({
      ...base,
      [CREATE]: problemResponse(409, { code: "calendar_feed_exists" }),
      [READ]: [
        jsonResponse({ status: "ready" }),
        jsonResponse({ feed: FEED, status: "ready" }),
        jsonResponse({ status: "ready" }),
        jsonResponse({ feed: FEED, status: "ready" }),
        jsonResponse({ status: "ready" }),
      ],
      [REVOKE]: problemResponse(404, { code: "calendar_feed_not_found" }),
      [ROTATE]: problemResponse(404, { code: "calendar_feed_not_found" }),
    });
    await mount();
    click("Create calendar feed");
    await waitFor(() =>
      expect(state().textContent).toBe(
        "Your calendar feed changed in another window.",
      )
    );
    expect(document.activeElement).toBe(button("Rotate link"));
    click("Rotate link");
    await waitFor(() =>
      expect(button("Create calendar feed").disabled).toBe(false)
    );
    expect(state().textContent).toBe(
      "Your calendar feed changed in another window.",
    );
    expect(document.activeElement).toBe(button("Create calendar feed"));
    click("Create calendar feed");
    await waitFor(() => expect(button("Revoke feed").disabled).toBe(false));
    click("Revoke feed");
    await waitFor(() =>
      expect(button("Create calendar feed").disabled).toBe(false)
    );
    expect(
      api.calls().filter((call) =>
        call.startsWith("GET /api/v1/settings/calendar-feed")
      ),
    )
      .toHaveLength(5);
  });

  it("holds a second change while one runs", async () => {
    shell();
    const created = deferred<Response>();
    const api = stubApi({
      ...base,
      [CREATE]: created.promise,
      [READ]: jsonResponse({ status: "ready" }),
    });
    await mount();
    act(() => {
      fireEvent.click(button("Create calendar feed"));
      fireEvent.click(button("Create calendar feed"));
    });
    await act(async () => {
      created.resolve(
        jsonResponse({ feed: FEED, status: "created", url: FIRST }, 201),
      );
      await created.promise;
    });
    await waitFor(() => expect(link()?.value).toBe(FIRST));
    expect(api.calls().filter((call) => call.startsWith("POST"))).toHaveLength(
      1,
    );
  });

  it("says what could not load, for any member", async () => {
    for (
      const [routes, message, controls] of [
        [
          {
            ...base,
            [READ]: jsonResponse({ status: "ready" }),
            [SESSION]: jsonResponse(
              workspaceSession({ member: { id: ids.member, role: "member" } }),
            ),
          },
          "No calendar feed yet.",
          true,
        ],
        [
          { [SESSION]: unreachable },
          "Your session could not be confirmed.",
          false,
        ],
        [
          { ...base, [READ]: problemResponse(503, { detail: "Feed is off." }) },
          "Feed is off.",
          false,
        ],
        [
          { ...base, [READ]: unreachable },
          "Your calendar feed could not be loaded.",
          false,
        ],
      ] as const
    ) {
      shell();
      stubApi(routes);
      const unmount = await mount();
      expect(state().textContent).toBe(message);
      expect(
        screen.queryByRole("button", { name: "Create calendar feed" }) !== null,
      ).toBe(controls);
      unmount();
    }
  });
});
