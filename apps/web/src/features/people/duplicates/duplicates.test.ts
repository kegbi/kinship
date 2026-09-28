import { describe, expect, it } from "vitest";
import {
  dismissedAnnouncement,
  duplicatesReducer,
  duplicatesSummary,
  initialDuplicates,
  reasonsText,
} from "./duplicates.ts";

const person = (id: string) => ({
  givenName: "Ada",
  id,
  updatedAt: "2026-09-27T10:00:00.000000Z",
});
const pair = {
  people: [person("a"), person("b")],
  reasons: ["email", "name"] as ("email" | "name" | "phone")[],
};

describe("PEOPLE-008 duplicate review state", () => {
  it("loads once, folds the list away until asked, and opens one merge at a time", () => {
    let state = initialDuplicates();
    expect(state).toEqual({
      expanded: false,
      pairs: [],
      status: "loading",
      truncated: false,
    });
    state = duplicatesReducer(state, {
      context: { nameOrder: "given_family_nickname", workspaceId: "w" },
      pairs: [pair],
      truncated: false,
      type: "loaded",
    });
    expect(state.status).toBe("ready");
    expect(state.context?.workspaceId).toBe("w");
    expect(state.expanded).toBe(false);
    state = duplicatesReducer(state, { type: "toggled" });
    expect(state.expanded).toBe(true);
    state = duplicatesReducer(state, { index: 0, type: "merge-opened" });
    expect(state.merging).toBe(0);
    expect(duplicatesReducer(state, { index: 3, type: "merge-opened" }).merging)
      .toBe(0);
    state = duplicatesReducer(state, { type: "merge-closed" });
    expect(state.merging).toBeUndefined();
    expect(
      duplicatesReducer(initialDuplicates(), { type: "failed" }).status,
    ).toBe("unavailable");
  });

  it("dismisses one pair at a time, never beside a merge, and drops it once dismissed", () => {
    const other = { people: [person("c"), person("d")], reasons: pair.reasons };
    let state = duplicatesReducer(initialDuplicates(), {
      context: { nameOrder: "given_family_nickname", workspaceId: "w" },
      pairs: [pair, other],
      truncated: false,
      type: "loaded",
    });
    state = duplicatesReducer(state, {
      key: "a:b",
      names: "Ada and Ada",
      type: "dismiss-started",
    });
    expect(state.dismissing).toBe("a:b");
    expect(state.announcement).toBe("Marking Ada and Ada as not duplicates…");
    // Neither a second dismissal nor a merge starts while one is in flight.
    expect(
      duplicatesReducer(state, {
        key: "c:d",
        names: "Ada and Ada",
        type: "dismiss-started",
      }).dismissing,
    ).toBe("a:b");
    expect(duplicatesReducer(state, { index: 1, type: "merge-opened" }).merging)
      .toBeUndefined();
    const failed = duplicatesReducer(state, {
      detail: "Nothing was saved.",
      type: "dismiss-failed",
    });
    expect(failed.dismissing).toBeUndefined();
    expect(failed.announcement).toBe("Nothing was saved.");
    expect(failed.pairs).toHaveLength(2);
    state = duplicatesReducer(state, {
      key: "a:b",
      names: "Ada and Ada",
      type: "dismissed",
    });
    expect(state.dismissing).toBeUndefined();
    expect(state.pairs).toEqual([other]);
    expect(state.announcement).toBe(dismissedAnnouncement("Ada and Ada"));
    // A merge open blocks a dismissal.
    const merging = duplicatesReducer(state, {
      index: 0,
      type: "merge-opened",
    });
    expect(
      duplicatesReducer(merging, {
        key: "c:d",
        names: "Ada and Ada",
        type: "dismiss-started",
      }).dismissing,
    ).toBeUndefined();
  });

  it("words the reasons and the count", () => {
    expect(reasonsText(["email", "name", "phone"])).toBe(
      "Same name · same email address · same phone number",
    );
    expect(reasonsText(["phone"])).toBe("Same phone number");
    expect(duplicatesSummary(1, false)).toBe(
      "1 pair of people may be the same person.",
    );
    expect(duplicatesSummary(20, true)).toBe(
      "20 pairs of people may be the same person. Showing the first 20; merge some to see more.",
    );
    expect(duplicatesSummary(0, false)).toBe(
      "No possible duplicates are left to review.",
    );
    expect(dismissedAnnouncement("Ada and Grace")).toBe(
      "Ada and Grace are marked as not duplicates. They will not be suggested again.",
    );
  });
});
