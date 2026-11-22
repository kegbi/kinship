/**
 * What a journal entry is, and what a member has to write for one to be kept.
 *
 * The journal keeps three kinds of item — a written post, a linked activity,
 * and one rating per day — and only the first and the last carry anything the
 * member typed. The rules for those two are here: how long the text may be,
 * what counts as a point in time, what counts as a calendar day, and the range
 * a rating falls in.
 *
 * A day is the rule worth naming. `2026-02-31` matches the shape of a date and
 * is not one, so the text is round-tripped through the calendar rather than
 * only matched against a pattern; the shared kernel's `isoDate` stops at the
 * pattern because its callers hand it dates the database already issued.
 */

import type { Instant } from "../../../shared-kernel/clock.ts";
import { deterministicId } from "../../../shared-kernel/ids.ts";
import { boundedText, isInstant } from "../../../shared-kernel/validation.ts";

/** The namespace that makes a post creation idempotent across retries. */
export const JOURNAL_POST_ID_NAMESPACE = "kinship.journal.post-id.v1";

export interface StoredJournalPost {
  readonly body: string;
  readonly createdAt: string;
  readonly id: string;
  readonly occurredAt: string;
  readonly title?: string;
  readonly updatedAt: string;
}

export interface StoredDayRating {
  readonly comment?: string;
  readonly createdAt: string;
  readonly id: string;
  readonly ratedOn: string;
  readonly rating: number;
  readonly updatedAt: string;
}

/** What a member writes when they post, or edit a post. */
export interface JournalPostInput {
  readonly body: string;
  readonly occurredAt: string;
  readonly title?: string;
}

/** A post creation, optionally named by a retry-safe request identifier. */
export interface JournalPostCreateInput extends JournalPostInput {
  readonly requestId?: string;
}

/** A post edit, optionally checked against the revision it was made from. */
export interface JournalPostUpdateInput extends JournalPostInput {
  readonly expectedUpdatedAt?: string;
}

/** What a member writes when they rate a day. */
export interface DayRatingInput {
  readonly comment?: string;
  readonly ratedOn: string;
  readonly rating: number;
}

/** The canonical post a write proceeds with. */
export interface JournalPostValues {
  readonly body: string;
  readonly occurredAt: Date;
  readonly title?: string;
}

/** The canonical rating a write proceeds with. */
export interface DayRatingValues {
  readonly comment?: string;
  readonly ratedOn: string;
  readonly rating: number;
}

/** The lowest and highest a day may be rated. */
export const DAY_RATING_RANGE = { maximum: 5, minimum: 1 } as const;

/** The point in time itself, because the repository writes a `Date`. */
export function instant(value: string | Instant): Date | undefined {
  return isInstant(value) ? new Date(value) : undefined;
}

/**
 * A calendar day, or `undefined` when the text only looks like one.
 *
 * The round trip is the whole rule: a day that does not survive being read and
 * written back is a day the calendar does not have.
 */
export function calendarDate(value: string): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

/**
 * The canonical post, or nothing when the member has to fix something.
 *
 * A title is optional, so an absent one is fine and a present but unusable one
 * is not: that asymmetry is the only subtlety in either of these rules.
 */
export function validateJournalPost(
  input: JournalPostInput,
): JournalPostValues | undefined {
  const body = boundedText(input.body, 50_000);
  const occurredAt = instant(input.occurredAt);
  const title = boundedText(input.title, 500);
  if (!body || !occurredAt || (input.title !== undefined && !title)) {
    return undefined;
  }
  return { body, occurredAt, ...(title ? { title } : {}) };
}

/** The canonical rating, or nothing when the member has to fix something. */
export function validateDayRating(
  input: DayRatingInput,
): DayRatingValues | undefined {
  const ratedOn = calendarDate(input.ratedOn);
  const comment = boundedText(input.comment, 10_000);
  if (
    !ratedOn || !Number.isInteger(input.rating) ||
    input.rating < DAY_RATING_RANGE.minimum ||
    input.rating > DAY_RATING_RANGE.maximum ||
    (input.comment !== undefined && !comment)
  ) return undefined;
  return { ...(comment ? { comment } : {}), ratedOn, rating: input.rating };
}

/**
 * The post identifier a request identifier names inside a workspace (MCP-D4).
 *
 * Two retries of one creation derive the same identifier, so the second finds
 * the row the first wrote; another workspace's identical request identifier
 * derives a different one.
 */
export function deriveJournalPostId(
  workspaceId: string,
  requestId: string,
): Promise<string> {
  return deterministicId(JOURNAL_POST_ID_NAMESPACE, [workspaceId, requestId]);
}

/**
 * True when a stored post is the one a retried creation describes: the same
 * body, the same title or none, and the same moment however its offset was
 * spelled.
 */
export function postMatches(
  stored: StoredJournalPost,
  values: JournalPostValues,
): boolean {
  return stored.body === values.body && stored.title === values.title &&
    Date.parse(stored.occurredAt) === values.occurredAt.valueOf();
}
