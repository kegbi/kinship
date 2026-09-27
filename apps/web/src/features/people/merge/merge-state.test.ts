import { describe, expect, it } from "vitest";
import type { PersonMergePreview } from "../../../../../../packages/contracts/generated/auth-client.ts";
import {
  initialMergeState,
  type MergePerson,
  mergeReducer,
  mergeRequest,
  mergeSummary,
} from "./merge-state.ts";

const ada: MergePerson = {
  familyName: "Lovelace",
  givenName: "Ada",
  id: "00000000-0000-4000-8000-000000000101",
};
const countess: MergePerson = {
  givenName: "Ada",
  id: "00000000-0000-4000-8000-000000000102",
  nickname: "Countess",
};
const name = (person: MergePerson) =>
  [person.givenName, person.familyName, person.nickname].filter(Boolean).join(
    " ",
  );

function preview(
  primary: MergePerson,
  duplicate: MergePerson,
  overrides: Partial<PersonMergePreview> = {},
): PersonMergePreview {
  const identity = (person: MergePerson, updatedAt: string) => ({
    givenName: person.givenName,
    id: person.id,
    isDeceased: false,
    isPartial: false,
    lifecycle: "active" as const,
    updatedAt,
  });
  return {
    conflicts: [],
    conflictsDigest: "ab".repeat(32),
    duplicate: identity(duplicate, "2026-09-27T11:00:00.000000Z"),
    moves: 3,
    primary: identity(primary, "2026-09-27T10:00:00.000000Z"),
    status: "ready",
    ...overrides,
  };
}

describe("PEOPLE-008 merge dialog state", () => {
  it("confirms only against the preview of the primary the member chose, with both of its revisions", () => {
    let state = initialMergeState({ anchor: ada, other: countess });
    expect(state.primaryId).toBe(ada.id);
    expect(mergeRequest(state)).toBeUndefined();
    state = mergeReducer(state, { type: "preview-started" });
    expect(state.previewing).toBe(true);
    state = mergeReducer(state, {
      preview: preview(ada, countess),
      primaryId: ada.id,
      type: "preview-answered",
    });
    expect(state.previewing).toBe(false);
    expect(mergeRequest(state)).toEqual({
      body: {
        confirmed: true,
        conflictsDigest: "ab".repeat(32),
        duplicateId: countess.id,
        duplicateRevision: "2026-09-27T11:00:00.000000Z",
        primaryRevision: "2026-09-27T10:00:00.000000Z",
      },
      primaryId: ada.id,
    });
    const swapped = mergeReducer(state, {
      personId: countess.id,
      type: "primary-chosen",
    });
    expect(swapped.primaryId).toBe(countess.id);
    expect(mergeRequest(swapped)).toBeUndefined();
    // A late answer for the other choice never confirms this one.
    expect(
      mergeRequest(
        mergeReducer(swapped, {
          preview: preview(ada, countess),
          primaryId: ada.id,
          type: "preview-answered",
        }),
      ),
    ).toBeUndefined();
    expect(
      mergeReducer(state, { personId: "someone-else", type: "primary-chosen" })
        .primaryId,
    ).toBe(ada.id);
  });

  it("says why a preview failed and offers no confirmation", () => {
    let state = initialMergeState({ anchor: ada, other: countess });
    state = mergeReducer(state, { type: "preview-started" });
    state = mergeReducer(state, {
      detail: "Both people represent members.",
      primaryId: ada.id,
      type: "preview-failed",
    });
    expect(state).toMatchObject({
      previewError: "Both people represent members.",
      previewing: false,
    });
    expect(mergeRequest(state)).toBeUndefined();
    expect(
      mergeReducer(state, {
        detail: "stale",
        primaryId: countess.id,
        type: "preview-failed",
      }).previewError,
    ).toBe("Both people represent members.");
  });

  it("finds the other person first when only one is known", () => {
    let state = initialMergeState({ anchor: ada });
    expect(mergeRequest(state)).toBeUndefined();
    state = mergeReducer(state, { type: "search-started" });
    expect(state.searching).toBe(true);
    state = mergeReducer(state, {
      candidates: [countess],
      type: "search-answered",
    });
    expect(state).toMatchObject({
      candidates: [{ id: countess.id }],
      searchStatus: "1 person found.",
      searching: false,
    });
    state = mergeReducer(state, { person: countess, type: "other-chosen" });
    expect(state.other?.id).toBe(countess.id);
    state = mergeReducer(state, {
      preview: preview(ada, countess),
      primaryId: ada.id,
      type: "preview-answered",
    });
    state = mergeReducer(state, { type: "other-cleared" });
    expect(state.other).toBeUndefined();
    expect(state.preview).toBeUndefined();
    expect(state.primaryId).toBe(ada.id);
    expect(
      mergeReducer(state, { candidates: [], type: "search-answered" })
        .searchStatus,
    ).toBe("No other person matches.");
    expect(
      mergeReducer(state, {
        candidates: [ada, countess],
        type: "search-answered",
      }).searchStatus,
    ).toBe("2 people found.");
    expect(mergeReducer(state, { type: "search-failed" }).searchStatus).toBe(
      "People could not be searched. Try again.",
    );
  });

  it("is busy while the merge is in flight and says why a refused one failed", () => {
    let state = initialMergeState({ anchor: ada, other: countess });
    state = mergeReducer(state, { type: "merge-started" });
    expect(state.saving).toBe(true);
    expect(mergeReducer(state, { type: "merge-started" })).toBe(state);
    state = mergeReducer(state, {
      detail: "One of these people changed.",
      type: "merge-failed",
    });
    expect(state).toMatchObject({
      error: "One of these people changed.",
      saving: false,
    });
    expect(mergeReducer(state, { type: "merge-started" }).error).toBe("");
  });

  it("reads the preview again when the merge was refused as out of date, and confirms only against the new one", () => {
    let state = initialMergeState({ anchor: ada, other: countess });
    state = mergeReducer(state, {
      preview: preview(ada, countess),
      primaryId: ada.id,
      type: "preview-answered",
    });
    const round = state.previewRound;
    state = mergeReducer(state, { type: "merge-started" });
    state = mergeReducer(state, {
      detail: "What this merge would discard changed.",
      type: "merge-outdated",
    });
    expect(state).toMatchObject({
      error: "What this merge would discard changed.",
      previewRound: round + 1,
      saving: false,
    });
    // The old preview is gone, so nothing can be confirmed against it.
    expect(state.preview).toBeUndefined();
    expect(mergeRequest(state)).toBeUndefined();
    state = mergeReducer(state, { type: "preview-started" });
    state = mergeReducer(state, {
      preview: preview(ada, countess, {
        conflicts: [
          { discarded: "12 March", fact: "birthday", kept: "10 December" },
        ],
        conflictsDigest: "cd".repeat(32),
      }),
      primaryId: ada.id,
      type: "preview-answered",
    });
    // The refusal stays said while the new conflicts are shown.
    expect(state.error).toBe("What this merge would discard changed.");
    expect(mergeSummary(state, name)?.conflicts).toEqual([
      "Birthday — Kept: 10 December, discarded: 12 March",
    ]);
    expect(mergeRequest(state)?.body.conflictsDigest).toBe("cd".repeat(32));
  });

  it("says how much moves, each fact kept and discarded, and that it cannot be undone", () => {
    let state = initialMergeState({ anchor: ada, other: countess });
    expect(mergeSummary(state, name)).toBeUndefined();
    state = mergeReducer(state, {
      preview: preview(ada, countess, {
        conflicts: [
          { discarded: "12 March", fact: "birthday", kept: "10 December" },
          {
            discarded: "every 30 days",
            fact: "stay-in-touch",
            kept: "every week",
          },
          {
            discarded: "The duplicate's photo will not be used",
            fact: "avatar",
            kept: "The primary's photo",
          },
          { discarded: "Vassar", fact: "first-meeting", kept: "Harvard" },
          { discarded: "1852", fact: "deceased", kept: "1851" },
          { discarded: "May", fact: "first_met", kept: "June" },
        ],
      }),
      primaryId: ada.id,
      type: "preview-answered",
    });
    expect(mergeSummary(state, name)).toEqual({
      conflicts: [
        "Birthday — Kept: 10 December, discarded: 12 March",
        "Stay in touch — Kept: every week, discarded: every 30 days",
        "Photo — Kept: The primary's photo, discarded: The duplicate's photo will not be used",
        "First meeting — Kept: Harvard, discarded: Vassar",
        "Date of death — Kept: 1851, discarded: 1852",
        "First met date — Kept: June, discarded: May",
      ],
      moves:
        "3 records that name Ada Countess move to Ada Lovelace, and Ada Countess is then deleted. Only one of each fact below can stay, so Ada Lovelace's is kept; exact copies of contact details, addresses, tags, and relationships are kept once.",
      warning: "A merge cannot be undone.",
    });
    state = mergeReducer(state, {
      preview: preview(ada, countess, { moves: 1 }),
      primaryId: ada.id,
      type: "preview-answered",
    });
    expect(mergeSummary(state, name)?.moves).toBe(
      "1 record that names Ada Countess moves to Ada Lovelace, and Ada Countess is then deleted. Nothing conflicts; exact copies of contact details, addresses, tags, and relationships are kept once.",
    );
  });
});
