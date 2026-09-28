import { describe, expect, it } from "vitest";
import {
  calendarFeedReducer,
  type CalendarFeedState,
  feedSummary,
  initialCalendarFeed,
} from "./calendar-feed.ts";

const utc = { effectiveTimezone: "UTC", locale: "en" };
const FEED = { createdAt: "2026-09-28T10:00:00.000Z" };
const URL_ONE = "https://kinship.example/api/v1/calendar-feeds/kin_cal_a.b.ics";

const ready = (state: CalendarFeedState = initialCalendarFeed) =>
  calendarFeedReducer(state, { feed: undefined, type: "loaded" });

describe("INTEGRATION-002 calendar feed state", () => {
  it("loads with or without a live feed", () => {
    expect(initialCalendarFeed.phase).toBe("loading");
    const none = ready();
    expect([none.phase, none.feed, none.status]).toEqual([
      "ready",
      undefined,
      "No calendar feed yet.",
    ]);
    const live = calendarFeedReducer(initialCalendarFeed, {
      feed: FEED,
      timePreferences: utc,
      type: "loaded",
    });
    expect(live.timePreferences).toEqual(utc);
    expect([live.feed, live.status]).toEqual([
      FEED,
      "Your calendar feed is active.",
    ]);
  });

  it("shows a minted link once, focuses it, and hides it on dismissal", () => {
    const busy = calendarFeedReducer(ready(), {
      busy: true,
      message: "Creating calendar feed…",
      type: "busy",
    });
    expect([busy.busy, busy.status]).toEqual([true, "Creating calendar feed…"]);
    const created = calendarFeedReducer(busy, {
      feed: FEED,
      status: "created",
      type: "issued",
      url: URL_ONE,
    });
    expect([created.busy, created.feed, created.url, created.focus]).toEqual([
      false,
      FEED,
      URL_ONE,
      "url",
    ]);
    expect(created.status).toBe(
      "Calendar feed created. Copy the link now; it is shown only once.",
    );
    const focused = calendarFeedReducer(created, { type: "focused" });
    expect(focused.focus).toBeUndefined();
    const dismissed = calendarFeedReducer(focused, { type: "dismissed" });
    expect([dismissed.url, dismissed.feed, dismissed.status]).toEqual([
      undefined,
      FEED,
      "The link is hidden. Rotate the feed if you need a new one.",
    ]);
  });

  it("rotation replaces the link and revocation clears it", () => {
    const rotated = calendarFeedReducer(ready(), {
      feed: FEED,
      status: "rotated",
      type: "issued",
      url: URL_ONE,
    });
    expect(rotated.status).toBe(
      "Calendar feed link rotated. The old link no longer works; copy the new one now.",
    );
    const revoked = calendarFeedReducer(rotated, { type: "revoked" });
    expect([revoked.feed, revoked.url, revoked.focus, revoked.busy]).toEqual([
      undefined,
      undefined,
      "create",
      false,
    ]);
    expect(revoked.status).toBe(
      "Calendar feed revoked. Its link no longer works.",
    );
  });

  it("a refusal releases the controls and keeps what is shown", () => {
    const shown = calendarFeedReducer(ready(), {
      feed: FEED,
      status: "created",
      type: "issued",
      url: URL_ONE,
    });
    const busy = calendarFeedReducer(shown, { busy: true, type: "busy" });
    expect(busy.status).toBe(shown.status);
    const refused = calendarFeedReducer(busy, {
      message: "Try again.",
      type: "failed",
    });
    expect([refused.busy, refused.url, refused.status]).toEqual([
      false,
      URL_ONE,
      "Try again.",
    ]);
    const note = calendarFeedReducer(refused, {
      message: "Link copied.",
      type: "status",
    });
    expect(note.status).toBe("Link copied.");
    const unavailable = calendarFeedReducer(initialCalendarFeed, {
      message: "Unavailable.",
      type: "failed",
    });
    expect(unavailable.phase).toBe("unavailable");
  });

  it("dismissing the link moves focus to rotation", () => {
    const shown = calendarFeedReducer(ready(), {
      feed: FEED,
      status: "created",
      type: "issued",
      url: URL_ONE,
    });
    const dismissed = calendarFeedReducer(
      calendarFeedReducer(shown, { type: "focused" }),
      { type: "dismissed" },
    );
    expect(dismissed.focus).toBe("rotate");
  });

  it("a feed another window changed is read again and says so", () => {
    const shown = calendarFeedReducer(ready(), {
      feed: FEED,
      status: "created",
      type: "issued",
      url: URL_ONE,
    });
    const busy = calendarFeedReducer(shown, { busy: true, type: "busy" });
    const gone = calendarFeedReducer(busy, {
      feed: undefined,
      type: "changed-elsewhere",
    });
    expect([gone.busy, gone.feed, gone.url, gone.focus, gone.status]).toEqual([
      false,
      undefined,
      undefined,
      "create",
      "Your calendar feed changed in another window.",
    ]);
    const live = calendarFeedReducer(ready(), {
      feed: FEED,
      type: "changed-elsewhere",
    });
    expect([live.feed, live.focus, live.phase]).toEqual([
      FEED,
      "rotate",
      "ready",
    ]);
  });

  it("summarizes when the feed was created and last used", () => {
    expect(feedSummary(FEED, utc)).toBe(
      "Created Sep 28, 2026, 10:00 AM · Never used",
    );
    expect(
      feedSummary({ ...FEED, lastUsedAt: "2026-09-29T08:15:00.000Z" }, utc),
    ).toBe("Created Sep 28, 2026, 10:00 AM · Last used Sep 29, 2026, 8:15 AM");
  });
});
