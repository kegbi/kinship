import { assertEquals } from "../../../../testing/assert.ts";
import { canonicalJson, jsonObject, sha256Hex } from "./canonical.ts";

Deno.test("[GAP-018] a record is a record, and an array or a null is not", () => {
  assertEquals(jsonObject({ a: 1 }), { a: 1 });
  assertEquals(jsonObject([]), undefined);
  assertEquals(jsonObject(null), undefined);
  assertEquals(jsonObject(undefined), undefined);
  assertEquals(jsonObject("text"), undefined);
  assertEquals(jsonObject(7), undefined);
});

Deno.test("[GAP-018] canonical text sorts keys so two spellings of a record hash alike", () => {
  assertEquals(
    canonicalJson({ b: 1, a: 2 }),
    '{"a":2,"b":1}',
  );
  assertEquals(
    canonicalJson({ a: 2, b: 1 }),
    canonicalJson({ b: 1, a: 2 }),
  );
  assertEquals(canonicalJson([3, "x", null]), '[3,"x",null]');
  assertEquals(
    canonicalJson({ nested: { z: [{ y: 1 }] } }),
    '{"nested":{"z":[{"y":1}]}}',
  );
  assertEquals(canonicalJson('q"uote'), '"q\\"uote"');
  assertEquals(canonicalJson(null), "null");
  assertEquals(canonicalJson(-1.5), "-1.5");
  assertEquals(canonicalJson(true), "true");
  assertEquals(canonicalJson([]), "[]");
  assertEquals(canonicalJson({}), "{}");
});

Deno.test("[GAP-018] an absent property is rendered as a word, not dropped", () => {
  // Every fingerprint in `import_runs` was computed over text that spells an
  // absent source UUID out. Dropping the key here would silently invalidate
  // all of them, so the rendering is pinned rather than tidied.
  assertEquals(
    canonicalJson({ present: 1, missing: undefined }),
    '{"missing":undefined,"present":1}',
  );
  assertEquals(
    canonicalJson([1, undefined]),
    "[1,]",
    "a list renders the same absence as nothing, because join does",
  );
});

Deno.test("[GAP-018] the digest is pinned to fixed vectors", () => {
  return Promise.all([
    sha256Hex(""),
    sha256Hex("[]"),
    sha256Hex("abc"),
    sha256Hex(new TextEncoder().encode("abc")),
  ]).then(([empty, emptyArray, text, bytes]) => {
    assertEquals(
      empty,
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
    assertEquals(
      emptyArray,
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
      "the empty attachment manifest every artifact carries",
    );
    assertEquals(
      text,
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    assertEquals(bytes, text, "bytes and their text hash alike");
  });
});
