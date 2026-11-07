/**
 * The pin on the download response the three file routes already produced.
 */

import { assertEquals, assertStatus } from "../backend/testing/assert.ts";
import { attachmentFilename, fileDownload } from "./downloads.ts";
import { GATEWAY_OWNED_HEADERS } from "./secure_headers.ts";

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
    ],
    [
      "private, no-store",
      `attachment; filename="profile.json"; filename*=UTF-8''profile.json`,
      "4",
      "application/json",
    ],
    "every header the file routes set is set here",
  );
  assertEquals(
    [...new Uint8Array(await response.arrayBuffer())],
    [1, 2, 3, 4],
    "the bytes are copied out of the caller's buffer",
  );
});

Deno.test("[SECA-13] a download leaves nosniff to the gateway, so it carries exactly one", async () => {
  const response = fileDownload({
    bytes: new Uint8Array([1]),
    filename: "card.vcf",
    mimeType: "text/vcard",
  });
  for (const header of GATEWAY_OWNED_HEADERS) {
    assertEquals(
      response.headers.get(header),
      null,
      `${header} is added by gateway/security_headers.conf; a second copy contradicts it`,
    );
  }
  const config = await Deno.readTextFile(
    new URL("../../gateway/security_headers.conf", import.meta.url),
  );
  assertEquals(
    config.match(/^add_header X-Content-Type-Options "nosniff" always;$/gm)
      ?.length,
    1,
    "the gateway adds the one copy to every response, downloads included",
  );
});

Deno.test("[PEOPLE-007] D3: only content addressed by an immutable id is cached", () => {
  const file = {
    bytes: new Uint8Array([1]),
    filename: "avatar.png",
    mimeType: "image/png",
  };
  assertEquals(
    fileDownload(file).headers.get("Cache-Control"),
    "private, no-store",
    "a download is never stored by default",
  );
  assertEquals(
    fileDownload(file, { immutable: true }).headers.get("Cache-Control"),
    "private, max-age=86400, immutable",
    "an immutable file id may be reused privately for a day",
  );
});
