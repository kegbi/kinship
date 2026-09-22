import { assertEquals } from "../../../testing/assert.ts";
import { encodeCursor } from "../../../shared-kernel/pagination.ts";
import {
  decodeGiftCursor,
  encodeGiftCursor,
  GIFT_CURSOR_VERSION,
} from "./cursors.ts";

const workspaceId = "20000000-0000-4000-8000-000000000001";
const personId = "20000000-0000-4000-8000-000000000002";
const recordId = "20000000-0000-4000-8000-000000000003";
const updatedAt = "2026-01-01T00:00:00.000000Z";
const anchor = { id: recordId, updatedAt };

Deno.test("[GAP-023] a gift cursor round trips through its own codec", () => {
  assertEquals(GIFT_CURSOR_VERSION, 1);
  const cursor = encodeGiftCursor("gift", anchor, workspaceId, personId);
  assertEquals(
    cursor,
    encodeCursor({
      collection: "gift",
      id: recordId,
      personId,
      updatedAt,
      version: 1,
      workspaceId,
    }),
    "the body is minted verbatim",
  );
  assertEquals(decodeGiftCursor("gift", cursor, workspaceId, personId), anchor);
});

Deno.test("[GAP-023] a gift cursor may not be replayed as a debt cursor", () => {
  const gift = encodeGiftCursor("gift", anchor, workspaceId, personId);
  const debt = encodeGiftCursor("debt", anchor, workspaceId, personId);
  assertEquals(
    decodeGiftCursor("debt", gift, workspaceId, personId),
    undefined,
    "the two collections page independently",
  );
  assertEquals(
    decodeGiftCursor("gift", debt, workspaceId, personId),
    undefined,
  );
  assertEquals(decodeGiftCursor("debt", debt, workspaceId, personId), anchor);
});

Deno.test("[GAP-023] a gift cursor minted for another question is refused", () => {
  const cursor = encodeGiftCursor("gift", anchor, workspaceId, personId);
  assertEquals(
    decodeGiftCursor(
      "gift",
      cursor,
      "20000000-0000-4000-8000-00000000000f",
      personId,
    ),
    undefined,
    "another workspace's rows stay out of reach",
  );
  assertEquals(
    decodeGiftCursor(
      "gift",
      cursor,
      workspaceId,
      "20000000-0000-4000-8000-00000000000f",
    ),
    undefined,
    "another person's section stays out of reach",
  );
});

Deno.test("[GAP-023] a forged or broken gift cursor reads as nothing", () => {
  assertEquals(
    decodeGiftCursor("gift", "forged", workspaceId, personId),
    undefined,
  );
  assertEquals(
    decodeGiftCursor("gift", "!!not base64url!!", workspaceId, personId),
    undefined,
  );
  assertEquals(
    decodeGiftCursor("gift", encodeCursor(null), workspaceId, personId),
    undefined,
  );
  for (
    const body of [
      {
        collection: "gift",
        id: recordId,
        personId,
        updatedAt,
        version: 2,
        workspaceId,
      },
      {
        collection: "gift",
        id: "not-a-uuid",
        personId,
        updatedAt,
        version: 1,
        workspaceId,
      },
      {
        collection: "gift",
        id: recordId,
        personId,
        updatedAt: "never",
        version: 1,
        workspaceId,
      },
      { collection: "gift", id: recordId, personId, version: 1, workspaceId },
    ]
  ) {
    assertEquals(
      decodeGiftCursor("gift", encodeCursor(body), workspaceId, personId),
      undefined,
      `${JSON.stringify(body)} is not a usable anchor`,
    );
  }
});
