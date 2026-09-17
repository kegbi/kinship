/**
 * How a person's relationships and the workspace's relationship types are
 * paged.
 *
 * Two listings page inside this module: the edges hanging off one person, and
 * the vocabulary a new edge may point at. Each resumes from a keyset anchor
 * carried in an opaque cursor, and each cursor also carries what it was minted
 * for — the workspace, and either the person or the search text — so a cursor
 * replayed against a different question is refused rather than silently
 * answered with somebody else's rows.
 *
 * Neither cursor needs a signature: both anchors are re-validated against rows
 * the caller is already allowed to see, and the filters they carry narrow the
 * query rather than widening it. Minting and reading one is arithmetic over
 * the anchor, not a database concern, so both codecs live here. Decoding never
 * throws: an unreadable cursor is `undefined`, which the use case reports as a
 * stale cursor.
 */

import {
  decodeCursor,
  encodeCursor,
} from "../../../shared-kernel/pagination.ts";
import { isInstant, uuid } from "../../../shared-kernel/validation.ts";

/** The cursor body shape currently minted; older ones are stale by design. */
export const RELATIONSHIP_CURSOR_VERSION = 1;

/** Where a page of one person's relationships resumes. */
export interface RelationshipCursor {
  readonly createdAt: string;
  readonly id: string;
}

/** Where a page of the workspace's relationship types resumes. */
export interface RelationshipTypeAnchor {
  readonly forwardLabel: string;
  readonly id: string;
  readonly sortOrder: number;
}

interface EncodedRelationshipCursor extends RelationshipCursor {
  readonly personId: string;
  readonly version: 1;
  readonly workspaceId: string;
}

interface EncodedRelationshipTypeCursor extends RelationshipTypeAnchor {
  readonly search: string;
  readonly version: 1;
  readonly workspaceId: string;
}

/** The cursor that resumes this person's relationships after the anchor. */
export function encodeRelationshipCursor(
  anchor: RelationshipCursor,
  workspaceId: string,
  personId: string,
): string {
  return encodeCursor(
    {
      createdAt: anchor.createdAt,
      id: anchor.id,
      personId,
      version: RELATIONSHIP_CURSOR_VERSION,
      workspaceId,
    } satisfies EncodedRelationshipCursor,
  );
}

/** The anchor a relationship cursor decodes to, or `undefined`. */
export function decodeRelationshipCursor(
  value: string,
  workspaceId: string,
  personId: string,
): RelationshipCursor | undefined {
  const parsed = decodeCursor(value) as
    | Partial<EncodedRelationshipCursor>
    | undefined;
  if (
    parsed?.version !== RELATIONSHIP_CURSOR_VERSION ||
    parsed.workspaceId !== workspaceId || parsed.personId !== personId ||
    uuid(parsed.id) === undefined || !isInstant(parsed.createdAt)
  ) return undefined;
  return { createdAt: parsed.createdAt, id: parsed.id! };
}

/** The cursor that resumes the type vocabulary after the given anchor. */
export function encodeRelationshipTypeCursor(
  anchor: RelationshipTypeAnchor,
  workspaceId: string,
  search: string,
): string {
  return encodeCursor(
    {
      ...anchor,
      search,
      version: RELATIONSHIP_CURSOR_VERSION,
      workspaceId,
    } satisfies EncodedRelationshipTypeCursor,
  );
}

/** The anchor a type cursor decodes to, or `undefined`. */
export function decodeRelationshipTypeCursor(
  value: string,
  workspaceId: string,
  search: string,
): RelationshipTypeAnchor | undefined {
  const parsed = decodeCursor(value) as
    | Partial<EncodedRelationshipTypeCursor>
    | undefined;
  if (
    parsed?.version !== RELATIONSHIP_CURSOR_VERSION ||
    parsed.workspaceId !== workspaceId || parsed.search !== search ||
    uuid(parsed.id) === undefined ||
    typeof parsed.forwardLabel !== "string" ||
    !Number.isSafeInteger(parsed.sortOrder)
  ) return undefined;
  return {
    forwardLabel: parsed.forwardLabel,
    id: parsed.id!,
    sortOrder: parsed.sortOrder!,
  };
}
