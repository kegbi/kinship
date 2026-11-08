/**
 * What a recorded interaction changes on its person's page (FEQ-10).
 *
 * The notes, activities, calls, and conversations cards each show how many
 * recent records of their kind the person has; the records themselves are
 * listed in the unified timeline, which reads itself again on
 * `PERSON_TIMELINE_CHANGED_EVENT`. A write answers with the record it
 * created, so a card counts that record instead of reading its list again:
 * `recentCardReducer` is the one pure transition fed by the creation event
 * (`INTERACTION_CREATED_EVENT`, or a card's own save). It reads again only
 * when the record cannot simply be counted — the card has not loaded, failed,
 * or holds a full page, which the new record may push another out of — and
 * `lastContactAfter` gives the hero the last contact the record makes.
 */

import type { Interaction } from "../../../../../packages/contracts/generated/auth-client.ts";
import type { PersonProfile } from "./section-mounts.ts";

export type RecordedKind = Interaction["kind"];

type Communication = Extract<Interaction, { kind: "call" | "conversation" }>;

/** One card's recent records: how many there are, once they are known. */
export type RecentCard =
  | { readonly status: "hidden" }
  | { readonly status: "loading"; readonly initial: boolean }
  | { readonly status: "ready"; readonly count: number }
  | { readonly status: "error" };

export type RecentCardEvent =
  | { readonly type: "loading" }
  | { readonly type: "loaded"; readonly count: number }
  | { readonly type: "failed" }
  | {
    /** The creation event: the record a write answered with, if any. */
    readonly type: "created";
    readonly detail: unknown;
    /** The card's kind, its person, and how many records its read lists. */
    readonly kind: RecordedKind;
    readonly personId: string;
    readonly limit: number;
  };

/** The card a page opens with: counted empty by the summary, or unread. */
export function initialRecentCard(
  hidden: boolean,
  total: number | undefined,
): RecentCard {
  if (hidden) return { status: "hidden" };
  return total === 0
    ? { count: 0, status: "ready" }
    : { initial: true, status: "loading" };
}

/**
 * The record `detail` names when it is an interaction recorded for
 * `personId`; `"unknown"` when the detail names no record at all, so what
 * changed cannot be told; `undefined` when it is someone else's.
 */
export function recordedFor(
  personId: string,
  detail: unknown,
): Interaction | "unknown" | undefined {
  if (!detail || typeof detail !== "object" || !("kind" in detail)) {
    return "unknown";
  }
  const record = detail as Interaction;
  // A call or a conversation names its person; a note or an activity its
  // participants, or a note its one person.
  const people = [
    ...("person" in record && record.person ? [record.person] : []),
    ...("participants" in record ? record.participants ?? [] : []),
  ];
  return people.some((person) => person.id === personId) ? record : undefined;
}

export function recentCardReducer(
  card: RecentCard,
  event: RecentCardEvent,
): RecentCard {
  switch (event.type) {
    case "loading":
      return card.status === "hidden"
        ? card
        : { initial: false, status: "loading" };
    case "loaded":
      return { count: event.count, status: "ready" };
    case "failed":
      return { status: "error" };
    case "created": {
      if (card.status === "hidden") return card;
      const record = recordedFor(event.personId, event.detail);
      if (record === undefined) return card;
      if (record !== "unknown" && record.kind !== event.kind) return card;
      if (
        record !== "unknown" && card.status === "ready" &&
        card.count < event.limit
      ) return { count: card.count + 1, status: "ready" };
      // A full page keeps its size, and an unread or failed card reads now.
      if (record !== "unknown" && card.status === "ready") return card;
      return { initial: false, status: "loading" };
    }
  }
}

/**
 * The sections whose records a recorded interaction or a timeline change
 * adds to: the ones the unified timeline merges.
 */
const RECORDED_SECTIONS: ReadonlySet<string> = new Set([
  "activities",
  "calls",
  "conversations",
  "life-events",
  "notes",
]);

/**
 * `profile` without the counts of the sections a write on the page has
 * recorded something in, which no longer say what those sections hold; an
 * owner without a count reads its section.
 */
export function withoutRecordedCounts(profile: PersonProfile): PersonProfile {
  const { summary } = profile;
  if (!summary) return profile;
  return {
    ...profile,
    summary: {
      ...summary,
      sectionCounts: summary.sectionCounts.filter((entry) =>
        !RECORDED_SECTIONS.has(entry.id)
      ),
    },
  };
}

/** The instant a call or conversation was last in contact. */
function contactedAt(record: Communication): string {
  if (record.kind === "call") return record.calledAt;
  return [record.happenedAt, ...record.messages.map((m) => m.writtenAt)]
    .reduce((latest, at) => Date.parse(at) > Date.parse(latest) ? at : latest);
}

/**
 * The person's last contact once `record` is saved: a call or a conversation
 * counts from its newest moment (the directory's rule, GAP-053); any other
 * record leaves it as it was.
 */
export function lastContactAfter(
  current: string | undefined,
  record: Interaction,
): string | undefined {
  if (record.kind !== "call" && record.kind !== "conversation") return current;
  const at = contactedAt(record);
  return current && Date.parse(current) >= Date.parse(at) ? current : at;
}
