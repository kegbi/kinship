import {
  type CursorKeyset,
  decodeBase64Url,
  decodeCursor,
  encodeBase64Url,
  encodeCursor,
  signCursor,
  verifyCursor,
} from "./pagination.ts";
import { assert, assertRejects } from "../testing/assert.ts";

const keyset: CursorKeyset = {
  activeVersion: 2,
  keys: new Map([
    [1, new Uint8Array(32).fill(7)],
    [2, new Uint8Array(32).fill(9)],
  ]),
};
const anchor = {
  id: "00000000-0000-4000-8000-000000000010",
  updatedAt: "2026-09-16T10:00:00.000000Z",
  version: 2,
};

Deno.test("[GAP-006] base64url is url safe, unpadded, and strictly decoded", () => {
  const bytes = new Uint8Array([251, 255, 190, 0, 1]);
  const encoded = encodeBase64Url(bytes);
  assert(
    !/[+/=]/.test(encoded),
    `base64url must avoid +, / and padding, got ${encoded}`,
  );
  assert(
    [...(decodeBase64Url(encoded) ?? [])].join(",") === [...bytes].join(","),
    "a round trip returns the same bytes",
  );
  assert(decodeBase64Url("not base64!") === undefined, "alphabet is enforced");
  assert(
    decodeBase64Url(`${encoded}=`) === undefined,
    "a padded value is not canonical",
  );
  assert(encodeBase64Url(new Uint8Array()) === "", "empty bytes encode empty");
});

Deno.test("[GAP-006] an opaque cursor round trips its body", () => {
  const cursor = encodeCursor(anchor);
  assert(
    !/[+/=]/.test(cursor),
    `an opaque cursor must be url safe, got ${cursor}`,
  );
  const decoded = decodeCursor(cursor) as typeof anchor | undefined;
  assert(
    decoded?.id === anchor.id && decoded.updatedAt === anchor.updatedAt &&
      decoded.version === 2,
    "the decoded body matches what was encoded",
  );
});

Deno.test("[GAP-006] an unreadable opaque cursor decodes to undefined", () => {
  assert(decodeCursor("!!!!") === undefined, "a bad alphabet is rejected");
  assert(
    decodeCursor(encodeBase64Url(new TextEncoder().encode("{"))) === undefined,
    "truncated JSON is rejected",
  );
  assert(
    decodeCursor(encodeBase64Url(new Uint8Array([0xff, 0xfe]))) === undefined,
    "non-UTF-8 bytes are rejected",
  );
});

Deno.test("[GAP-006] a signed cursor is accepted only with its own key", async () => {
  const cursor = await signCursor("kinship.test.cursor.v1", anchor, keyset);
  assert(
    cursor.startsWith("v1.v2."),
    `a signed cursor names its format and key, got ${cursor}`,
  );
  const body = await verifyCursor("kinship.test.cursor.v1", cursor, keyset) as
    | typeof anchor
    | undefined;
  assert(body?.id === anchor.id, "the signed body survives verification");

  assert(
    await verifyCursor("kinship.other.cursor.v1", cursor, keyset) === undefined,
    "a cursor from another domain is rejected",
  );
  assert(
    await verifyCursor("kinship.test.cursor.v1", `${cursor}x`, keyset) ===
      undefined,
    "a tampered signature is rejected",
  );
  const [format, key, encodedBody, signature] = cursor.split(".");
  const forged = `${format}.${key}.${
    encodeBase64Url(new TextEncoder().encode(JSON.stringify({ id: "forged" })))
  }.${signature}`;
  assert(
    await verifyCursor("kinship.test.cursor.v1", forged, keyset) === undefined,
    "a swapped body is rejected",
  );
  assert(
    encodedBody !== undefined && encodedBody.length > 0,
    "the body is carried in the cursor",
  );
});

Deno.test("[GAP-006] signed cursors survive key rotation and refuse retired keys", async () => {
  const rotated: CursorKeyset = {
    activeVersion: 2,
    keys: new Map([[2, new Uint8Array(32).fill(9)]]),
  };
  const older = await signCursor("kinship.test.cursor.v1", anchor, {
    activeVersion: 1,
    keys: keyset.keys,
  });
  assert(
    await verifyCursor("kinship.test.cursor.v1", older, keyset) !== undefined,
    "a cursor signed with a still-published key verifies",
  );
  assert(
    await verifyCursor("kinship.test.cursor.v1", older, rotated) === undefined,
    "a cursor signed with a retired key is rejected",
  );
  await assertRejects(
    () =>
      signCursor("kinship.test.cursor.v1", anchor, {
        activeVersion: 3,
        keys: keyset.keys,
      }),
    "signing without the active key must fail loudly",
  );
});

Deno.test("[GAP-006] malformed signed cursors decode to undefined", async () => {
  for (
    const cursor of [
      "",
      "v1",
      "v1.v2.body",
      "v2.v2.body.signature",
      "v1.vx.body.signature",
      "v1.v0.body.signature",
      "v1.v9.body.signature",
      "v1.v2.!!!.signature",
      "v1.v2.body.!!!",
      "v1.v2.body.signature.extra",
    ]
  ) {
    assert(
      await verifyCursor("kinship.test.cursor.v1", cursor, keyset) ===
        undefined,
      `"${cursor}" must not verify`,
    );
  }
});
