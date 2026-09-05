import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCalendarDate,
  formatInstant,
  formatPartialDate,
  loadTimePreferences,
} from "./time-presentation.ts";

afterEach(() => vi.unstubAllGlobals());

describe("APR-009 explicit date presentation", () => {
  it.each([
    {
      locale: "fa-IR",
      monthDay: "۲۹ فوریه",
      year: "۲۰۲۴",
      date: "۲۹ فوریه ۲۰۲۴",
    },
    {
      locale: "th-TH",
      monthDay: "29 กุมภาพันธ์",
      year: "2024",
      date: "29 ก.พ. 2024",
    },
  ])(
    "preserves recorded Gregorian components while localizing $locale",
    ({ locale, monthDay, year, date }) => {
      expect(formatPartialDate({ month: 2, day: 29 }, "month_day", locale))
        .toBe(monthDay);
      expect(formatPartialDate({ year: 2024 }, "year", locale)).toBe(year);
      expect(formatCalendarDate("2024-02-29", locale)).toBe(date);
    },
  );
  it("APR-009 keeps already-saved unsupported locale or timezone values from breaking a view", () => {
    expect(
      formatInstant("2026-09-04T22:10:00Z", {
        locale: "zz",
        effectiveTimezone: "Europe/Belgrade",
      }),
    ).toBe("Time unavailable");
    expect(formatCalendarDate("2026-09-05", "zz")).toBe("Date unavailable");
    expect(
      formatInstant("2026-09-04T22:10:00Z", {
        locale: "en-USA",
        effectiveTimezone: "Europe/Belgrade",
      }),
    ).toBe("Time unavailable");
    expect(
      formatInstant("2026-09-04T22:10:00Z", {
        locale: "en",
        effectiveTimezone: "Missing/Zone",
      }),
    ).toBe("Time unavailable");
    expect(formatInstant("invalid", { locale: "en", effectiveTimezone: "UTC" }))
      .toBe("Time unavailable");
    expect(formatCalendarDate("2026-09-05", "en-USA")).toBe("Date unavailable");
    expect(formatCalendarDate("invalid", "en")).toBe("Date unavailable");
    expect(formatPartialDate({ month: 2, day: 29 }, "month_day", "en-USA"))
      .toBe("Date unavailable");
  });
  it("uses member locale and timezone across midnight", () => {
    const instant = "2026-09-04T22:10:00Z";
    expect(
      formatInstant(instant, {
        locale: "en-US",
        effectiveTimezone: "America/Los_Angeles",
      }),
    ).toBe("Sep 4, 2026, 3:10 PM");
    expect(
      formatInstant(instant, {
        locale: "de-DE",
        effectiveTimezone: "Europe/Belgrade",
      }),
    ).toBe("05.09.2026, 00:10");
    expect(
      formatInstant(instant, {
        locale: "en-GB",
        effectiveTimezone: "Europe/Belgrade",
      }),
    ).toBe("5 Sept 2026, 00:10");
  });
  it("uses daylight-saving rules on both sides of the transition", () => {
    const preferences = {
      locale: "en-GB",
      effectiveTimezone: "America/New_York",
    };
    expect(formatInstant("2026-03-08T06:59:00Z", preferences)).toBe(
      "8 Mar 2026, 01:59",
    );
    expect(formatInstant("2026-03-08T07:01:00Z", preferences)).toBe(
      "8 Mar 2026, 03:01",
    );
  });
  it("keeps calendar and partial components without invented year, month, day, or time", () => {
    const date = "2024-02-29";
    expect(formatCalendarDate(date, "en-US")).toBe("Feb 29, 2024");
    expect(formatCalendarDate(date, "de-DE")).toBe("29.02.2024");
    expect(formatPartialDate({ month: 2, day: 29 }, "month_day", "en-US")).toBe(
      "February 29",
    );
    expect(formatPartialDate({}, "full", "en-US")).toBe("Date unknown");
    expect(formatPartialDate({ year: 2024 }, "full", "en-US")).toBe("2024");
    const cases = {
      full: "February 29, 2024",
      year_month: "February 2024",
      year: "2024",
      month_day: "February 29",
      month: "February",
      day: "29",
      unknown: "Date unknown",
    } as const;
    for (const [precision, expected] of Object.entries(cases)) {
      expect(
        formatPartialDate(
          { year: 2024, month: 2, day: 29 },
          precision as keyof typeof cases,
          "en-US",
        ),
      ).toBe(expected);
    }
  });
  it("does not use the browser timezone when preferences cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    expect(await loadTimePreferences("workspace-a")).toBeUndefined();
    expect(formatInstant("2026-09-04T22:10:00Z", undefined)).toBe(
      "Time unavailable",
    );
    expect(
      formatInstant("2026-09-04T22:10:00Z", {
        locale: "",
        effectiveTimezone: "UTC",
      }),
    ).toBe("Time unavailable");
    expect(
      formatInstant("2026-09-04T22:10:00Z", {
        locale: "en",
        effectiveTimezone: "",
      }),
    ).toBe("Time unavailable");
  });
  it("loads each workspace's resolved preferences without caching another membership", async () => {
    const fetch = vi.fn().mockImplementation((_url, options) =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ready",
            preferences: {
              locale: "de-DE",
              effectiveTimezone: options.headers["X-Workspace-Id"] === "a"
                ? "Europe/Belgrade"
                : "Asia/Tokyo",
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
      )
    );
    vi.stubGlobal("fetch", fetch);
    expect(await loadTimePreferences("a")).toEqual({
      locale: "de-DE",
      effectiveTimezone: "Europe/Belgrade",
    });
    expect(await loadTimePreferences("b")).toEqual({
      locale: "de-DE",
      effectiveTimezone: "Asia/Tokyo",
    });
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          status: 403,
          title: "Forbidden",
          detail: "Forbidden",
          type: "about:blank",
        }),
        {
          status: 403,
          headers: { "content-type": "application/problem+json" },
        },
      ),
    );
    expect(await loadTimePreferences("b")).toBeUndefined();
  });
});
