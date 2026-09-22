import { assertEquals } from "../../../testing/assert.ts";
import { encodeCursor } from "../../../shared-kernel/pagination.ts";
import {
  decodePersonFileCursor,
  encodePersonFileCursor,
  PERSON_FILE_CURSOR_VERSION,
  personFileKindRank,
} from "./cursors.ts";

const workspaceId = "30000000-0000-4000-8000-000000000001";
const personId = "30000000-0000-4000-8000-000000000002";
const fileId = "30000000-0000-4000-8000-000000000003";
const createdAt = "2026-01-01T00:00:00.000000Z";
const anchor = { createdAt, fileId, kind: "photo", sortOrder: 3 };

Deno.test("[GAP-023] photos rank ahead of documents and of anything else", () => {
  assertEquals(personFileKindRank("photo"), 0);
  assertEquals(personFileKindRank("document"), 1);
  assertEquals(personFileKindRank("avatar_candidate"), 1);
});

Deno.test("[GAP-023] a person-file cursor round trips through its own codec", () => {
  assertEquals(PERSON_FILE_CURSOR_VERSION, 1);
  const cursor = encodePersonFileCursor(anchor, workspaceId, personId);
  assertEquals(
    cursor,
    encodeCursor({
      createdAt,
      fileId,
      kind: "photo",
      personId,
      sortOrder: 3,
      version: 1,
      workspaceId,
    }),
    "the body is minted verbatim",
  );
  assertEquals(
    decodePersonFileCursor(cursor, workspaceId, personId),
    anchor,
  );
});

Deno.test("[GAP-023] a person-file cursor minted for another question is refused", () => {
  const cursor = encodePersonFileCursor(anchor, workspaceId, personId);
  assertEquals(
    decodePersonFileCursor(
      cursor,
      "30000000-0000-4000-8000-00000000000f",
      personId,
    ),
    undefined,
    "another workspace's files stay out of reach",
  );
  assertEquals(
    decodePersonFileCursor(
      cursor,
      workspaceId,
      "30000000-0000-4000-8000-00000000000f",
    ),
    undefined,
    "another person's files stay out of reach",
  );
});

Deno.test("[GAP-023] a forged or broken person-file cursor reads as nothing", () => {
  assertEquals(
    decodePersonFileCursor("forged", workspaceId, personId),
    undefined,
  );
  assertEquals(
    decodePersonFileCursor("!!not base64url!!", workspaceId, personId),
    undefined,
  );
  assertEquals(
    decodePersonFileCursor(encodeCursor(null), workspaceId, personId),
    undefined,
  );
  for (
    const body of [
      { ...anchor, personId, version: 2, workspaceId },
      { ...anchor, fileId: "not-a-uuid", personId, version: 1, workspaceId },
      { ...anchor, createdAt: "never", personId, version: 1, workspaceId },
      { ...anchor, kind: 4, personId, version: 1, workspaceId },
      { ...anchor, personId, sortOrder: 1.5, version: 1, workspaceId },
      { createdAt, fileId, personId, sortOrder: 3, version: 1, workspaceId },
    ]
  ) {
    assertEquals(
      decodePersonFileCursor(encodeCursor(body), workspaceId, personId),
      undefined,
      `${JSON.stringify(body)} is not a usable anchor`,
    );
  }
});
