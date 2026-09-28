/**
 * What acting on several people at once means (GAP-051, PEOPLE-009).
 *
 * A bulk action is the single-person action repeated, one person at a time,
 * each in its own transaction, so one refused person never undoes another.
 * These rules decide only what the repetition itself adds: which requests are
 * well formed, when an item is already in the state it was asked for, what a
 * tag list becomes, and the one stable code a refused item is reported with.
 */

import type {
  PersonLifecycleState,
  PersonTransition,
} from "./lifecycle_rules.ts";

/** How many people one request may name, and one selection may hold. */
export const BULK_PEOPLE_LIMIT = 100;

export type BulkPeopleAction = PersonTransition | "tag" | "untag";

export interface BulkPeopleInput {
  readonly action: BulkPeopleAction;
  readonly personIds: readonly string[];
  readonly tagId?: string;
}

export type BulkItemOutcome = "done" | "failed" | "skipped" | "unchanged";

export type BulkFailureCode =
  | "archived_write_rejected"
  | "forbidden"
  | "invalid"
  | "not_found"
  | "section_hidden"
  | "stale"
  | "tag_unavailable"
  | "unavailable";

export interface BulkItemResult {
  readonly code?: BulkFailureCode;
  readonly outcome: BulkItemOutcome;
  readonly personId: string;
}

export type BulkSummary = Readonly<Record<BulkItemOutcome, number>>;

/** Why a request cannot be run at all, by field. */
export function bulkInputErrors(
  input: BulkPeopleInput,
): Readonly<Record<string, string>> {
  const errors: Record<string, string> = {};
  const count = input.personIds.length;
  if (count === 0 || count > BULK_PEOPLE_LIMIT) {
    errors.personIds = `Select between 1 and ${BULK_PEOPLE_LIMIT} people.`;
  } else if (new Set(input.personIds).size !== count) {
    errors.personIds = "Select each person once.";
  }
  const tagging = input.action === "tag" || input.action === "untag";
  if (tagging && !input.tagId) errors.tagId = "Choose a tag.";
  if (!tagging && input.tagId !== undefined) {
    errors.tagId = "Only tagging names a tag.";
  }
  return errors;
}

/**
 * Whether archiving or restoring this person changes anything. Asking for
 * the state a person is already in is `unchanged`, never a conflict.
 */
export function transitionPlan(
  action: PersonTransition,
  lifecycle: PersonLifecycleState,
): "not-found" | "proceed" | "unchanged" {
  if (lifecycle === "deleted") return "not-found";
  const target = action === "archive" ? "archived" : "active";
  return lifecycle === target ? "unchanged" : "proceed";
}

/** The tag list a person keeps after one tag is added or removed. */
export function tagChange(
  action: "tag" | "untag",
  current: readonly string[],
  tagId: string,
):
  | { readonly status: "unchanged" }
  | { readonly status: "change"; readonly tagIds: readonly string[] } {
  const tagged = current.includes(tagId);
  if (action === "tag") {
    return tagged
      ? { status: "unchanged" }
      : { status: "change", tagIds: [...current, tagId] };
  }
  return tagged
    ? { status: "change", tagIds: current.filter((id) => id !== tagId) }
    : { status: "unchanged" };
}

const FAILURE_CODES: Readonly<Record<string, BulkFailureCode>> = {
  "archived-write-rejected": "archived_write_rejected",
  forbidden: "forbidden",
  hidden: "section_hidden",
  "invalid-reference": "tag_unavailable",
  "not-found": "not_found",
  stale: "stale",
  "validation-error": "invalid",
};

/** The stable code a refused item is reported with. */
export function bulkFailureCode(status: string): BulkFailureCode {
  return FAILURE_CODES[status] ?? "unavailable";
}

/** How many items ended each way. */
export function bulkSummary(results: readonly BulkItemResult[]): BulkSummary {
  const summary = { done: 0, failed: 0, skipped: 0, unchanged: 0 };
  for (const result of results) summary[result.outcome] += 1;
  return summary;
}
