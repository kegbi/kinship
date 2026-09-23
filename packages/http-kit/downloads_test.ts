/**
 * The pin on the download response the three file routes already produced.
 */

import { assertEquals, assertStatus } from "../backend/testing/assert.ts";
import { attachmentFilename, fileDownload } from "./downloads.ts";

Deno.test("[GAP-020] a plain name is offered as an attachment twice over", () => {
  assertEquals(
    attachmentFilename("export.json"),
    `attachment; filename="export.json"; filename*=UTF-8''export.json`,
    "the ASCII fallback and the encoded name agree",
  );
});

Deno.test("[GAP-020] a name that could break the header is neutralized", () => {
  assertEquals(
    attachmentFilename('a"b\\c\r\nd.txt'),
    `attachment; filename="a_b_c__d.txt"; filename*=UTF-8''a%22b%5Cc%0D%0Ad.txt`,
    "quotes, backslashes, and newlines cannot leave the quoted string",
  );
  assertEquals(
    attachmentFilename("Ada Lovelace — notes.pdf"),
    `attachment; filename="Ada Lovelace _ notes.pdf"; filename*=UTF-8''Ada%20Lovelace%20%E2%80%94%20notes.pdf`,
    "a non-ASCII name survives in the encoded form",
  );
});

Deno.test("[GAP-020] the download carries its length, type, and cache rules", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);

  const response = fileDownload({
    bytes,
    filename: "profile.json",
    mimeType: "application/json",
  });

  assertStatus(response, 200);
  assertEquals(
    [
      response.headers.get("Cache-Control"),
      response.headers.get("Content-Disposition"),
      response.headers.get("Content-Length"),
      response.headers.get("Content-Type"),
      response.headers.get("X-Content-Type-Options"),
    ],
    [
      "private, no-store",
      `attachment; filename="profile.json"; filename*=UTF-8''profile.json`,
      "4",
      "application/json",
      "nosniff",
    ],
    "every header the file routes set is set here",
  );
  assertEquals(
    [...new Uint8Array(await response.arrayBuffer())],
    [1, 2, 3, 4],
    "the bytes are copied out of the caller's buffer",
  );
});
