import { assertEquals } from "../../../testing/assert.ts";
import { encodeCursor } from "../../../shared-kernel/pagination.ts";
import {
  decodeRelationshipCursor,
  decodeRelationshipTypeCursor,
  encodeRelationshipCursor,
  encodeRelationshipTypeCursor,
  RELATIONSHIP_CURSOR_VERSION,
} from "./cursors.ts";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const personId = "10000000-0000-4000-8000-000000000002";
const relationshipId = "10000000-0000-4000-8000-000000000003";
const typeId = "10000000-0000-4000-8000-000000000004";
const createdAt = "2026-01-01T00:00:00.000000Z";

const anchor = { createdAt, id: relationshipId };
const typeAnchor = { forwardLabel: "Mother", id: typeId, sortOrder: 7 };

Deno.test("[GAP-016] a relationship cursor round trips through its own codec", () => {
  assertEquals(RELATIONSHIP_CURSOR_VERSION, 1);
  const cursor = encodeRelationshipCursor(anchor, workspaceId, personId);
  assertEquals(
    cursor,
    encodeCursor({
      createdAt,
      id: relationshipId,
      personId,
      version: 1,
      workspaceId,
    }),
    "the body is minted verbatim",
  );
  assertEquals(
    decodeRelationshipCursor(cursor, workspaceId, personId),
    anchor,
  );
});

Deno.test("[GAP-016] a relationship cursor minted for another question is refused", () => {
  const cursor = encodeRelationshipCursor(anchor, workspaceId, personId);
  assertEquals(
    decodeRelationshipCursor(
      cursor,
      "10000000-0000-4000-8000-00000000000f",
      personId,
    ),
    undefined,
    "another workspace's rows stay out of reach",
  );
  assertEquals(
    decodeRelationshipCursor(
      cursor,
      workspaceId,
      "10000000-0000-4000-8000-00000000000f",
    ),
    undefined,
    "another person's page stays out of reach",
  );
});

Deno.test("[GAP-016] a forged or broken relationship cursor reads as nothing", () => {
  assertEquals(
    decodeRelationshipCursor("forged", workspaceId, personId),
    undefined,
  );
  assertEquals(
    decodeRelationshipCursor("!!not base64url!!", workspaceId, personId),
    undefined,
  );
  assertEquals(
    decodeRelationshipCursor(encodeCursor(null), workspaceId, personId),
    undefined,
  );
  for (
    const body of [
      { createdAt, id: relationshipId, personId, version: 2, workspaceId },
      { createdAt, id: "not-a-uuid", personId, version: 1, workspaceId },
      {
        createdAt: "never",
        id: relationshipId,
        personId,
        version: 1,
        workspaceId,
      },
      { id: relationshipId, personId, version: 1, workspaceId },
    ]
  ) {
    assertEquals(
      decodeRelationshipCursor(encodeCursor(body), workspaceId, personId),
      undefined,
      `${JSON.stringify(body)} is not a usable anchor`,
    );
  }
});

Deno.test("[GAP-016] a type cursor round trips and is bound to its search", () => {
  const cursor = encodeRelationshipTypeCursor(typeAnchor, workspaceId, "mo");
  assertEquals(
    cursor,
    encodeCursor({ ...typeAnchor, search: "mo", version: 1, workspaceId }),
    "the body is minted verbatim",
  );
  assertEquals(
    decodeRelationshipTypeCursor(cursor, workspaceId, "mo"),
    typeAnchor,
  );
  assertEquals(
    decodeRelationshipTypeCursor(cursor, workspaceId, ""),
    undefined,
    "a cursor minted under a search may not be replayed without it",
  );
  assertEquals(
    decodeRelationshipTypeCursor(
      cursor,
      "10000000-0000-4000-8000-00000000000f",
      "mo",
    ),
    undefined,
  );
});

Deno.test("[GAP-016] a forged or broken type cursor reads as nothing", () => {
  assertEquals(
    decodeRelationshipTypeCursor("forged", workspaceId, ""),
    undefined,
  );
  for (
    const body of [
      { ...typeAnchor, search: "", version: 2, workspaceId },
      { ...typeAnchor, id: "not-a-uuid", search: "", version: 1, workspaceId },
      { ...typeAnchor, forwardLabel: 5, search: "", version: 1, workspaceId },
      { ...typeAnchor, search: "", sortOrder: 1.5, version: 1, workspaceId },
      {
        forwardLabel: "Mother",
        id: typeId,
        search: "",
        version: 1,
        workspaceId,
      },
    ]
  ) {
    assertEquals(
      decodeRelationshipTypeCursor(encodeCursor(body), workspaceId, ""),
      undefined,
      `${JSON.stringify(body)} is not a usable anchor`,
    );
  }
});
