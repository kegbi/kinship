/**
 * How a profile section is paged.
 *
 * Two listings page inside one request: the facts themselves, and the
 * workspace vocabulary a fact may point at. Each resumes from a keyset anchor
 * carried in an opaque cursor, and each cursor also carries what it was minted
 * for — the person, the section, the person's revision, the option search —
 * so a cursor replayed against a different question is refused rather than
 * silently answered.
 *
 * Minting and reading a cursor is arithmetic over the anchor, not a database
 * concern, so both codecs live beside the facts they page. Decoding never
 * throws: an unreadable cursor is `undefined`, which the use case reports as a
 * stale cursor.
 */

import {
  decodeCursor,
  encodeCursor,
} from "../../../../shared-kernel/pagination.ts";
import { uuid } from "../../../../shared-kernel/validation.ts";
import type { ProfileFactSection } from "./values.ts";

/** How many facts one page of a section carries. */
export const PROFILE_FACT_PAGE_SIZE = 50;
/** How many vocabulary entries one page of options carries. */
export const PROFILE_FACT_OPTION_PAGE_SIZE = 50;
/** The cursor body shape currently minted; older ones are stale by design. */
export const PROFILE_FACT_CURSOR_VERSION = 2;

/** The revision spelling a cursor is allowed to carry. */
const REVISION_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Where a page of facts resumes. */
export interface ProfileFactPageAnchor {
  readonly id: string;
  readonly updatedAt: string;
}

/** Where a page of vocabulary options resumes. */
export interface ProfileFactOptionAnchor {
  readonly id: string;
  readonly primary: string;
  readonly secondary: string;
}

export interface ProfileFactCursor extends ProfileFactPageAnchor {
  readonly limit: typeof PROFILE_FACT_PAGE_SIZE;
  readonly personId: string;
  readonly personUpdatedAt: string;
  readonly section: ProfileFactSection;
  readonly version: 2;
}

export interface ProfileFactOptionCursor extends ProfileFactOptionAnchor {
  readonly limit: 50;
  readonly personId: string;
  readonly search: string;
  readonly section: ProfileFactSection;
  readonly version: 2;
}

/** The cursor a fact page decodes to, or `undefined` when it is not one. */
export function decodeFactCursor(value: string): ProfileFactCursor | undefined {
  const parsed = decodeCursor(value) as Partial<ProfileFactCursor> | undefined;
  return parsed?.version === PROFILE_FACT_CURSOR_VERSION &&
      parsed.limit === PROFILE_FACT_PAGE_SIZE &&
      uuid(parsed.id) !== undefined && uuid(parsed.personId) !== undefined &&
      REVISION_PATTERN.test(parsed.updatedAt ?? "") &&
      REVISION_PATTERN.test(parsed.personUpdatedAt ?? "") &&
      typeof parsed.section === "string"
    ? parsed as ProfileFactCursor
    : undefined;
}

/** The cursor an option page decodes to, or `undefined`. */
export function decodeOptionCursor(
  value: string,
): ProfileFactOptionCursor | undefined {
  const parsed = decodeCursor(value) as
    | Partial<ProfileFactOptionCursor>
    | undefined;
  return parsed?.version === PROFILE_FACT_CURSOR_VERSION &&
      parsed.limit === PROFILE_FACT_OPTION_PAGE_SIZE &&
      uuid(parsed.id) !== undefined && uuid(parsed.personId) !== undefined &&
      typeof parsed.primary === "string" &&
      typeof parsed.secondary === "string" &&
      typeof parsed.search === "string" &&
      typeof parsed.section === "string"
    ? parsed as ProfileFactOptionCursor
    : undefined;
}

/** The cursor that resumes this section's facts after the given anchor. */
export function encodeFactCursor(input: {
  readonly anchor: ProfileFactPageAnchor;
  readonly personId: string;
  readonly personUpdatedAt: string;
  readonly section: ProfileFactSection;
}): string {
  return encodeCursor({
    id: input.anchor.id,
    limit: PROFILE_FACT_PAGE_SIZE,
    personId: input.personId,
    personUpdatedAt: input.personUpdatedAt,
    section: input.section,
    updatedAt: input.anchor.updatedAt,
    version: PROFILE_FACT_CURSOR_VERSION,
  });
}

/** The cursor that resumes this section's options after the given anchor. */
export function encodeOptionCursor(input: {
  readonly anchor: ProfileFactOptionAnchor;
  readonly personId: string;
  readonly search: string;
  readonly section: ProfileFactSection;
}): string {
  return encodeCursor({
    ...input.anchor,
    limit: PROFILE_FACT_OPTION_PAGE_SIZE,
    personId: input.personId,
    search: input.search,
    section: input.section,
    version: PROFILE_FACT_CURSOR_VERSION,
  });
}

/**
 * True when a decoded fact cursor was minted for exactly this question.
 *
 * The person's revision is part of the match, so a listing resumed after the
 * person changed starts over rather than paging a snapshot that no longer
 * exists.
 */
export function factCursorMatches(
  cursor: ProfileFactCursor | undefined,
  question: {
    readonly personId: string;
    readonly personUpdatedAt: string;
    readonly section: ProfileFactSection;
  },
): cursor is ProfileFactCursor {
  return cursor !== undefined && cursor.section === question.section &&
    cursor.personId === question.personId &&
    cursor.personUpdatedAt === question.personUpdatedAt;
}

/** True when a decoded option cursor was minted for exactly this question. */
export function optionCursorMatches(
  cursor: ProfileFactOptionCursor | undefined,
  question: {
    readonly personId: string;
    readonly search: string;
    readonly section: ProfileFactSection;
  },
): cursor is ProfileFactOptionCursor {
  return cursor !== undefined && cursor.section === question.section &&
    cursor.personId === question.personId &&
    cursor.search === question.search;
}
