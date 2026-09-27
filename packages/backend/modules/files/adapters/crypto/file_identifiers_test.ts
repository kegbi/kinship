import {
  WebCryptoFileIdentifiers,
  WebCryptoObjectKeys,
} from "./file_identifiers.ts";
import { assert } from "../../../../testing/assert.ts";

Deno.test("[FILES-001] file ids and object keys are distinct opaque identifiers", () => {
  const fileId = new WebCryptoFileIdentifiers().next();
  const first = new WebCryptoObjectKeys().next();
  const second = new WebCryptoObjectKeys().next();
  assert(/^[0-9a-f-]{36}$/.test(fileId), "file id is opaque UUID");
  assert(
    first.startsWith("objects/") && first !== second,
    "storage keys are generated and unique",
  );
});
