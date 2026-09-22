/**
 * How a person's files are paged.
 *
 * One listing serves both profile cards — photos first, then documents — so
 * the anchor is the whole four-part order the listing reads in: which card the
 * row belongs to, where the member dragged it inside that card, when the file
 * was stored, and the file's own identifier to break the tie. Anything less
 * would let a page boundary fall between two rows that sort the same way and
 * quietly drop one.
 *
 * The cursor carries the workspace and the person it was minted for, so one
 * replayed against another person's files is refused rather than answered. It
 * needs no signature: the anchor is re-validated against rows the caller is
 * already allowed to see, and what it carries narrows the query rather than
 * widening it. Decoding never throws: an unreadable cursor is `undefined`,
 * which the use case reports as a rejected query.
 */

import {
  decodeCursor,
  encodeCursor,
} from "../../../shared-kernel/pagination.ts";
import { isInstant, uuid } from "../../../shared-kernel/validation.ts";

/** The cursor body shape currently minted; older ones are stale by design. */
export const PERSON_FILE_CURSOR_VERSION = 1;

/** Where a page of one person's files resumes. */
export interface PersonFilePageAnchor {
  readonly createdAt: string;
  readonly fileId: string;
  /** The link kind, which is what puts photos before documents. */
  readonly kind: string;
  /** The member's own order inside that kind. */
  readonly sortOrder: number;
}

interface EncodedPersonFileCursor extends PersonFilePageAnchor {
  readonly personId: string;
  readonly version: 1;
  readonly workspaceId: string;
}

/** Photos sort before documents; everything else sorts with documents. */
export function personFileKindRank(kind: string): number {
  return kind === "photo" ? 0 : 1;
}

/** The cursor that resumes this person's files after the given anchor. */
export function encodePersonFileCursor(
  anchor: PersonFilePageAnchor,
  workspaceId: string,
  personId: string,
): string {
  return encodeCursor(
    {
      createdAt: anchor.createdAt,
      fileId: anchor.fileId,
      kind: anchor.kind,
      personId,
      sortOrder: anchor.sortOrder,
      version: PERSON_FILE_CURSOR_VERSION,
      workspaceId,
    } satisfies EncodedPersonFileCursor,
  );
}

/** The anchor a file cursor decodes to, or `undefined`. */
export function decodePersonFileCursor(
  value: string,
  workspaceId: string,
  personId: string,
): PersonFilePageAnchor | undefined {
  const parsed = decodeCursor(value) as
    | Partial<EncodedPersonFileCursor>
    | undefined;
  if (
    parsed?.version !== PERSON_FILE_CURSOR_VERSION ||
    parsed.workspaceId !== workspaceId || parsed.personId !== personId ||
    uuid(parsed.fileId) === undefined || typeof parsed.kind !== "string" ||
    !Number.isSafeInteger(parsed.sortOrder) || !isInstant(parsed.createdAt)
  ) return undefined;
  return {
    createdAt: parsed.createdAt,
    fileId: parsed.fileId!,
    kind: parsed.kind,
    sortOrder: parsed.sortOrder!,
  };
}
