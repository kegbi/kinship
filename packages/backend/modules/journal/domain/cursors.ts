/**
 * How the journal is paged.
 *
 * The timeline reads newest first, and two items written in the same moment
 * are separated by when the row was created and then by its identifier, so the
 * anchor carries all three: fewer keys would let a page boundary fall between
 * two items that sort the same way and drop one.
 *
 * The codec lives in the journal module rather than in the read model that
 * serves the list, because what a journal item sorts by is the module's rule,
 * not the projection's. `public.ts` publishes it, so
 * `read-models/journal-timeline` reaches it the way any other consumer does.
 *
 * The cursor carries the workspace it was minted for, so one replayed against
 * another tenant's journal is refused rather than answered. It needs no
 * signature: the anchor is re-validated against rows the caller is already
 * allowed to see, and what it carries narrows the query rather than widening
 * it. Decoding never throws: an unreadable cursor is `undefined`, which the
 * read model reports as a rejected query.
 */

import {
  decodeCursor,
  encodeCursor,
} from "../../../shared-kernel/pagination.ts";
import { isInstant, uuid } from "../../../shared-kernel/validation.ts";

/** The cursor body shape currently minted; older ones are stale by design. */
export const JOURNAL_CURSOR_VERSION = 1;

/** Where a page of the journal resumes. */
export interface JournalPageAnchor {
  readonly createdAt: string;
  readonly id: string;
  readonly occurredAt: string;
}

interface EncodedJournalCursor extends JournalPageAnchor {
  readonly version: 1;
  readonly workspaceId: string;
}

/** The cursor that resumes this workspace's journal after the anchor. */
export function encodeJournalCursor(
  anchor: JournalPageAnchor,
  workspaceId: string,
): string {
  return encodeCursor(
    {
      createdAt: anchor.createdAt,
      id: anchor.id,
      occurredAt: anchor.occurredAt,
      version: JOURNAL_CURSOR_VERSION,
      workspaceId,
    } satisfies EncodedJournalCursor,
  );
}

/** The anchor a journal cursor decodes to, or `undefined`. */
export function decodeJournalCursor(
  value: string,
  workspaceId: string,
): JournalPageAnchor | undefined {
  const parsed = decodeCursor(value) as
    | Partial<EncodedJournalCursor>
    | undefined;
  if (
    parsed?.version !== JOURNAL_CURSOR_VERSION ||
    parsed.workspaceId !== workspaceId || uuid(parsed.id) === undefined ||
    !isInstant(parsed.createdAt) || !isInstant(parsed.occurredAt)
  ) return undefined;
  return {
    createdAt: parsed.createdAt,
    id: parsed.id!,
    occurredAt: parsed.occurredAt,
  };
}
