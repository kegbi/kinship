import { assertEquals } from "../../../../testing/assert.ts";
import { plainText, sourceText, webAddress } from "./contact_source.ts";

Deno.test("[GAP-050] only UTF-8 text is read, with its byte-order mark dropped", () => {
  assertEquals(sourceText("﻿Name"), "Name");
  assertEquals(sourceText("Name"), "Name");
  assertEquals(sourceText(undefined), { problem: "The file text is missing." });
  assertEquals(sourceText(42), { problem: "The file text is missing." });
  const refused = {
    problem: "The file is not UTF-8 encoded. Save it as UTF-8 and try again.",
  };
  for (const text of ["￾N\u0000a", "a\u0000b", "J�rgen"]) {
    assertEquals(sourceText(text), refused, JSON.stringify(text));
  }
});

Deno.test("[GAP-050] text is kept plain, and only an http(s) URL is a website", () => {
  assertEquals(plainText(" a\u0007b\tc\nd\r "), "ab\tc\nd");
  assertEquals(plainText("   "), undefined);
  assertEquals(plainText(undefined), undefined);
  assertEquals(plainText("abcd", 3), undefined);
  assertEquals(webAddress(" https://example.com/a "), "https://example.com/a");
  assertEquals(webAddress("http://example.com"), "http://example.com");
  for (
    const text of [
      undefined,
      "",
      "not a url",
      "ftp://example.com",
      "javascript:alert(1)",
    ]
  ) {
    assertEquals(webAddress(text), undefined, String(text));
  }
});
