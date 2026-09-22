import { assertEquals } from "../../../testing/assert.ts";
import { encodeCursor } from "../../../shared-kernel/pagination.ts";
import {
  decodeJournalCursor,
  encodeJournalCursor,
  JOURNAL_CURSOR_VERSION,
} from "./cursors.ts";

const workspaceId = "40000000-0000-4000-8000-000000000001";
const itemId = "40000000-0000-4000-8000-000000000002";
const createdAt = "2026-01-02T00:00:00.000000Z";
const occurredAt = "2026-01-01T00:00:00.000000Z";
const anchor = { createdAt, id: itemId, occurredAt };

Deno.test("[GAP-023] a journal cursor round trips through its own codec", () => {
  assertEquals(JOURNAL_CURSOR_VERSION, 1);
  const cursor = encodeJournalCursor(anchor, workspaceId);
  assertEquals(
    cursor,
    encodeCursor({
      createdAt,
      id: itemId,
      occurredAt,
      version: 1,
      workspaceId,
    }),
    "the body is minted verbatim",
  );
  assertEquals(decodeJournalCursor(cursor, workspaceId), anchor);
});

Deno.test("[GAP-023] a journal cursor minted for another workspace is refused", () => {
  const cursor = encodeJournalCursor(anchor, workspaceId);
  assertEquals(
    decodeJournalCursor(cursor, "40000000-0000-4000-8000-00000000000f"),
    undefined,
    "another workspace's journal stays out of reach",
  );
});

Deno.test("[GAP-023] a forged or broken journal cursor reads as nothing", () => {
  assertEquals(decodeJournalCursor("forged", workspaceId), undefined);
  assertEquals(
    decodeJournalCursor("!!not base64url!!", workspaceId),
    undefined,
  );
  assertEquals(decodeJournalCursor(encodeCursor(null), workspaceId), undefined);
  for (
    const body of [
      { ...anchor, version: 2, workspaceId },
      { ...anchor, id: "not-a-uuid", version: 1, workspaceId },
      { ...anchor, createdAt: "never", version: 1, workspaceId },
      { ...anchor, occurredAt: "never", version: 1, workspaceId },
      { createdAt, id: itemId, version: 1, workspaceId },
    ]
  ) {
    assertEquals(
      decodeJournalCursor(encodeCursor(body), workspaceId),
      undefined,
      `${JSON.stringify(body)} is not a usable anchor`,
    );
  }
});
