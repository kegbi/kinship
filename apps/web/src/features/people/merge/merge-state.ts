/**
 * The merge dialog's state, as one pure reducer (GAP-049, PEOPLE-008).
 *
 * The dialog merges two people. Opened from the directory's duplicate review
 * it already knows both; opened from a person's menu it knows one, the
 * anchor, and first finds the other. Either way the member then chooses which
 * record to keep, and the dialog asks the server's merge preview what that
 * choice keeps, discards, and moves. The member reads it, and that a merge
 * cannot be undone, and confirms against the two revisions and the conflicts
 * digest the preview named. A merge refused because one of those is out of
 * date drops the preview and asks for it again, so the member sees what is
 * true now before confirming again.
 *
 * Every step moves the same few facts, folded here so each can be tested
 * without a DOM: the two people, which is kept, the search that finds the
 * other, the preview of the current choice, and whether the merge is in
 * flight or was refused. A preview answers for one choice of primary; an
 * answer for a choice the member has since changed is never confirmed.
 */

import type {
  PersonMergeConflict,
  PersonMergePreview,
} from "../../../../../../packages/contracts/generated/auth-client.ts";

/** A person as the dialog shows them. */
export interface MergePerson {
  readonly avatar?: { readonly color: string; readonly imageUrl?: string };
  readonly familyName?: string;
  readonly givenName: string;
  readonly id: string;
  readonly middleName?: string;
  readonly nickname?: string;
}

export interface MergeState {
  readonly anchor: MergePerson;
  /** The other person, once known. */
  readonly other?: MergePerson;
  /** The person who is kept. */
  readonly primaryId: string;
  readonly candidates: readonly MergePerson[];
  readonly searching: boolean;
  readonly searchStatus: string;
  /** What the server said merging into `primaryId` would do. */
  readonly preview?: {
    readonly primaryId: string;
    readonly value: PersonMergePreview;
  };
  readonly previewing: boolean;
  /** Advanced when the preview must be read again for the same choice. */
  readonly previewRound: number;
  /** Why the preview of the current choice was refused, or nothing. */
  readonly previewError: string;
  /** The merge is in flight; every control waits. */
  readonly saving: boolean;
  /** Why the last merge was refused, or nothing. */
  readonly error: string;
}

export type MergeAction =
  | { readonly type: "search-started" }
  | {
    readonly type: "search-answered";
    readonly candidates: readonly MergePerson[];
  }
  | { readonly type: "search-failed" }
  | { readonly type: "other-chosen"; readonly person: MergePerson }
  | { readonly type: "other-cleared" }
  | { readonly type: "primary-chosen"; readonly personId: string }
  | { readonly type: "preview-started" }
  | {
    readonly type: "preview-answered";
    readonly preview: PersonMergePreview;
    readonly primaryId: string;
  }
  | {
    readonly type: "preview-failed";
    readonly detail: string;
    readonly primaryId: string;
  }
  | { readonly type: "merge-started" }
  | { readonly type: "merge-failed"; readonly detail: string }
  /** Refused because the preview it was confirmed against is out of date. */
  | { readonly type: "merge-outdated"; readonly detail: string };

export function initialMergeState(
  people: { readonly anchor: MergePerson; readonly other?: MergePerson },
): MergeState {
  return {
    anchor: people.anchor,
    candidates: [],
    error: "",
    ...(people.other ? { other: people.other } : {}),
    previewError: "",
    previewRound: 0,
    previewing: false,
    primaryId: people.anchor.id,
    saving: false,
    searchStatus: "",
    searching: false,
  };
}

/** The state with no preview, as a changed choice leaves it. */
function unpreviewed(state: MergeState): MergeState {
  const { preview: _preview, ...rest } = state;
  return { ...rest, error: "", previewError: "", previewing: false };
}

export function mergeReducer(
  state: MergeState,
  action: MergeAction,
): MergeState {
  switch (action.type) {
    case "search-started":
      return { ...state, searchStatus: "Searching…", searching: true };
    case "search-answered":
      return {
        ...state,
        candidates: action.candidates,
        searchStatus: action.candidates.length === 0
          ? "No other person matches."
          : `${action.candidates.length} ${
            action.candidates.length === 1 ? "person" : "people"
          } found.`,
        searching: false,
      };
    case "search-failed":
      return {
        ...state,
        searchStatus: "People could not be searched. Try again.",
        searching: false,
      };
    case "other-chosen":
      return { ...unpreviewed(state), other: action.person };
    case "other-cleared": {
      const { other: _other, ...rest } = unpreviewed(state);
      return { ...rest, primaryId: state.anchor.id };
    }
    case "primary-chosen":
      return action.personId === state.anchor.id ||
          action.personId === state.other?.id
        ? { ...unpreviewed(state), primaryId: action.personId }
        : state;
    case "preview-started":
      return { ...state, previewError: "", previewing: true };
    case "preview-answered":
      return action.primaryId === state.primaryId
        ? {
          ...state,
          preview: { primaryId: action.primaryId, value: action.preview },
          previewing: false,
        }
        : state;
    case "preview-failed":
      return action.primaryId === state.primaryId
        ? { ...state, previewError: action.detail, previewing: false }
        : state;
    case "merge-started":
      return state.saving ? state : { ...state, error: "", saving: true };
    case "merge-failed":
      return { ...state, error: action.detail, saving: false };
    case "merge-outdated": {
      const { preview: _preview, ...rest } = state;
      return {
        ...rest,
        error: action.detail,
        previewRound: state.previewRound + 1,
        saving: false,
      };
    }
  }
}

/** The kept person, the folded one, and the preview of that choice. */
function previewed(state: MergeState) {
  if (!state.other || state.preview?.primaryId !== state.primaryId) {
    return undefined;
  }
  const kept = state.primaryId === state.other.id ? state.other : state.anchor;
  const folded = kept === state.anchor ? state.other : state.anchor;
  return { folded, kept, preview: state.preview.value };
}

/**
 * The confirmation the member sends: confirmed, against the revisions of both
 * people and the conflicts digest the preview they read named.
 */
export function mergeRequest(state: MergeState):
  | {
    readonly body: {
      readonly confirmed: true;
      readonly conflictsDigest: string;
      readonly duplicateId: string;
      readonly duplicateRevision: string;
      readonly primaryRevision: string;
    };
    readonly primaryId: string;
  }
  | undefined {
  const people = previewed(state);
  if (!people) return undefined;
  return {
    body: {
      confirmed: true,
      conflictsDigest: people.preview.conflictsDigest,
      duplicateId: people.folded.id,
      duplicateRevision: people.preview.duplicate.updatedAt,
      primaryRevision: people.preview.primary.updatedAt,
    },
    primaryId: people.kept.id,
  };
}

const FACTS: Readonly<Record<PersonMergeConflict["fact"], string>> = {
  avatar: "Photo",
  birthday: "Birthday",
  deceased: "Date of death",
  "first-meeting": "First meeting",
  first_met: "First met date",
  "stay-in-touch": "Stay in touch",
};

const COPIES =
  "exact copies of contact details, addresses, tags, and relationships are kept once";

/** What the confirmation says, in the member's name order. */
export function mergeSummary(
  state: MergeState,
  name: (person: MergePerson) => string,
):
  | {
    readonly conflicts: readonly string[];
    readonly moves: string;
    readonly warning: string;
  }
  | undefined {
  const people = previewed(state);
  if (!people) return undefined;
  const primary = name(people.kept);
  const duplicate = name(people.folded);
  const { conflicts, moves } = people.preview;
  const records = moves === 1
    ? `1 record that names ${duplicate} moves`
    : `${moves} records that name ${duplicate} move`;
  return {
    conflicts: conflicts.map((conflict) =>
      `${
        FACTS[conflict.fact]
      } — Kept: ${conflict.kept}, discarded: ${conflict.discarded}`
    ),
    moves: `${records} to ${primary}, and ${duplicate} is then deleted. ${
      conflicts.length > 0
        ? `Only one of each fact below can stay, so ${primary}'s is kept; ${COPIES}.`
        : `Nothing conflicts; ${COPIES}.`
    }`,
    warning: "A merge cannot be undone.",
  };
}
