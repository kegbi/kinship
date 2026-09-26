import { describe, expect, it } from "vitest";
import {
  firstMeetingText,
  type HeroFacts,
  heroFactsFromProfile,
  heroFactsReducer,
  railCountText,
  railSummaryFromProfile,
  railSummaryReducer,
  tagPreview,
} from "./profile-summary.ts";
import type { PersonProfile } from "./section-mounts.ts";

const person = {
  givenName: "Ada",
  id: "00000000-0000-4000-8000-000000000100",
  isDeceased: false,
  isPartial: false,
  isSelf: false,
  isStarred: false,
  tagCount: 10,
  tags: [{ id: "00000000-0000-4000-8000-000000000200", name: "Friend" }],
  updatedAt: "2026-08-15T08:00:00.000000Z",
} as unknown as PersonProfile["person"];

describe("GAP-028 rail summary", () => {
  it("seeds counted sections from the summary and nothing for a hidden one", () => {
    const summary = railSummaryFromProfile(
      {
        primaryContactMethods: [],
        relationshipCounts: [],
        sectionCounts: [
          { count: 2, id: "contact-methods", status: "ready" },
          { count: 0, id: "pets", status: "ready" },
          { id: "addresses", status: "hidden" },
          { count: 5, id: "notes", status: "ready" },
        ],
      } as unknown as PersonProfile["summary"],
    );
    expect(summary).toEqual({
      addresses: { empty: false, scope: "total" },
      "contact-methods": { count: 2, empty: false, scope: "total" },
      pets: { count: 0, empty: true, scope: "total" },
    });
    expect(railSummaryFromProfile(undefined)).toEqual({});
  });

  it("folds counts and empty states without losing the other", () => {
    let state = railSummaryReducer({}, {
      count: 3,
      scope: "page",
      section: "work",
    });
    state = railSummaryReducer(state, { empty: true, section: "work" });
    expect(state.work).toEqual({ count: 3, empty: true, scope: "page" });
    expect(railCountText(state.work)).toBe("3 on this page");
    state = railSummaryReducer(state, {
      count: undefined,
      scope: "total",
      section: "work",
    });
    expect(state.work).toEqual({ empty: true, scope: "total" });
    expect(railCountText(state.work)).toBeUndefined();
    expect(railCountText(undefined)).toBeUndefined();
    expect(railCountText({ count: 1, empty: false, scope: "total" })).toBe("1");
  });
});

describe("GAP-028 hero facts", () => {
  it("starts from the profile answer", () => {
    const format = (instant: string) => `at ${instant}`;
    expect(heroFactsFromProfile(
      { ...person, lastContactAt: "2026-08-29T09:00:00.000Z" },
      {
        detail: "",
        nextReminderAt: "2026-08-30T09:00:00.000Z",
        openTaskCount: 0,
        status: "ready",
        stayInTouchAt: "2026-09-01T09:00:00.000Z",
      },
      false,
      format,
    )).toEqual({
      lastContact: "at 2026-08-29T09:00:00.000Z",
      nextReminder: "at 2026-08-30T09:00:00.000Z",
      stayInTouch: "Loading cadence…",
      tags: { more: 9, names: ["Friend"] },
    });
    expect(heroFactsFromProfile(
      person,
      { detail: "", openTaskCount: 2, status: "ready" },
      true,
      format,
    )).toEqual({
      lastContact: "None recorded",
      nextReminder: "Not recorded",
      stayInTouch: "Not set",
    });
  });

  it("folds each published fact, clearing an optional one that is empty", () => {
    let facts: HeroFacts = {
      lastContact: "",
      nextReminder: "",
      stayInTouch: "",
    };
    for (
      const change of [
        { slot: "birthday", text: "March 12" },
        { slot: "work", text: "Engineer" },
        { slot: "first-meeting-place", text: "London" },
        { slot: "last-contact", text: "Yesterday" },
        { slot: "next-reminder", text: "Tomorrow" },
        { slot: "stay-in-touch", text: "Every 1 week" },
        { slot: "tags", tags: tagPreview(["A"]) },
      ] as const
    ) facts = heroFactsReducer(facts, change);
    expect(facts).toEqual({
      birthday: "March 12",
      firstMeetingPlace: "London",
      lastContact: "Yesterday",
      nextReminder: "Tomorrow",
      stayInTouch: "Every 1 week",
      tags: { more: 0, names: ["A"] },
      work: "Engineer",
    });
    expect(firstMeetingText(facts)).toBe("London");
    facts = heroFactsReducer(facts, {
      slot: "first-meeting-date",
      text: "June 5",
    });
    expect(firstMeetingText(facts)).toBe("June 5");
    facts = heroFactsReducer(facts, { slot: "work", text: "" });
    facts = heroFactsReducer(facts, { slot: "birthday", text: undefined });
    facts = heroFactsReducer(facts, { slot: "tags", tags: undefined });
    expect(facts).not.toHaveProperty("work");
    expect(facts).not.toHaveProperty("birthday");
    expect(facts).not.toHaveProperty("tags");
  });

  it("previews at most eight tags and counts the rest", () => {
    const names = Array.from({ length: 12 }, (_, index) => `Tag ${index}`);
    expect(tagPreview(names)).toEqual({ more: 4, names: names.slice(0, 8) });
    expect(tagPreview([])).toEqual({ more: 0, names: [] });
  });
});
