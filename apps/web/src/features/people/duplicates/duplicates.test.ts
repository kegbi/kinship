import { describe, expect, it } from "vitest";
import {
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
  });
});
