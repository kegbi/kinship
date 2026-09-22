/**
 * How a person's gifts and debts are paged.
 *
 * Two collections hang off one person and one answer carries both, so each
 * gets its own cursor rather than sharing one that would have to say which
 * half it belonged to. Both resume from the same keyset anchor shape — the
 * `updated_at desc, id` pair the listing orders by — and both carry the
 * workspace and the person they were minted for, so a cursor replayed against
 * another tenant's listing or another person's section is refused rather than
 * silently answered with rows the caller never asked about.
 *
 * Neither cursor needs a signature: the anchor is re-validated against rows
 * the caller is already allowed to see, and what the cursor carries narrows
 * the query rather than widening it. Minting and reading one is arithmetic
 * over the anchor, not a database concern, so both codecs live beside the
 * gifts they page. Decoding never throws: an unreadable cursor is `undefined`,
 * which the use case reports as a rejected query.
 */

import {
  decodeCursor,
  encodeCursor,
} from "../../../shared-kernel/pagination.ts";
import { isInstant, uuid } from "../../../shared-kernel/validation.ts";

/** The cursor body shape currently minted; older ones are stale by design. */
export const GIFT_CURSOR_VERSION = 1;

/** Which of the two collections a cursor pages. */
export type GiftCursorCollection = "debt" | "gift";

/** Where a page of gifts or of debts resumes. */
export interface GiftPageAnchor {
  readonly id: string;
  readonly updatedAt: string;
}

interface EncodedGiftCursor extends GiftPageAnchor {
  readonly collection: GiftCursorCollection;
  readonly personId: string;
  readonly version: 1;
  readonly workspaceId: string;
}

/** The cursor that resumes one of the two collections after the anchor. */
export function encodeGiftCursor(
  collection: GiftCursorCollection,
  anchor: GiftPageAnchor,
  workspaceId: string,
  personId: string,
): string {
  return encodeCursor(
    {
      collection,
      id: anchor.id,
      personId,
      updatedAt: anchor.updatedAt,
      version: GIFT_CURSOR_VERSION,
      workspaceId,
    } satisfies EncodedGiftCursor,
  );
}

/**
 * The anchor a cursor decodes to, or `undefined` when it is not one this
 * listing minted. The collection is part of the match, so a gift cursor
 * replayed as a debt cursor is refused rather than paging the wrong table.
 */
export function decodeGiftCursor(
  collection: GiftCursorCollection,
  value: string,
  workspaceId: string,
  personId: string,
): GiftPageAnchor | undefined {
  const parsed = decodeCursor(value) as
    | Partial<EncodedGiftCursor>
    | undefined;
  if (
    parsed?.version !== GIFT_CURSOR_VERSION ||
    parsed.collection !== collection || parsed.workspaceId !== workspaceId ||
    parsed.personId !== personId || uuid(parsed.id) === undefined ||
    !isInstant(parsed.updatedAt)
  ) return undefined;
  return { id: parsed.id!, updatedAt: parsed.updatedAt };
}
