/**
 * What merging two people means (GAP-049, PEOPLE-008).
 *
 * A merge keeps one person, the primary, and folds the duplicate into it:
 * every record anywhere in the workspace that pointed at the duplicate points
 * at the primary afterwards, and the duplicate is deleted the way a person
 * delete deletes one. It cannot be undone — there is no second record left to
 * restore — so the decision rules here are strict:
 *
 * - both people are in the workspace, neither is deleted, and neither is
 *   archived (an archived person is restored first);
 * - a revision either side was decided against must still be current;
 * - the primary keeps every value it has, and an empty value takes the
 *   duplicate's;
 * - of the single-valued important dates (birthday, date of death, first
 *   meeting) the primary keeps its own, and takes the duplicate's only when it
 *   has none.
 *
 * `reconcileReferences` is the postcondition the use case checks before it
 * commits: every reference to the duplicate that was counted before the merge
 * was either relinked or removed, and none is left.
 */

import type { ImportantDateRecord } from "./important_dates/rules.ts";
import type { PersonLifecycleState } from "./lifecycle_rules.ts";

/** A person as a merge reads them, locked. */
export interface MergeCandidate {
  readonly description?: string;
  readonly familyName?: string;
  readonly foodPreferences?: string;
  readonly genderOptionId?: string;
  readonly givenName: string;
  readonly id: string;
  readonly isDeceased: boolean;
  readonly isPartial: boolean;
  readonly isStarred: boolean;
  readonly lifecycle: PersonLifecycleState;
  readonly middleName?: string;
  readonly nickname?: string;
  readonly updatedAt: string;
}

/** The revisions a decision is checked against; a preview names none. */
export interface MergeRevisions {
  readonly duplicateRevision?: string;
  readonly primaryRevision?: string;
}

/**
 * What a member confirms: the duplicate, the revisions of both people the
 * confirmation showed them, and the digest of the conflicts it listed.
 */
export interface MergePeopleInput {
  /** `conflictsDigest` of the conflicts the confirmation showed. */
  readonly conflictsDigest: string;
  readonly duplicateId: string;
  readonly duplicateRevision: string;
  readonly primaryRevision: string;
}

/** A single-valued fact only one of the pair can keep. */
export type MergeConflictFact =
  | "avatar"
  | "birthday"
  | "deceased"
  | "first-meeting"
  | "first_met"
  | "stay-in-touch";

/**
 * One fact both people hold where only the primary's survives: what is kept
 * and what is discarded, worded for the confirmation, the kept value, and the
 * discarded value as the audit history keeps it.
 */
export interface MergeConflict {
  readonly discarded: string;
  readonly fact: MergeConflictFact;
  readonly kept: string;
  readonly keptSnapshot: Readonly<Record<string, unknown>>;
  readonly snapshot: Readonly<Record<string, unknown>>;
}

/** The people-owned single-valued facts a person holds. */
export interface PersonMergeFacts {
  readonly avatar?: {
    readonly externalUrl?: string;
    readonly fileId?: string;
    readonly source: string;
  };
  readonly dates: readonly ImportantDateRecord[];
  readonly firstMeeting?: {
    readonly introducedBy?: { readonly id: string; readonly name: string };
    readonly location?: { readonly id: string; readonly text: string };
    readonly notes?: string;
    readonly placeText?: string;
  };
}

/**
 * The duplicate's avatar image a merge leaves drawn by nobody (REL-063).
 *
 * The primary keeps its own avatar unless it has none, or has the default one
 * while the duplicate's is not; only then does the duplicate's become the
 * primary's. Otherwise the duplicate's image, whose link the files
 * participant moved to the primary, is no longer anybody's avatar and is
 * discarded once the merge commits. An image both people shared stays.
 */
export function unusedAvatarFile(
  primary: PersonMergeFacts,
  duplicate: PersonMergeFacts,
): string | undefined {
  const fileId = duplicate.avatar?.fileId;
  if (!fileId || fileId === primary.avatar?.fileId) return undefined;
  const taken = primary.avatar === undefined ||
    (primary.avatar.source === "default" &&
      duplicate.avatar?.source !== "default");
  return taken ? undefined : fileId;
}

export type MergeDecision =
  | { readonly status: "archived-write-rejected" }
  | { readonly status: "not-found" }
  | { readonly status: "proceed" }
  | { readonly status: "stale" };

/** The primary's identity once the duplicate's values have filled its gaps. */
export type MergedIdentity = Omit<
  MergeCandidate,
  "id" | "lifecycle" | "updatedAt"
>;

/** The kinds a person has at most one of (`person_dates_singleton_kind_unique`). */
export const SINGLE_VALUED_DATE_KINDS: ReadonlySet<string> = new Set([
  "birthday",
  "deceased",
  "first_met",
]);

/** Reference name (`crm.<table>.<column>`) to a row count. */
export type ReferenceCounts = Readonly<Record<string, number>>;

/** What a merge did to the references it found. */
export interface ReferenceOutcome {
  readonly relinked: ReferenceCounts;
  readonly removed: ReferenceCounts;
}

export function mergeDecision(
  primary: MergeCandidate | undefined,
  duplicate: MergeCandidate | undefined,
  input: MergeRevisions,
): MergeDecision {
  if (!primary || !duplicate) return { status: "not-found" };
  if (primary.lifecycle === "deleted" || duplicate.lifecycle === "deleted") {
    return { status: "not-found" };
  }
  if (primary.lifecycle === "archived" || duplicate.lifecycle === "archived") {
    return { status: "archived-write-rejected" };
  }
  if (
    (input.primaryRevision !== undefined &&
      input.primaryRevision !== primary.updatedAt) ||
    (input.duplicateRevision !== undefined &&
      input.duplicateRevision !== duplicate.updatedAt)
  ) {
    return { status: "stale" };
  }
  return { status: "proceed" };
}

function filled(primary?: string, duplicate?: string): string | undefined {
  return primary?.trim() ? primary : duplicate?.trim() ? duplicate : undefined;
}

export function mergedIdentity(
  primary: MergeCandidate,
  duplicate: MergeCandidate,
): MergedIdentity {
  const merged: Record<string, string | boolean | undefined> = {
    description: filled(primary.description, duplicate.description),
    familyName: filled(primary.familyName, duplicate.familyName),
    foodPreferences: filled(primary.foodPreferences, duplicate.foodPreferences),
    genderOptionId: filled(primary.genderOptionId, duplicate.genderOptionId),
    givenName: filled(primary.givenName, duplicate.givenName) ?? "",
    isDeceased: primary.isDeceased || duplicate.isDeceased,
    isPartial: primary.isPartial && duplicate.isPartial,
    isStarred: primary.isStarred || duplicate.isStarred,
    middleName: filled(primary.middleName, duplicate.middleName),
    nickname: filled(primary.nickname, duplicate.nickname),
  };
  return Object.fromEntries(
    Object.entries(merged).filter(([, value]) => value !== undefined),
  ) as unknown as MergedIdentity;
}

/**
 * Which of the duplicate's dates move to the primary and which are dropped: a
 * single-valued kind the primary already has stays the primary's.
 */
export function datePlan(
  primaryDates: readonly ImportantDateRecord[],
  duplicateDates: readonly ImportantDateRecord[],
): {
  readonly relink: readonly ImportantDateRecord[];
  readonly remove: readonly ImportantDateRecord[];
} {
  const held = new Set(
    primaryDates
      .filter((entry) => SINGLE_VALUED_DATE_KINDS.has(entry.kind))
      .map((entry) => entry.kind),
  );
  const remove = duplicateDates.filter((entry) => held.has(entry.kind));
  const relink = duplicateDates.filter((entry) => !held.has(entry.kind));
  return { relink, remove };
}

/**
 * The problems a merge left behind, or none. Each reference counted before
 * must be accounted for as relinked or removed, and nothing may still point
 * at the duplicate afterwards.
 */
export function reconcileReferences(
  before: ReferenceCounts,
  outcome: ReferenceOutcome,
  after: ReferenceCounts,
): readonly string[] {
  const names = [
    ...new Set([
      ...Object.keys(before),
      ...Object.keys(outcome.relinked),
      ...Object.keys(outcome.removed),
    ]),
  ].sort();
  const problems: string[] = [];
  for (const name of names) {
    const counted = before[name] ?? 0;
    const relinked = outcome.relinked[name] ?? 0;
    const removed = outcome.removed[name] ?? 0;
    if (counted !== relinked + removed) {
      problems.push(
        `${name}: ${counted} before, ${relinked} relinked, ${removed} removed`,
      );
    }
  }
  const remaining = Object.entries(after).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  for (const [name, left] of remaining) {
    if (left !== 0) {
      problems.push(`${name}: ${left} still reference the duplicate`);
    }
  }
  return problems;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** A remembered date as words, naming only the parts it has. */
export function partialDateText(
  value: Pick<
    ImportantDateRecord,
    "day" | "isYearApproximate" | "month" | "year"
  >,
): string {
  const year = value.year === undefined
    ? undefined
    : `${value.isYearApproximate ? "about " : ""}${value.year}`;
  const month = value.month === undefined ? undefined : MONTHS[value.month - 1];
  const day = value.day === undefined
    ? undefined
    : month
    ? String(value.day)
    : `day ${value.day}`;
  const text = [day, month, year].filter(Boolean).join(" ");
  return text || "an unknown date";
}

/** An object with its keys in order and its empty values left out. */
function sorted(
  fields: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) =>
        value !== undefined && value !== false && value !== ""
      )
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

type FirstMeeting = NonNullable<PersonMergeFacts["firstMeeting"]>;

function meetingText(meeting: FirstMeeting): string {
  const introducer = meeting.introducedBy?.name.trim();
  const parts = [
    meeting.placeText?.trim(),
    meeting.location?.text.trim(),
    introducer ? `introduced by ${introducer}` : undefined,
    meeting.notes?.trim(),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" — ") : "no details";
}

function meetingSnapshot(meeting: FirstMeeting) {
  return sorted({
    introducedByName: meeting.introducedBy?.name,
    introducedByPersonId: meeting.introducedBy?.id,
    location: meeting.location?.text,
    locationId: meeting.location?.id,
    notes: meeting.notes,
    placeText: meeting.placeText,
  });
}

function dateSnapshot(value: ImportantDateRecord) {
  return sorted({
    day: value.day,
    id: value.id,
    isYearApproximate: value.isYearApproximate,
    kind: value.kind,
    label: value.label,
    month: value.month,
    notes: value.notes,
    precision: value.precision,
    year: value.year,
  });
}

/** `value` as JSON with every object's keys in order, at any depth. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, field]) => field !== undefined)
      // An object's keys are distinct, so no two compare equal.
      .sort(([left], [right]) => (left < right ? -1 : 1));
    return `{${
      entries.map(([key, field]) =>
        `${JSON.stringify(key)}:${canonicalJson(field)}`
      ).join(",")
    }}`;
  }
  return JSON.stringify(value);
}

/**
 * The fingerprint of what a merge would discard: SHA-256, as hex, over each
 * conflict's fact and its kept and discarded snapshots, in a canonical order.
 * The wording is left out, so only a changed value changes it. A preview
 * hands it to the confirmation and the merge recomputes it from the pair it
 * locked; any difference means the member confirmed a list that is no longer
 * true — a date, a photo, or a cadence can change without touching either
 * person's revision.
 */
export async function conflictsDigest(
  conflicts: readonly MergeConflict[],
): Promise<string> {
  const entries = conflicts.map((conflict) =>
    canonicalJson({
      discarded: conflict.snapshot,
      fact: conflict.fact,
      kept: conflict.keptSnapshot,
    })
  ).sort();
  const bytes = new TextEncoder().encode(`[${entries.join(",")}]`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

/**
 * The people-owned facts only one of the pair can keep, in a fixed order:
 * the single-valued dates, the first meeting, and a photo. The merge drops
 * exactly these, so the preview and the audit history name the same list.
 */
export function peopleConflicts(
  primary: PersonMergeFacts,
  duplicate: PersonMergeFacts,
): readonly MergeConflict[] {
  const conflicts: MergeConflict[] = [];
  const plan = datePlan(primary.dates, duplicate.dates);
  for (const dropped of plan.remove) {
    const kept = primary.dates.find((entry) => entry.kind === dropped.kind)!;
    conflicts.push({
      discarded: partialDateText(dropped),
      fact: dropped.kind as MergeConflictFact,
      kept: partialDateText(kept),
      keptSnapshot: dateSnapshot(kept),
      snapshot: dateSnapshot(dropped),
    });
  }
  if (primary.firstMeeting && duplicate.firstMeeting) {
    conflicts.push({
      discarded: meetingText(duplicate.firstMeeting),
      fact: "first-meeting",
      kept: meetingText(primary.firstMeeting),
      keptSnapshot: meetingSnapshot(primary.firstMeeting),
      snapshot: meetingSnapshot(duplicate.firstMeeting),
    });
  }
  const pictured = (facts: PersonMergeFacts) =>
    facts.avatar !== undefined && facts.avatar.source !== "default";
  if (pictured(primary) && pictured(duplicate)) {
    conflicts.push({
      discarded: "The duplicate's photo will not be used",
      fact: "avatar",
      kept: "The primary's photo",
      keptSnapshot: sorted({ ...primary.avatar }),
      snapshot: sorted({ ...duplicate.avatar }),
    });
  }
  return conflicts;
}
